// shotstage.js — photo mode for the entry's screenshots. `?shot=<name>` stages one
// deterministic moment of real play with the game's own systems (missions, police,
// traffic, combat, activities, progression) and then renders it live, HUD and all:
// the golden-hour cover drive, a four-star pursuit, an on-foot shootout in Neon
// Midtown, and the city map menu over the night skyline. Nothing is composited.

import { PALETTE, rgb } from './config.js';
import { createVehicle, skidMarks, tyreSmoke } from './vehicles.js';

let world, traffic, police, combat, missions, activities, progression, hud, camera, game, crew, turf;
let parkedVehicles, random, setVehicle, setCameraAngles, setStageCity, openMenu;

/** Wire photo mode to the live systems; returns the stage runner. */
export function createShotStage(ctx) {
  ({ world, traffic, police, combat, missions, activities, progression, hud, camera, game, crew, turf } = ctx);
  ({ parkedVehicles, random, setVehicle, setCameraAngles, setStageCity, openMenu } = ctx);
  return { stage: stageShot, frame: stageFrame };
}

/** Crew and turf as they stand `done` jobs into the story. */
function stageCareer(done, standing) {
  crew.reset();
  crew.syncStory(missions.state.done.map((_, i) => i < done), false);
  turf.reset();
  turf.stage(standing);
}

function setStageHour(hour) {
  game.hour = hour;
}

function clearScene() {
  for (const car of traffic.cars) car.removed = true;
  traffic.cars.length = 0;
  police.clear();
  combat.clearEnemies();
  combat.tracers.length = 0;
  combat.particles.length = 0;
  skidMarks.length = 0;
  tyreSmoke.length = 0;
  combat.player.dead = false;
  combat.player.inVehicle = null;
  combat.player.cover = null;
  crew.mateo.visible = false;
  crew.mateo.staged = false;
  setVehicle(null);
  // A frozen frame would leave mid-crossing pedestrians standing in traffic: keep the kerbs.
  const kerbside = traffic.pedestrians.filter((ped) => {
    const road = world.nearestRoad(ped.x, ped.z);
    return !road || road.distance > road.w / 2 + 0.5;
  });
  traffic.pedestrians.length = 0;
  traffic.pedestrians.push(...kerbside);
}

function stageCar(type, x, z, heading, speed = 0, options = {}) {
  const car = createVehicle(type, x, z, heading, options);
  car.y = world.groundHeight(x, z) + 0.02;
  car.speed = speed;
  car.parked = true;
  car.staged = true;
  if (options.color) car.color = options.color;
  parkedVehicles.push(car);
  return car;
}

/** A pedestrian caught mid-stride on the pavement. */
function strollPed(x, z, heading, style = 'civ', options = {}) {
  const ped = traffic.addStagedPed(x, z, heading, style, options);
  ped.speedNow = options.speed ?? 1.3;
  ped.phase = random() * Math.PI * 2;
  return ped;
}

/** Arm the player as a mid-story criminal: cash, respect, the full weapon rail. */
function careerPlayer({ cash, respect, health = 100, armor = 40, slot = 3, mag = 24 }) {
  const p = combat.player;
  p.cash = cash;
  p.respect = respect;
  p.health = health;
  p.armor = armor;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = slot;
  p.ammo.smg.mag = mag;
  p.ammo.smg.reserve = 180;
  p.dead = false;
}

/** Rubber laid behind a sliding car: two rear-tyre streaks curving back along its arc. */
function stageSkids(car, length, curve, alpha = 0.55) {
  const back = car.spec.wheelBase / 2, half = car.spec.width * 0.4;
  for (let d = 0; d < length; d += 0.7) {
    const h = car.heading - curve * (d / length) ** 1.4;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const bx = car.x - fx * (back + d), bz = car.z - fz * (back + d);
    const bend = curve * d * d / length * 0.35;
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
    for (const side of [-1, 1]) {
      skidMarks.push({ x: bx + rx * (side * half + bend), z: bz + rz * (side * half + bend), y: car.y + 0.075, rot: h, alpha: alpha * (1 - d / length * 0.6) });
    }
  }
}

/** Thick tyre smoke boiling off the rear wheels and trailing back. */
function stageSmoke(car, count, spread = 6) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  for (let i = 0; i < count; i += 1) {
    const d = car.spec.wheelBase / 2 + random() * spread;
    const side = (random() - 0.5) * car.spec.width * 1.4;
    const life = 1.6 * (1 - d / (spread + 3));
    tyreSmoke.push({
      x: car.x - fx * d + Math.cos(car.heading) * side, y: car.y + 0.3 + d * 0.12 + random() * 0.3, z: car.z - fz * d - Math.sin(car.heading) * side,
      size: 0.6 + d * 0.28 + random() * 0.4, life: Math.max(0.3, life), maxLife: 1.6, vy: 0,
    });
  }
}

/** Freeze the nearest street lamp mid-topple, dark, with sparks at its sheared base. */
function knockLamp(x, z, fallYaw, tilt) {
  let lamp = null, best = 6;
  for (const l of world.lampposts) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < best) { best = d; lamp = l; }
  }
  if (!lamp) return null;
  Object.assign(lamp, { knocked: true, fallYaw, tilt, spin: 0, landed: true });
  lamp.glow.alpha = 0;
  stagedSparks(lamp.x, 0.35, lamp.z, 12, 0.6);
  return lamp;
}

function driveHero(type, x, z, heading, speed, colors = {}) {
  const hero = stageCar(type, x, z, heading, speed);
  if (colors.body) hero.color = colors.body;
  if (colors.accent) hero.accent = colors.accent;
  progression.tuneVehicle(hero);
  setVehicle(hero);
  return hero;
}

function stageShot(name) {
  hud.showLoadingDone();
  hud.showTitle(name === 'title');
  hud.setPlaying(name !== 'title', false);
  setStageCity(null);
  const stages = { title: stageTitle, start: stageStart, chase: stageChase, foot: stageFoot, combat: stageCombat, night: stageNight, menu: stageMenu };
  (stages[name] ?? stageTitle)();
  if (!stages[name]) { hud.showTitle(true); hud.setPlaying(false, false); }
}

/** Per-frame life in a staged shot: a gentle camera breath only. */
function stageFrame(elapsed, name) {
  if (name === 'combat' || name === 'foot') {
    const pulse = 0.9 + Math.sin(elapsed * 2) * 0.05;
    combat.particles.forEach((pt) => { if (!pt.smoke) pt.size = 0.5 * pulse; });
  }
}

function stageTitle() {
  clearScene();
  setStageHour(19.05);
  missions.reset();
  missions.state.done = [true, true, false, false, false];
  missions.state.active = false;
  combinePlayerOnFoot(-40, 285, 0.6);
  stageCar('coupe', 118, 254, -Math.PI / 2);
  stageCar('muscle', 214, 267, Math.PI / 2);
  stageCar('supercar', 330, 251, -Math.PI / 2);
  stageCar('van', -160, 254, -Math.PI / 2);
  stageCar('sedan', 58, 267, Math.PI / 2);
  for (const [x, z, h] of [[-20, 291, 1.2], [30, 293, 2.7], [96, 290, 0.4], [160, 294, 3.3], [-100, 288, 1.9], [-166, 325, 0.8], [120, 310, 2.2]]) {
    traffic.addStagedPed(x, z, h, 'civ');
  }
  hud.setTitle({
    progress: 2, cash: 18450, tokens: 5, peak: 3, hasSave: true,
    saveLabel: 'MISSION 03 · $18,450', storyComplete: false,
  });
  camera.pos = [170, 24, 310];
  camera.target = [-190, 7, 430];
  camera.fov = 56;
}


function combinePlayerOnFoot(x, z, heading) {
  const p = combat.player;
  p.x = x; p.z = z;
  p.y = world.groundHeight(x, z);
  p.heading = heading;
  p.aimYaw = heading;
  p.inVehicle = null;
  p.dead = false;
  p.health = 100;
  p.armor = 0;
  setVehicle(null);
}


function stageCombat() {
  clearScene();
  setStageHour(19.42);
  setStageCity({ districts: 5, tokens: 9, safehouse: true, missions: 4 });
  // Mission 04, Coral Pier: on foot, gold waypoint on the gang, neon wheel behind.
  missions.stage(3, 1, { banner: 'ACTIVE MISSION', done: 3 });
  hud.els.banner.classList.remove('show');
  const p = combat.player;
  combinePlayerOnFoot(-164.4, 368, 0.02);
  p.health = 74;
  p.armor = 45;
  p.cash = 36480;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = 3;
  p.ammo.smg.mag = 21;
  p.ammo.smg.reserve = 180;
  p.moving = true;
  p.walkPhase = 1.1;
  p.aimYaw = -0.06;
  p.respect = 520;
  setCameraAngles(0, 0.1);

  // The gang dug in behind crates and drums on the pier, the wheel lit up behind them.
  combat.spawnEnemy(-166, 380, { health: 80, style: 'goon', weapon: 'pistol' });
  combat.spawnEnemy(-159.2, 383.2, { health: 80, style: 'goon', weapon: 'smg', stationary: true });
  combat.spawnEnemy(-163.2, 400.6, { health: 80, style: 'goon', weapon: 'pistol', stationary: true });
  const enemyA = combat.enemies[0];
  const enemyB = combat.enemies[1];
  const enemyC = combat.enemies[2];
  if (enemyA) { enemyA.heading = Math.PI + 0.1; enemyA.phase = 1.4; enemyA.hitFlash = 0.2; }
  if (enemyB) { enemyB.heading = Math.PI + 0.35; enemyB.phase = 0.4; }
  if (enemyC) { enemyC.heading = Math.PI - 0.3; enemyC.phase = 2.2; enemyC.hitFlash = 0.1; }
  const deck = 1.1;
  // A frozen frame of the exchange: muzzle flash, tracers, sparks and shell casings.
  combat.tracers.push({ x1: -164.4, y1: deck + 1.48, z1: 368.7, x2: -165.9, y2: deck + 1.4, z2: 379.6, color: rgb(0xffd27a), life: 999, maxLife: 999 });
  combat.tracers.push({ x1: -164.3, y1: deck + 1.46, z1: 368.8, x2: -159.4, y2: deck + 1.38, z2: 382.8, color: rgb(0xffb44a), life: 999, maxLife: 999 });
  combat.tracers.push({ x1: -163.3, y1: deck + 1.45, z1: 400.1, x2: -164.9, y2: deck + 1.4, z2: 369.4, color: rgb(0xff5a3c), life: 999, maxLife: 999 });
  for (let i = 0; i < 7; i += 1) {
    combat.particles.push({ x: -165.9, y: deck + 1.4, z: 379.6, vx: (random() - 0.5) * 3, vy: random() * 2, vz: (random() - 0.5) * 3, life: 999, maxLife: 999, color: rgb(0xa81f2a), size: 0.5, gravity: 0 });
  }
  for (let i = 0; i < 5; i += 1) {
    combat.particles.push({ x: -164.3 + (random() - 0.5) * 0.4, y: deck + 1.5, z: 368.9, vx: 0, vy: 0, vz: 0, life: 999, maxLife: 999, color: rgb(0xffcf6a), size: 0.24, gravity: 0 });
  }
  combat.addImpact(-165.9, deck + 1.4, 379.5, PALETTE.gold, 999);
  combat.addImpact(-161.4, deck + 1.2, 376.6, rgb(0xffe08a), 999);
  traffic.addStagedPed(-170.5, 366, -1.2, 'civ', { panic: 3, panicArms: true });
  traffic.addStagedPed(-158.4, 372, 0.4, 'civ', { panic: 2, panicArms: true });
  police.setWanted(1);
  hud.dialogue('MATEO', 'Coral Pier, under the wheel. They took the codes — take them back.', 120000);
  camera.pos = [-162.6, 3.7, 363.4];
  camera.target = [-165.2, 4.6, 392];
  camera.fov = 62;
}


/** Twilight pursuit: cruisers at the player's door, helicopter above, stars lit. */
function stageChase() {
  clearScene();
  setStageHour(19.14);
  setStageCity({ districts: 4, tokens: 7, safehouse: true, missions: 3 });
  missions.stage(2, 2, { banner: 'ACTIVE MISSION', done: 2 });
  hud.els.banner.classList.remove('show');
  const p = combat.player;
  p.cash = 41280;
  p.health = 74;
  p.armor = 30;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = 3;
  p.ammo.smg.mag = 19;
  p.respect = 620;

  const hero = stageCar('supercar', 128, 251.4, -Math.PI / 2 + 0.1, 41);
  hero.boost = 0.42;
  hero.boosting = true;
  hero.drift = 3.8;
  hero.steer = -0.6;
  hero.color = rgb(0xff2f86);
  hero.accent = rgb(0x39e9ff);
  setVehicle(hero);
  p.x = hero.x; p.z = hero.z; p.y = hero.y;
  p.heading = hero.heading;

  police.setWanted(4);
  police.setPeak(4);
  stageCareer(2, { palm: 52, harbor: 38, midtown: 24, hills: 6, key: 0 });
  crew.mateo.status = 'RIDING SHOTGUN';
  // Two interceptors on the bumper, a third closing from behind.
  const c1 = police.spawnStagedCruiser(134.5, 246.6, -Math.PI / 2 - 0.08);
  const c2 = police.spawnStagedCruiser(136.5, 256.8, -Math.PI / 2 + 0.1);
  const c4 = police.spawnStagedCruiser(166, 250, -Math.PI / 2);
  [c1, c2, c4].forEach((c, i) => { c.sirenOn = true; c.remote = true; c.sirenPhase = i * 0.37; c.speed = 38; });

  // SBPD roadblock ahead: two cruisers nose-in in a V across the westbound lanes, striped
  // barriers in the gaps, a fan of burning red flares on the asphalt, officers behind.
  police.stageRoadblock(104, 250.6, Math.PI / 2, 1, 8.6, 'Ocean Boulevard');
  traffic.addStagedPed(99.5, 244.4, Math.PI / 2, 'cop');
  traffic.addStagedPed(99, 257.2, Math.PI / 2, 'cop');
  // Air One hovering over the boulevard, its searchlight pinning the supercar.
  police.stageHelicopter({ x: 112, z: 249, y: 15.5, heading: Math.PI / 2 + 0.35, spotX: 126.5, spotZ: 251.2 });
  hud.dispatch('SBPD DISPATCH · AIR ONE', 'Roadblock set on Ocean Boulevard, flares down. Air One has the suspect in the light.', 0);

  stageCar('coupe', 60, 254, -Math.PI / 2, 18);
  stageCar('taxi', 112, 268, Math.PI / 2, 0);
  stageCar('van', 196, 268, Math.PI / 2, 0);
  stageCar('sedan', 70, 266, Math.PI / 2, 0);
  // Rubber and smoke from the drifting hero car, sparks where the cruiser rubbed its flank.
  stageSkids(hero, 26, -0.35, 0.6);
  stageSmoke(hero, 18, 7);
  // A kerbside lamppost the slide clipped, caught mid-fall in a shower of sparks.
  knockLamp(124, 245.5, -Math.PI / 2 - 0.5, 0.62);
  for (let i = 0; i < 6; i += 1) {
    combat.particles.push({
      x: 130.6 + random() * 1.2, y: 0.4 + random() * 0.5, z: 249.6 + random() * 0.6, vx: 0, vy: 0, vz: 0,
      life: 800, maxLife: 999, color: i % 2 ? rgb(0xffd27a) : rgb(0xff8a3a), size: 0.2 + random() * 0.15, gravity: 0,
    });
  }
  for (const [x, z, h] of [[150, 291, 1.7], [122, 293, 2.5], [112, 238, 0.6], [96, 239, 3.1], [64, 288, 1.2], [104, 237, 2.2]]) {
    traffic.addStagedPed(x, z, h, 'civ', { panic: 3, panicArms: true });
  }
  hud.dialogue('MATEO', 'Four stars on the Strip. Marina lockup stays open if you drive like that.', 120000);
  camera.pos = [149, 4.2, 253.2];
  camera.target = [112, 3.1, 250.2];
  camera.fov = 60;
}


/** Midnight vista down Neon Midtown and the Palm Strip: skyline, bay wheel, wet road. */
function stageNight() {
  clearScene();
  setStageHour(22.34);
  setStageCity({ districts: 5, tokens: 10, safehouse: true, missions: 4 });
  missions.stage(2, 2, { banner: 'ACTIVE MISSION', done: 3 });
  hud.els.banner.classList.remove('show');
  const p = combat.player;
  p.cash = 91250;
  p.health = 100;
  p.armor = 70;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = 3;
  p.ammo.smg.mag = 24;
  p.respect = 980;

  // Hero supercar cruising west under the neon, headlights washing the asphalt.
  const hero = stageCar('supercar', 302, 251.5, -Math.PI / 2, 34);
  hero.boost = 0.8;
  hero.boosting = true;
  hero.drift = 2.4;
  hero.color = rgb(0x27e2d2);
  hero.accent = rgb(0xff3f95);
  setVehicle(hero);
  p.x = hero.x; p.z = hero.z; p.y = hero.y;
  p.heading = hero.heading;

  // Live traffic in both directions, lights on, plus promenade strollers.
  stageCar('taxi', 244, 266, Math.PI / 2, 12);
  stageCar('sedan', 196, 267.5, Math.PI / 2, 10);
  stageCar('coupe', 180, 252.5, -Math.PI / 2, 21);
  stageCar('muscle', 132, 253, -Math.PI / 2, 18);
  stageCar('van', 96, 266.5, Math.PI / 2, 8);
  stageCar('supercar', 58, 251, -Math.PI / 2, 26);
  stageCar('coupe', 24, 283, Math.PI / 2, 0);
  stageCar('taxi', 158, 283.5, -Math.PI / 2, 0);
  for (const [x, z, h] of [
    [300, 291, 1.4], [262, 293, 2.8], [222, 290, 0.6], [184, 292, 3.2],
    [140, 289, 1.9], [96, 294, 2.5], [46, 290, 0.2], [312, 238, 2.1],
    [250, 237.5, 0.8], [170, 239, 2.9], [110, 238, 1.3],
  ]) {
    traffic.addStagedPed(x, z, h, 'civ');
  }
  hud.dialogue('ELENA', 'Midnight on the Strip. Every window lit, the wheel turning, the whole city open.', 120000);
  // Wide midnight vista: skyline right, lit Ferris wheel over the bay to the left.
  camera.pos = [311, 2.6, 255.5];
  camera.target = [283, 2.2, 249.5];
  camera.fov = 64;
}


/** The cover: a golden-hour run west down Ocean Boulevard with a cruiser on the bumper. */
function stageStart() {
  clearScene();
  setStageHour(18.98);
  missions.stage(1, 0, { banner: 'ACTIVE MISSION', done: 1 });
  hud.els.banner.classList.remove('show');
  careerPlayer({ cash: 23850, respect: 420, health: 92, armor: 40, mag: 27 });
  progression.state.upgrades.engine = 1;
  progression.state.stored = ['coupe', 'taxi'];
  // The Paint Shop's Bay Cyan underglow lit under the Solaris GT.
  progression.state.neon = 'cyan';
  const p = combat.player;

  const hero = driveHero('supercar', 30, 252.5, -Math.PI / 2 + 0.03, 31, { body: rgb(0xff2f86), accent: rgb(0x39e9ff) });
  hero.boost = 0.66;
  hero.boosting = true;
  hero.drift = 1.2;
  hero.steer = -0.15;
  stageSkids(hero, 18, -0.12, 0.42);
  stageSmoke(hero, 6, 4);
  p.x = hero.x; p.z = hero.z; p.y = hero.y; p.heading = hero.heading;

  // Two stars for the stolen GT: a patrol cruiser closing on the rear quarter.
  police.setWanted(2);
  police.setPeak(2);
  stageCareer(1, { palm: 34, harbor: 12, midtown: 8, hills: 0, key: 0 });
  const cop = police.spawnStagedCruiser(32, 247, -Math.PI / 2 - 0.07);
  cop.sirenOn = true; cop.remote = true; cop.speed = 33; cop.sirenPhase = 0.2;

  // Evening traffic both ways down the Strip.
  stageCar('coupe', -6, 247.5, -Math.PI / 2, 22, { color: rgb(0xff8a3c) });
  stageCar('taxi', -44, 255, -Math.PI / 2, 18);
  stageCar('sedan', -96, 248, -Math.PI / 2, 16, { color: rgb(0x2f7fbf) });
  stageCar('van', -150, 255.5, -Math.PI / 2, 14);
  stageCar('muscle', -210, 248, -Math.PI / 2, 20);
  stageCar('sedan', 6, 267, Math.PI / 2, 14, { color: rgb(0xf1efe6) });
  stageCar('muscle', -38, 272, Math.PI / 2, 16, { color: rgb(0x1f9e8f) });
  stageCar('taxi', -90, 266.5, Math.PI / 2, 12);
  stageCar('coupe', -140, 272, Math.PI / 2, 15, { color: rgb(0x8f5bb8) });
  stageCar('supercar', -200, 267, Math.PI / 2, 24, { color: rgb(0xffc24b) });
  // Parked cars on the hotel kerb and the promenade.
  stageCar('coupe', -18, 239.5, -Math.PI / 2, 0, { color: rgb(0x5fb8c8) });
  stageCar('sedan', -70, 239.5, -Math.PI / 2, 0, { color: rgb(0xc85f8a) });
  stageCar('muscle', -30, 281, Math.PI / 2, 0, { color: rgb(0xdf7a3a) });

  // Strollers on both pavements.
  for (const [x, z, h] of [
    [12, 238, -Math.PI / 2], [4, 240.5, Math.PI / 2], [-26, 237.5, -Math.PI / 2], [-48, 240, Math.PI / 2],
    [-80, 238, -Math.PI / 2], [-120, 240, Math.PI / 2], [-150, 238.5, -Math.PI / 2],
    [18, 286, Math.PI / 2], [-8, 289, -Math.PI / 2], [-40, 287, Math.PI / 2], [-66, 291, -Math.PI / 2],
    [-98, 286.5, Math.PI / 2], [-132, 290, -Math.PI / 2], [-176, 287, Math.PI / 2],
  ]) {
    strollPed(x, z, h, 'civ');
  }
  hud.dialogue('ELENA', 'Harbor gate, west end of the Strip. Lose the cruiser before you pull in.', 120000);
  camera.pos = [41.5, 3.2, 257.4];
  camera.target = [14, 1.7, 251.2];
  camera.fov = 62;
}

/** A frozen exchange of fire: muzzle star at the shooter, a tracer streak `head` of the way down the line. */
function stagedShot(x1, z1, x2, z2, y1, y2, color, head, opts = {}) {
  const yaw = Math.atan2(x2 - x1, z2 - z1);
  const mx = x1 + Math.sin(yaw) * (opts.reach ?? 0.78), mz = z1 + Math.cos(yaw) * (opts.reach ?? 0.78);
  combat.tracers.push({
    x1: mx, y1, z1: mz, x2, y2, z2, color, life: 999, maxLife: 999, head,
    flash: opts.flash ?? true, flashSize: opts.flashSize ?? 0.5, spin: opts.spin ?? head * 7, ground: world.groundHeight(mx, mz),
  });
  return yaw;
}

/** Sparks frozen mid-burst where rounds strike metal or stone. */
function stagedSparks(x, y, z, count, spread = 0.5, color = rgb(0xffd27a)) {
  for (let i = 0; i < count; i += 1) {
    const a = random() * Math.PI * 2, r = random() * spread;
    combat.particles.push({
      x: x + Math.cos(a) * r, y: y + random() * spread * 0.8, z: z + Math.sin(a) * r * 0.6,
      vx: 0, vy: 0, vz: 0, life: 999, maxLife: 999, color: i % 3 ? color : rgb(0xffffff), size: 0.12 + random() * 0.12, gravity: 0,
    });
  }
}

/** On foot in Neon Midtown: a cover firefight at the Solaris Vault plaza, Mateo alongside. */
function stageFoot() {
  clearScene();
  setStageHour(19.72);
  missions.stage(2, 1, { banner: 'ACTIVE MISSION', done: 2 });
  hud.els.banner.classList.remove('show');
  careerPlayer({ cash: 31640, respect: 760, health: 81, armor: 55, mag: 22 });
  stageCareer(2, { palm: 52, harbor: 38, midtown: 24, hills: 6, key: 0 });
  const p = combat.player;
  const px = 63.4, pz = 0.3;
  combinePlayerOnFoot(px, pz, Math.PI + 0.3);
  p.health = 81;
  p.armor = 55;
  p.moving = false;
  p.walkPhase = 0.8;
  setCameraAngles(Math.PI, 0.1);

  // Armoured vault guards dug in behind the plaza barricades and the colonnade.
  const spots = [[53.6, -18.2, 'smg'], [72.4, -23.2, 'pistol'], [61.4, -32.6, 'smg'], [82.2, -14.2, 'pistol'], [45.5, -27.5, 'pistol']];
  for (const [x, z, weapon] of spots) combat.spawnEnemy(x, z, { health: 85, style: 'guard', weapon, stationary: true, mission: true });
  combat.enemies.forEach((e) => { e.heading = Math.atan2(px - e.x, pz - e.z); e.phase = 0; });
  combat.enemies[0].hitFlash = 0.25;
  combat.enemies[3].hitFlash = 0.2;

  // Cover: the stealable teal muscle car broadside at the kerb, the bank's armoured van beyond.
  const muscle = stageCar('muscle', 65.6, -1.5, Math.PI / 2 + 0.08, 0, { color: rgb(0x1f9e8f) });
  stageCar('van', 86.5, -8.4, -Math.PI / 2, 0, { color: rgb(0x3a4250) });
  stageCar('coupe', 38, 7.5, Math.PI / 2, 0, { color: rgb(0xff5a3c) });
  // The player down in low cover at the car's tail, rising over the boot to fire.
  combat.stageCover({ x: px, z: -0.6, kind: 'car', name: muscle.spec.name, car: muscle }, 0.2);

  // The player's SMG burst over the boot at the nearest guard, sparking off the barricade.
  const gy = 1.02;
  const yaw = stagedShot(px, pz, 53.9, -18.0, gy, gy + 0.1, rgb(0xffe6a8), 0.42, { flashSize: 0.62 });
  stagedShot(px, pz, 54.6, -18.9, gy, gy - 0.1, rgb(0xfff2c8), 0.83, { flash: false });
  p.aimYaw = yaw;
  p.heading = yaw + 0.2;

  // Mateo kneeling off the car's nose in his plate carrier, laying covering bursts on the guards.
  const mx = 69.4, mz = -0.3;
  const myaw = Math.atan2(82.2 - mx, -14.2 - mz);
  crew.stageMateo({ x: mx, z: mz, heading: myaw, aimYaw: myaw, crouch: 0.62, status: 'COVERING FIRE' });
  const my = 1.0;
  stagedShot(mx, mz, 82.0, -14.6, my, 1.3, rgb(0x9ff3ff), 0.38, { flashSize: 0.58 });
  stagedShot(mx, mz, 82.6, -13.6, my, 1.2, rgb(0xc8faff), 0.78, { flash: false });
  stagedShot(mx, mz, 72.6, -22.6, my, 1.25, rgb(0x9ff3ff), 0.62, { flash: false });
  stagedSparks(82.2, 1.3, -14.6, 6, 0.35, rgb(0xbff6ff));

  // Return fire: guard muzzle stars and orange streaks cracking past toward the car.
  stagedShot(72.4, -23.2, 64.6, -1.4, 1.4, 1.05, rgb(0xff9a5a), 0.62, { flashSize: 0.55, reach: 0.7 });
  stagedShot(61.4, -32.6, 63.3, -1.8, 1.4, 1.1, rgb(0xff8a4a), 0.74, { flashSize: 0.5, reach: 0.7 });
  stagedShot(45.5, -27.5, 66.8, -1.2, 1.4, 1.0, rgb(0xffa060), 0.35, { flashSize: 0.45, reach: 0.7 });
  // Brass casings tumbling out to the right of the gun.
  for (let i = 0; i < 4; i += 1) {
    combat.particles.push({
      x: px + 0.45 + i * 0.2, y: 1.2 + i * 0.14 - (i > 2 ? 0.5 : 0), z: pz - 0.2 + i * 0.1, vx: 0, vy: 0, vz: 0,
      life: 999, maxLife: 999, color: rgb(0xd9a441), size: 0.3, gravity: 0, casing: true, spin: i * 1.7,
    });
  }
  // Rounds sparking off the muscle car's roof and the striped barricade.
  stagedSparks(64.4, 1.3, -1.4, 6, 0.35);
  stagedSparks(66.6, 1.25, -1.2, 3, 0.3);
  stagedSparks(54.7, 1.0, -18.8, 7, 0.4);
  combat.addImpact(54.6, 1.3, -18.4, PALETTE.gold, 999);

  // Heat arriving: one cruiser swinging in off the cross street.
  police.setWanted(2);
  police.setPeak(3);
  const cop = police.spawnStagedCruiser(24, -6, Math.PI / 2 + 0.35);
  cop.sirenOn = true; cop.remote = true; cop.speed = 18;
  // Bystanders scattering, one cowering by the kerb with her hands over her head.
  traffic.addStagedPed(49, 9.5, -1.2, 'civ', { panic: 3, panicArms: true });
  traffic.addStagedPed(92, 11, 1.4, 'civ', { panic: 3, panicArms: true });
  traffic.addStagedPed(96, -2, 2.6, 'civ', { panic: 3, panicArms: true });
  traffic.addStagedPed(56.5, -7.5, 2.4, 'civ', { panic: 3, duck: 1, longHair: true });
  for (const [x, z, h] of [[30, 14, Math.PI / 2], [104, 15, -Math.PI / 2]]) strollPed(x, z, h);
  hud.dialogue('MATEO', 'Stay low behind the muscle car. I\'ve got the guards on the right. Peek and fire.', 120000);
  // Low over-the-shoulder camera behind the player's cover, Mateo framed to the right.
  camera.pos = [px + 0.6, 2.75, pz + 7.8];
  camera.target = [px + 2.6, 0.95, pz - 30];
  camera.fov = 54;
}

/** The city menu over the night skyline: full map, story arc, activities, garage. */
function stageMenu() {
  clearScene();
  setStageHour(22.1);
  missions.stage(2, 1, { banner: 'ACTIVE MISSION', done: 2 });
  hud.els.banner.classList.remove('show');
  careerPlayer({ cash: 58420, respect: 1180, health: 100, armor: 70 });
  progression.state.upgrades = { engine: 2, nitro: 1, armor: 1, grip: 0 };
  progression.state.stored = ['coupe', 'muscle', 'taxi', 'sedan'];
  Object.assign(progression.state.stats, { stolen: 23, stunts: 5, evaded: 9, activities: 6, takedowns: 31 });
  activities.state.best = { sprint: 38.4, courier: 61.2, circuit: 30.9 };
  activities.state.completed = { sprint: 2, courier: 1, circuit: 1 };
  activities.state.streak = 3;
  activities.state.bestStreak = 3;
  progression.state.paint = 'lagoon';
  progression.state.neon = 'pink';
  stageCareer(2, { palm: 72, harbor: 46, midtown: 38, hills: 14, key: 6 });
  crew.mateo.status = 'RIDING SHOTGUN';
  // The save pill and SAVES tab read these staged slots, so photo mode never writes to the
  // visitor's localStorage. Timestamps are fixed local times, the same on every capture.
  const at = (h, m) => new Date(2026, 10, 20, h, m).getTime();
  const slot = (id, label, savedAt, name, district, progress, cash, crewIds) => ({
    slot: id, label, exists: !!savedAt, savedAt, name, district, progress, total: 8, cash, crew: crewIds, storyComplete: false,
  });
  game.stagedSaves = [
    slot('auto', 'AUTOSAVE', at(22, 4), '03 · Neon Heist Getaway', 'Neon Midtown', 2, 58420, ['elena', 'mateo']),
    slot('1', 'SLOT 1', at(21, 58), '03 · Neon Heist Getaway', 'Palm Strip', 2, 57900, ['elena', 'mateo']),
    slot('2', 'SLOT 2', at(19, 31), '02 · Harbor Contraband', 'Harbor Docks', 1, 21350, ['elena']),
    slot('3', 'SLOT 3', 0, '', 'Palm Strip', 0, 0, []),
  ];
  const hero = driveHero('supercar', 132, 120, Math.PI, 0, { body: rgb(0x27e2d2), accent: rgb(0xff3f95) });
  const p = combat.player;
  p.x = hero.x; p.z = hero.z; p.heading = hero.heading;
  police.setPeak(4);
  for (const [x, z, h] of [[-120, 4, 0.1], [250, 0, 1.5], [6, 258, -1.6], [-260, -128, 3.1], [380, 130, 1.2]]) {
    const cop = police.spawnStagedCruiser(x, z, h);
    cop.sirenOn = false;
  }
  for (let i = 0; i < 14; i += 1) {
    const pt = world.randomRoadPoint(130, 0, 20, 420, random);
    traffic.addStagedCar(['sedan', 'taxi', 'coupe', 'van'][i % 4], pt.x, pt.z, pt.axis === 'x' ? Math.PI / 2 : 0);
  }
  camera.pos = [210, 46, 360];
  camera.target = [60, 26, 40];
  camera.fov = 58;
  openMenu('map');
}
