// scene.js — the per-frame dynamic scene. Everything that moves is rebuilt into one
// mesh each frame: cars with their light halos and contact shadows, pedestrians, the
// player and gangs with tracers and sparks, mission crates, sun tokens, pickups, the
// gold mission beacon, cyan activity rings and the police helicopter's searchlight.

import { PALETTE, SAFEHOUSE, TAU, rgb, shade } from './config.js';
import { MeshBuilder } from './meshkit.js';
import { buildVehicle, buildHelicopter, vehicleGlow, skidMarks, tyreSmoke } from './vehicles.js';
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

  const addBeamGlow = (from, to, r0, r1, color, alpha) => glows.push({ beam: true, x: from[0], y: from[1], z: from[2], x2: to[0], y2: to[1], z2: to[2], r: r0, r2: r1, color, alpha });

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
    vehicleGlow(car, time, addGlow, dx * dx + dz * dz < 140 * 140 ? addBeamGlow : null, Math.min(1, Math.max(0, env.night - 0.1) * 1.8));
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
      speed: ped.duck > 0 ? 0 : ped.panic > 0 ? 4.2 : ped.speedNow,
      colors: ped.colors,
      style: ped.style,
      panic: ped.panic > 0 || ped.panicArms,
      duck: ped.duck > 0 ? Math.min(1, ped.duck * 3) : 0,
      longHair: ped.longHair,
      aiming: false,
      lod: dx * dx + dz * dz > 50 * 50 ? 1 : 0,
    }, time);
    shadows.push({ x: ped.x, z: ped.z, y: world.groundHeight(ped.x, ped.z) + 0.025, rx: 0.55, rz: 0.55, alpha: 0.25 });
  }

  // Skid marks as dark rubber streaks on the road, tyre smoke as soft rising halos.
  for (const m of skidMarks) {
    if (m.alpha < 0.02) continue;
    const dx = m.x - camX, dz = m.z - camZ;
    if (dx * dx + dz * dz > 160 * 160) continue;
    shadows.push({ x: m.x, z: m.z, y: m.y, rx: 0.17, rz: 0.95, alpha: m.alpha, rot: m.rot });
  }
  for (const puff of tyreSmoke) {
    const life = puff.life / puff.maxLife;
    addGlow(puff.x, puff.y, puff.z, rgb(0x9a928c), puff.size, life * 0.16);
  }

  // Street lamps, drawn live so a car can knock one flat: the pole pivots on its base
  // toward `fallYaw` by `tilt`, and a felled lamp goes dark.
  const lampDark = rgb(0x32343a);
  for (const lamp of world.lampposts ?? []) {
    const dx = lamp.x - camX, dz = lamp.z - camZ;
    if (dx * dx + dz * dz > 420 * 420) continue;
    const ax = Math.cos(lamp.rot), az = Math.sin(lamp.rot);
    if (!lamp.knocked) {
      b.box(lamp.x, 0.12, lamp.z, 0.42, 0.24, 0.42, shade(lampDark, 0.85), { omitBottom: true });
      b.box(lamp.x, 2.7, lamp.z, 0.22, 5.4, 0.22, lampDark, { omitBottom: true, s: -0.3 });
      b.segment([lamp.x, 5.2, lamp.z], [lamp.x + ax * 1.15, 5.2, lamp.z + az * 1.15], 0.14, 0.14, lampDark);
      b.box(lamp.x + ax * 1.15, 5.1, lamp.z + az * 1.15, 0.7, 0.28, 0.7, PALETTE.headlight, { e: 1, omitBottom: true });
      continue;
    }
    const fx = Math.sin(lamp.fallYaw), fz = Math.cos(lamp.fallYaw);
    const ct = Math.cos(lamp.tilt), st = Math.sin(lamp.tilt);
    // Rotate a point offset from the base in the vertical plane of the fall.
    const R = (ox, oy, oz) => {
      const along = ox * fx + oz * fz;
      const px = ox - along * fx, pz = oz - along * fz;
      const na = oy * st + along * ct, ny = oy * ct - along * st;
      return [lamp.x + px + na * fx, 0.05 + Math.max(0, ny), lamp.z + pz + na * fz];
    };
    b.box(lamp.x, 0.08, lamp.z, 0.42, 0.16, 0.42, shade(lampDark, 0.7), { omitBottom: true });
    const top = R(0, 5.2, 0), head = R(ax * 1.15, 5.1, az * 1.15);
    b.segment(R(0, 0.1, 0), top, 0.22, 0.22, lampDark);
    b.segment(top, head, 0.14, 0.14, lampDark);
    b.segment(R(ax * 0.8, 5.1, az * 0.8), R(ax * 1.5, 5.1, az * 1.5), 0.7, 0.28, shade(PALETTE.headlight, lamp.landed ? 0.4 : 0.8), { e: lamp.landed ? 0.05 : 0.5 });
    shadows.push({ x: (lamp.x + head[0]) / 2, z: (lamp.z + head[2]) / 2, y: 0.04, rx: 0.5, rz: 2.8 * st + 0.4, alpha: 0.35, rot: lamp.fallYaw });
  }

  // Fire hydrants: squat red posts with brass caps, or a sheared stump throwing a geyser.
  for (const h of world.hydrants ?? []) {
    const dx = h.x - camX, dz = h.z - camZ;
    if (dx * dx + dz * dz > 120 * 120) continue;
    const gy = world.groundHeight(h.x, h.z);
    const red = rgb(0xd8322c), brass = rgb(0xe0b048);
    if (!h.broken) {
      b.cylinder(h.x, gy, h.z, 0.2, 0.2, 0.12, 8, shade(red, 0.8), {});
      b.cylinder(h.x, gy + 0.12, h.z, 0.15, 0.14, 0.52, 8, red, { s: -0.3 });
      b.cylinder(h.x, gy + 0.64, h.z, 0.17, 0.06, 0.16, 8, brass, { s: -0.6 });
      b.box(h.x, gy + 0.44, h.z, 0.46, 0.1, 0.1, red, { omitBottom: true, s: -0.3 });
      b.box(h.x, gy + 0.44, h.z, 0.1, 0.1, 0.36, brass, { omitBottom: true, s: -0.5 });
    } else {
      b.cylinder(h.x, gy, h.z, 0.2, 0.18, 0.16, 8, shade(red, 0.7), {});
      if (h.spray > 0) {
        const k = Math.min(1, h.spray / 3);
        const top = 3.2 + Math.sin(time * 9 + h.x) * 0.3;
        glows.push({ beam: true, x: h.x, y: gy + 0.2, z: h.z, x2: h.x, y2: gy + top * k + 0.4, z2: h.z, r: 0.18, r2: 0.55, color: [0.75, 0.9, 1.0], alpha: 0.5 * k });
        addGlow(h.x, gy + top * k, h.z, [0.7, 0.85, 1.0], 1.1, 0.25 * k);
        addGlow(h.x, gy + 0.05, h.z, [0.5, 0.7, 0.85], 2.4, 0.22 * k, { sx: 1, sz: 1 });
      }
    }
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
