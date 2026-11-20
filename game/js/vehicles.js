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
  if (boosting) v.boost = Math.max(0, v.boost - dt * 0.32 * (v.nitroRate ?? 1));
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
        v.health -= impact * 1.4 * (v.damageScale ?? 1);
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
        v.health = Math.max(0, v.health - damage * (v.damageScale ?? 1));
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
// Geometry: every car is sculpted. The body is a loft of rounded
// superellipse sections along the car (front +Z), so hoods slope, fenders swell and the
// nose and tail round off; a glass greenhouse rides on the belt line, flared arches sit
// over sculpted tyres with spoked rims, and LED strips are decals wrapped on the paint.
// ---------------------------------------------------------------------------

/**
 * Side profile per body: belt-line height keypoints from tail (u = -1) to nose (u = +1),
 * the greenhouse [windscreen base, windscreen top, roof end, rear-glass base] in u, the
 * roof height, how much of the body top the cabin and roof span, and how blunt the ends are.
 */
const BODY_STYLES = {
  supercar: { belt: [[-1, 0.70], [-0.72, 0.84], [-0.25, 0.86], [0.3, 0.74], [1, 0.48]], sill: 0.28, cabin: [0.40, 0.04, -0.30, -0.82], roof: 1.07, roofW: 0.70, blunt: 4.2, wing: true, flare: 0.10 },
  coupe: { belt: [[-1, 0.78], [-0.7, 0.90], [-0.2, 0.90], [0.35, 0.80], [1, 0.58]], sill: 0.30, cabin: [0.36, 0.04, -0.36, -0.74], roof: 1.20, roofW: 0.72, blunt: 4.8, wing: true, flare: 0.08 },
  muscle: { belt: [[-1, 0.84], [-0.7, 0.94], [0, 0.93], [0.5, 0.93], [1, 0.76]], sill: 0.32, cabin: [0.26, 0.0, -0.36, -0.62], roof: 1.30, roofW: 0.76, blunt: 6, flare: 0.07, stripe: true },
  sedan: { belt: [[-1, 0.88], [-0.7, 0.98], [0, 0.97], [0.5, 0.93], [1, 0.76]], sill: 0.32, cabin: [0.34, 0.12, -0.42, -0.66], roof: 1.44, roofW: 0.78, blunt: 6, flare: 0.05 },
  van: { belt: [[-1, 1.04], [-0.5, 1.06], [0.5, 1.02], [1, 0.86]], sill: 0.36, cabin: [0.64, 0.40, -0.965, -0.99], roof: 2.16, roofW: 0.9, blunt: 9, flare: 0.04, cargo: true },
};
BODY_STYLES.taxi = BODY_STYLES.sedan;
BODY_STYLES.cruiser = BODY_STYLES.sedan;

const TRIM = rgb(0x121318);
const TYRE = rgb(0x17181c);

/** Belt-line height at u, eased between the style's keypoints. */
function beltAt(style, u) {
  const k = style.belt;
  if (u <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i += 1) {
    if (u <= k[i + 1][0]) {
      const t = (u - k[i][0]) / (k[i + 1][0] - k[i][0]);
      const s = t * t * (3 - 2 * t);
      return k[i][1] + (k[i + 1][1] - k[i][1]) * s;
    }
  }
  return k[k.length - 1][1];
}

/** The body as a closed surface: a point at length u (-1..1) and section angle t. */
function bodyShape(style, L, W) {
  const hw0 = W / 2 - 0.08;
  const halfWidth = (u) => hw0 * (1 - 0.08 * Math.max(u, 0) ** 3 - 0.05 * Math.max(-u, 0) ** 4);
  const ends = (u) => Math.max(0, 1 - Math.abs(u) ** style.blunt) ** (1 / style.blunt);
  const frame = (u) => {
    const top = beltAt(style, u);
    const bottom = style.sill + 0.07 * Math.abs(u) ** 6;
    return { yc: (top + bottom) / 2, hh: (top - bottom) / 2, e: ends(u), hw: halfWidth(u) };
  };
  const point = (u, t) => {
    const f = frame(u);
    const c = Math.cos(t), s = Math.sin(t);
    // Flatter shoulders above the waist, a fuller tuck below it.
    const ex = 2 / (s > 0 ? 4.2 : 2.6);
    const x = f.hw * f.e * Math.sign(c) * Math.abs(c) ** ex;
    const y = f.yc + f.hh * f.e * Math.sign(s) * Math.abs(s) ** ex;
    return [x, y, (u * L) / 2];
  };
  /** Half-width of the body top at `drop` metres under the roofline of station u. */
  const topWidth = (u, drop) => {
    const f = frame(u);
    const r = Math.max(0, (f.hh * f.e - drop) / Math.max(f.hh * f.e, 1e-3));
    return f.hw * f.e * Math.max(0, 1 - r ** 4.2) ** (1 / 4.2);
  };
  return { point, frame, topWidth, hw0 };
}

export function buildVehicle(b, v, time = 0, opts = {}) {
  const spec = v.spec;
  const style = BODY_STYLES[v.type] ?? BODY_STYLES.sedan;
  const L = spec.length, W = spec.width;
  const lod = opts.lod ?? 0;
  const body = v.color ?? spec.colors.body;
  const accent = v.accent ?? spec.colors.accent;
  const glass = spec.colors.glass;
  const rim = spec.colors.rim;
  const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
  const pitch = v.pitch ?? 0, roll = v.roll ?? 0;
  const baseY = v.y;
  const yaw = -v.heading;      // box() turns by -heading
  const turn = v.heading;     // ellipsoid() turns by +heading
  // Car-local (x right, y up, z forward) to world, with pitch and body roll.
  const P = (lx, ly, lz) => [v.x + lx * cos + lz * sin, baseY + ly - lz * pitch + lx * roll, v.z - lx * sin + lz * cos];
  const shape = bodyShape(style, L, W);
  const PAINT = -0.85, GLASS = -1;

  // --- Body shell.
  const stations = lod ? 9 : 17;
  const ring = lod ? 12 : 20;
  const us = [];
  for (let k = 0; k < stations; k += 1) us.push(Math.sin(((-1 + (2 * k) / (stations - 1)) * Math.PI) / 2));
  const ts = [];
  for (let j = 0; j < ring; j += 1) ts.push((3 * Math.PI) / 2 - (2 * Math.PI * j) / ring);
  const rows = us.map((u) => ts.map((t) => { const p = shape.point(u, t); return P(p[0], p[1], p[2]); }));
  const axis = us.map((u) => { const f = shape.frame(u); return P(0, f.yc, (u * L) / 2); });
  const lowerTrim = shade(body, 0.42);
  b.surface(rows, {
    wrap: true, axis,
    colorAt: (i, j) => (Math.sin((ts[j] + ts[(j + 1) % ring] + (j === ring - 1 ? -2 * Math.PI : 0)) / 2) < -0.62 ? lowerTrim : body),
    glossAt: (i, j) => (Math.sin(ts[j]) < -0.6 ? 0 : PAINT),
  });

  // Decals wrapped on the paint: LED strips, intakes, stripes and livery.
  const decal = (u0, u1, t0, t1, color, e = 0, gloss = 0, cells = 6) => {
    const pts = [], ax = [];
    for (let a = 0; a <= 1; a += 1) {
      const u = a ? u1 : u0;
      const row = [];
      for (let k = 0; k <= cells; k += 1) {
        const t = t0 + ((t1 - t0) * k) / cells;
        const p = shape.point(u, t);
        const f = shape.frame(u);
        const dx = p[0], dy = p[1] - f.yc, dz = Math.sign(u) * (1 - f.e) * 0.6;
        const len = Math.hypot(dx, dy, dz) || 1;
        row.push(P(p[0] + (dx / len) * 0.014, p[1] + (dy / len) * 0.014, p[2] + (dz / len) * 0.014));
      }
      pts.push(row);
      const f = shape.frame(u);
      ax.push(P(0, f.yc, (u * L) / 2));
    }
    b.surface(pts, { axis: ax, color, e, s: gloss });
  };
  const PI = Math.PI;
  const headCol = rgb(0xf4fbff), tailCol = v.braking ? rgb(0xff3a3a) : rgb(0xe0262c);
  decal(0.905, 0.962, 0.07 * PI, 0.30 * PI, headCol, 1, 0, 3);
  decal(0.905, 0.962, 0.70 * PI, 0.93 * PI, headCol, 1, 0, 3);
  decal(-0.972, -0.935, 0.04 * PI, 0.96 * PI, tailCol, v.braking ? 1 : 0.86, 0, lod ? 4 : 10);
  decal(0.935, 0.99, 1.22 * PI, 1.78 * PI, TRIM, 0, 0, 4);
  decal(-0.99, -0.94, 1.2 * PI, 1.8 * PI, TRIM, 0, 0, 4);
  if (style.wing || v.type === 'coupe') {
    for (const [a, c] of [[-0.035 * PI, 0.035 * PI], [0.965 * PI, 1.035 * PI]]) decal(-0.55, 0.62, a, c, accent, 0.4, 0, 1);
  }
  if (style.stripe) {
    decal(-1, -0.2, 0.44 * PI, 0.56 * PI, accent, 0.08, PAINT, 2);
    decal(0.2, 1, 0.44 * PI, 0.56 * PI, accent, 0.08, PAINT, 2);
  }
  if (v.police) {
    decal(-0.5, 0.48, -0.16 * PI, 0.02 * PI, spec.colors.accent, 0, PAINT, 2);
    decal(-0.5, 0.48, 0.98 * PI, 1.16 * PI, spec.colors.accent, 0, PAINT, 2);
    decal(-0.1, 0.1, 0.02 * PI, 0.12 * PI, rgb(0xffc24b), 0.5, 0, 1);
    decal(-0.1, 0.1, 0.88 * PI, 0.98 * PI, rgb(0xffc24b), 0.5, 0, 1);
  }
  if (v.type === 'taxi') decal(-0.6, 0.6, -0.04 * PI, 0.04 * PI, rgb(0x212328), 0, 0, 1);
  if (v.health < 35) decal(0.3, 0.75, 0.3 * PI, 0.7 * PI, rgb(0x2a2420), 0, 0, 2);

  // --- Greenhouse: raked windscreen, glass sides split by pillars, roof, rear glass.
  const [cA, cB, cC, cD] = style.cabin;
  const cabinStations = [];
  const pushStation = (u, h, part) => cabinStations.push({ u, h, part });
  for (let k = 0; k <= 3; k += 1) { const t = k / 3; pushStation(cA + (cB - cA) * t, Math.sin((t * PI) / 2), 'front'); }
  const mid = (cB + cC) / 2;
  pushStation(mid + 0.035, 1, 'roof');
  pushStation(mid - 0.035, 1, 'pillar');
  for (let k = 0; k <= 3; k += 1) { const t = k / 3; pushStation(cC + (cD - cC) * t, Math.cos((t * PI) / 2) ** 0.8, 'rear'); }
  const cabinRing = [[-1, 0], [-1.02, 0.5], [-0.97, 0.9], [-0.55, 1.0], [0.55, 1.0], [0.97, 0.9], [1.02, 0.5], [1, 0]];
  const cabinRows = [], cabinAxis = [];
  for (const st of cabinStations) {
    const f = shape.frame(st.u);
    const beltY = f.yc + f.hh * f.e - 0.05;
    const bw = shape.topWidth(st.u, 0.05) - 0.01;
    const tw = shape.hw0 * style.roofW * (0.92 + 0.08 * st.h);
    const hc = (style.roof - beltY) * st.h;
    cabinRows.push(cabinRing.map(([xf, yf]) => {
      const wHere = bw + (tw - bw) * yf;
      const crown = yf >= 1 ? 0.03 * st.h : 0;
      return P(xf * wHere, beltY + hc * yf + crown, (st.u * L) / 2);
    }));
    cabinAxis.push(P(0, beltY, (st.u * L) / 2));
  }
  // Cells between stations: windscreen, roof with side glass, B-pillar, roof, rear glass.
  const CELL_PARTS = ['front', 'front', 'front', 'roof', 'pillar', 'roof', 'rear', 'rear', 'rear'];
  const roofColor = v.type === 'supercar' ? shade(body, 0.5) : body;
  const cabinCell = (i, j) => {
    const part = CELL_PARTS[i];
    const st = cabinStations[i];
    const side = j <= 1 || j >= 5;
    if (part === 'front' || part === 'rear') {
      if (j === 0 || j === 6) return [body, PAINT];
      return part === 'rear' && style.cargo ? [body, PAINT] : [glass, GLASS];
    }
    if (!side) return [roofColor, PAINT];
    if (part === 'pillar') return [shade(body, 0.3), PAINT];
    if (style.cargo && st.u < 0.25) return [body, PAINT];
    return [glass, GLASS];
  };
  b.surface(cabinRows, {
    axis: cabinAxis,
    colorAt: (i, j) => cabinCell(i, j)[0],
    glossAt: (i, j) => cabinCell(i, j)[1],
  });

  // --- Wheels: flared arches over rounded tyres and spoked rims that turn and steer.
  const wheelR = spec.wheelRadius;
  const axles = [L * 0.32, -L * 0.32];
  const moved = Math.hypot(v.x - (v.wheelX ?? v.x), v.z - (v.wheelZ ?? v.z));
  v.wheelX = v.x; v.wheelZ = v.z;
  v.wheelSpin = ((v.wheelSpin ?? 0) + (moved < 4 ? moved / wheelR : 0) * (v.speed < 0 ? -1 : 1)) % (PI * 2);
  const blurred = Math.abs(v.speed ?? 0) > 14;
  const sides = lod ? 10 : 16;
  for (const az of axles) {
    const steerYaw = az > 0 ? (v.steer ?? 0) * 0.42 : 0;
    for (const side of [-1, 1]) {
      const cx = side * (W / 2 - 0.2);
      buildWheel(b, P, cx, az, side, wheelR, 0.28, steerYaw, v.wheelSpin, rim, sides, blurred, lod);
      // Arch: a flared shell over the tyre, swelling past the body side.
      const R = wheelR + 0.07;
      const archRows = [];
      const steps = lod ? 5 : 9;
      for (let k = 0; k <= steps; k += 1) {
        const th = -0.04 * PI + (1.08 * PI * k) / steps;
        const cols = [[shape.hw0 - 0.16, 0.0], [shape.hw0 - 0.04, style.flare * 0.5], [W / 2 - 0.02, style.flare * 0.3], [W / 2 - 0.01, -0.04]];
        archRows.push(cols.map(([x, dr]) => P(side * x, wheelR + Math.sin(th) * (R + dr), az + Math.cos(th) * (R + dr))));
      }
      b.surface(archRows, { color: body, s: PAINT, flip: side > 0 });
      const lip = [];
      for (let k = 0; k <= steps; k += 1) {
        const th = -0.04 * PI + (1.08 * PI * k) / steps;
        lip.push([P(side * (W / 2 - 0.01), wheelR + Math.sin(th) * (R - 0.04), az + Math.cos(th) * (R - 0.04)),
          P(side * (W / 2 - 0.36), wheelR + Math.sin(th) * (R - 0.03), az + Math.cos(th) * (R - 0.03))]);
      }
      b.surface(lip, { color: TRIM, flip: side > 0 });
    }
  }

  // --- Details: mirrors, wing, exhausts, roof gear.
  const f0 = shape.frame(cA);
  const mirrorY = f0.yc + f0.hh * f0.e + 0.1;
  for (const side of [-1, 1]) {
    const m = P(side * (shape.topWidth(cA, 0.05) + 0.05), mirrorY - 0.03, (cA * L) / 2 - 0.16);
    b.ellipsoid(m[0], m[1], m[2], 0.085, 0.05, 0.06, body, { yaw: turn, segments: 6, rings: 4, s: PAINT });
  }
  if (style.wing) {
    const ft = shape.frame(-0.86);
    const wingY = ft.yc + ft.hh * ft.e + (v.type === 'supercar' ? 0.26 : 0.2);
    const [wx, , wz] = P(0, 0, -L * 0.43);
    b.box(wx, wingY + baseY, wz, W * 0.8, 0.05, 0.42, shade(body, 0.62), { rotY: yaw, omitBottom: true, s: PAINT });
    const [lx, , lz] = P(0, 0, -L * 0.445);
    b.box(lx, wingY + baseY + 0.035, lz, W * 0.78, 0.02, 0.08, accent, { rotY: yaw, e: 0.5 });
    for (const side of [-1, 1]) {
      const [sx, , sz] = P(side * W * 0.26, 0, -L * 0.43);
      b.box(sx, wingY + baseY - 0.13, sz, 0.05, 0.26, 0.2, TRIM, { rotY: yaw, omitBottom: true });
      const [ex, , ez] = P(side * W * 0.4, 0, -L * 0.43);
      b.box(ex, wingY + baseY, ez, 0.03, 0.16, 0.46, shade(body, 0.55), { rotY: yaw, omitBottom: true });
    }
  }
  if (!lod) {
    for (const side of [-1, 1]) {
      const e = P(side * W * 0.2, style.sill + 0.08, -L * 0.495);
      b.ellipsoid(e[0], e[1], e[2], 0.07, 0.07, 0.06, rgb(0xb9bcc0), { yaw: turn, segments: 6, rings: 3, e: 0.1 });
    }
  }
  const roofY = style.roof + 0.03;
  if (v.type === 'muscle') {
    const s = P(0, beltAt(style, 0.55) + 0.05, L * 0.28);
    b.box(s[0], s[1], s[2], W * 0.34, 0.12, 0.6, TRIM, { rotY: yaw, omitBottom: true });
  }
  if (v.police) {
    const uMid = ((cB + cC) / 2) * L / 2;
    const base = P(0, roofY + 0.04, uMid);
    b.box(base[0], base[1], base[2], W * 0.52, 0.07, 0.34, rgb(0x1a1c22), { rotY: yaw, omitBottom: true });
    const phase = Math.floor((time + (v.sirenPhase ?? 0) * 0.5) * 7) % 2;
    const red = P(-W * 0.14, roofY + 0.13, uMid), blue = P(W * 0.14, roofY + 0.13, uMid);
    b.ellipsoid(red[0], red[1], red[2], W * 0.13, 0.08, 0.15, phase ? rgb(0xff2a3d) : rgb(0x7a1420), { yaw: turn, segments: 8, rings: 4, e: phase ? 1 : 0.5 });
    b.ellipsoid(blue[0], blue[1], blue[2], W * 0.13, 0.08, 0.15, phase ? rgb(0x18266e) : rgb(0x2f6bff), { yaw: turn, segments: 8, rings: 4, e: phase ? 0.5 : 1 });
    // Push bar.
    const pb = P(0, 0.5, L * 0.515);
    b.box(pb[0], pb[1], pb[2], W * 0.62, 0.3, 0.08, rgb(0x2c2e33), { rotY: yaw, omitBottom: true });
  }
  if (v.type === 'taxi') {
    const t = P(0, roofY + 0.12, ((cB + cC) / 2) * L / 2);
    b.box(t[0], t[1], t[2], W * 0.3, 0.2, 0.4, rgb(0xffd25a), { rotY: yaw, e: 0.75, omitBottom: true });
  }
  if (v.type === 'van') {
    for (let i = 0; i < 3; i += 1) {
      const r = P(-W * 0.25 + i * W * 0.25, roofY + 0.06, -L * 0.15);
      b.box(r[0], r[1], r[2], 0.06, 0.06, L * 0.5, rgb(0xa9aaa8), { rotY: yaw });
    }
  }
  if (v.mission) {
    const m = P(0, roofY + 0.1, ((cB + cC) / 2) * L / 2);
    b.ellipsoid(m[0], m[1], m[2], 0.12, 0.1, 0.12, rgb(0xffc24b), { segments: 6, rings: 4, e: 1 });
  }
  return v;
}

/** A rounded tyre (tread, shoulders, sidewalls) with a dished, spoked rim on its outer face. */
function buildWheel(b, P, cx, cz, side, r, width, steerYaw, spin, rimColor, sides, blurred, lod) {
  const cs = Math.cos(steerYaw), ss = Math.sin(steerYaw);
  const at = (a, rho, phi) => {
    const yr = Math.cos(phi) * rho, zr = Math.sin(phi) * rho;
    const ox = side * a;
    return P(cx + ox * cs + zr * ss, r + yr, cz - ox * ss + zr * cs);
  };
  const hw = width / 2;
  const profile = lod
    ? [[-hw, 0.62], [-hw, 1], [hw, 1], [hw, 0.66]]
    : [[-hw, 0.6], [-hw * 0.92, 0.95], [-hw * 0.6, 1], [hw * 0.6, 1], [hw * 0.92, 0.95], [hw, 0.66]];
  const rows = [], axis = [];
  for (let k = 0; k < sides; k += 1) {
    const phi = (k / sides) * Math.PI * 2 + spin;
    rows.push(profile.map(([a, f]) => at(a, r * f, phi)));
    axis.push(at(0, 0, phi));
  }
  // Rows wrap around the axle; treat each profile column as the ring.
  const ringRows = profile.map((_, c) => rows.map((row) => row[c]));
  b.surface(ringRows, { wrap: true, axis: profile.map(([a]) => at(a, 0, 0)), color: TYRE });
  // Rim face: five spokes over a dark barrel, a bright lip and a hub cap.
  const face = hw + 0.004;
  const hub = at(face + 0.02, 0, 0);
  const n = sides;
  for (let k = 0; k < n; k += 1) {
    const p0 = (k / n) * Math.PI * 2 + spin, p1 = ((k + 1) / n) * Math.PI * 2 + spin;
    const spoke = blurred ? true : (Math.floor((k / n) * 15) % 3 === 0);
    const inner = blurred ? shade(rimColor, 0.62) : spoke ? rimColor : rgb(0x24262b);
    const a0 = at(face, r * 0.6, p0), a1 = at(face, r * 0.6, p1);
    const m0 = at(face - 0.03, r * 0.18, p0), m1 = at(face - 0.03, r * 0.18, p1);
    b.quad(m0, a0, a1, m1, inner, { s: -0.6 });
    b.tri(hub, m0, m1, shade(rimColor, 1.08), { e: 0.08, s: -0.6 });
  }
}

/**
 * Light the car: headlight and LED tail-bar halos, flat light pools washing the road
 * ahead and behind, nitro flames, siren strobes with red/blue pools, beacons and smoke.
 * `add(x, y, z, color, radius, alpha, flat)`; a flat glow is {sx, sz, rot} on the ground.
 */
export function vehicleGlow(v, time, add) {
  const forward = vehicleForward(v);
  const right = vehicleRight(v);
  const spec = v.spec;
  const style = BODY_STYLES[v.type] ?? BODY_STYLES.sedan;
  const L = spec.length, W = spec.width;
  const at = (lx, ly, lz) => [v.x + right[0] * lx + forward[0] * lz, v.y + ly, v.z + right[1] * lx + forward[1] * lz];
  const headY = beltAt(style, 0.93) - 0.06;
  const tailY = beltAt(style, -0.95) - 0.04;
  for (const side of [-1, 1]) {
    const h = at(side * W * 0.3, headY, L * 0.475);
    add(h[0], h[1], h[2], rgb(0xeef6ff), 0.62, 0.62);
    add(h[0], h[1], h[2], rgb(0xffffff), 0.22, 0.9);
  }
  // The tail bar: a row of red LEDs across the back.
  const tailAlpha = v.braking ? 0.75 : 0.42;
  for (let i = -3; i <= 3; i += 1) {
    const t = at((i / 3) * W * 0.34, tailY, -L * 0.478);
    add(t[0], t[1], t[2], rgb(0xff2a2a), Math.abs(i) === 3 ? 0.5 : 0.32, tailAlpha);
  }
  const fx = forward[0], fz = forward[1];
  const rot = v.heading;
  // Light pools on the asphalt: a long warm wash ahead, a red glow behind.
  const ahead = at(0, 0.07, L * 1.15);
  add(ahead[0], ahead[1], ahead[2], rgb(0xffe6b8), 2.4, 0.22, { sx: 1.1, sz: 2.4, rot });
  const behind = at(0, 0.06, -L * 0.72);
  add(behind[0], behind[1], behind[2], rgb(0xff2a22), 1.8, v.braking ? 0.32 : 0.16, { sx: 1.2, sz: 1.0, rot });
  if (v.boosting) {
    for (const side of [-1, 1]) {
      const n = at(side * W * 0.2, style.sill + 0.08, -L * 0.53);
      add(n[0], n[1], n[2], rgb(0xff7a1e), 0.7, 0.8);
      const n2 = at(side * W * 0.2, style.sill + 0.08, -L * 0.6);
      add(n2[0], n2[1], n2[2], rgb(0x3fa8ff), 0.42, 0.5);
    }
  }
  if (v.police && v.sirenOn) {
    const phase = Math.floor((time + (v.sirenPhase ?? 0) * 0.5) * 7) % 2;
    const uMid = ((style.cabin[1] + style.cabin[2]) / 2) * L / 2;
    const red = at(-W * 0.14, style.roof + 0.16, uMid), blue = at(W * 0.14, style.roof + 0.16, uMid);
    add(red[0], red[1], red[2], rgb(0xff2a3d), phase ? 2.6 : 1.3, phase ? 0.95 : 0.4);
    add(blue[0], blue[1], blue[2], rgb(0x2f6bff), phase ? 1.3 : 2.6, phase ? 0.4 : 0.95);
    add(red[0], red[1], red[2], rgb(0xffd6dc), 0.3, phase ? 1 : 0.3);
    add(blue[0], blue[1], blue[2], rgb(0xd6e2ff), 0.3, phase ? 0.3 : 1);
    // Red and blue pools washing the wet road around the cruiser.
    const l = at(-1.4, 0.06, 0), r = at(1.4, 0.06, 0);
    add(l[0], l[1], l[2], rgb(0xff2438), 4.2, phase ? 0.34 : 0.18, { sx: 1, sz: 1, rot });
    add(r[0], r[1], r[2], rgb(0x2f6bff), 4.2, phase ? 0.18 : 0.34, { sx: 1, sz: 1, rot });
  }
  if (v.mission) {
    add(v.x, v.y + style.roof + 0.4, v.z, rgb(0xffc24b), 2.0, 0.6);
  }
  if (v.smoke > 0.05) {
    add(v.x - fx * L * 0.3, v.y + 1.2, v.z - fz * L * 0.3, rgb(0x3a3330), 1.6, v.smoke * 0.4);
  }
}

/**
 * The police air unit: a two-tone glossy fuselage with a glass bubble canopy, a tapered
 * tail boom and fin, skids, spinning rotors, nav strobes and a searchlight whose beam
 * falls as a soft volumetric cone onto `h.spotX, h.spotZ`.
 * `addGlow(x, y, z, color, r, alpha, flat)`; `addBeam(from, to, r0, r1, color, alpha)`.
 */
export function buildHelicopter(b, h, time, addGlow, addBeam) {
  const cos = Math.cos(h.heading), sin = Math.sin(h.heading);
  const P = (lx, ly, lz) => [h.x + lx * cos + lz * sin, h.y + ly, h.z - lx * sin + lz * cos];
  const navy = rgb(0x1c2a44), white = rgb(0xe9ecef), dark = rgb(0x15181e);
  const body = P(0, 0, 0.3);
  b.ellipsoid(body[0], body[1], body[2], 1.25, 1.15, 2.5, navy, {
    yaw: h.heading, segments: 14, rings: 8, s: -0.75,
    colorAt: (i) => (i >= 5 ? white : i === 4 ? rgb(0xffc24b) : navy),
  });
  const canopy = P(0, 0.2, 1.45);
  b.ellipsoid(canopy[0], canopy[1], canopy[2], 1.02, 0.86, 1.35, rgb(0x16222e), { yaw: h.heading, segments: 12, rings: 6, s: -1 });
  b.tube([P(0, 0.35, -1.7), P(0, 0.55, -4.2), P(0, 0.75, -6.3)], [0.5, 0.3, 0.16], 8, navy, { s: -0.6 });
  const fin = P(0, 1.35, -6.1);
  b.box(fin[0], fin[1], fin[2], 0.12, 1.5, 0.9, navy, { rotY: -h.heading, omitBottom: true });
  const stab = P(0, 0.8, -5.6);
  b.box(stab[0], stab[1], stab[2], 2.0, 0.08, 0.5, navy, { rotY: -h.heading, omitBottom: true });
  // Tail rotor: a vertical spinning blade beside the fin.
  const ta = time * 40;
  b.segment(P(0.22, 1.3 + Math.cos(ta) * 0.9, -6.25 + Math.sin(ta) * 0.9), P(0.22, 1.3 - Math.cos(ta) * 0.9, -6.25 - Math.sin(ta) * 0.9), 0.04, 0.14, rgb(0x8f979e));
  // Main rotor: mast, hub and four long blades.
  const mast = P(0, 1.2, 0.2);
  b.tube([mast, [mast[0], mast[1] + 0.6, mast[2]]], [0.16, 0.12], 6, dark);
  const rotor = time * 19;
  for (let i = 0; i < 4; i += 1) {
    const a = rotor + (i * Math.PI) / 2;
    b.segment([mast[0], mast[1] + 0.62, mast[2]], [mast[0] + Math.cos(a) * 6.2, mast[1] + 0.58, mast[2] + Math.sin(a) * 6.2], 0.36, 0.05, dark);
  }
  // Skids on struts.
  for (const side of [-1, 1]) {
    b.tube([P(side * 1.15, -1.45, -1.4), P(side * 1.15, -1.45, 1.6), P(side * 1.15, -1.25, 2.1)], [0.07, 0.07, 0.07], 5, rgb(0x4a5158));
    b.segment(P(side * 0.7, -0.8, -0.6), P(side * 1.15, -1.45, -0.7), 0.08, 0.08, rgb(0x4a5158));
    b.segment(P(side * 0.7, -0.8, 1.0), P(side * 1.15, -1.45, 1.0), 0.08, 0.08, rgb(0x4a5158));
  }
  // Nav strobes and the searchlight.
  const port = P(-1.3, -0.2, 0.2), star = P(1.3, -0.2, 0.2), tail = P(0, 0.9, -6.4);
  const blink = Math.floor(time * 2.5) % 2;
  addGlow(port[0], port[1], port[2], rgb(0xff2a3d), 1.1, 0.85);
  addGlow(star[0], star[1], star[2], rgb(0x39ff9e), 1.0, 0.8);
  addGlow(tail[0], tail[1], tail[2], rgb(0xffffff), blink ? 1.4 : 0.6, blink ? 0.9 : 0.3);
  const lamp = P(0, -1.05, 2.0);
  b.ellipsoid(lamp[0], lamp[1], lamp[2], 0.24, 0.2, 0.24, rgb(0xfff6dc), { segments: 6, rings: 4, e: 1 });
  addGlow(lamp[0], lamp[1], lamp[2], rgb(0xfff4d6), 2.2, 0.95);
  const spot = [h.spotX, 0.2, h.spotZ];
  addBeam(lamp, spot, 0.6, 6.0, rgb(0xfff0c8), 0.5);
  addGlow(spot[0], 0.14, spot[2], rgb(0xfff1c2), 7.5, 0.34, { sx: 1, sz: 1 });
  addGlow(spot[0], 0.15, spot[2], rgb(0xffffff), 3.6, 0.5, { sx: 1, sz: 1 });
}
