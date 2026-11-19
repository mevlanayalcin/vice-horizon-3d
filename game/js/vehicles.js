// vehicles.js — every Solaris Bay machine, how it looks and how it slides. The player's
// car uses arcade drift physics (forward/lateral grip, handbrake, nitro boost, ramps,
// crashes, water stalls); traffic and police cruisers share the same builder and mesh
// so all three systems produce identical, readable silhouettes. All original designs.

import { VEHICLES, clamp, rgb, shade, lerp } from './config.js';

let nextId = 1;

export function createVehicle(type, x, z, heading = 0, options = {}) {
  const spec = VEHICLES[type] ?? VEHICLES.sedan;
  const v = {
    id: nextId++,
    type: spec.id,
    spec,
    x, z, y: 0.02,
    heading,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    speed: 0,
    steer: 0,
    throttle: 0,
    braking: false,
    handbrake: false,
    boost: options.boost ?? 1,
    boosting: false,
    health: options.health ?? 100,
    maxHealth: 100,
    airborne: false,
    pitch: 0,
    roll: 0,
    lean: 0,
    police: options.police ?? false,
    sirenPhase: 0,
    driver: null,
    stolen: options.stolen ?? false,
    mission: options.mission ?? false,
    parked: options.parked ?? false,
    traffic: false,
    lane: options.lane ?? null,
    age: 0,
    lastCrash: 0,
    oil: 0,
    smoke: 0,
    horn: 0,
    color: options.color ?? spec.colors.body,
    accent: options.accent ?? spec.colors.accent,
    sirenOn: options.sirenOn ?? false,
    ...options,
  };
  return v;
}

export function vehicleForward(v) {
  return [Math.sin(v.heading), Math.cos(v.heading)];
}

export function vehicleRight(v) {
  return [Math.cos(v.heading), -Math.sin(v.heading)];
}

export function localToWorld(v, lx, lz) {
  const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
  return [v.x + lx * cos + lz * sin, v.z - lx * sin + lz * cos];
}

export function respawnVehicle(v, x, z, heading) {
  v.x = x; v.z = z; v.heading = heading;
  v.velocityX = 0; v.velocityZ = 0; v.speed = 0;
  v.y = 0.02; v.velocityY = 0; v.airborne = false;
  v.health = v.maxHealth;
  v.smoke = 0;
}

/**
 * One fixed step of player-car physics. `controls` has throttle (-1..1), steer (-1..1),
 * handbrake (bool), boost (bool). Returns event strings for audio, HUD and sparks.
 */
export function updateVehicle(v, controls, dt, world, options = {}) {
  const spec = v.spec;
  const events = [];
  v.age += dt;
  const forward = vehicleForward(v);
  const right = vehicleRight(v);
  const fx = forward[0], fz = forward[1];
  const rx = right[0], rz = right[1];

  const throttle = clamp(controls.throttle ?? 0, -1, 1);
  const steerInput = clamp(controls.steer ?? 0, -1, 1);
  const handbrake = !!controls.handbrake;
  v.throttle = throttle;
  v.braking = (throttle < 0 && v.speed > 1.2) || (handbrake && Math.abs(v.speed) > 4);

  // Boost: extra push while held, recharging when not.
  const boosting = !!controls.boost && v.boost > 0.02 && Math.abs(v.speed) > 2;
  v.boosting = boosting;
  if (boosting) v.boost = Math.max(0, v.boost - dt * 0.32);
  else v.boost = Math.min(1, v.boost + dt * 0.09);

  // Decompose velocity into forward / lateral and apply grip to the latter.
  let vf = v.velocityX * fx + v.velocityZ * fz;
  let vl = v.velocityX * rx + v.velocityZ * rz;

  const engine = (boosting ? spec.accel * 1.55 : spec.accel) * throttle;
  const maxSpeed = spec.maxSpeed * (boosting ? 1.24 : 1);
  if (throttle > 0) vf += engine * dt;
  else if (throttle < 0) vf += throttle * spec.brake * (vf > 0.4 ? 1 : 0.5) * dt;
  if (!handbrake) vf -= vf * 0.55 * dt;
  else vf -= vf * 1.5 * dt;

  vf = clamp(vf, -maxSpeed * 0.35, maxSpeed);
  if (vf > maxSpeed) vf = maxSpeed;

  const grip = handbrake ? spec.grip * 0.22 : spec.grip;
  vl -= vl * Math.min(1, grip * dt);
  if (handbrake) vl += steerInput * vf * 0.2 * dt;

  // Steering: sharper at low speed, measured at high speed.
  const speedFactor = clamp(Math.abs(vf) / 7, 0, 1);
  const turnRate = spec.steer * steerInput * speedFactor * (1 - clamp(Math.abs(vf) / (maxSpeed * 1.6), 0, 0.45));
  if (Math.abs(vf) > 0.2) {
    v.heading += turnRate * dt * (vf >= 0 ? 1 : -1);
  }
  v.steer = lerp(v.steer, steerInput, clamp(dt * 10, 0, 1));
  v.lean = lerp(v.lean, -steerInput * clamp(Math.abs(vf) / 30, 0, 1) * 0.09, clamp(dt * 6, 0, 1));
  v.roll = v.lean;

  // Drift angle for smoke and tyre squeal.
  v.drift = Math.abs(vl);

  v.velocityX = fx * vf + rx * vl;
  v.velocityZ = fz * vf + rz * vl;
  v.speed = vf;
  v.x += v.velocityX * dt;
  v.z += v.velocityZ * dt;

  // Vertical: ramps launch the car, gravity brings it down.
  const groundY = world.groundHeight(v.x, v.z);
  const ramp = rampAt(world, v.x, v.z);
  if (v.airborne) {
    v.velocityY -= 24 * dt;
    v.y += v.velocityY * dt;
    v.pitch = lerp(v.pitch, clamp(v.velocityY * 0.015, -0.18, 0.22), clamp(dt * 4, 0, 1));
    if (v.y <= groundY + 0.02) {
      v.y = groundY + 0.02;
      const impact = Math.abs(v.velocityY);
      v.velocityY = 0;
      v.airborne = false;
      v.pitch = 0;
      if (impact > 7) {
        v.health -= impact * 1.4;
        events.push('landing');
      }
      events.push('landed');
    }
  } else if (ramp && Math.abs(vf) > 8) {
    const t = rampProgress(ramp, v.x, v.z);
    v.y = groundY + 0.02 + ramp.h * t;
    v.pitch = -0.2 * t;
    // Leaving the ramp's high lip sends the car up.
    if (t > 0.88) {
      v.airborne = true;
      v.velocityY = 5.5 + Math.abs(vf) * 0.13;
      v.pitch = 0.14;
      events.push('stunt');
    }
  } else {
    v.y = lerp(v.y, groundY + 0.02, clamp(dt * 9, 0, 1));
    v.pitch = lerp(v.pitch, 0, clamp(dt * 6, 0, 1));
  }

  // Collisions with buildings, palms, sea walls.
  const radius = Math.max(1.6, spec.width * 0.72);
  const hit = world.collideCircle(v.x, v.z, radius);
  if (hit.hit) {
    v.x = hit.x;
    v.z = hit.z;
    const along = v.velocityX * hit.nx + v.velocityZ * hit.nz;
    if (along < 0) {
      v.velocityX -= hit.nx * along * 1.4;
      v.velocityZ -= hit.nz * along * 1.4;
      const damage = Math.min(34, Math.abs(along) * 1.9);
      if (damage > 3) {
        v.health = Math.max(0, v.health - damage);
        v.speed *= 0.5;
        events.push(damage > 12 ? 'crashHard' : 'crash');
        v.lastCrash = v.age;
      }
    }
  }

  // Sea and world bounds: the car stalls and loses speed in the water.
  if (world.isWater(v.x, v.z) && v.y < 0.8) {
    v.velocityX *= 0.94;
    v.velocityZ *= 0.94;
    v.speed *= 0.9;
    if (v.age - (v.waterAt ?? -10) > 1.2) {
      v.waterAt = v.age;
      v.health -= 5;
      events.push('splash');
    }
  }
  if (v.x < world.bounds.minX + 8 || v.x > world.bounds.maxX - 8) {
    v.x = clamp(v.x, world.bounds.minX + 8, world.bounds.maxX - 8);
    v.velocityX *= -0.25;
    events.push('crash');
  }
  if (v.z < world.bounds.minZ + 8 || v.z > world.bounds.maxZ - 8) {
    v.z = clamp(v.z, world.bounds.minZ + 8, world.bounds.maxZ - 8);
    v.velocityZ *= -0.25;
    events.push('crash');
  }

  v.x = clamp(v.x, world.bounds.minX + 4, world.bounds.maxX - 4);
  v.z = clamp(v.z, world.bounds.minZ + 4, world.bounds.maxZ - 4);

  if (v.health < 26) v.smoke = Math.min(1, v.smoke + dt * 0.8);
  else v.smoke = Math.max(0, v.smoke - dt);
  if (v.health <= 0 && !v.wrecked) {
    v.wrecked = true;
    v.health = 0;
    events.push('wrecked');
  }
  return events;
}

function rampAt(world, x, z) {
  if (!world.props) return null;
  for (const p of world.props) {
    if (p.type !== 'ramp') continue;
    if (x > p.x - p.w / 2 - 1 && x < p.x + p.w / 2 + 1 && z > p.z - p.d / 2 - 1 && z < p.z + p.d / 2 + 1) return p;
  }
  return null;
}

function rampProgress(ramp, x, z) {
  const axis = Math.abs(ramp.rot) < 0.1 ? 'z' : Math.abs(ramp.rot - Math.PI) < 0.1 ? 'z' : 'x';
  if (ramp.rot === Math.PI) return clamp(1 - (z - ramp.z + ramp.d / 2) / ramp.d, 0, 1);
  if (Math.abs(ramp.rot - Math.PI / 2) < 0.1) return clamp((x - ramp.x + ramp.w / 2) / ramp.w, 0, 1);
  if (axis === 'z') return clamp((z - ramp.z + ramp.d / 2) / ramp.d, 0, 1);
  return clamp((x - ramp.x + ramp.w / 2) / ramp.w, 0, 1);
}

// ---------------------------------------------------------------------------
// Geometry: car built in local space (front +Z) and placed with a yaw.
// ---------------------------------------------------------------------------

export function buildVehicle(b, v, time = 0, opts = {}) {
  const spec = v.spec;
  const L = spec.length, W = spec.width, H = spec.height;
  const yaw = -v.heading;
  const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
  const place = (lx, lz) => [v.x + lx * cos + lz * sin, v.z - lx * sin + lz * cos];
  const body = v.color ?? spec.colors.body;
  const accent = v.accent ?? spec.colors.accent;
  const glass = spec.colors.glass;
  const rim = spec.colors.rim;
  const dark = rgb(0x1a1c22);
  const baseY = v.y;
  const tilt = v.pitch ?? 0;
  const cy = baseY + H * 0.45;

  const boxAt = (lx, ly, lz, sx, sy, sz, color, extra = {}) => {
    const [wx, wz] = place(lx, lz);
    b.box(wx, baseY + ly, wz, sx, sy, sz, color, { rotY: yaw, omitBottom: true, ...extra });
  };

  // Shadow of the car is drawn separately on the ground.
  // Chassis / lower body.
  boxAt(0, 0.52, 0, W, 0.5, L * 0.98, body, { top: shade(body, 0.93) });
  // Tapered nose and tail.
  boxAt(0, 0.47, L * 0.36, W * 0.92, 0.34, L * 0.3, shade(body, 0.96));
  boxAt(0, 0.47, -L * 0.36, W * 0.92, 0.34, L * 0.3, shade(body, 0.92));
  // Mid body highlight.
  boxAt(0, 0.76, 0.02, W * 0.97, 0.14, L * 0.72, shade(body, 1.06));

  if (v.type === 'van') {
    boxAt(0, 1.32, -L * 0.08, W * 0.96, 1.52, L * 0.8, body);
    boxAt(0, 1.35, L * 0.3, W * 0.9, 0.7, 0.1, glass, { e: 0.3 });
    boxAt(0, 1.9, -L * 0.05, W * 0.94, 0.14, L * 0.8, shade(body, 0.9));
    boxAt(W * 0.4, 1.4, L * 0.15, W * 0.16, 0.7, 0.08, glass, { e: 0.25 });
    boxAt(-W * 0.4, 1.4, L * 0.15, W * 0.16, 0.7, 0.08, glass, { e: 0.25 });
  } else {
    // Cabin and glass.
    const cabinH = v.type === 'muscle' ? 0.48 : 0.42;
    boxAt(0, 0.78 + cabinH / 2, -L * 0.06, W * 0.78, cabinH, L * 0.44, glass, { e: 0.22 });
    boxAt(0, 0.8 + cabinH, -L * 0.08, W * 0.74, 0.08, L * 0.4, shade(body, 0.9));
    // Roof rails / A and B pillars.
    boxAt(W * 0.37, 1.0, -L * 0.06, 0.08, 0.5, L * 0.36, shade(body, 0.82));
    boxAt(-W * 0.37, 1.0, -L * 0.06, 0.08, 0.5, L * 0.36, shade(body, 0.82));
    // Hood and boot seams.
    boxAt(0, 0.73, L * 0.33, W * 0.86, 0.06, L * 0.24, shade(body, 1.1));
    boxAt(0, 0.72, -L * 0.34, W * 0.86, 0.05, L * 0.18, shade(body, 0.85));
  }

  // Bumpers, grille and side skirts.
  boxAt(0, 0.42, L * 0.49, W * 0.88, 0.26, 0.25, dark);
  boxAt(0, 0.4, -L * 0.49, W * 0.88, 0.24, 0.25, dark);
  boxAt(0, 0.32, 0, W * 0.86, 0.18, L * 0.7, shade(body, 0.75));
  boxAt(0, 0.62, L * 0.505, W * 0.32, 0.16, 0.06, rgb(0x24262a));

  // Headlights and taillights.
  const lightY = v.headlightLift ? 0.65 : 0.62;
  for (const side of [-1, 1]) {
    boxAt(side * W * 0.33, lightY, L * 0.5, W * 0.18, 0.14, 0.1, rgb(0xfff3d2), { e: 1 });
    boxAt(side * W * 0.34, lightY, -L * 0.5, W * 0.17, 0.13, 0.09, v.braking ? rgb(0xff5a4d) : rgb(0x9e231c), { e: v.braking ? 1 : 0.45 });
  }
  // Wheels.
  const wheelR = spec.wheelRadius;
  const axles = [L * 0.32, -L * 0.32];
  for (const az of axles) {
    for (const side of [-1, 1]) {
      const [wx, wz] = place(side * (W / 2 - 0.02), az);
      b.wheel(wx, baseY + wheelR, wz, wheelR, 0.32, rgb(0x16171b), rim, { rotY: yaw, sides: 10 });
      boxAt(side * W * 0.52, 0.46, az, 0.06, 0.3, 0.3, dark);
    }
  }

  if (v.type === 'coupe' || v.type === 'supercar') {
    boxAt(0, 0.92, -L * 0.28, W * 0.68, 0.08, 0.35, shade(body, 0.68));
    boxAt(W * 0.28, 0.85, -L * 0.28, 0.08, 0.25, 0.28, shade(body, 0.7));
    boxAt(-W * 0.28, 0.85, -L * 0.28, 0.08, 0.25, 0.28, shade(body, 0.7));
    // Side accent swoosh.
    boxAt(W * 0.5 * 0.99, 0.58, 0.05, 0.03, 0.14, L * 0.4, accent, { top: accent });
    boxAt(-W * 0.5 * 0.99, 0.58, 0.05, 0.03, 0.14, L * 0.4, accent, { top: accent });
  }
  if (v.type === 'muscle') {
    boxAt(0, 0.84, L * 0.28, W * 0.5, 0.09, 0.5, rgb(0x24262a));
    boxAt(0, 0.89, L * 0.28, 0.8, 0.05, 0.3, rgb(0x9d9fa3));
    // Racing stripe.
    boxAt(0, 0.955, 0.0, 0.55, 0.02, L * 0.5, accent, { e: 0.1 });
  }
  if (v.type === 'van') {
    // Ladder on the roof.
    for (let i = 0; i < 4; i += 1) boxAt(-W * 0.28 + i * W * 0.18, 2.18, -L * 0.1, 0.08, 0.06, L * 0.5, rgb(0xa9aaa8));
  }

  if (v.police) {
    // Black door panels and a lightbar.
    for (const side of [-1, 1]) {
      boxAt(side * W * 0.5 * 0.999, 0.66, -L * 0.06, 0.04, 0.32, L * 0.36, v.spec.colors.accent, { top: v.spec.colors.accent });
    }
    boxAt(0, 1.32, -L * 0.08, W * 0.46, 0.1, 0.4, rgb(0x23252b));
    const phase = Math.floor((time + (v.sirenPhase ?? 0) * 0.5) * 7) % 2;
    boxAt(-W * 0.14, 1.46, -L * 0.08, W * 0.3, 0.2, 0.34, phase ? rgb(0xff2a3d) : rgb(0x6e1019), { e: phase ? 1 : 0.4 });
    boxAt(W * 0.14, 1.46, -L * 0.08, W * 0.3, 0.2, 0.34, phase ? rgb(0x101a5e) : rgb(0x2f6bff), { e: phase ? 0.4 : 1 });
    // Push bar.
    boxAt(0, 0.62, L * 0.54, W * 0.7, 0.1, 0.1, rgb(0x2c2e33));
    boxAt(0, 0.44, L * 0.54, W * 0.7, 0.1, 0.1, rgb(0x2c2e33));
    boxAt(-W * 0.3, 0.5, L * 0.54, 0.08, 0.32, 0.08, rgb(0x2c2e33));
    boxAt(W * 0.3, 0.5, L * 0.54, 0.08, 0.32, 0.08, rgb(0x2c2e33));
    // Roof number light.
    boxAt(0, 1.3, -L * 0.35, W * 0.2, 0.12, 0.1, rgb(0xff9d3c), { e: 0.7 });
  }
  if (v.type === 'taxi') {
    boxAt(0, 1.26, -L * 0.02, W * 0.28, 0.2, 0.35, rgb(0xffd25a), { e: 0.7 });
    boxAt(0, 0.62, 0.05, W * 0.04, 0.14, L * 0.6, rgb(0x212328));
  }
  if (v.type === 'supercar') {
    boxAt(0, 1.18, -L * 0.2, 0.35, 0.2, L * 0.2, accent, { e: 0.35 });
  }
  if (v.mission) {
    // A gold marker beacon on the roof is drawn in the HUD pass.
    boxAt(0, 1.28, -L * 0.06, W * 0.16, 0.1, 0.16, rgb(0xffc24b), { e: 1 });
  }
  if (v.health < 35) {
    // Blackened panels and a hint of smoke colour.
    boxAt(W * 0.2, 0.7, L * 0.3, 0.5, 0.3, 0.6, rgb(0x2a2420));
  }
  return v;
}

export function vehicleGlow(v, time, add) {
  const forward = vehicleForward(v);
  const right = vehicleRight(v);
  const spec = v.spec;
  const head = [v.x + forward[0] * spec.length * 0.52, v.y + 0.65, v.z + forward[1] * spec.length * 0.52];
  const tail = [v.x - forward[0] * spec.length * 0.52, v.y + 0.62, v.z - forward[1] * spec.length * 0.52];
  for (const side of [-1, 1]) {
    add(head[0] + right[0] * side * spec.width * 0.32, head[1], head[2] + right[1] * side * spec.width * 0.32, rgb(0xfff0c8), 0.55, 0.5);
  }
  if (v.braking) {
    for (const side of [-1, 1]) {
      add(tail[0] + right[0] * side * spec.width * 0.32, tail[1], tail[2] + right[1] * side * spec.width * 0.32, rgb(0xff2a22), 0.75, 0.7);
    }
  }
  if (v.police && v.sirenOn) {
    const phase = Math.floor((time + (v.sirenPhase ?? 0) * 0.5) * 7) % 2;
    const roof = [v.x - forward[0] * spec.length * 0.08, v.y + 1.5, v.z - forward[1] * spec.length * 0.08];
    add(roof[0] - right[0] * 0.28, roof[1], roof[2] - right[1] * 0.28, rgb(0xff2a3d), phase ? 2.5 : 1.1, phase ? 0.9 : 0.22);
    add(roof[0] + right[0] * 0.28, roof[1], roof[2] + right[1] * 0.28, rgb(0x2f6bff), phase ? 1.1 : 2.5, phase ? 0.22 : 0.9);
  }
  if (v.mission) {
    add(v.x, v.y + 2.1, v.z, rgb(0xffc24b), 2.2, 0.6);
  }
  if (v.smoke > 0.05) {
    add(v.x - forward[0] * spec.length * 0.3, v.y + 1.2, v.z - forward[1] * spec.length * 0.3, rgb(0x3a3330), 1.6, v.smoke * 0.4);
  }
}
