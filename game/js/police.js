// police.js — a proper five-star heat system. Crimes raise the level, cruisers spawn
// off-screen and pursue with siren and flashing bars, and officers deploy on foot. From
// three stars SBPD dispatch closes the road ahead: two cruisers parked diagonally in a V
// across the lanes, striped police barriers between them (knockable at speed) and a fan of
// burning red road flares, while the Air One helicopter shadows the player and pins them in
// its searchlight. Dispatch calls go to the HUD as radio chatter. Break line of sight far
// enough for long enough and the stars cool down one by one (faster with Elena on comms).
// All original "Solaris Bay PD" imagery.

import { CITY, PALETTE, clamp, createRandom, rgb } from './config.js';
import { createVehicle, updateVehicle, vehicleForward } from './vehicles.js';

const STAR_NAMES = ['CLEAR', 'HEAT 1', 'HEAT 2', 'HEAT 3', 'HEAT 4', 'HEAT 5'];
/** Roadblocks go up from this many stars. */
export const ROADBLOCK_STARS = 3;

export function createPolice(world, combat, bus) {
  const random = createRandom(0x5ab0c0);
  const cruisers = [];
  const roadblockCars = [];
  const roadblocks = [];
  let wanted = 0;
  let heatTimer = 0;
  let spawnTimer = 0;
  let roadblockTimer = 0;
  let time = 0;
  let evasion = false;
  let lastRaise = -10;
  let officersDeployed = new Set();
  let peak = 0;
  let chasePeak = 0;
  let helicopter = null;

  function raise(amount = 1, reason = '') {
    if (amount <= 0) return;
    const before = wanted;
    wanted = clamp(wanted + amount, 0, 5);
    heatTimer = 0;
    lastRaise = time;
    evasion = false;
    if (wanted > before) {
      bus.onWanted?.(wanted, reason);
      if (wanted >= ROADBLOCK_STARS && before < ROADBLOCK_STARS) roadblockTimer = 2.5;
    }
    peak = Math.max(peak, wanted);
    chasePeak = Math.max(chasePeak, wanted);
  }

  function setWanted(level) {
    wanted = clamp(level, 0, 5);
    heatTimer = 0;
    evasion = false;
    peak = Math.max(peak, wanted);
    chasePeak = Math.max(chasePeak, wanted);
    bus.onWanted?.(wanted, '');
  }

  function setPeak(level) {
    peak = Math.max(peak, clamp(level, 0, 5));
  }

  function clear() {
    wanted = 0;
    heatTimer = 0;
    evasion = false;
    for (const car of cruisers) removeCruiser(car);
    cruisers.length = 0;
    for (const car of roadblockCars) removeCruiser(car);
    roadblockCars.length = 0;
    roadblocks.length = 0;
    officersDeployed.clear();
    helicopter = null;
    chasePeak = 0;
  }

  /**
   * The air unit: arrives at three stars, circles just ahead of the player at rooftop
   * height, sweeps its searchlight onto them, and peels away once the heat drops.
   */
  function updateHelicopter(dt, player) {
    if (wanted >= 3) {
      if (!helicopter) {
        helicopter = { x: player.x + 120, z: player.z - 90, y: 30, heading: 0, spotX: player.x, spotZ: player.z, leaving: false };
        bus.onHelicopter?.(helicopter);
      }
      helicopter.leaving = false;
      const orbit = time * 0.35;
      const hx = player.x + Math.cos(orbit) * 26, hz = player.z + Math.sin(orbit) * 26;
      const dx = hx - helicopter.x, dz = hz - helicopter.z;
      const dist = Math.hypot(dx, dz);
      const step = Math.min(dist, 34 * dt);
      if (dist > 0.01) {
        helicopter.x += (dx / dist) * step;
        helicopter.z += (dz / dist) * step;
        helicopter.heading = Math.atan2(dx, dz);
      }
      helicopter.y += (22 + Math.sin(time * 0.8) * 1.5 - helicopter.y) * Math.min(1, dt * 0.8);
      // The searchlight lags the target a little, so a fast car can slip out of it.
      const k = Math.min(1, dt * 2.2);
      helicopter.spotX += (player.x - helicopter.spotX) * k;
      helicopter.spotZ += (player.z - helicopter.spotZ) * k;
    } else if (helicopter) {
      helicopter.leaving = true;
      helicopter.y += dt * 6;
      helicopter.x += Math.sin(helicopter.heading) * 30 * dt;
      helicopter.z += Math.cos(helicopter.heading) * 30 * dt;
      if (helicopter.y > 90) helicopter = null;
    }
  }

  /** Park the air unit at a fixed hover for staged frames. */
  function stageHelicopter(h) {
    helicopter = { leaving: false, ...h };
    return helicopter;
  }

  function removeCruiser(car) {
    car.removed = true;
    bus.onPoliceRemoved?.(car);
  }

  function spawnCruiser(offsetDir = null, distance = 140) {
    const angle = offsetDir ?? random() * Math.PI * 2;
    let x = 0, z = 0, heading = 0;
    if (bus.playerPosition) {
      const target = bus.playerPosition();
      x = target.x + Math.sin(angle) * distance;
      z = target.z + Math.cos(angle) * distance;
      heading = Math.atan2(target.x - x, target.z - z);
    }
    // Keep the spawn on the land and out of buildings.
    if (world.isWater(x, z) || world.insideBuilding(x, z)) {
      const road = world.randomRoadPoint(bus.playerPosition ? bus.playerPosition().x : 0, bus.playerPosition ? bus.playerPosition().z : 0, 90, 200, random);
      x = road.x;
      z = road.z;
      heading = angle;
    }
    const car = createVehicle('cruiser', x, z, heading, { police: true, sirenOn: true, health: 130 });
    car.police = true;
    car.sirenOn = true;
    car.pursuit = true;
    car.officers = 0;
    car.sirenPhase = random() * 10;
    car.y = world.groundHeight(x, z) + 0.02;
    car.maxHealth = 130;
    car.health = 130;
    car.throttle = 0;
    cruisers.push(car);
    bus.onPoliceSpawned?.(car);
    return car;
  }

  /** A road name for dispatch chatter. */
  function streetName(x, z, road) {
    if (road && road.axis === 'x' && Math.abs(road.z1 - CITY.boulevardZ) < 2) return 'Ocean Boulevard';
    if (road?.bridge) return 'the Marina Causeway';
    return world.districtName(x, z);
  }

  /**
   * Lay out one roadblock across a road: centre (cx, cz), road direction `along` (yaw),
   * `toward` = +1/-1 for the side the suspect approaches from, `half` = half road width.
   * Two cruisers sit diagonally in a V, three striped barriers close the gaps, and a fan of
   * red flares burns on the asphalt in front.
   */
  function layRoadblock(cx, cz, along, toward, half, options = {}) {
    const dx = Math.sin(along) * toward, dz = Math.cos(along) * toward;
    const px = dz, pz = -dx;
    const at = (a, s) => [cx + dx * a + px * s, cz + dz * a + pz * s];
    const block = { x: cx, z: cz, along, toward, half, cars: [], barriers: [], flares: [], born: time, street: options.street ?? '' };
    for (const side of [-1, 1]) {
      const [x, z] = at(0, side * half * 0.4);
      // Nose-in diagonals: each points across the lanes toward the centre line and the
      // oncoming suspect, so the pair forms a V with push-bars and lightbars facing them.
      const heading = Math.atan2(-side * px + dx * 0.8, -side * pz + dz * 0.8);
      let car;
      if (options.staged) car = spawnStagedCruiser(x, z, heading, { roadblock: true });
      else {
        car = createVehicle('cruiser', x, z, heading, { police: true, sirenOn: true, health: 130 });
        car.police = true;
        car.roadblock = true;
        car.maxHealth = 130;
        car.health = 130;
        car.y = world.groundHeight(x, z) + 0.02;
        roadblockCars.push(car);
        bus.onPoliceSpawned?.(car);
      }
      car.sirenOn = true;
      car.braking = true;
      car.sirenPhase = side * 0.31;
      block.cars.push(car);
    }
    const barrierYaw = along;
    for (const s of [-0.86, 0, 0.86]) {
      const [x, z] = at(s === 0 ? 3.2 : 1.4, s * half);
      block.barriers.push({ x, z, rot: barrierYaw, knocked: false, tilt: 0, spin: 0, fallYaw: 0, slide: 0 });
    }
    for (let i = 0; i < 7; i += 1) {
      const u = (i - 3) / 3;
      const [x, z] = at(9 + (i % 2) * 2.4 + Math.abs(u) * -1.5, u * half * 0.82);
      block.flares.push({ x, z, phase: i * 1.37, life: 1 });
    }
    roadblocks.push(block);
    return block;
  }

  function spawnRoadblock() {
    const player = bus.playerPosition ? bus.playerPosition() : { x: 0, z: 0 };
    const v = bus.playerVehicle ? bus.playerVehicle() : null;
    const forward = v ? vehicleForward(v) : [0, 1];
    let cx = player.x + forward[0] * 110;
    let cz = player.z + forward[1] * 110;
    const road = world.nearestRoad(cx, cz);
    let along = Math.atan2(forward[0], forward[1]);
    let half = 9;
    if (road && road.distance < 45) {
      cx = road.px; cz = road.pz;
      along = road.axis === 'x' ? Math.PI / 2 : 0;
      half = Math.min(14, road.w / 2 - 1.5);
    }
    if (world.isWater(cx, cz) || world.insideBuilding(cx, cz)) return null;
    // The flares face the suspect: flip the layout to the side the player is coming from.
    const toward = (player.x - cx) * Math.sin(along) + (player.z - cz) * Math.cos(along) >= 0 ? 1 : -1;
    const street = streetName(cx, cz, road);
    const block = layRoadblock(cx, cz, along, toward, half, { street });
    // Officers take cover behind the cruisers.
    for (const car of block.cars) {
      const ox = car.x - Math.sin(along) * toward * 4 + (random() - 0.5) * 2;
      const oz = car.z - Math.cos(along) * toward * 4 + (random() - 0.5) * 2;
      combat.spawnEnemy(ox, oz, { style: 'cop', police: true, health: 95, damage: 9, weapon: 'pistol', stationary: true, cash: 0, range: 55 });
    }
    bus.onRoadblock?.(block);
    return block;
  }

  /** Barriers fly when a car ploughs through them; flares slowly burn down. */
  function updateRoadblocks(dt, playerVehicle) {
    for (let i = roadblocks.length - 1; i >= 0; i -= 1) {
      const block = roadblocks[i];
      if (block.cars.every((c) => c.removed)) { roadblocks.splice(i, 1); continue; }
      for (const f of block.flares) f.life = Math.max(0.35, f.life - dt * 0.004);
      for (const bar of block.barriers) {
        if (!bar.knocked && playerVehicle && Math.abs(playerVehicle.speed) > 5) {
          const d = Math.hypot(bar.x - playerVehicle.x, bar.z - playerVehicle.z);
          if (d < 2.4) {
            bar.knocked = true;
            bar.fallYaw = Math.atan2(playerVehicle.velocityX, playerVehicle.velocityZ);
            bar.spin = 3 + Math.abs(playerVehicle.speed) * 0.08;
            bar.slide = Math.abs(playerVehicle.speed) * 0.45;
            playerVehicle.speed *= 0.82;
            playerVehicle.velocityX *= 0.82;
            playerVehicle.velocityZ *= 0.82;
            bus.onBarrierHit?.(bar);
          }
        }
        if (bar.knocked && bar.tilt < 1.5) {
          bar.tilt = Math.min(1.5, bar.tilt + bar.spin * dt);
          bar.x += Math.sin(bar.fallYaw) * bar.slide * dt;
          bar.z += Math.cos(bar.fallYaw) * bar.slide * dt;
          bar.slide *= Math.max(0, 1 - dt * 2.5);
        }
      }
    }
  }

  /** Photo mode: a fully dressed roadblock at a fixed spot. */
  function stageRoadblock(cx, cz, along, toward, half, street = 'Ocean Boulevard') {
    return layRoadblock(cx, cz, along, toward, half, { staged: true, street });
  }

  function update(dt, player, playerVehicle) {
    time += dt;
    updateHelicopter(dt, player);
    if (player.dead) {
      // The city loses interest while the player is down.
      heatTimer += dt;
    }
    const targetX = player.x, targetZ = player.z;
    let nearestSiren = Infinity;
    let seen = false;

    // Keep the wanted level populated with cruisers when the player is wanted.
    spawnTimer -= dt;
    const allowed = wanted === 0 ? 0 : Math.min(5, wanted + 1);
    const active = cruisers.filter((c) => !c.removed);
    if (spawnTimer <= 0 && active.length < allowed && wanted > 0) {
      const burst = wanted >= 3 ? 2 : 1;
      for (let i = 0; i < burst && active.length + i < allowed; i += 1) {
        spawnCruiser(null, wanted >= 4 ? 110 : 150);
      }
      spawnTimer = Math.max(1.8, 4.6 - wanted * 0.5);
    }

    for (let i = cruisers.length - 1; i >= 0; i -= 1) {
      const car = cruisers[i];
      if (car.removed) { cruisers.splice(i, 1); continue; }
      const dx = targetX - car.x, dz = targetZ - car.z;
      const dist = Math.hypot(dx, dz);
      nearestSiren = Math.min(nearestSiren, dist);
      if (dist < 120) seen = true;
      car.sirenPhase += dt;
      car.sirenOn = wanted > 0 && dist < 220;

      if (dist > 360) {
        removeCruiser(car);
        cruisers.splice(i, 1);
        continue;
      }

      if (car.remote) {
        // Parked/mission police cars simply wait with their bars lit.
        car.speed = 0;
        continue;
      }

      // Pursue the player's car (predicting a little) or pull up beside a suspect on foot.
      const lead = playerVehicle ? 0.28 : 0;
      const px = player.x + (playerVehicle ? playerVehicle.velocityX * lead : 0);
      const pz = player.z + (playerVehicle ? playerVehicle.velocityZ * lead : 0);
      const toX = px - car.x, toZ = pz - car.z;
      const toDist = Math.hypot(toX, toZ) || 1;
      const desiredHeading = Math.atan2(toX, toZ);
      let diff = desiredHeading - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      const stopDist = playerVehicle ? 5.5 : 24;
      let throttle = toDist > stopDist ? 1 : toDist < stopDist - 4 ? -0.5 : 0;
      // Do not plow into the player at 0 stars' worth of patience: ramming is the job.
      let steer = clamp(diff * 1.4, -1, 1);
      if (Math.abs(diff) > 1.2 && toDist < 14) throttle = -0.7;
      const handbrake = Math.abs(diff) > 0.85 && Math.abs(car.speed) > 12 && wanted >= 2;
      const boost = wanted >= 3 && toDist > 32;
      const speeds = updateVehicle(car, { throttle, steer, handbrake, boost }, dt, world);
      for (const ev of speeds) {
        if (ev === 'crash' || ev === 'crashHard') bus.onCrash?.(car, ev);
      }
      car.police = true;
      car.sirenOn = true;
      // Ram damage.
      if (playerVehicle && dist < 3.6) {
        const push = (3.6 - dist) / 2;
        const nx = dx / (dist || 1), nz = dz / (dist || 1);
        car.x -= nx * push;
        car.z -= nz * push;
        playerVehicle.x += nx * push;
        playerVehicle.z += nz * push;
        const impact = Math.abs(car.speed) + Math.abs(playerVehicle.speed);
        if (impact > 9 && time - (car.lastRam ?? -10) > 0.7) {
          car.lastRam = time;
          car.health -= impact * 0.25;
          playerVehicle.health = Math.max(0, playerVehicle.health - impact * 0.42 * (playerVehicle.damageScale ?? 1));
          bus.onCrash?.(car, 'ram');
        }
      }
      // On foot: deploy officers when the cruiser gets close.
      if (!playerVehicle && dist < 30 && car.speed < 6 && !car.deployed && wanted > 0) {
        car.deployed = true;
        const forward = vehicleForward(car);
        for (let o = 0; o < Math.min(2, wanted); o += 1) {
          const side = o === 0 ? 1 : -1;
          combat.spawnEnemy(car.x + forward[1] * side * 2.4, car.z - forward[0] * side * 2.4, {
            style: 'cop', police: true, health: 90, damage: 8, weapon: o === 0 ? 'pistol' : 'smg', cash: 0, range: 50,
          });
        }
        bus.onOfficers?.(car);
      }
      if (car.health <= 0) {
        // Wrecked cruiser: smoke and a final pair of officers, then fade out.
        car.sirenOn = false;
        if (!car.wrecked) {
          car.wrecked = true;
          bus.onWreck?.(car);
          for (let o = 0; o < 2; o += 1) {
            combat.spawnEnemy(car.x + (random() - 0.5) * 5, car.z + (random() - 0.5) * 5, {
              style: 'cop', police: true, health: 85, damage: 8, cash: 0, range: 50,
            });
          }
        }
      }
    }

    // Roadblocks from three stars: dispatch closes the road ahead of a driving suspect.
    if (wanted >= ROADBLOCK_STARS && playerVehicle) {
      roadblockTimer -= dt;
      if (roadblockTimer <= 0) {
        roadblockTimer = wanted >= 4 ? 16 : 24;
        if (roadblockCars.filter((c) => !c.removed).length < 6) spawnRoadblock();
      }
    }
    updateRoadblocks(dt, playerVehicle);
    for (let i = roadblockCars.length - 1; i >= 0; i -= 1) {
      const car = roadblockCars[i];
      if (car.removed) { roadblockCars.splice(i, 1); continue; }
      car.sirenOn = true;
      car.sirenPhase += dt;
      car.speed = 0;
      if (Math.hypot(car.x - targetX, car.z - targetZ) > 380) {
        removeCruiser(car);
        roadblockCars.splice(i, 1);
      }
    }

    // Evasion / cool-down.
    if (wanted > 0) {
      if (seen) {
        heatTimer = 0;
        evasion = false;
      } else {
        // Elena on comms reads the SBPD band and steers the cool-down along.
        heatTimer += dt * (bus.heatCoolRate?.() ?? 1);
        evasion = heatTimer > 3;
        if (heatTimer > 11 && time - lastRaise > 11) {
          wanted = Math.max(0, wanted - 1);
          heatTimer = 4;
          bus.onWantedCool?.(wanted);
          if (wanted === 0) {
            bus.onEvaded?.(chasePeak);
            chasePeak = 0;
            evasion = false;
            for (const car of cruisers) removeCruiser(car);
            cruisers.length = 0;
            for (const car of roadblockCars) removeCruiser(car);
            roadblockCars.length = 0;
            roadblocks.length = 0;
          }
        }
      }
    } else {
      evasion = false;
      heatTimer = 0;
    }

    bus.onSirenLevel?.(nearestSiren);
  }

  function allCars() {
    return cruisers.concat(roadblockCars);
  }

  function spawnStagedCruiser(x, z, heading, options = {}) {
    const car = createVehicle('cruiser', x, z, heading, { police: true, sirenOn: true, health: 140 });
    car.police = true;
    car.sirenOn = true;
    car.staged = true;
    car.remote = true;
    car.maxHealth = 140;
    car.health = 140;
    car.y = world.groundHeight(x, z) + 0.02;
    if (options.roadblock) roadblockCars.push(car);
    else cruisers.push(car);
    return car;
  }

  return {
    cruisers,
    roadblockCars,
    allCars,
    update,
    raise,
    setWanted,
    clear,
    setPeak,
    spawnCruiser,
    spawnStagedCruiser,
    stageHelicopter,
    stageRoadblock,
    spawnRoadblock,
    roadblocks,
    get chasePeak() { return chasePeak; },
    get helicopter() { return helicopter; },
    get wanted() { return wanted; },
    get evasion() { return evasion; },
    get nearestSiren() { return 0; },
    get label() { return STAR_NAMES[wanted] ?? 'CLEAR'; },
    get peak() { return peak; },
    get time() { return time; },
  };
}
