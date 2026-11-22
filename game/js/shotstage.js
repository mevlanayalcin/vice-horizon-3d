// shotstage.js — photo mode for the entry's four screenshots. `?shot=<name>` stages one
// deterministic moment of real play through the game's own systems (missions, police, crew,
// turf, traffic, combat, activities, progression, saves) and renders it live, HUD and all:
//   chase  4-star coastal pursuit on Ocean Boulevard: the drifting Solaris GT, a PIT unit on
//          its rear quarter and a flanker, an SBPD roadblock with flares and officers firing,
//          Air One's searchlight, civilian traffic and a scattering crowd;
//   foot   the Solaris Vault cover shootout in Neon Midtown with Mateo laying covering fire,
//          a downed guard, a cruiser and an officer closing and a roadblock down the avenue;
//   menu   the city menu (M) at night: map, completion ring, medals, crew, saves;
//   title  the Golden-Hour start screen over an aerial of the boulevard, beach and pier.
// The SBPD RESPONSE table, wanted pill, ability cards and save cards read the same live
// state a played frame would: nothing here draws a picture of the HUD.

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

const STAGES = { chase: stageChase, foot: stageFoot, menu: stageMenu, title: stageTitle };

function stageShot(name) {
  const stage = STAGES[name] ?? stageTitle;
  const title = stage === stageTitle;
  hud.showLoadingDone(true);
  hud.showTitle(title);
  hud.setPlaying(!title, false);
  setStageCity(null);
  game.stagedSaves = null;
  game.stagedCompletion = null;
  stage();
  hud.clearToasts();
}

/** Per-frame life in a staged frame: the flares and the muzzle sparks flicker. */
function stageFrame(elapsed, name) {
  if (name === 'foot' || name === 'chase') {
    const pulse = 0.92 + Math.sin(elapsed * 9) * 0.06;
    for (const pt of combat.particles) if (pt.staged) pt.size = pt.baseSize * pulse;
  }
}

// ------------------------------------------------------------------ building blocks
function clearScene() {
  for (const car of traffic.cars) car.removed = true;
  traffic.cars.length = 0;
  police.clear();
  combat.clearEnemies();
  combat.tracers.length = 0;
  combat.particles.length = 0;
  skidMarks.length = 0;
  tyreSmoke.length = 0;
  Object.assign(combat.player, { dead: false, inVehicle: null, cover: null });
  crew.mateo.visible = false;
  crew.mateo.staged = false;
  setVehicle(null);
  // Mid-crossing walkers would freeze in the traffic lanes: keep only the kerbside ones.
  const kerbside = traffic.pedestrians.filter((ped) => {
    const road = world.nearestRoad(ped.x, ped.z);
    return !road || road.distance > road.w / 2 + 0.5;
  });
  traffic.pedestrians.length = 0;
  traffic.pedestrians.push(...kerbside);
}

function stageCar(type, x, z, heading, speed = 0, options = {}) {
  const car = createVehicle(type, x, z, heading, options);
  Object.assign(car, { y: world.groundHeight(x, z) + 0.02, speed, parked: true, staged: true });
  if (options.color) car.color = options.color;
  parkedVehicles.push(car);
  return car;
}

/** A pedestrian: strolling, or (`flee`) running with arms up, or (`duck`) cowering. */
function ped(x, z, heading, mode = 'stroll', style = 'civ') {
  const options = mode === 'flee' ? { panic: 3, panicArms: true } : mode === 'duck' ? { panic: 3, duck: 1 } : {};
  const p = traffic.addStagedPed(x, z, heading, style, options);
  p.speedNow = mode === 'stroll' ? 1.3 : 0;
  p.phase = random() * Math.PI * 2;
  return p;
}

/** A mid-story criminal: cash, respect and the weapons unlocked at that point in the story. */
function careerPlayer({ cash, respect, health = 100, armor = 40, slot = 3, mag = 24, weapons = ['fists', 'pistol', 'smg', 'shotgun', 'carbine'] }) {
  const p = combat.player;
  Object.assign(p, { cash, respect, health, armor, weaponSlot: slot, dead: false, reloadTimer: 0 });
  p.weapons = weapons.slice();
  Object.assign(p.ammo.pistol, { mag: 9, reserve: 84 });
  Object.assign(p.ammo.smg, { mag, reserve: 180 });
  Object.assign(p.ammo.shotgun, { mag: 6, reserve: 30 });
  Object.assign(p.ammo.carbine, { mag: 24, reserve: 96 });
}

function playerOnFoot(x, z, heading) {
  const p = combat.player;
  Object.assign(p, { x, z, y: world.groundHeight(x, z), heading, aimYaw: heading, inVehicle: null, dead: false });
  setVehicle(null);
}

/** Crew and turf as they stand `done` jobs into the story. */
function stageCareer(done, standing) {
  crew.reset();
  crew.syncStory(missions.state.done.map((_, i) => i < done), false);
  turf.reset();
  turf.stage(standing);
}

/** The Z / X / C cards mid-fight: seconds left on each cooldown, and any effect still running. */
function stageAbilities(cooldown, effect = {}) {
  Object.assign(crew.state.cooldown, { jam: 0, patch: 0, nitro: 0 }, cooldown);
  Object.assign(crew.state.effect, { jam: 0, patch: 0, nitro: 0 }, effect);
}

/** Rubber laid behind a sliding car: two rear-tyre streaks curving back along its arc. */
function stageSkids(car, length, curve, alpha = 0.55) {
  const back = car.spec.wheelBase / 2, half = car.spec.width * 0.4;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
  for (let d = 0; d < length; d += 0.7) {
    const bx = car.x - fx * (back + d), bz = car.z - fz * (back + d);
    const bend = (curve * d * d) / length * 0.35;
    for (const side of [-1, 1]) {
      skidMarks.push({ x: bx + rx * (side * half + bend), z: bz + rz * (side * half + bend), y: car.y + 0.075, rot: car.heading - curve * (d / length) ** 1.4, alpha: alpha * (1 - (d / length) * 0.6) });
    }
  }
}

/** Tyre smoke boiling off the rear wheels and trailing back. */
function stageSmoke(car, count, spread = 6) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  for (let i = 0; i < count; i += 1) {
    const d = car.spec.wheelBase / 2 + random() * spread;
    const side = (random() - 0.5) * car.spec.width * 1.4;
    tyreSmoke.push({
      x: car.x - fx * d + Math.cos(car.heading) * side, y: car.y + 0.3 + d * 0.12 + random() * 0.3, z: car.z - fz * d - Math.sin(car.heading) * side,
      size: 0.6 + d * 0.28 + random() * 0.4, life: Math.max(0.3, 1.6 * (1 - d / (spread + 3))), maxLife: 1.6, vy: 0,
    });
  }
}

/** Sparks frozen mid-burst where metal meets metal or rounds strike stone. */
function sparks(x, y, z, count, spread = 0.5, color = rgb(0xffd27a)) {
  for (let i = 0; i < count; i += 1) {
    const a = random() * Math.PI * 2, r = random() * spread;
    const size = 0.12 + random() * 0.14;
    combat.particles.push({
      x: x + Math.cos(a) * r, y: y + random() * spread * 0.8, z: z + Math.sin(a) * r * 0.6, vx: 0, vy: 0, vz: 0,
      life: 999, maxLife: 999, color: i % 3 ? color : rgb(0xffffff), size, baseSize: size, gravity: 0, staged: true,
    });
  }
}

/** One frozen round: a muzzle star at the shooter and a tracer `head` of the way down the line. */
function shot(x1, z1, x2, z2, y1, y2, color, head, opts = {}) {
  const yaw = Math.atan2(x2 - x1, z2 - z1);
  const reach = opts.reach ?? 0.78;
  const mx = x1 + Math.sin(yaw) * reach, mz = z1 + Math.cos(yaw) * reach;
  combat.tracers.push({
    x1: mx, y1, z1: mz, x2, y2, z2, color, life: 999, maxLife: 999, head,
    flash: opts.flash ?? true, flashSize: opts.flashSize ?? 0.5, spin: opts.spin ?? head * 7, ground: world.groundHeight(mx, mz),
  });
  return yaw;
}

/** Freeze the nearest street lamp mid-topple, dark, with sparks at its sheared base. */
function knockLamp(x, z, fallYaw, tilt) {
  let lamp = null, best = 6;
  for (const l of world.lampposts) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < best) { best = d; lamp = l; }
  }
  if (!lamp) return;
  Object.assign(lamp, { knocked: true, fallYaw, tilt, spin: 0, landed: true });
  lamp.glow.alpha = 0;
  sparks(lamp.x, 0.35, lamp.z, 10, 0.6);
}

/** A save card's data, exactly as save.list() returns it, for frames that never touch localStorage. */
function slotData(id, label, savedAt, index, district, progress, cash, completion, crewIds) {
  const acts = ['I', 'I', 'II', 'II', 'II', 'III', 'III', 'III'];
  const titles = ['BOARDWALK BOOST', 'HARBOR CONTRABAND', 'NEON HEIST', 'PIER AMBUSH', 'CASA HILLS HUSH', 'STARLIGHT KEY RUN', 'CRANE LIGHT BLACKOUT', 'THE SOLARIS VAULT'];
  return {
    slot: id, label, exists: !!savedAt, savedAt, name: '', district, progress, total: 8, cash, crew: crewIds,
    storyComplete: false, completion, act: savedAt ? `ACT ${acts[index]} — ${titles[index]}` : '', mission: index,
  };
}
// Fixed local timestamps so every capture prints the same clock.
const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();

// ------------------------------------------------------------------ 01 · the chase (cover)
/** Four stars at golden hour: roadblock ahead, Air One overhead, two units on the GT's bumpers. */
function stageChase() {
  clearScene();
  game.hour = 19.08;
  setStageCity({ districts: 4, tokens: 7, safehouse: true, missions: 2 });
  missions.stage(2, 2, { banner: 'ACTIVE MISSION', done: 2 });
  hud.els.banner.classList.remove('show');
  careerPlayer({ cash: 41280, respect: 760, health: 74, armor: 30, slot: 3, mag: 19, weapons: ['fists', 'pistol', 'smg', 'shotgun'] });
  stageCareer(2, { palm: 72, harbor: 46, midtown: 38, hills: 14, key: 6 });
  crew.mateo.status = 'RIDING SHOTGUN';
  stageAbilities({ patch: 14, nitro: 21.4 }, { nitro: 2.6 });

  const hero = stageCar('supercar', 128, 251.4, -Math.PI / 2 + 0.1, 41);
  Object.assign(hero, { boost: 0.92, boosting: true, drift: 3.8, steer: -0.6, health: 86, color: rgb(0xff2f86), accent: rgb(0x39e9ff) });
  progression.state.neon = 'cyan';
  setVehicle(hero);

  police.setWanted(4);
  police.setPeak(4);
  // UNIT-12 on the rear quarter lining up the PIT, UNIT-07 flanking on the beach side,
  // UNIT-21 closing from behind the camera and UNIT-33 running the intercept a block north.
  const units = [
    police.spawnStagedCruiser(134.2, 247.4, -Math.PI / 2 - 0.12),
    police.spawnStagedCruiser(133, 259.2, -Math.PI / 2 + 0.1),
    police.spawnStagedCruiser(168, 250.5, -Math.PI / 2),
    police.spawnStagedCruiser(150, 130, -Math.PI / 2),
  ];
  units.forEach((c, i) => Object.assign(c, { sirenOn: true, remote: true, pursuit: true, sirenPhase: i * 0.37, speed: 38 }));
  // TAC-04: two cruisers nose-in across the westbound lanes, sawhorses, a fan of flares.
  police.stageRoadblock(104, 250.6, Math.PI / 2, 1, 8.6, 'Ocean Boulevard');
  police.stageHelicopter({ x: 112, z: 249, y: 15.5, heading: Math.PI / 2 + 0.35, spotX: 126.5, spotZ: 251.2 });
  police.setSeen(true);
  // Officers dug in behind the barricade, firing on the GT; their rounds spark off the bonnet.
  for (const [x, z, h] of [[99.6, 245.2, Math.PI / 2 + 0.2], [99.2, 256.6, Math.PI / 2 - 0.25]]) {
    const cop = combat.spawnEnemy(x, z, { style: 'cop', police: true, weapon: 'pistol', stationary: true, health: 80 });
    Object.assign(cop, { heading: h, kneel: false, barricade: true, phase: 0 });
  }
  shot(99.6, 245.2, 127.4, 250.6, 1.45, 1.0, rgb(0xff9a5a), 0.55, { flashSize: 0.5, reach: 0.7 });
  shot(99.2, 256.6, 126.8, 252.2, 1.45, 1.05, rgb(0xff8a4a), 0.72, { flashSize: 0.45, reach: 0.7 });
  sparks(125.9, 1.0, 251.4, 6, 0.3);
  hud.dispatch('SBPD DISPATCH · AIR ONE', 'TAC-04 has Ocean Boulevard closed, flares down. Air One has the suspect in the light. UNIT-12, take the PIT.', 0);

  // Civilian traffic: stopped short of the roadblock westbound, rolling past eastbound.
  stageCar('coupe', 72, 247.8, -Math.PI / 2, 0, { color: rgb(0xff8a3c) });
  stageCar('van', 62, 254.6, -Math.PI / 2 + 0.05, 0);
  stageCar('taxi', 112, 268, Math.PI / 2, 9);
  stageCar('sedan', 84, 266.6, Math.PI / 2, 12, { color: rgb(0x2f7fbf) });
  stageCar('muscle', 52, 271.2, Math.PI / 2, 14, { color: rgb(0x1f9e8f) });
  stageCar('coupe', 98, 269, Math.PI / 2, 10, { color: rgb(0x8f5bb8) });
  stageCar('sedan', 92, 239.2, -Math.PI / 2, 0, { color: rgb(0xf1efe6) });
  // The slide: rubber, smoke, the cruiser's nose grinding sparks off the GT's quarter.
  stageSkids(hero, 26, -0.35, 0.6);
  stageSmoke(hero, 22, 7);
  stageSmoke(units[0], 6, 3);
  sparks(131.2, 0.55, 249.4, 9, 0.5, rgb(0xff9a3a));
  knockLamp(124, 245.5, -Math.PI / 2 - 0.5, 0.62);

  // The crowd: hotel-side pavement, beach promenade and the sand, scattering from the chase.
  const crowd = [
    [118, 238.6, 2.6, 'flee'], [110, 237.4, 0.4, 'flee'], [96, 238.2, 3.0, 'flee'], [86, 239.4, 1.2, 'duck'], [76, 237.8, -1.6, 'stroll'],
    [126, 239.6, 2.2, 'flee'], [104, 286.6, 0.7, 'duck'], [94, 290.4, 1.9, 'flee'], [88, 285.6, 2.6, 'flee'], [80, 288.2, -1.5, 'stroll'],
    [70, 291.0, 1.5, 'stroll'], [60, 287.2, 2.9, 'flee'], [50, 292.4, 1.1, 'stroll'], [64, 296.6, 2.2, 'stroll'],
  ];
  for (const [x, z, h, mode] of crowd) ped(x, z, h, mode);
  ped(97.8, 249.4, Math.PI / 2, 'stroll', 'cop');

  hud.dialogue('MATEO', 'Roadblock on Ocean! Thread the gap by the flares, I\'ll keep the bird busy. Causeway is two blocks out.', 120000);
  camera.pos = [149, 4.2, 253.2];
  camera.target = [112, 3.1, 250.2];
  camera.fov = 60;
}

// ------------------------------------------------------------------ 02 · on foot at the vault
/** Neon twilight: the player low behind the teal Coastal Muscle, Mateo off its nose, guards dug in. */
function stageFoot() {
  clearScene();
  game.hour = 19.72;
  setStageCity({ districts: 4, tokens: 7, safehouse: true, missions: 2 });
  missions.stage(2, 1, { banner: 'ACTIVE MISSION', done: 2 });
  hud.els.banner.classList.remove('show');
  careerPlayer({ cash: 31640, respect: 760, health: 81, armor: 55, slot: 3, mag: 22, weapons: ['fists', 'pistol', 'smg', 'shotgun'] });
  stageCareer(2, { palm: 72, harbor: 46, midtown: 38, hills: 14, key: 6 });
  stageAbilities({ jam: 27 });
  const p = combat.player;
  const px = 63.4, pz = 0.3;
  playerOnFoot(px, pz, Math.PI + 0.3);
  Object.assign(p, { moving: false, walkPhase: 0.8 });
  setCameraAngles(Math.PI, 0.1);

  // Armoured vault guards behind the plaza barricades and the colonnade; one already down.
  const spots = [[53.6, -18.2, 'smg'], [72.4, -23.2, 'pistol'], [61.4, -32.6, 'smg'], [82.2, -14.2, 'pistol'], [45.5, -27.5, 'pistol'], [58.2, -11.6, 'smg']];
  for (const [x, z, weapon] of spots) combat.spawnEnemy(x, z, { health: 85, style: 'guard', weapon, stationary: true, mission: true });
  combat.enemies.forEach((e) => { e.heading = Math.atan2(px - e.x, pz - e.z); e.phase = 0; });
  combat.enemies[0].hitFlash = 0.25;
  combat.enemies[3].hitFlash = 0.2;
  Object.assign(combat.enemies[5], { alive: false, health: 0, deathTimer: 0.6, heading: 2.2 });

  // Cover: the stealable teal Coastal Muscle at the kerb, the bank's armoured van beyond.
  const muscle = stageCar('muscle', 65.6, -1.5, Math.PI / 2 + 0.08, 0, { color: rgb(0x1f9e8f) });
  stageCar('van', 86.5, -8.4, -Math.PI / 2, 0, { color: rgb(0x3a4250) });
  stageCar('coupe', 38, 7.5, Math.PI / 2, 0, { color: rgb(0xff5a3c) });
  stageCar('taxi', 104, 7.2, -Math.PI / 2, 0);
  combat.stageCover({ x: px, z: -0.6, kind: 'car', name: muscle.spec.name, car: muscle }, 0.2);

  // The player's SMG burst over the boot, sparking off the barricade.
  const yaw = shot(px, pz, 53.9, -18.0, 1.02, 1.12, rgb(0xffe6a8), 0.42, { flashSize: 0.62 });
  shot(px, pz, 54.6, -18.9, 1.02, 0.92, rgb(0xfff2c8), 0.83, { flash: false });
  p.aimYaw = yaw;
  p.heading = yaw + 0.2;
  // Mateo kneeling off the nose in his plate carrier, laying cyan covering bursts.
  const mx = 67.9, mz = -0.3;
  const myaw = Math.atan2(82.2 - mx, -14.2 - mz);
  crew.stageMateo({ x: mx, z: mz, heading: myaw, aimYaw: myaw, crouch: 0.62, status: 'COVERING FIRE' });
  shot(mx, mz, 82.0, -14.6, 1.0, 1.3, rgb(0x9ff3ff), 0.38, { flashSize: 0.58 });
  shot(mx, mz, 82.6, -13.6, 1.0, 1.2, rgb(0xc8faff), 0.78, { flash: false });
  shot(mx, mz, 72.6, -22.6, 1.0, 1.25, rgb(0x9ff3ff), 0.62, { flash: false });
  sparks(82.2, 1.3, -14.6, 6, 0.35, rgb(0xbff6ff));
  // Return fire cracking back toward the car.
  shot(72.4, -23.2, 64.6, -1.4, 1.4, 1.05, rgb(0xff9a5a), 0.62, { flashSize: 0.55, reach: 0.7 });
  shot(61.4, -32.6, 63.3, -1.8, 1.4, 1.1, rgb(0xff8a4a), 0.74, { flashSize: 0.5, reach: 0.7 });
  shot(45.5, -27.5, 66.8, -1.2, 1.4, 1.0, rgb(0xffa060), 0.35, { flashSize: 0.45, reach: 0.7 });
  for (let i = 0; i < 4; i += 1) {
    combat.particles.push({
      x: px + 0.45 + i * 0.2, y: 1.2 + i * 0.14 - (i > 2 ? 0.5 : 0), z: pz - 0.2 + i * 0.1, vx: 0, vy: 0, vz: 0,
      life: 999, maxLife: 999, color: rgb(0xd9a441), size: 0.3, gravity: 0, casing: true, spin: i * 1.7,
    });
  }
  sparks(64.4, 1.3, -1.4, 6, 0.35);
  sparks(66.6, 1.25, -1.2, 3, 0.3);
  sparks(54.7, 1.0, -18.8, 7, 0.4);
  combat.addImpact(54.6, 1.3, -18.4, PALETTE.gold, 999);
  // Glowing smoke drifting off the barricade where the rounds hit.
  for (let i = 0; i < 8; i += 1) {
    tyreSmoke.push({ x: 54 + random() * 3, y: 0.6 + random() * 1.2, z: -17.5 - random() * 2, size: 1.2 + random() * 0.9, life: 1.1, maxLife: 1.6, vy: 0 });
  }

  // Three stars and the response arriving: UNIT-12 swinging in, an officer on foot, TAC-04 down the avenue.
  police.setWanted(3);
  police.setPeak(3);
  const cop = police.spawnStagedCruiser(24, -6, Math.PI / 2 + 0.35);
  Object.assign(cop, { sirenOn: true, remote: true, pursuit: true, speed: 18 });
  const officer = combat.spawnEnemy(30.5, 9.5, { style: 'cop', police: true, weapon: 'pistol', health: 80 });
  Object.assign(officer, { heading: Math.atan2(px - 30.5, pz - 9.5), phase: 1.2, speed: 3.4, callsign: 'OFC-31' });
  police.stageRoadblock(132, 0, -Math.PI / 2, 1, 8.6, 'Midtown Avenue');
  police.setSeen(true);

  // Civilians caught in it: hands up and running, one cowering by the kerb.
  for (const [x, z, h, mode] of [[49, 9.5, -1.2, 'flee'], [92, 11, 1.4, 'flee'], [96, -2, 2.6, 'flee'], [56.5, -7.5, 2.4, 'duck'], [78, 12.5, 0.9, 'flee'], [42, 13, -2.2, 'flee']]) {
    ped(x, z, h, mode);
  }
  hud.dialogue('MATEO', 'Stay low behind the muscle car. I have the guards on the right. Then we take it, the keys are in it.', 120000);
  camera.pos = [px + 0.6, 2.75, pz + 7.8];
  camera.target = [px + 2.6, 0.95, pz - 30];
  camera.fov = 54;
}

// ------------------------------------------------------------------ 03 · city map, progression, saves
/** The city menu over the night skyline, five jobs in: every system's progress at once. */
function stageMenu() {
  clearScene();
  game.hour = 22.1;
  missions.stage(5, 0, { banner: 'ACTIVE MISSION', done: 5 });
  missions.state.ratings = ['G', 'S', 'G', 'B', 'G', null, null, null];
  hud.els.banner.classList.remove('show');
  careerPlayer({ cash: 58420, respect: 1180, health: 100, armor: 70 });
  progression.state.upgrades = { engine: 2, nitro: 2, armor: 1, grip: 1 };
  progression.state.stored = ['coupe', 'muscle', 'taxi', 'sedan'];
  Object.assign(progression.state.stats, { stolen: 23, stunts: 5, evaded: 9, activities: 6, takedowns: 31 });
  activities.state.best = { sprint: 38.4, courier: 61.2, circuit: 30.9, fares: 52.4 };
  activities.state.completed = { sprint: 2, courier: 1, circuit: 1, fares: 1 };
  activities.state.streak = 3;
  activities.state.bestStreak = 3;
  progression.state.paint = 'lagoon';
  progression.state.neon = 'pink';
  game.tokens.forEach((t, i) => { t.taken = i < 9; });
  stageCareer(5, { palm: 72, midtown: 58, harbor: 46, hills: 34, key: 20 });
  crew.mateo.status = 'RIDING SHOTGUN';
  // The SAVES cards read these, so photo mode never writes the visitor's localStorage.
  game.stagedSaves = [
    slotData('auto', 'AUTOSAVE', at(20, 22, 4), 5, 'Palm Strip', 5, 58420, 64.2, ['elena', 'mateo']),
    slotData('1', 'SLOT 1', at(20, 21, 58), 5, 'Palm Strip', 5, 57900, 63.8, ['elena', 'mateo']),
    slotData('2', 'SLOT 2', at(19, 23, 12), 2, 'Neon Midtown', 2, 41280, 42.0, ['elena', 'mateo']),
    slotData('3', 'SLOT 3', at(18, 19, 31), 1, 'Harbor Docks', 1, 21350, 18.0, ['elena']),
  ];
  const hero = stageCar('supercar', 132, 120, Math.PI, 0, { color: rgb(0x27e2d2), accent: rgb(0xff3f95) });
  progression.tuneVehicle(hero);
  setVehicle(hero);
  police.setPeak(4);
  for (const [x, z, h] of [[-120, 4, 0.1], [250, 0, 1.5], [6, 258, -1.6], [-260, -128, 3.1], [380, 130, 1.2]]) {
    police.spawnStagedCruiser(x, z, h).sirenOn = false;
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

// ------------------------------------------------------------------ 04 · title / start screen
/** Golden hour from above Ocean Boulevard: traffic, the beach crowd, the pier wheel, the bay. */
function stageTitle() {
  clearScene();
  game.hour = 19.05;
  missions.reset();
  missions.state.done = missions.state.done.map((_, i) => i < 2);
  missions.state.active = false;
  playerOnFoot(-40, 285, 0.6);
  combat.player.cash = 41280;
  game.tokens.forEach((t, i) => { t.taken = i < 7; });
  police.setPeak(4);
  // Both directions on the boulevard, and parked cars on the promenade kerb.
  const flow = [
    ['coupe', 118, 254, -Math.PI / 2, 0xff8a3c], ['muscle', 214, 267, Math.PI / 2, 0x1f9e8f], ['supercar', 330, 251, -Math.PI / 2, 0xff2f86],
    ['van', -160, 254, -Math.PI / 2, null], ['sedan', 58, 267, Math.PI / 2, 0x2f7fbf], ['taxi', 4, 252.5, -Math.PI / 2, null],
    ['coupe', -70, 268, Math.PI / 2, 0x8f5bb8], ['sedan', 160, 253, -Math.PI / 2, 0xf1efe6], ['taxi', 262, 266.5, Math.PI / 2, null],
    ['supercar', -110, 252, -Math.PI / 2, 0xffc24b], ['muscle', 20, 282, Math.PI / 2, 0xdf7a3a], ['coupe', 96, 282.5, Math.PI / 2, 0x5fb8c8],
  ];
  for (const [type, x, z, h, color] of flow) stageCar(type, x, z, h, 12, color ? { color: rgb(color) } : {});
  for (const [x, z, h] of [[-20, 291, 1.2], [30, 293, 2.7], [96, 290, 0.4], [160, 294, 3.3], [-100, 288, 1.9], [-166, 325, 0.8], [120, 310, 2.2],
    [64, 296, 1.6], [-60, 305, 2.9], [200, 292, 0.9], [-130, 300, 1.3], [10, 312, 2.0], [140, 238, 1.4], [70, 238.5, -1.4]]) {
    ped(x, z, h, 'stroll');
  }
  game.stagedSaves = [
    slotData('auto', 'AUTOSAVE', at(19, 23, 18), 2, 'Palm Strip', 2, 41280, 42.0, ['elena', 'mateo']),
    slotData('1', 'SLOT 1', at(19, 23, 12), 2, 'Palm Strip', 2, 41280, 42.0, ['elena', 'mateo']),
    slotData('2', 'SLOT 2', at(18, 19, 31), 1, 'Harbor Docks', 1, 21350, 18.0, ['elena']),
    slotData('3', 'SLOT 3', 0, 0, 'Palm Strip', 0, 0, 0, []),
  ];
  // High over the eastern boulevard, looking west down Ocean Boulevard into the sun: hotels
  // and neon on the right, the beach, the pier wheel and the bay on the left.
  camera.pos = [250, 34, 258];
  camera.target = [-140, 4, 310];
  camera.fov = 56;
}
