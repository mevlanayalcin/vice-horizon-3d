// combat.js — Mateo on foot: WASD movement relative to the camera, sprint, jump,
// punch, and four weapons with magazine/reload state. Hitscan tracers, muzzle
// flashes, sparks, blood, enemy goons and police officers with health bars.
// buildCharacter() is the shared low-poly person used by pedestrians and NPCs too.

import { PALETTE, WEAPONS, clamp, lerp, mix3, rgb, shade } from './config.js';
import { vehicleForward } from './vehicles.js';

const SKIN = [rgb(0xc98f66), rgb(0xb07850), rgb(0xe2b28a), rgb(0x8d5c3d), rgb(0xd9a377)];
const SHIRTS = [rgb(0xff6f61), rgb(0x44c9c0), rgb(0xffc85a), rgb(0xd967c9), rgb(0x7a9cff), rgb(0xf2e6d0), rgb(0x2b2f38)];
const PANTS = [rgb(0x394152), rgb(0x6c5a4a), rgb(0x2a2c31), rgb(0x8d8377), rgb(0x3f6b62), rgb(0xb5a287)];
const HAIR = [rgb(0x221a15), rgb(0x5a3a22), rgb(0xc9a06a), rgb(0x1a1a1c), rgb(0x7a4a2a), rgb(0xe2cfa8)];

export function characterColors(seed = 0.5, style = 'civ') {
  if (style === 'cop') {
    return { skin: SKIN[Math.floor(seed * SKIN.length) % SKIN.length], shirt: rgb(0x26364c), pants: rgb(0x1e2734), hair: HAIR[Math.floor(seed * HAIR.length) % HAIR.length], accent: rgb(0xe9d27a) };
  }
  if (style === 'guard') {
    return { skin: SKIN[Math.floor(seed * SKIN.length) % SKIN.length], shirt: rgb(0x34404f), pants: rgb(0x1d232c), hair: rgb(0x17171a), accent: rgb(0xffc24b), vest: rgb(0x22262c) };
  }
  if (style === 'goon') {
    return { skin: SKIN[Math.floor(seed * SKIN.length) % SKIN.length], shirt: rgb(0x2e2b30), pants: rgb(0x232326), hair: rgb(0x17171a), accent: rgb(0x8f2b2b) };
  }
  const i = Math.floor(seed * 1000);
  return {
    skin: SKIN[i % SKIN.length],
    shirt: SHIRTS[(i * 7) % SHIRTS.length],
    pants: PANTS[(i * 13) % PANTS.length],
    hair: HAIR[(i * 3) % HAIR.length],
    accent: SHIRTS[(i * 5 + 2) % SHIRTS.length],
  };
}

/**
 * Shared stylised humanoid, sculpted from smooth parts: tapered tube limbs with knees and
 * elbows, a lofted torso (hips, waist, chest, shoulders), a rounded head with hair, caps
 * or shades, and shoes. `c` = {x,z,y,heading,phase,speed,colors,aiming,weapon,panic,dead,
 * style,scale,lod}. The walk, aim and panic poses move the joints, not whole boxes.
 */
export function buildCharacter(b, c, time = 0) {
  const heading = c.heading ?? 0;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const baseY = c.y ?? 0;
  const W = (lx, ly, lz) => [c.x + lx * cos + lz * sin, baseY + ly, c.z - lx * sin + lz * cos];
  const yaw = heading;
  const colors = c.colors ?? characterColors(0.4, c.style ?? 'civ');
  const k = c.scale ?? 1;
  const lod = c.lod ?? 0;
  const sides = lod ? 4 : 6;
  const walk = c.phase ?? 0;
  const speed = c.speed ?? 0;
  const swing = clamp(speed / 3, 0, 1);
  const bob = Math.sin(walk * 2) * 0.035 * swing;
  const step = Math.sin(walk) * 0.42 * swing;
  const step2 = Math.sin(walk + Math.PI) * 0.42 * swing;
  const shoe = rgb(0x2c2f36);
  if (c.dead) {
    // A still, dark silhouette flat on the ground.
    const body = W(0, 0.14, 0.05);
    b.ellipsoid(body[0], body[1], body[2], 0.24 * k, 0.12 * k, 0.62 * k, shade(colors.shirt, 0.55), { yaw, segments: 8, rings: 4 });
    const head = W(0, 0.13, 0.78 * k);
    b.ellipsoid(head[0], head[1], head[2], 0.12 * k, 0.11 * k, 0.13 * k, colors.skin, { yaw, segments: 7, rings: 4 });
    return;
  }
  // Ducking (0..1): a bystander cowering from gunfire sinks into a crouch, knees forward.
  const duck = clamp(c.duck ?? 0, 0, 1);
  const hipY = (0.94 - 0.42 * duck) * k + bob;
  const headY = (1.72 - 0.52 * duck) * k + bob;

  // Legs: hip, knee and ankle joints with a forward knee bend in stride.
  for (const [side, st] of [[-1, step], [1, step2]]) {
    const hip = W(side * 0.095 * k, hipY, -0.12 * duck * k);
    const knee = W(side * (0.1 + 0.04 * duck) * k, (0.5 - 0.06 * duck) * k, st * 0.45 + (0.04 + 0.34 * duck) * k);
    const ankle = W(side * 0.1 * k, 0.1 * k, st);
    b.tube([hip, knee, ankle], [0.088 * k, 0.07 * k, 0.052 * k], sides, colors.pants);
    const foot = W(side * 0.1 * k, 0.055 * k, st + 0.05 * k);
    b.ellipsoid(foot[0], foot[1], foot[2], 0.062 * k, 0.05 * k, 0.13 * k, shoe, { yaw, segments: 6, rings: 3 });
  }

  // Torso: hips, belt, waist, chest and shoulders lofted into one smooth body.
  const torsoRows = [
    [hipY - 0.05, 0.165, 0.11],
    [hipY + 0.05, 0.16, 0.106],
    [hipY + 0.1, 0.152, 0.102],
    [hipY + 0.36, 0.182, 0.118],
    [hipY + 0.5, 0.19, 0.1],
    [hipY + 0.6, 0.07, 0.06],
  ];
  const torsoCells = [colors.pants, shade(colors.pants, 0.55), colors.shirt, colors.shirt, colors.shirt];
  const ringN = lod ? 6 : 10;
  const rows = [], axis = [];
  for (const [y, rx, rz] of torsoRows) {
    const ring = [];
    for (let i = 0; i < ringN; i += 1) {
      const a = (i / ringN) * Math.PI * 2;
      ring.push(W(Math.cos(a) * rx * k, y, Math.sin(a) * rz * k));
    }
    rows.push(ring);
    axis.push(W(0, y, 0));
  }
  b.surface(rows, { wrap: true, axis, colorAt: (i) => torsoCells[i] });
  if (colors.jacket || colors.vest) {
    // Player: an open linen blazer over the shirt. Vault guards: a plated tactical vest.
    const jacket = !!colors.jacket;
    const gap = jacket ? 0.55 : 0.0;
    const cols = lod ? 7 : 12;
    const jRows = [], jAxis = [];
    const jSpec = jacket
      ? [[hipY - 0.02, 0.178, 0.124], [hipY + 0.12, 0.17, 0.118], [hipY + 0.36, 0.198, 0.132], [hipY + 0.5, 0.212, 0.118], [hipY + 0.6, 0.12, 0.09]]
      : [[hipY + 0.1, 0.178, 0.135], [hipY + 0.3, 0.2, 0.148], [hipY + 0.48, 0.205, 0.132]];
    for (const [y, rx, rz] of jSpec) {
      const ring = [];
      for (let i = 0; i <= cols; i += 1) {
        const a = Math.PI / 2 + gap + (i / cols) * (Math.PI * 2 - gap * 2);
        ring.push(W(Math.cos(a) * rx * k, y, Math.sin(a) * rz * k));
      }
      jRows.push(ring);
      jAxis.push(W(0, y, 0));
    }
    const shell = jacket ? colors.jacket : colors.vest;
    b.surface(jRows, { axis: jAxis, colorAt: (i) => (!jacket && i === 1 ? shade(shell, 1.25) : shell), s: jacket ? 0 : -0.35 });
    if (jacket) {
      // Lapels and a pocket square in gold.
      for (const side of [-1, 1]) {
        const lap = W(side * 0.07 * k, hipY + 0.44, 0.112 * k);
        b.ellipsoid(lap[0], lap[1], lap[2], 0.035 * k, 0.12 * k, 0.02 * k, shade(colors.jacket, 0.86), { yaw: yaw + side * 0.3, segments: 5, rings: 3 });
      }
      const sq = W(0.12 * k, hipY + 0.4, 0.118 * k);
      b.box(sq[0], sq[1], sq[2], 0.05 * k, 0.03 * k, 0.012, colors.accent, { rotY: -yaw, omitBottom: true });
    } else {
      // Gold unit stripe and a glowing ID strip across the vest.
      const strip = W(0, hipY + 0.34, 0.15 * k);
      b.box(strip[0], strip[1], strip[2], 0.26 * k, 0.04 * k, 0.02, colors.accent, { rotY: -yaw, e: 0.7, omitBottom: true });
      for (const side of [-1, 1]) {
        const pad = W(side * 0.21 * k, hipY + 0.5, 0);
        b.ellipsoid(pad[0], pad[1], pad[2], 0.075 * k, 0.05 * k, 0.09 * k, colors.vest, { yaw, segments: 6, rings: 3 });
        const pouch = W(side * 0.09 * k, hipY + 0.18, 0.15 * k);
        b.box(pouch[0], pouch[1], pouch[2], 0.08 * k, 0.09 * k, 0.05 * k, shade(colors.vest, 1.3), { rotY: -yaw, omitBottom: true });
      }
    }
  }
  if (c.style === 'guard') {
    const helm = W(0, headY + 0.045 * k, -0.005 * k);
    b.ellipsoid(helm[0], helm[1], helm[2], 0.138 * k, 0.12 * k, 0.15 * k, colors.vest, { yaw, segments: 9, rings: 4, top: 0.56, s: -0.4 });
    const visor = W(0, headY + 0.005 * k, 0.118 * k);
    b.ellipsoid(visor[0], visor[1], visor[2], 0.105 * k, 0.04 * k, 0.03 * k, rgb(0x0b1c2a), { yaw, segments: 6, rings: 3, s: -1 });
  }
  if (c.style === 'cop') {
    const badge = W(0.09 * k, hipY + 0.42, 0.12 * k);
    b.ellipsoid(badge[0], badge[1], badge[2], 0.035, 0.035, 0.012, colors.accent, { yaw, segments: 5, rings: 3, e: 0.4 });
  } else if (c.style !== 'goon' && c.style !== 'guard') {
    // An open overshirt collar in the accent colour.
    const collar = W(0, hipY + 0.55, 0.05 * k);
    b.ellipsoid(collar[0], collar[1], collar[2], 0.11 * k, 0.04 * k, 0.07 * k, colors.accent, { yaw, segments: 6, rings: 3 });
  }

  // Neck and head.
  const neck = W(0, hipY + 0.58, 0);
  const chin = W(0, headY - 0.1 * k, 0.01);
  b.tube([neck, chin], [0.05 * k, 0.048 * k], sides, colors.skin);
  const head = W(0, headY, 0.01 * k);
  b.ellipsoid(head[0], head[1], head[2], 0.112 * k, 0.138 * k, 0.122 * k, colors.skin, { yaw, segments: lod ? 6 : 10, rings: lod ? 4 : 7 });
  const hair = W(0, headY + 0.028 * k, -0.012 * k);
  b.ellipsoid(hair[0], hair[1], hair[2], 0.122 * k, 0.13 * k, 0.135 * k, colors.hair, { yaw, segments: lod ? 6 : 10, rings: 4, top: 0.52 });
  if (c.longHair) {
    const back = W(0, headY - 0.07 * k, -0.07 * k);
    b.ellipsoid(back[0], back[1], back[2], 0.11 * k, 0.17 * k, 0.07 * k, colors.hair, { yaw, segments: 7, rings: 4 });
  }
  if (c.style === 'player' || c.style === 'goon') {
    const shades = W(0, headY + 0.012 * k, 0.122 * k);
    b.ellipsoid(shades[0], shades[1], shades[2], 0.1 * k, 0.03 * k, 0.025 * k, rgb(0x0d0f14), { yaw, segments: 6, rings: 3, s: -0.95 });
  }
  if (c.style === 'cop') {
    const cap = W(0, headY + 0.06 * k, 0);
    b.ellipsoid(cap[0], cap[1], cap[2], 0.13 * k, 0.1 * k, 0.14 * k, rgb(0x1a2230), { yaw, segments: 8, rings: 4, top: 0.55 });
    const brim = W(0, headY + 0.06 * k, 0.13 * k);
    b.ellipsoid(brim[0], brim[1], brim[2], 0.11 * k, 0.018 * k, 0.07 * k, rgb(0x101317), { yaw, segments: 6, rings: 3 });
  }

  // Arms: panic up, aiming forward, or swinging with the walk. Short sleeves, bare forearms.
  const longSleeve = c.style === 'cop' || c.style === 'guard' || !!colors.jacket;
  const sleeve = colors.jacket ?? colors.shirt;
  const sleeveRow = (color) => (i) => (i === 0 ? color : longSleeve ? shade(color, 0.94) : colors.skin);
  const arm = (shoulder, elbow, hand) => {
    b.tube([shoulder, elbow, hand], [0.066 * k, 0.054 * k, 0.042 * k], sides, sleeve, { colorAt: sleeveRow(sleeve) });
    b.ellipsoid(hand[0], hand[1], hand[2], 0.048 * k, 0.055 * k, 0.05 * k, colors.skin, { yaw, segments: 6, rings: 3 });
  };
  const shoulderY = hipY + 0.5;
  const shoulderL = W(-0.205 * k, shoulderY, 0);
  const shoulderR = W(0.205 * k, shoulderY, 0);
  const weapon = c.weapon ?? null;
  if (c.panic && duck > 0.3) {
    // Cowering: both hands clasped over the head.
    arm(shoulderL, W(-0.3 * k, shoulderY + 0.12, 0.14 * k), W(-0.08 * k, headY + 0.12 * k, 0.04 * k));
    arm(shoulderR, W(0.3 * k, shoulderY + 0.12, 0.14 * k), W(0.08 * k, headY + 0.12 * k, 0.04 * k));
  } else if (c.panic) {
    arm(shoulderL, W(-0.34 * k, shoulderY + 0.2, 0.05), W(-0.36 * k, shoulderY + 0.46, 0.08));
    arm(shoulderR, W(0.34 * k, shoulderY + 0.2, 0.05), W(0.36 * k, shoulderY + 0.46, 0.08));
  } else if (c.aiming || weapon) {
    const aim = c.aimYaw ?? heading;
    const rel = aim - heading;
    const local = (lx, lz) => [lx * Math.cos(rel) + lz * Math.sin(rel), -lx * Math.sin(rel) + lz * Math.cos(rel)];
    const [hx, hz] = local(0.04, 0.6 * k);
    const [ex, ez] = local(0.2 * k, 0.3 * k);
    const handY = shoulderY - 0.06;
    arm(shoulderR, W(ex, shoulderY - 0.1, ez), W(hx, handY, hz));
    const [sx, sz] = local(-0.06, 0.48 * k);
    const [lx, lz] = local(-0.16 * k, 0.24 * k);
    arm(shoulderL, W(lx, shoulderY - 0.16, lz), W(sx, handY - 0.03, sz));
    if (weapon) {
      // Original low-poly hardware: dark receiver, coloured energy cell.
      const gunLength = weapon === 'shotgun' ? 0.95 : weapon === 'smg' ? 0.62 : 0.42;
      const gunYaw = -aim;
      const [gx0, gz0] = local(0.02, 0.62 * k);
      const g = W(gx0, handY + 0.04, gz0);
      const fx = Math.sin(aim), fz = Math.cos(aim);
      b.box(g[0], g[1], g[2], 0.08, 0.12, gunLength, rgb(0x23262c), { rotY: gunYaw, omitBottom: true, s: -0.5 });
      b.box(g[0], g[1] - 0.03, g[2], 0.05, 0.05, gunLength * 0.8, rgb(0x8f979e), { rotY: gunYaw, omitBottom: true, s: -0.7 });
      b.box(g[0] + fx * gunLength * 0.45, g[1], g[2] + fz * gunLength * 0.45, 0.06, 0.06, 0.08, rgb(0x3a3e46), { rotY: gunYaw, omitBottom: true });
      if (weapon === 'smg') {
        b.box(g[0], g[1] + 0.1, g[2], 0.035, 0.08, 0.1, PALETTE.neonCyan, { rotY: gunYaw, e: 0.6, omitBottom: true });
      }
    }
  } else {
    const armSwing = Math.sin(walk) * 0.35 * swing;
    arm(shoulderL, W(-0.24 * k, shoulderY - 0.27, -armSwing * 0.35), W(-0.25 * k, shoulderY - 0.53, -armSwing * 0.7 + 0.05));
    arm(shoulderR, W(0.24 * k, shoulderY - 0.27, armSwing * 0.35), W(0.25 * k, shoulderY - 0.53, armSwing * 0.7 + 0.05));
  }
}

/**
 * A star-shaped muzzle flash at (x, y, z) firing along unit (ux, uy, uz): a long forward
 * spike and a ring of shorter petals, each a pair of crossed emissive blades.
 */
function buildMuzzleFlash(b, x, y, z, ux, uy, uz, size, color, seed) {
  let ax = uz, ay = 0, az = -ux;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
  const hot = rgb(0xfff4d2);
  const warm = mix3(color, rgb(0xffb04a), 0.5);
  const blade = (dx, dy, dz, len, width, col) => {
    const tip = [x + dx * len, y + dy * len, z + dz * len];
    for (const [sx, sy, sz] of [[ax, ay, az], [bx, by, bz]]) {
      const w = width * size;
      b.tri([x + sx * w, y + sy * w, z + sz * w], tip, [x - sx * w, y - sy * w, z - sz * w], col, { e: 1, n: [-ux, -uy, -uz] });
    }
  };
  blade(ux, uy, uz, 0.95 * size, 0.16, hot);
  const petals = 6;
  for (let i = 0; i < petals; i += 1) {
    const a = (i / petals) * Math.PI * 2 + seed * 0.7;
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = ux * 0.55 + (ax * ca + bx * sa) * 0.8;
    const dy = uy * 0.55 + (ay * ca + by * sa) * 0.8;
    const dz = uz * 0.55 + (az * ca + bz * sa) * 0.8;
    const dl = Math.hypot(dx, dy, dz);
    blade(dx / dl, dy / dl, dz / dl, (0.42 + (i % 2) * 0.2) * size, 0.07, i % 2 ? warm : hot);
  }
}

// ---------------------------------------------------------------------------
// Combat system
// ---------------------------------------------------------------------------

export function createCombat(world, bus) {
  const player = {
    x: world.spawn.x, z: world.spawn.z, y: 0,
    heading: Math.PI,
    aimYaw: Math.PI,
    velocityX: 0, velocityZ: 0,
    height: 1.8,
    radius: 0.5,
    health: 100,
    armor: 0,
    maxHealth: 100,
    maxArmor: 100,
    cash: 640,
    respect: 0,
    weaponSlot: 2,
    weapons: ['fists', 'pistol'],
    ammo: {
      pistol: { mag: 12, reserve: 96 },
      smg: { mag: 30, reserve: 180 },
      shotgun: { mag: 6, reserve: 36 },
    },
    fireCooldown: 0,
    reloadTimer: 0,
    recoil: 0,
    punchTimer: 0,
    jumpY: 0,
    jumpVelocity: 0,
    sprinting: false,
    moving: false,
    walkPhase: 0,
    inVehicle: null,
    dead: false,
    deathTimer: 0,
    hitFlash: 0,
    lastDamageAt: -10,
    colors: { skin: rgb(0xc58f68), shirt: rgb(0xe85a44), pants: rgb(0x3c4d68), hair: rgb(0x1d1a19), jacket: rgb(0xeee4d2), accent: rgb(0xffc24b) },
    style: 'player',
    longHair: false,
  };

  const enemies = [];
  const tracers = [];
  const particles = [];
  const impacts = [];
  let time = 0;

  const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

  function weapon() {
    return WEAPON_BY_ID[player.weapons.includes(weaponId()) ? weaponId() : 'fists'];
  }
  function weaponId() {
    const w = WEAPONS.find((item) => item.slot === player.weaponSlot);
    return w ? w.id : 'fists';
  }

  function reset(x, z) {
    player.x = x ?? world.spawn.x;
    player.z = z ?? world.spawn.z;
    player.y = world.groundHeight(player.x, player.z);
    player.heading = Math.PI;
    player.aimYaw = Math.PI;
    player.health = 100;
    player.armor = 0;
    player.dead = false;
    player.deathTimer = 0;
    player.inVehicle = null;
    player.jumpY = 0;
    player.jumpVelocity = 0;
    enemies.length = 0;
    tracers.length = 0;
    particles.length = 0;
  }

  function giveWeapon(id) {
    if (!player.weapons.includes(id)) {
      player.weapons.push(id);
      const w = WEAPON_BY_ID[id];
      if (w && player.ammo[id]) {
        player.ammo[id].mag = w.mag;
        player.ammo[id].reserve = Math.max(player.ammo[id].reserve, w.reserve);
      }
    }
  }

  function switchWeapon(slot) {
    const w = WEAPONS.find((item) => item.slot === slot);
    if (!w) return false;
    if (!player.weapons.includes(w.id)) {
      bus.notify?.(`${w.name} locked — complete more missions`, 'warn');
      return false;
    }
    player.weaponSlot = slot;
    player.reloadTimer = 0;
    bus.onWeapon?.(w);
    return true;
  }

  function hasWeapon(id) {
    return player.weapons.includes(id);
  }

  function currentAmmo() {
    const id = weaponId();
    return player.ammo[id] ?? null;
  }

  function spawnEnemy(x, z, options = {}) {
    const health = options.health ?? 60;
    const enemy = {
      x, z,
      y: world.groundHeight(x, z),
      heading: options.heading ?? 0,
      health,
      maxHealth: health,
      alive: true,
      deathTimer: 0,
      fireTimer: 0.7 + Math.random() * 0.8,
      think: Math.random() * Math.PI,
      phase: Math.random() * Math.PI * 2,
      speed: 0,
      style: options.style ?? 'goon',
      colors: characterColors(Math.random(), options.style ?? 'goon'),
      weapon: options.weapon ?? (Math.random() < 0.25 ? 'smg' : 'pistol'),
      mission: options.mission ?? false,
      police: options.police ?? false,
      cash: options.cash ?? 40 + Math.floor(Math.random() * 60),
      radius: 0.5,
      range: options.range ?? 42,
      damage: options.damage ?? 7,
      hitFlash: 0,
      aiming: true,
      knock: 0,
      aggro: options.aggro ?? true,
      stationary: options.stationary ?? false,
    };
    enemies.push(enemy);
    return enemy;
  }

  function clearEnemies() {
    for (const e of enemies) e.alive = false;
    enemies.length = 0;
  }

  function spawnTracer(x1, y1, z1, x2, y2, z2, color, life = 0.07) {
    tracers.push({ x1, y1, z1, x2, y2, z2, color, life, maxLife: life });
  }

  function spark(x, y, z, color, count = 5, power = 3) {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x, y, z,
        vx: (Math.random() - 0.5) * power,
        vy: Math.random() * power * 0.8 + 0.4,
        vz: (Math.random() - 0.5) * power,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.7,
        color,
        size: 0.4 + Math.random() * 0.5,
        gravity: 14,
      });
    }
  }

  /** A spent brass casing flicked out to the shooter's right; it bounces on the ground. */
  function ejectCasing(x, y, z, yaw) {
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    particles.push({
      x, y, z,
      vx: rx * (2.2 + Math.random()) + (Math.random() - 0.5) * 0.6,
      vy: 2.4 + Math.random() * 1.2,
      vz: rz * (2.2 + Math.random()) + (Math.random() - 0.5) * 0.6,
      life: 1.4, maxLife: 1.4, color: rgb(0xd9a441), size: 0.3, gravity: 11, casing: true, spin: Math.random() * 6,
    });
  }

  function raycast(origin, dir, maxDist) {
    // March the ray until it enters a solid collider; cheap and good enough for bullets.
    let last = maxDist;
    for (let t = 2; t < maxDist; t += 2.2) {
      const x = origin[0] + dir[0] * t;
      const z = origin[2] + dir[2] * t;
      if (world.insideBuilding(x, z)) {
        last = t;
        break;
      }
    }
    return last;
  }

  function fireOnce(weaponSpec, aim, muzzleBias = 0) {
    const pellets = weaponSpec.pellets ?? 1;
    const spread = weaponSpec.spread ?? 0;
    const baseX = player.x, baseZ = player.z;
    const yaw = aim + muzzleBias;
    const start = [
      baseX + Math.sin(yaw) * 0.8,
      (player.y ?? 0) + 1.35,
      baseZ + Math.cos(yaw) * 0.8,
    ];
    const dir = [Math.sin(yaw), 0.02 + (Math.random() - 0.5) * spread * 0.4, Math.cos(yaw)];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    dir[0] /= len; dir[1] /= len; dir[2] /= len;

    let bestDist = weaponSpec.range;
    let bestEnemy = null;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const ex = enemy.x - start[0], ez = enemy.z - start[2];
      const ey = enemy.y + 1.1 - start[1];
      const along = ex * dir[0] + ey * dir[1] + ez * dir[2];
      if (along < 1 || along > bestDist) continue;
      const px = start[0] + dir[0] * along;
      const py = start[1] + dir[1] * along;
      const pz = start[2] + dir[2] * along;
      const miss = Math.hypot(px - enemy.x, py - (enemy.y + 1.1), pz - enemy.z);
      const radius = 0.65 + spread * 22;
      if (miss < radius) {
        bestDist = along;
        bestEnemy = enemy;
      }
    }
    const worldDist = raycast(start, dir, Math.min(bestDist, weaponSpec.range));
    const hitDist = Math.min(worldDist, bestDist);
    const end = [start[0] + dir[0] * hitDist, start[1] + dir[1] * hitDist, start[2] + dir[2] * hitDist];

    if (bestEnemy && hitDist >= bestDist - 0.05) {
      damageEnemy(bestEnemy, weaponSpec.damage, end);
    } else if (hitDist < weaponSpec.range) {
      spark(end[0], end[1], end[2], rgb(0xffd59a), 3, 2.2);
    }
    spawnTracer(start[0], start[1], start[2], end[0], end[1], end[2], rgb(0xffe6a8), 0.07);
    spark(start[0], start[1], start[2], PALETTE.gold, 2, 1.6);
    ejectCasing(start[0] - Math.sin(yaw) * 0.35, start[1] + 0.05, start[2] - Math.cos(yaw) * 0.35, yaw);
    player.recoil = Math.min(0.12, player.recoil + 0.03);
    bus.onGunshot?.(weaponSpec.id, player.x, player.z);
  }

  function fire(aim) {
    if (player.dead || player.inVehicle) return;
    const spec = weapon();
    if (player.fireCooldown > 0 || player.reloadTimer > 0) return;
    if (spec.melee) {
      melee(aim);
      return;
    }
    const ammo = currentAmmo();
    if (!ammo) return;
    if (ammo.mag <= 0) {
      reload();
      return;
    }
    player.fireCooldown = spec.rate;
    ammo.mag -= 1;
    if (spec.pellets && spec.pellets > 1) {
      for (let i = 0; i < spec.pellets; i += 1) fireOnce(spec, aim, (Math.random() - 0.5) * spec.spread);
    } else {
      fireOnce(spec, aim);
    }
    bus.onShotFired?.(spec);
    if (ammo.mag === 0) reload();
  }

  function melee(aim) {
    player.fireCooldown = 0.42;
    player.punchTimer = 0.3;
    const px = player.x + Math.sin(aim) * 1.2;
    const pz = player.z + Math.cos(aim) * 1.2;
    let hitAny = false;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (Math.hypot(enemy.x - px, enemy.z - pz) < 2.1) {
        damageEnemy(enemy, 22, [enemy.x, enemy.y + 1.2, enemy.z]);
        hitAny = true;
      }
    }
    bus.onMelee?.(hitAny);
    spark(px, (player.y ?? 0) + 1.2, pz, rgb(0xffe0b0), 2, 1.2);
  }

  function reload() {
    const id = weaponId();
    const spec = WEAPON_BY_ID[id];
    const ammo = player.ammo[id];
    if (!spec || spec.melee || !ammo) return;
    if (ammo.mag >= spec.mag || ammo.reserve <= 0) return;
    player.reloadTimer = 1.05;
    bus.onReload?.(spec);
  }

  function finishReload() {
    const id = weaponId();
    const spec = WEAPON_BY_ID[id];
    const ammo = player.ammo[id];
    if (!spec || !ammo) return;
    const need = spec.mag - ammo.mag;
    const take = Math.min(need, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
  }

  function damageEnemy(enemy, amount, point) {
    enemy.health -= amount;
    enemy.hitFlash = 0.15;
    enemy.knock = 0.2;
    spark(point[0], point[1], point[2], rgb(0xa81f2a), 4, 2.5);
    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.deathTimer = 0;
      bus.onKill?.(enemy);
      const cash = enemy.cash;
      player.cash += cash;
      player.respect += 12;
      bus.notify?.(`+$${cash}  ·  +12 respect`, 'cash');
    } else {
      bus.onHitEnemy?.(enemy);
    }
  }

  function hurtPlayer(amount, source) {
    if (player.dead) return;
    if (player.armor > 0) {
      const absorbed = Math.min(player.armor, amount * 0.7);
      player.armor -= absorbed;
      amount -= absorbed;
    }
    player.health = Math.max(0, player.health - amount);
    player.hitFlash = 0.3;
    bus.onPlayerHurt?.(amount, source);
    if (player.health <= 0) {
      player.dead = true;
      player.deathTimer = 3;
      bus.onPlayerDeath?.();
    }
  }

  function update(dt, input, cameraYaw, environment) {
    time += dt;
    const w = weapon();
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.recoil = Math.max(0, player.recoil - dt * 2.2);
    player.hitFlash = Math.max(0, player.hitFlash - dt);
    if (player.reloadTimer > 0) {
      player.reloadTimer -= dt;
      if (player.reloadTimer <= 0) finishReload();
    }
    if (player.punchTimer > 0) player.punchTimer -= dt;
    if (player.dead) {
      player.deathTimer -= dt;
      return;
    }
    player.aimYaw = cameraYaw;
    if (!player.inVehicle) {
      // Movement relative to the camera.
    const forward = [Math.sin(cameraYaw), Math.cos(cameraYaw)];
    const right = [Math.cos(cameraYaw), -Math.sin(cameraYaw)];
    let mx = 0, mz = 0;
    if (input.forward) { mx += forward[0]; mz += forward[1]; }
    if (input.back) { mx -= forward[0]; mz -= forward[1]; }
    if (input.right) { mx += right[0]; mz += right[1]; }
    if (input.left) { mx -= right[0]; mz -= right[1]; }
    const mag = Math.hypot(mx, mz);
    player.sprinting = !!input.sprint && mag > 0.1;
    let speed = player.sprinting ? 8.4 : 4.9;
    if (weapon()?.id !== 'fists' && input.aim) speed *= 0.72;
    if (mag > 0.001) {
      mx /= mag; mz /= mag;
      player.velocityX = lerp(player.velocityX, mx * speed, clamp(dt * 12, 0, 1));
      player.velocityZ = lerp(player.velocityZ, mz * speed, clamp(dt * 12, 0, 1));
      const desired = Math.atan2(mx, mz);
      let diff = desired - player.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.heading += diff * clamp(dt * 12, 0, 1);
      player.moving = true;
      player.walkPhase += dt * (player.sprinting ? 11 : 7.2);
    } else {
      player.velocityX = lerp(player.velocityX, 0, clamp(dt * 14, 0, 1));
      player.velocityZ = lerp(player.velocityZ, 0, clamp(dt * 14, 0, 1));
      player.moving = false;
    }
    // Jump.
    const ground = world.groundHeight(player.x, player.z);
    if (input.jump && player.jumpY <= 0.01 && player.jumpVelocity <= 0.01) {
      player.jumpVelocity = 5.1;
      player.airborne = true;
    }
    if (player.airborne) {
      player.jumpVelocity -= 16 * dt;
      player.jumpY += player.jumpVelocity * dt;
      if (player.jumpY <= 0) {
        player.jumpY = 0;
        player.jumpVelocity = 0;
        player.airborne = false;
      }
    }
    player.x += player.velocityX * dt;
    player.z += player.velocityZ * dt;
    const hit = world.collideCircle(player.x, player.z, player.radius);
    if (hit.hit) { player.x = hit.x; player.z = hit.z; }
    player.x = clamp(player.x, world.bounds.minX + 4, world.bounds.maxX - 4);
    player.z = clamp(player.z, world.bounds.minZ + 4, world.bounds.maxZ - 4);
    player.y = world.groundHeight(player.x, player.z) + player.jumpY;

    // Aiming / firing.
    if (input.fire) {
      if (w.auto) fire(player.aimYaw);
      else if (input.firePressed) fire(player.aimYaw);
    }
    if (input.reloadPressed) reload();
    if (input.switchWeapon) switchWeapon(input.switchWeapon);
    }

    // Enemies.
    for (const enemy of enemies) {
      if (!enemy.alive) {
        enemy.deathTimer += dt;
        continue;
      }
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.knock = Math.max(0, enemy.knock - dt);
      enemy.phase += dt * 6;
      const dx = player.x - enemy.x, dz = player.z - enemy.z;
      const dist = Math.hypot(dx, dz) || 1;
      const desired = Math.atan2(dx, dz);
      let diff = desired - enemy.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      enemy.heading += diff * clamp(dt * 5, 0, 1);
      const wanted = enemy.stationary ? 0 : dist > 17 ? 3.1 : dist < 9 ? -1.4 : 0;
      enemy.speed = lerp(enemy.speed, wanted, clamp(dt * 3, 0, 1));
      enemy.x += Math.sin(enemy.heading) * enemy.speed * dt;
      enemy.z += Math.cos(enemy.heading) * enemy.speed * dt;
      const eh = world.collideCircle(enemy.x, enemy.z, 0.5);
      if (eh.hit) { enemy.x = eh.x; enemy.z = eh.z; }
      enemy.y = world.groundHeight(enemy.x, enemy.z);
      // Fire at the player.
      enemy.fireTimer -= dt;
      if (enemy.fireTimer <= 0 && dist < enemy.range) {
        enemy.fireTimer = (enemy.weapon === 'smg' ? 0.5 : 1.0) + Math.random() * 0.6;
        const accuracy = clamp(0.78 - dist / 80, 0.28, 0.72);
        const hit = Math.random() < accuracy;
        const startY = enemy.y + 1.35;
        const endX = player.x + (Math.random() - 0.5) * (hit ? 0.5 : 2.2);
        const endZ = player.z + (Math.random() - 0.5) * (hit ? 0.5 : 2.2);
        spawnTracer(enemy.x, startY, enemy.z, endX, player.y + 1.2, endZ, rgb(0xff9a6a), 0.06);
        spark(enemy.x, startY, enemy.z, PALETTE.gold, 2, 1.2);
        bus.onEnemyShot?.(enemy);
        if (hit) {
          if (player.inVehicle) {
            player.inVehicle.health = Math.max(0, player.inVehicle.health - enemy.damage * 0.7 * (player.inVehicle.damageScale ?? 1));
            bus.onCarHurt?.(enemy.damage);
          } else {
            hurtPlayer(enemy.damage, enemy);
          }
        }
      }
    }

    // Keep enemies separated so groups read as a crowd, not a stack.
    for (let i = 0; i < enemies.length; i += 1) {
      const a = enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < enemies.length; j += 1) {
        const b2 = enemies[j];
        if (!b2.alive) continue;
        const dx = b2.x - a.x, dz = b2.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.1 && d > 0.001) {
          const push = (1.1 - d) / 2;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b2.x += (dx / d) * push;
          b2.z += (dz / d) * push;
        }
      }
    }

    // Projectiles, particles, impacts.
    for (let i = tracers.length - 1; i >= 0; i -= 1) {
      tracers[i].life -= dt;
      if (tracers[i].life <= 0) tracers.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= p.gravity * dt;
      if (p.casing) {
        p.spin += dt * 14;
        const floor = world.groundHeight(p.x, p.z) + 0.03;
        if (p.y < floor) { p.y = floor; p.vy = Math.abs(p.vy) * 0.35; p.vx *= 0.5; p.vz *= 0.5; }
      }
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = impacts.length - 1; i >= 0; i -= 1) {
      impacts[i].life -= dt;
      if (impacts[i].life <= 0) impacts.splice(i, 1);
    }
    bus.onCombatState?.(player, { enemies, weapon: w, ammo: currentAmmo() });
  }

  function addImpact(x, y, z, color, life = 0.5) {
    impacts.push({ x, y, z, color, life, maxLife: life });
  }

  function build(b, environment) {
    // Player on foot.
    if (!player.inVehicle && !player.dead) {
      buildCharacter(b, {
        x: player.x, z: player.z, y: player.y,
        heading: player.heading,
        aimYaw: player.aimYaw,
        phase: player.walkPhase,
        speed: player.moving ? Math.hypot(player.velocityX, player.velocityZ) : 0,
        colors: player.colors,
        aiming: !!environment?.aim,
        weapon: environment?.aim && weapon().id !== 'fists' ? weapon().id : null,
        style: 'player',
      }, time);
    }
    for (const enemy of enemies) {
      if (!enemy.alive && enemy.deathTimer > 1.2) continue;
      buildCharacter(b, {
        x: enemy.x, z: enemy.z, y: enemy.y,
        heading: enemy.heading,
        phase: enemy.phase,
        speed: Math.abs(enemy.speed),
        colors: enemy.colors,
        style: enemy.style,
        weapon: enemy.alive ? enemy.weapon : null,
        aiming: enemy.alive,
        dead: !enemy.alive,
      }, time);
    }
    // Bullet tracers: a short white-hot streak racing down the line of fire with a
    // tapering gold tail, and a star-shaped muzzle flash at the barrel while it is fresh.
    for (const t of tracers) {
      const dx = t.x2 - t.x1, dy = t.y2 - t.y1, dz = t.z2 - t.z1;
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      const age = t.head ?? clamp(1 - t.life / t.maxLife, 0, 1);
      const head = Math.min(len, 1.2 + age * len);
      const tail = Math.max(0, head - Math.min(3.4, len * 0.3));
      const mid = tail + (head - tail) * 0.45;
      const at = (d) => [t.x1 + ux * d, t.y1 + uy * d, t.z1 + uz * d];
      b.segment(at(tail), at(mid), 0.022, 0.022, shade(t.color, 0.8), { e: 1, s: 0 });
      b.segment(at(mid), at(head), 0.045, 0.045, mix3(t.color, PALETTE.white, 0.6), { e: 1, s: 0 });
      if (t.flash !== false && (t.head !== undefined || age < 0.5)) buildMuzzleFlash(b, t.x1, t.y1, t.z1, ux, uy, uz, t.flashSize ?? 0.5, t.color, t.spin ?? len);
    }
    // Sparks and blood as tiny glowing chips; brass casings as tumbling glossy shells.
    for (const p of particles) {
      if (p.smoke) continue; // tyre smoke is drawn as soft halos only
      if (p.casing) {
        b.box(p.x, p.y, p.z, 0.026, 0.026, 0.07, p.color, { rotY: p.spin, omitBottom: true, s: -0.8, e: 0.15 });
        continue;
      }
      if (p.color[0] > 0.6 && p.color[1] < 0.4) {
        b.box(p.x, p.y, p.z, p.size * 0.2, p.size * 0.2, p.size * 0.2, p.color, { e: 1, omitBottom: true });
      } else {
        b.box(p.x, p.y, p.z, p.size * 0.16, p.size * 0.16, p.size * 0.16, p.color, { e: 1, omitBottom: true });
      }
    }
    for (const s of impacts) {
      const a = s.life / s.maxLife;
      b.box(s.x, s.y, s.z, 0.18 * a, 0.18 * a, 0.18 * a, s.color, { e: 1, omitBottom: true });
    }
  }

  function glow(timeNow, add) {
    // Muzzle flashes and enemy muzzle heat.
    for (const t of tracers) {
      const life = t.head !== undefined ? 1 : clamp(t.life / t.maxLife, 0, 1);
      const k = t.flashSize ?? 0.5;
      if (t.flash !== false) {
        add(t.x1, t.y1, t.z1, rgb(0xfff2c8), 0.55 * k * life + 0.2, life * 0.95);
        add(t.x1, t.y1, t.z1, rgb(0xffa340), 2.2 * k * life + 0.3, life * 0.5);
        // The flash lights up the ground around the shooter.
        add(t.x1, (t.ground ?? t.y1 - 1.4) + 0.06, t.z1, rgb(0xffa850), 2.6 * k + 0.6, life * 0.35, { flat: true });
      }
      const dx = t.x2 - t.x1, dy = t.y2 - t.y1, dz = t.z2 - t.z1;
      const len = Math.hypot(dx, dy, dz) || 1;
      const age = t.head ?? clamp(1 - t.life / t.maxLife, 0, 1);
      const d = Math.min(len, 1.2 + age * len);
      add(t.x1 + dx / len * d, t.y1 + dy / len * d, t.z1 + dz / len * d, t.color, 0.35, 0.7);
    }
    for (const p of particles) {
      const life = clamp(p.life / p.maxLife, 0, 1);
      if (p.smoke) add(p.x, p.y, p.z, p.color, p.size * 1.9, life * 0.22);
      else if (p.casing) continue;
      else add(p.x, p.y, p.z, p.color, p.size * 0.8, life * 0.6);
    }
    for (const e of enemies) {
      if (!e.alive && e.deathTimer > 1.4) continue;
      if (e.hitFlash > 0) add(e.x, e.y + 1.2, e.z, rgb(0xff6a5a), 1.2, 0.8);
    }
    if (player.hitFlash > 0 && !player.dead) {
      // Damage indicator ring is HUD-side; here a soft red bloom around the player.
      add(player.x, player.y + 1.2, player.z, rgb(0xff2a3a), 1.6, player.hitFlash * 0.5);
    }
    void timeNow;
  }

  function pickupsNear(px, pz) {
    return null;
  }

  return {
    player,
    enemies,
    reset,
    update,
    fire,
    reload,
    giveWeapon,
    switchWeapon,
    hasWeapon,
    currentWeapon: () => weapon(),
    currentAmmo,
    spawnEnemy,
    clearEnemies,
    hurtPlayer,
    build,
    glow,
    addImpact,
    tracers,
    particles,
    get time() { return time; },
  };
}
