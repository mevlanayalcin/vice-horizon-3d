// scene.js — the per-frame dynamic scene. Everything that moves is rebuilt into one
// mesh each frame: cars with their light halos and contact shadows, pedestrians, the
// player and gangs with tracers and sparks, mission crates, sun tokens, pickups, the
// gold mission beacon, cyan activity rings and the police helicopter's searchlight.

import { PALETTE, SAFEHOUSE, TAU, rgb } from './config.js';
import { MeshBuilder } from './meshkit.js';
import { buildVehicle, buildHelicopter, vehicleGlow } from './vehicles.js';
import { buildCharacter } from './combat.js';

/** Build the frame's dynamic geometry, glow sprites and blob shadows. */
export function buildDynamicScene(ctx) {
  const {
    time, camera, env, world, traffic, combat, missions, activities, police,
    tokens, pickups, vehicles, playerVehicle, aiming, showSafehouse,
  } = ctx;
  const b = new MeshBuilder(60000);
  const glows = [];
  const shadows = [];
  const p = combat.player;
  const camX = camera.pos[0], camZ = camera.pos[2];

  // A halo faces the camera; a `flat` one ({sx, sz, rot}) is a light pool on the ground.
  const addGlow = (x, y, z, color, r, alpha, flat = null) => {
    if (flat) glows.push({ x, y, z, color, r, alpha, flat: true, sx: flat.sx ?? 1, sz: flat.sz ?? 1, rot: flat.rot ?? 0 });
    else glows.push({ x, y, z, color, r, alpha });
  };

  // Static neon halos.
  const nightBoost = 0.34 + env.night * 0.66;
  for (const g of world.glows) {
    const dx = g.x - camX, dz = g.z - camZ;
    if (dx * dx + dz * dz > 420 * 420) continue;
    addGlow(g.x, g.y, g.z, g.color, g.r, g.alpha * nightBoost);
  }

  // Vehicles (deduplicated).
  const seen = new Set();
  for (const car of vehicles) {
    if (seen.has(car)) continue;
    seen.add(car);
    const dx = car.x - camX, dz = car.z - camZ;
    if (dx * dx + dz * dz > 330 * 330) continue;
    buildVehicle(b, car, time, { lod: dx * dx + dz * dz > 75 * 75 ? 1 : 0 });
    vehicleGlow(car, time, addGlow);
    const groundY = world.groundHeight(car.x, car.z);
    shadows.push({ x: car.x, z: car.z, y: groundY + 0.03, rx: car.spec.width * 0.62, rz: car.spec.length * 0.6, alpha: 0.55, rot: car.heading });
    shadows.push({ x: car.x, z: car.z, y: groundY + 0.032, rx: car.spec.width * 0.42, rz: car.spec.length * 0.42, alpha: 0.35, rot: car.heading });
    if (car.health < 30 && car.health > 0) {
      addGlow(car.x, car.y + 1.2, car.z, rgb(0x2f2a25), 1.8, 0.2);
    }
  }

  // Pedestrians and characters.
  for (const ped of traffic.pedestrians) {
    const dx = ped.x - camX, dz = ped.z - camZ;
    if (dx * dx + dz * dz > 190 * 190) continue;
    buildCharacter(b, {
      x: ped.x,
      z: ped.z,
      y: world.groundHeight(ped.x, ped.z),
      heading: ped.heading,
      phase: ped.phase,
      speed: ped.panic > 0 ? 4.2 : ped.speedNow,
      colors: ped.colors,
      style: ped.style,
      panic: ped.panic > 0,
      longHair: ped.longHair,
      aiming: false,
      lod: dx * dx + dz * dz > 50 * 50 ? 1 : 0,
    }, time);
    shadows.push({ x: ped.x, z: ped.z, y: world.groundHeight(ped.x, ped.z) + 0.025, rx: 0.55, rz: 0.55, alpha: 0.25 });
  }

  // Player + enemies + tracers/particles.
  combat.build(b, { aim: !playerVehicle && aiming });
  if (!playerVehicle && !p.dead) {
    shadows.push({ x: p.x, z: p.z, y: (p.y ?? 0) + 0.03, rx: 0.6, rz: 0.6, alpha: 0.3 });
  }
  combat.glow(time, addGlow);

  // Mission crates.
  for (const crate of missions.crates) {
    if (crate.taken) continue;
    const bobY = 0.55 + Math.sin(time * 2.2 + crate.phase) * 0.12;
    const gold = rgb(0xffc24b);
    b.box(crate.x, bobY, crate.z, 1.0, 0.9, 1.0, rgb(0x7a4d21), { rotY: 0.4, omitBottom: true, e: 0.1 });
    b.box(crate.x, bobY + 0.46, crate.z, 1.04, 0.08, 1.04, gold, { rotY: 0.4, omitBottom: true, e: 1 });
    for (const side of [-1, 1]) {
      b.box(crate.x + side * 0.5, bobY, crate.z, 0.06, 0.86, 1.0, gold, { rotY: 0.4, e: 0.7, omitBottom: true });
    }
    addGlow(crate.x, bobY + 0.5, crate.z, gold, 1.6, 0.5);
    shadows.push({ x: crate.x, z: crate.z, rx: 0.8, rz: 0.8, alpha: 0.2 });
  }

  // Sun tokens.
  for (const token of tokens) {
    if (token.taken) continue;
    const bob = 1.5 + Math.sin(time * 2.6 + token.phase) * 0.22;
    b.cylinder(token.x, bob - 0.06, token.z, 0.42, 0.42, 0.12, 8, PALETTE.gold, { e: 1, capTop: true, capBottom: true });
    b.box(token.x, bob, token.z, 0.18, 0.5, 0.18, rgb(0xfff0b0), { e: 1, rotY: time * 0.6, omitBottom: true });
    addGlow(token.x, bob + 0.2, token.z, PALETTE.gold, 1.8, 0.6);
  }

  // Pickups.
  for (const pickup of pickups) {
    if (pickup.taken) continue;
    const y = 0.8 + Math.sin(time * 2 + pickup.x) * 0.08;
    const color = pickup.type === 'health' ? rgb(0x63ffa1) : rgb(0x5fe1ff);
    b.box(pickup.x, y, pickup.z, 0.62, 0.62, 0.62, rgb(0x101a22), { rotY: time * 0.7, omitBottom: true, e: 0.1 });
    b.box(pickup.x, y, pickup.z - 0.33, 0.42, 0.12, 0.04, color, { e: 1 });
    b.box(pickup.x, y, pickup.z - 0.33, 0.12, 0.42, 0.04, color, { e: 1 });
    addGlow(pickup.x, y, pickup.z, color, 1.4, 0.45);
  }

  // Mission waypoint: beam, rotating marker, ground ring.
  const wp = missions.active ? missions.waypoint() : null;
  if (wp) {
    // A soft light column, a spinning faceted gem and a glowing ground ring.
    const gold = PALETTE.gold;
    const gy = world.groundHeight(wp.x, wp.z);
    const spin = time * 1.7;
    glows.push({ beam: true, x: wp.x, y: gy + 26, z: wp.z, x2: wp.x, y2: gy + 0.2, z2: wp.z, r: 0.5, r2: 0.9, color: gold, alpha: 0.55 });
    const ring = [], radii = [];
    for (let i = 0; i <= 40; i += 1) {
      const a = (i / 40) * TAU;
      ring.push([wp.x + Math.cos(a) * 2.5, gy + 0.18, wp.z + Math.sin(a) * 2.5]);
      radii.push(0.09);
    }
    b.tube(ring, radii, 5, gold, { e: 1 });
    const gemY = gy + 3.4 + Math.sin(time * 2.4) * 0.25;
    b.ellipsoid(wp.x, gemY, wp.z, 0.55, 0.85, 0.55, gold, { yaw: spin, segments: 4, rings: 2, e: 1 });
    addGlow(wp.x, gemY, wp.z, gold, 2.6, 0.7);
    addGlow(wp.x, gy + 0.2, wp.z, gold, 3.4, 0.4, { sx: 1, sz: 1 });
  }

  // Safehouse marker when free roaming.
  if (showSafehouse) {
    const x = SAFEHOUSE.x, z = SAFEHOUSE.z + 12;
    addGlow(x, 3, z, PALETTE.neonCyan, 2.4, 0.3);
  }

  // Side activities: cyan start rings, or the live checkpoint chain while one runs.
  if (activities) {
    const cyan = PALETTE.neonCyan;
    const ringAt = (x, z, radius, alpha, beam) => {
      const gy = world.groundHeight(x, z);
      const ring = [], radii = [];
      for (let i = 0; i <= 36; i += 1) {
        const a = (i / 36) * TAU + time * 0.4;
        ring.push([x + Math.cos(a) * radius, gy + 0.16, z + Math.sin(a) * radius]);
        radii.push(0.08);
      }
      b.tube(ring, radii, 4, cyan, { e: 1 });
      addGlow(x, gy + 0.2, z, cyan, radius * 1.3, alpha * 0.6, { sx: 1, sz: 1 });
      if (beam) glows.push({ beam: true, x, y: gy + 20, z, x2: x, y2: gy + 0.2, z2: z, r: 0.4, r2: radius * 0.45, color: cyan, alpha: alpha * 0.5 });
    };
    if (activities.active) {
      activities.checkpoints.slice(0, 2).forEach(([x, z], i) => ringAt(x, z, i === 0 ? 7 : 5, i === 0 ? 0.9 : 0.4, i === 0));
    } else {
      for (const a of activities.ACTIVITIES) {
        const dx = a.start[0] - camX, dz = a.start[1] - camZ;
        if (dx * dx + dz * dz < 260 * 260) ringAt(a.start[0], a.start[1], 4.5, 0.7, true);
      }
    }
  }

  // Police air unit and its volumetric searchlight cone.
  const heli = police.helicopter;
  if (heli) {
    const addBeam = (from, to, r0, r1, color, alpha) => glows.push({ beam: true, x: from[0], y: from[1], z: from[2], x2: to[0], y2: to[1], z2: to[2], r: r0, r2: r1, color, alpha });
    buildHelicopter(b, heli, time, addGlow, addBeam);
  }

  return { geometry: b.geometry(), glows, shadows };
}
