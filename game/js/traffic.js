// traffic.js — autonomous Solaris Bay life. Cars loop their block in the correct
// right-hand lane, slow for each other and for the player, and can be carjacked.
// Pedestrians stroll the sidewalk rings, pause at corners, and scatter when shots
// or sirens go off. All geometry comes from the shared vehicle/character builders.

import { CITY, PALETTE, createRandom, rgb, clamp, lerp } from './config.js';
import { createVehicle, updateVehicle } from './vehicles.js';
import { characterColors } from './combat.js';

const CAR_TYPES = ['sedan', 'taxi', 'coupe', 'muscle', 'van', 'sedan', 'coupe', 'sedan', 'muscle'];
const LOOP_X = [[-390, -260], [-260, -130], [-130, 0], [0, 130], [130, 260], [260, 390]];
const LOOP_Z = [[-390, -260], [-260, -130], [-130, 0], [0, 130], [130, 260]];

function rectLoop(x1, x2, z1, z2, inset = 5) {
  const ax = x1 + inset, bx = x2 - inset;
  const az = z1 + inset, bz = z2 - inset;
  const legs = [
    { ax, az, bx, bz: az, heading: Math.PI / 2 },
    { ax: bx, az, bx, bz, heading: 0 },
    { ax: bx, az: bz, bx: ax, bz, heading: -Math.PI / 2 },
    { ax, az: bz, bx: ax, bz: az, heading: Math.PI },
  ];
  let total = 0;
  for (const leg of legs) {
    leg.len = Math.hypot(leg.bx - leg.ax, leg.bz - leg.az);
    leg.start = total;
    total += leg.len;
  }
  return { legs, total };
}

function sampleLoop(loop, s) {
  let t = ((s % loop.total) + loop.total) % loop.total;
  for (const leg of loop.legs) {
    if (t <= leg.start + leg.len) {
      const u = (t - leg.start) / leg.len;
      return {
        x: leg.ax + (leg.bx - leg.ax) * u,
        z: leg.az + (leg.bz - leg.az) * u,
        heading: leg.heading,
        leg,
      };
    }
  }
  return { x: loop.legs[0].ax, z: loop.legs[0].az, heading: 0 };
}

export function createTraffic(world, options = {}) {
  const random = createRandom(options.seed ?? 0x7ad10c);
  const cars = [];
  const pedestrians = [];
  let time = 0;

  function registerCar(car) {
    car.traffic = true;
    car.loop = rectLoop(car.loopX1, car.loopX2, car.loopZ1, car.loopZ2, 5);
    car.s = 0;
    car.loopSpeed = 8.5 + random() * 5;
    car.desiredSpeed = car.loopSpeed;
    cars.push(car);
    return car;
  }

  function makeTrafficCar(index) {
    const xpair = LOOP_X[Math.floor(random() * LOOP_X.length)];
    const zpair = LOOP_Z[Math.floor(random() * LOOP_Z.length)];
    const type = CAR_TYPES[Math.floor(random() * CAR_TYPES.length)];
    const ax = (xpair[0] + xpair[1]) / 2 + (random() - 0.5) * 50;
    const az = (zpair[0] + zpair[1]) / 2 + (random() - 0.5) * 40;
    const car = createVehicle(type, ax, az, 0, { parked: false });
    car.loopX1 = xpair[0]; car.loopX2 = xpair[1];
    car.loopZ1 = zpair[0]; car.loopZ2 = zpair[1];
    registerCar(car);
    car.s = random() * 480;
    car.loopSpeed = 8 + random() * 6.5;
    const pos = sampleLoop(car.loop, car.s);
    car.x = pos.x; car.z = pos.z;
    car.heading = pos.heading;
    car.colors = characterColors(random(), 'civ');
    return car;
  }

  // Pedestrians walk the sidewalk ring of a block, each on a slightly different path.
  function makePed(index) {
    const xpair = LOOP_X[Math.floor(random() * LOOP_X.length)];
    const zpair = LOOP_Z[Math.floor(random() * LOOP_Z.length)];
    const inset = 2.5 + random() * 2.4;
    const loop = rectLoop(xpair[0], xpair[1], zpair[0], zpair[1], inset);
    const ped = {
      id: index,
      loop,
      s: random() * loop.total,
      speed: 1.1 + random() * 0.9,
      dir: random() < 0.5 ? 1 : -1,
      phase: random() * Math.PI * 2,
      x: 0, z: 0, y: 0, heading: 0,
      panic: 0,
      panicDir: 0,
      colors: characterColors(random(), 'civ'),
      longHair: random() < 0.45,
      style: 'civ',
      pause: 0,
      speedNow: 0,
      stationary: false,
    };
    const pos = sampleLoop(loop, ped.s);
    ped.x = pos.x; ped.z = pos.z;
    ped.heading = pos.heading + (ped.dir > 0 ? 0 : Math.PI);
    pedestrians.push(ped);
    return ped;
  }

  for (let i = 0; i < 22; i += 1) makeTrafficCar(i);
  for (let i = 0; i < 30; i += 1) makePed(i);

  // A few beach/sunset loiterers for the boardwalk shot and free-roam life.
  const loiterSpots = [
    [-114, 315, 0.4], [-102, 318, 2.6], [46, 311, 1.1], [62, 316, 3.4],
    [-160, 316, 0.8], [-166, 360, 2.1], [-166, 386, 0.3], [7, 292, 1.6],
    [-18, 294, 4.1], [120, 288, 2.2], [182, 294, 3.7], [-240, 292, 1.0],
  ];
  loiterSpots.forEach(([x, z, heading], i) => {
    pedestrians.push({
      id: 100 + i, loop: null, s: 0, speed: 0, dir: 1,
      phase: random() * Math.PI * 2, x, z,
      y: world.groundHeight(x, z), heading,
      panic: 0, panicDir: 0,
      colors: characterColors(random(), 'civ'),
      longHair: i % 2 === 0, style: 'civ', pause: 999, speedNow: 0,
      stationary: true, poseTimer: random() * 6,
    });
  });

  function removeCar(car) {
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    car.traffic = false;
    return car;
  }

  function nearestCar(x, z, maxDist = 6.5, exclude = null) {
    let best = null, bestD = maxDist;
    for (const car of cars) {
      if (car === exclude) continue;
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function panicAt(x, z, radius = 30) {
    for (const ped of pedestrians) {
      if (Math.hypot(ped.x - x, ped.z - z) < radius) {
        ped.panic = 2.8 + Math.random() * 2.2;
        ped.panicDir = Math.atan2(ped.x - x, ped.z - z);
      }
    }
  }

  function addStagedCar(type, x, z, heading, color = null) {
    const car = createVehicle(type, x, z, heading, {
      parked: true,
      color: color ? rgb(color) : undefined,
    });
    car.staged = true;
    car.speed = 0;
    cars.push(car);
    return car;
  }

  function addStagedPed(x, z, heading, style = 'civ', options = {}) {
    const ped = {
      id: 200 + pedestrians.length, loop: null, s: 0, speed: 0, dir: 1,
      phase: Math.random() * Math.PI * 2, x, z,
      y: world.groundHeight(x, z), heading,
      panic: options.panic ?? 0, panicDir: options.panicDir ?? 0,
      colors: characterColors(Math.random(), style),
      longHair: options.longHair ?? Math.random() < 0.4,
      style, pause: 999, speedNow: 0, stationary: true,
      panicArms: options.panicArms ?? false,
      aiming: false,
    };
    pedestrians.push(ped);
    return ped;
  }

  function update(dt, player, playerVehicle, sirensNear = false) {
    time += dt;
    // Cars.
    for (const car of cars) {
      if (car.staged || car.parked) continue;
      const speed = car.speed;
      let target = car.loopSpeed;
      // React to the player's car: brake if it blocks the lane ahead.
      if (playerVehicle) {
        const aheadX = car.x + Math.sin(car.heading) * 7;
        const aheadZ = car.z + Math.cos(car.heading) * 7;
        if (Math.hypot(playerVehicle.x - aheadX, playerVehicle.z - aheadZ) < 4.2) target = 0.4;
        else if (Math.hypot(playerVehicle.x - car.x, playerVehicle.z - car.z) < 9) target *= 0.55;
        if (car.health < 25) target = 0;
      }
      if (sirensNear) target *= 0.75;
      car.desiredSpeed = target;
      car.loopSpeed = lerp(car.loopSpeed, Math.max(2.0, target), clamp(dt * 2, 0, 1));
      const moveSpeed = car.loopSpeed;
      car.s += moveSpeed * dt;
      const pos = sampleLoop(car.loop, car.s);
      // Smooth turn across corners.
      let diff = pos.heading - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      car.heading += diff * clamp(dt * 8, 0, 1);
      car.x = pos.x;
      car.z = pos.z;
      car.speed = moveSpeed;
      car.y = world.groundHeight(car.x, car.z) + 0.02;
      car.braking = target < 1.2 || (sirensNear && car.loopSpeed < 4);
      car.steer = 0;
      void speed;
    }
    // Keep traffic separated enough to read.
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      if (a.staged || a.parked) continue;
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        if (b.staged || b.parked) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 6.5 && d > 0.01) {
          // The car further back yields.
          const headingDot = Math.sin(a.heading) * dx + Math.cos(a.heading) * dz;
          if (headingDot > 0) a.loopSpeed = Math.max(1.6, a.loopSpeed - dt * 7);
          else b.loopSpeed = Math.max(1.6, b.loopSpeed - dt * 7);
        }
      }
    }
    // Pedestrians.
    for (const ped of pedestrians) {
      ped.panic = Math.max(0, ped.panic - dt);
      ped.phase += dt * (ped.panic > 0 ? 12 : 6);
      if (ped.stationary) {
        ped.y = world.groundHeight(ped.x, ped.z);
        ped.heading += Math.sin(time * 0.4 + ped.id) * dt * 0.15;
        ped.speedNow = 0;
        continue;
      }
      if (ped.panic > 0) {
        const target = ped.panicDir;
        ped.heading += clamp(angDiff(target, ped.heading), -1, 1) * dt * 4;
        ped.speedNow = 4.4;
        ped.x += Math.sin(ped.heading) * ped.speedNow * dt;
        ped.z += Math.cos(ped.heading) * ped.speedNow * dt;
        ped.y = world.groundHeight(ped.x, ped.z);
        const hit = world.collideCircle(ped.x, ped.z, 0.45);
        if (hit.hit) { ped.x = hit.x; ped.z = hit.z; }
        continue;
      }
      if (!ped.loop) continue;
      if (ped.pause > 0) {
        ped.pause -= dt;
        ped.speedNow = 0;
      } else {
        ped.speedNow = ped.speed;
        ped.s += ped.speed * ped.dir * dt;
        const pos = sampleLoop(ped.loop, ped.s);
        ped.x = pos.x;
        ped.z = pos.z;
        ped.heading += angDiff(pos.heading + (ped.dir > 0 ? 0 : Math.PI), ped.heading) * clamp(dt * 5, 0, 1);
        if (Math.random() < 0.0018) ped.pause = 0.7;
        if (Math.random() < 0.0004) ped.dir *= -1;
      }
      const hit = world.collideCircle(ped.x, ped.z, 0.4);
      if (hit.hit) { ped.x = hit.x; ped.z = hit.z; }
      ped.y = world.groundHeight(ped.x, ped.z);
    }
  }

  return {
    cars,
    pedestrians,
    update,
    removeCar,
    nearestCar,
    panicAt,
    addStagedCar,
    addStagedPed,
    get time() { return time; },
  };
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
