// combat.js — Mateo on foot: WASD movement relative to the camera, sprint, jump,
// punch, and four weapons with magazine/reload state. Hitscan tracers, muzzle
// flashes, sparks, blood, enemy goons and police officers with health bars.
// buildCharacter() is the shared low-poly person used by pedestrians and NPCs too.

import { PALETTE, WEAPONS, clamp, lerp, rgb, shade } from './config.js';
import { vehicleForward } from './vehicles.js';

const SKIN = [rgb(0xc98f66), rgb(0xb07850), rgb(0xe2b28a), rgb(0x8d5c3d), rgb(0xd9a377)];
const SHIRTS = [rgb(0xff6f61), rgb(0x44c9c0), rgb(0xffc85a), rgb(0xd967c9), rgb(0x7a9cff), rgb(0xf2e6d0), rgb(0x2b2f38)];
const PANTS = [rgb(0x394152), rgb(0x6c5a4a), rgb(0x2a2c31), rgb(0x8d8377), rgb(0x3f6b62), rgb(0xb5a287)];
const HAIR = [rgb(0x221a15), rgb(0x5a3a22), rgb(0xc9a06a), rgb(0x1a1a1c), rgb(0x7a4a2a), rgb(0xe2cfa8)];

export function characterColors(seed = 0.5, style = 'civ') {
  if (style === 'cop') {
    return { skin: SKIN[Math.floor(seed * SKIN.length) % SKIN.length], shirt: rgb(0x26364c), pants: rgb(0x1e2734), hair: HAIR[Math.floor(seed * HAIR.length) % HAIR.length], accent: rgb(0xe9d27a) };
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
 * Shared low-poly humanoid. `c` = {x,z,y,heading,phase,speed,colors,aiming,weapon,
 * panic,dead,style,scale}. Limbs are beams so the walk, aim and panic poses read clearly.
 */
export function buildCharacter(b, c, time = 0) {
  const heading = c.heading ?? 0;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const W = (lx, ly, lz) => [c.x + lx * cos + lz * sin, (c.y ?? 0) + ly, c.z - lx * sin + lz * cos];
  const yaw = -heading;
  const colors = c.colors ?? characterColors(0.4, c.style ?? 'civ');
  const scale = c.scale ?? 1;
  const walk = c.phase ?? 0;
  const speed = c.speed ?? 0;
  const swing = clamp(speed / 3, 0, 1);
  const bob = Math.sin(walk * 2) * 0.035 * swing;
  const step = Math.sin(walk) * 0.42 * swing;
  const step2 = Math.sin(walk + Math.PI) * 0.42 * swing;
  const dead = c.dead;
  if (dead) {
    // A still, dark silhouette flat on the ground.
    b.box(c.x, 0.16, c.z, 1.4, 0.3, 0.55, shade(colors.shirt, 0.55), { rotY: yaw, omitBottom: true });
    b.sphere(c.x + 0.7 * cos, 0.18, c.z - 0.7 * sin, 0.2, colors.skin, { segments: 6, rings: 4 });
    return;
  }
  const hipY = 0.92 * scale + bob;
  const torsoY = 1.28 * scale + bob;
  const headY = 1.72 * scale + bob;

  // Legs (two beams from hip to foot, with shoes).
  const hipW = 0.13 * scale;
  const leftFoot = W(-hipW, 0.08 * scale, step);
  const leftKnee = W(-hipW, 0.44 * scale, step * 0.4);
  const rightFoot = W(hipW, 0.08 * scale, step2);
  const rightKnee = W(hipW, 0.44 * scale, step2 * 0.4);
  b.segment(W(-hipW, hipY, 0), leftKnee, 0.19 * scale, 0.19 * scale, colors.pants, {});
  b.segment(leftKnee, leftFoot, 0.17 * scale, 0.17 * scale, colors.pants, {});
  b.segment(W(hipW, hipY, 0), rightKnee, 0.19 * scale, 0.19 * scale, colors.pants, {});
  b.segment(rightKnee, rightFoot, 0.17 * scale, 0.17 * scale, colors.pants, {});
  b.box(leftFoot[0], leftFoot[1] + 0.02, leftFoot[2], 0.22 * scale, 0.12 * scale, 0.34 * scale, rgb(0x35383f), { rotY: yaw, omitBottom: true });
  b.box(rightFoot[0], rightFoot[1] + 0.02, rightFoot[2], 0.22 * scale, 0.12 * scale, 0.34 * scale, rgb(0x35383f), { rotY: yaw, omitBottom: true });

  // Torso, jacket and a belt.
  b.box(c.x, torsoY, c.z, 0.5 * scale, 0.62 * scale, 0.3 * scale, colors.shirt, { rotY: yaw, omitBottom: true });
  b.box(c.x, torsoY - 0.28 * scale, c.z, 0.46 * scale, 0.08 * scale, 0.32 * scale, shade(colors.pants, 0.8), { rotY: yaw, omitBottom: true });
  b.box(W(0, 0, 0.16)[0], torsoY + 0.08, W(0, 0, 0.16)[2], 0.1 * scale, 0.5 * scale, 0.03 * scale, shade(colors.shirt, 0.7), { rotY: yaw, omitBottom: true });
  if (c.style === 'cop') {
    b.box(c.x, torsoY + 0.12, c.z, 0.52 * scale, 0.1 * scale, 0.32 * scale, rgb(0x101317), { rotY: yaw, omitBottom: true });
    b.box(W(0.18, 0, 0.17)[0], torsoY + 0.18, W(0.18, 0, 0.17)[2], 0.12 * scale, 0.12 * scale, 0.03 * scale, colors.accent, { rotY: yaw, omitBottom: true, e: 0.3 });
  }

  // Head, hair, face hint.
  b.sphere(c.x, headY, c.z, 0.19 * scale, colors.skin, { segments: 8, rings: 6 });
  b.box(c.x, headY + 0.12 * scale, c.z - 0.03 * scale, 0.34 * scale, 0.14 * scale, 0.32 * scale, colors.hair, { rotY: yaw, omitBottom: true });
  if (c.longHair) {
    b.box(c.x, headY - 0.06 * scale, c.z - 0.15 * scale, 0.28 * scale, 0.3 * scale, 0.12 * scale, colors.hair, { rotY: yaw, omitBottom: true });
  }
  // Cap for cops.
  if (c.style === 'cop') {
    b.box(c.x, headY + 0.18 * scale, c.z, 0.34 * scale, 0.1 * scale, 0.34 * scale, rgb(0x1a2230), { rotY: yaw, omitBottom: true });
    b.box(c.x, headY + 0.12 * scale, c.z + 0.18 * scale, 0.26 * scale, 0.04 * scale, 0.12 * scale, rgb(0x101317), { rotY: yaw, omitBottom: true });
  }

  // Arms: panic up, aiming forward, or swinging with the walk.
  const shoulderL = W(-0.32 * scale, torsoY + 0.18, 0);
  const shoulderR = W(0.32 * scale, torsoY + 0.18, 0);
  const weapon = c.weapon ?? null;
  if (c.panic) {
    b.segment(shoulderL, W(-0.55 * scale, torsoY + 0.65, 0.05), 0.14 * scale, 0.14 * scale, colors.shirt, {});
    b.segment(shoulderR, W(0.55 * scale, torsoY + 0.65, 0.05), 0.14 * scale, 0.14 * scale, colors.shirt, {});
    b.sphere(W(-0.6 * scale, torsoY + 0.7, 0.05)[0], torsoY + 0.7, W(-0.6 * scale, 0, 0.05)[2], 0.1, colors.skin, { segments: 5, rings: 4 });
    b.sphere(W(0.6 * scale, torsoY + 0.7, 0.05)[0], torsoY + 0.7, W(0.6 * scale, 0, 0.05)[2], 0.1, colors.skin, { segments: 5, rings: 4 });
  } else if (c.aiming || weapon) {
    const aim = c.aimYaw ?? heading;
    // Right arm across the body toward the aim direction.
    const handLocal = [0.18 * Math.cos(aim - heading) + 0.62 * Math.sin(aim - heading), torsoY + 0.02, 0.18 * -Math.sin(aim - heading) + 0.62 * Math.cos(aim - heading)];
    const hand = W(handLocal[0], handLocal[1], handLocal[2]);
    b.segment(shoulderR, hand, 0.13 * scale, 0.13 * scale, colors.shirt, {});
    b.sphere(hand[0], hand[1], hand[2], 0.09, colors.skin, { segments: 5, rings: 4 });
    b.segment(shoulderL, W(-0.24 * scale, torsoY - 0.05, 0.28), 0.13 * scale, 0.13 * scale, colors.shirt, {});
    b.sphere(W(-0.24 * scale, torsoY - 0.1, 0.3)[0], torsoY - 0.1, W(-0.24 * scale, 0, 0.3)[2], 0.09, colors.skin, { segments: 5, rings: 4 });
    if (weapon) {
      // Original low-poly hardware: dark receiver, coloured energy cell.
      const gunLength = weapon === 'shotgun' ? 0.95 : weapon === 'smg' ? 0.62 : 0.42;
      const gunYaw = -aim;
      const gx = c.x + Math.sin(aim) * 0.55, gz = c.z + Math.cos(aim) * 0.55;
      b.box(gx, torsoY + 0.02, gz, 0.1, 0.13, gunLength, rgb(0x23262c), { rotY: gunYaw, omitBottom: true });
      b.box(gx, torsoY - 0.01, gz, 0.055, 0.06, gunLength * 0.8, rgb(0x8f979e), { rotY: gunYaw, omitBottom: true });
      b.box(gx + Math.sin(aim) * gunLength * 0.45, torsoY + 0.02, gz + Math.cos(aim) * gunLength * 0.45, 0.07, 0.07, 0.08, rgb(0x3a3e46), { rotY: gunYaw, omitBottom: true });
      if (weapon === 'smg') {
        b.box(gx, torsoY + 0.14, gz, 0.04, 0.1, 0.1, PALETTE.neonCyan, { rotY: gunYaw, e: 0.5, omitBottom: true });
      }
    }
  } else {
    const armSwing = Math.sin(walk) * 0.35 * swing;
    b.segment(shoulderL, W(-0.37 * scale, torsoY - 0.28, -armSwing * 0.5), 0.14 * scale, 0.14 * scale, colors.shirt, {});
    b.segment(shoulderR, W(0.37 * scale, torsoY - 0.28, armSwing * 0.5), 0.14 * scale, 0.14 * scale, colors.shirt, {});
    b.sphere(W(-0.38, 0, -armSwing * 0.5)[0], torsoY - 0.32, W(-0.38, 0, -armSwing * 0.5)[2], 0.09, colors.skin, { segments: 5, rings: 4 });
    b.sphere(W(0.38, 0, armSwing * 0.5)[0], torsoY - 0.32, W(0.38, 0, armSwing * 0.5)[2], 0.09, colors.skin, { segments: 5, rings: 4 });
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
    colors: { skin: rgb(0xc58f68), shirt: rgb(0xe85a44), pants: rgb(0x3c4d68), hair: rgb(0x1d1a19) },
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
    spawnTracer(start[0], start[1], start[2], end[0], end[1], end[2], weaponSpec.id === 'smg' ? PALETTE.neonCyan : PALETTE.gold, 0.055);
    spark(start[0], start[1], start[2], PALETTE.gold, 2, 1.6);
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
            player.inVehicle.health = Math.max(0, player.inVehicle.health - enemy.damage * 0.7);
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
    // Tracers as glowing beams.
    for (const t of tracers) {
      const alpha = clamp(t.life / t.maxLife, 0, 1);
      b.segment([t.x1, t.y1, t.z1], [t.x2, t.y2, t.z2], 0.05, 0.05, t.color, { e: 1, s: 0 });
      void alpha;
    }
    // Blood/spark particles as tiny glowing tetra-ish boxes.
    for (const p of particles) {
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
      const life = clamp(t.life / t.maxLife, 0, 1);
      add(t.x1, t.y1, t.z1, t.color, 0.34 * life + 0.12, life * 0.8);
    }
    for (const p of particles) {
      add(p.x, p.y, p.z, p.color, p.size * 0.8, clamp(p.life / p.maxLife, 0, 1) * 0.6);
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
