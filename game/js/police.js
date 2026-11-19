// police.js — a proper five-star heat system. Crimes raise the level, cruisers spawn
// off-screen and pursue with siren and flashing bars, officers deploy on foot, and at
// four stars the force sets a roadblock. Break line of sight far enough for long
// enough and the stars cool down one by one. All original "Solaris Bay PD" imagery.

import { CITY, PALETTE, clamp, createRandom, rgb } from './config.js';
import { createVehicle, updateVehicle, vehicleForward } from './vehicles.js';

const STAR_NAMES = ['CLEAR', 'HEAT 1', 'HEAT 2', 'HEAT 3', 'HEAT 4', 'HEAT 5'];

export function createPolice(world, combat, bus) {
  const random = createRandom(0x5ab0c0);
  const cruisers = [];
  const roadblockCars = [];
  let wanted = 0;
  let heatTimer = 0;
  let spawnTimer = 0;
  let roadblockTimer = 0;
  let time = 0;
  let evasion = false;
  let lastRaise = -10;
  let officersDeployed = new Set();
  let peak = 0;

  function raise(amount = 1, reason = '') {
    if (amount <= 0) return;
    const before = wanted;
    wanted = clamp(wanted + amount, 0, 5);
    heatTimer = 0;
    lastRaise = time;
    evasion = false;
    if (wanted > before) {
      bus.onWanted?.(wanted, reason);
      if (wanted >= 4 && before < 4) roadblockTimer = 0.1;
    }
    peak = Math.max(peak, wanted);
  }

  function setWanted(level) {
    wanted = clamp(level, 0, 5);
    heatTimer = 0;
    evasion = false;
    peak = Math.max(peak, wanted);
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
    officersDeployed.clear();
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

  function spawnRoadblock() {
    const player = bus.playerPosition ? bus.playerPosition() : { x: 0, z: 0 };
    const v = bus.playerVehicle ? bus.playerVehicle() : null;
    const forward = v ? vehicleForward(v) : [0, 1];
    const cx = player.x + forward[0] * 110;
    const cz = player.z + forward[1] * 110;
    const heading = Math.atan2(forward[0], forward[1]) + Math.PI / 2;
    for (const side of [-1, 1]) {
      const x = clamp(cx + Math.cos(heading) * side * 5.5, world.bounds.minX + 10, world.bounds.maxX - 10);
      const z = clamp(cz - Math.sin(heading) * side * 5.5, world.bounds.minZ + 10, world.bounds.maxZ - 10);
      if (world.isWater(x, z) || world.insideBuilding(x, z)) continue;
      const car = createVehicle('cruiser', x, z, heading, { police: true, sirenOn: true, health: 130 });
      car.police = true;
      car.sirenOn = true;
      car.roadblock = true;
      car.maxHealth = 130;
      car.health = 130;
      car.y = world.groundHeight(x, z) + 0.02;
      roadblockCars.push(car);
      bus.onPoliceSpawned?.(car);
      // Officers take cover behind the roadblock.
      for (let i = 0; i < 2; i += 1) {
        const ox = x + Math.cos(heading) * (6 + i * 4) + (random() - 0.5) * 2;
        const oz = z - Math.sin(heading) * (6 + i * 4);
        combat.spawnEnemy(ox, oz, { style: 'cop', police: true, health: 95, damage: 9, weapon: 'pistol', stationary: false, cash: 0, range: 55 });
      }
    }
    bus.onRoadblock?.(cx, cz);
  }

  function update(dt, player, playerVehicle) {
    time += dt;
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
          playerVehicle.health = Math.max(0, playerVehicle.health - impact * 0.42);
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

    // Roadblocks at four and five stars.
    if (wanted >= 4 && playerVehicle) {
      roadblockTimer -= dt;
      if (roadblockTimer <= 0) {
        roadblockTimer = 22;
        if (roadblockCars.length < 4) spawnRoadblock();
      }
    }
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
        heatTimer += dt;
        evasion = heatTimer > 3;
        if (heatTimer > 11 && time - lastRaise > 11) {
          wanted = Math.max(0, wanted - 1);
          heatTimer = 4;
          bus.onWantedCool?.(wanted);
          if (wanted === 0) {
            bus.onEvaded?.();
            evasion = false;
            for (const car of cruisers) removeCruiser(car);
            cruisers.length = 0;
            for (const car of roadblockCars) removeCruiser(car);
            roadblockCars.length = 0;
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
    get wanted() { return wanted; },
    get evasion() { return evasion; },
    get nearestSiren() { return 0; },
    get label() { return STAR_NAMES[wanted] ?? 'CLEAR'; },
    get peak() { return peak; },
    get time() { return time; },
  };
}
