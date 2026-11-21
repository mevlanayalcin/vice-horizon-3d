// main.js — SOLARIS BAY: the event bus, the fixed 60 Hz loop, input, car theft and the
// play / pause / city-menu state machine. Nothing here or below reaches the network.
//
// Imports are listed gameplay first: missions (eight-job story), police (five-star SBPD),
// crew (Elena and Mateo), turf (district standing), save (three slots + autosave),
// progression (ranks, garage, Paint Shop), activities (races, courier, cab, ramps),
// citymenu (M / Tab map, completion ring, saves) and combat (five weapons, Q / C cover);
// then cars, traffic, sound, HUD and the renderer. Imported last: streetprops.js (hydrants
// and lampposts) and stage_glue.js (title and pause menus, photo mode, test hooks).
// Controls: WASD move or drive · mouse aim, LMB fire · E / F steal or leave a car · Space jump /
// handbrake · Shift sprint / nitro · Q / C cover · 1-5 weapons · R reload on foot, radio in a
// car · Z / X / C crew abilities (JAM DISPATCH, FIELD PATCH, NITRO SURGE; on foot C is cover)
// · T Mateo · H horn · M / Tab city menu · Esc or P pause to save and load.

import { createMissions, MISSIONS } from './missions.js';
import { createPolice } from './police.js';
import { createCrew } from './crew.js';
import { createTurf } from './turf.js';
import { createSave, snapshot, completionOf } from './save.js';
import { createProgression } from './progression.js';
import { createActivities } from './activities.js';
import { createCityMenu } from './citymenu.js';
import { createCombat } from './combat.js';
import { createVehicle, updateVehicle, tickTyreFx } from './vehicles.js';
import { PALETTE, SAFEHOUSE, STEP, clamp, lerp } from './config.js';
import { createCameraRig } from './camera.js';
import { createTraffic } from './traffic.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { envAtHour, timeNameAt, clockAt } from './daycycle.js';
import { buildDynamicScene } from './scene.js';
import { createRenderer } from './renderer3d.js';
import { createWorld } from './world.js';

const canvas = document.getElementById('game');
const shotName = new URLSearchParams(window.location.search).get('shot');
const isShot = !!shotName;

const renderer = createRenderer(canvas);
const world = createWorld(renderer);
const audio = createAudio();
const save = createSave();
const hud = createHud({ onAction: (action, data) => glue.handleAction(action, data), world });
const parkedVehicles = [];
const { tokens, pickups } = world;
const sfx = (name, ...args) => { if (audio.ready) audio[name](...args); };

// The bus is built before the systems so each receives the live object it keeps.
const bus = {
  onWanted: (level, reason) => {
    hud.notify(level === 0 ? 'Wanted level cleared' : `${level}-star response${reason ? ` · ${reason}` : ''}`, level >= 3 ? 'wanted' : 'warn');
    sfx('playWanted');
    hud.flashDamage();
  },
  onWantedCool: (level) => hud.notify(level === 0 ? 'You lost the cops' : `Heat cooling · ${level} star${level === 1 ? '' : 's'} left`, 'mission'),
  onEvaded: (chasePeak = 0) => {
    hud.notify('EVADED · wanted level clear', 'mission');
    progression.count('evaded');
    progression.addRespect(50, 'EVADED');
    // Shaking a three-star-plus chase raises standing where the crew went to ground.
    if (chasePeak >= 3) turf.add(turf.at(combat.player.x, combat.player.z), chasePeak * 3, `${chasePeak}-STAR CHASE SHAKEN`);
  },
  dispatch: (title, text, ms) => { hud.dispatch(title, text, ms); sfx('playDispatch'); },
  onRoadblock: (block) => {
    const where = block.street || 'the Strip';
    bus.dispatch('SBPD DISPATCH · ROADBLOCK', `All units: two cruisers and flares across ${where}. Air One, light him up.`, 6200);
    hud.notify(`ROADBLOCK AHEAD · ${where.toUpperCase()}`, 'wanted', 3200);
  },
  onHelicopter: () => bus.dispatch('SBPD DISPATCH · AIR ONE', 'Air One on station. Searchlight on the suspect vehicle, ground units close in.', 6200),
  onBarrierHit: () => {
    rig.shake = 0.3;
    sfx('playCrash', 0.6); sfx('playClang', 0.5);
    bus.notifyOnce('BARRIER SMASHED', 'warn', 5);
  },
  // Police cruisers are ordinary cars: built and stepped through the same physics.
  buildCar: (type, x, z, heading, options) => createVehicle(type, x, z, heading, options),
  driveCar: (car, controls, dt, quiet) => updateVehicle(car, controls, dt, world, { quiet }),
  onCover: (spot) => {
    if (!spot) return;
    sfx('playCover');
    bus.notifyOnce(`COVER · ${String(spot.name).toUpperCase()}`, 'info', 3);
  },
  coverVehicles: () => allVehicles(),
  crewDecoy: (enemy) => crew.decoyFor(enemy),
  heatCoolRate: () => crew.heatCool,
  hackRate: () => crew.hackRate,
  onCrewShot: () => sfx('playShot', 'smg'),
  onOfficers: () => hud.notify('Officers deploying', 'wanted', 2200),
  onWreck: () => hud.notify('Cruiser disabled', 'mission', 2200),
  onCrash: (car, kind) => { if (kind !== 'citizen') sfx('playCrash', kind === 'ram' ? 0.8 : 0.5); },
  onSirenLevel: (dist) => { sirenDistance = dist; },
  onGunshot: () => {
    traffic.panicAt(combat.player.x, combat.player.z, 40, { gunfire: true });
    if (police.wanted === 0) police.raise(1, 'Shots fired');
    else if (police.wanted < 3 && Math.random() < 0.12) police.raise(1, 'Shots fired');
  },
  onShotFired: (spec) => sfx('playShot', spec.id),
  onMelee: () => sfx('playCrash', 0.35),
  onReload: () => sfx('playUI'),
  onHitEnemy: () => hud.hitmarker(),
  onKill: (enemy) => {
    hud.hitmarker();
    progression.count('takedowns');
    if (enemy.police) police.raise(2, 'Officer down');
    else if (!enemy.mission && police.wanted < 4) police.raise(1, 'Homicide');
    sfx('playPickup', 'cash');
  },
  onPlayerHurt: (amount) => {
    hud.flashDamage();
    sfx('playCrash', 0.3);
    hud.announce(`Hurt. ${Math.ceil(amount)} damage.`);
  },
  onPlayerDeath: () => {
    hud.notify('FLATLINED · hospital bill $500', 'wanted', 5000);
    sfx('playExplosion');
    setTimeout(() => respawnPlayer(), 1700);
  },
  onCarHurt: () => hud.flashDamage(),
  onWeapon: (weapon) => { hud.notify(weapon.name.toUpperCase(), 'info', 1500); sfx('playUI'); },
  onAbility: (def) => { sfx('playUI'); if (def.id === 'jam') sfx('playDispatch'); else if (def.id === 'patch') sfx('playPickup', 'health'); },
  onCrate: () => sfx('playPickup', 'cash'),
  pickup: (x, y, z, color) => {
    for (let i = 0; i < 8; i += 1) {
      combat.particles.push({ x, y, z, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 4, life: 0.6, maxLife: 0.6, color, size: 0.5, gravity: 9 });
    }
  },
  missionBanner: (mission, kicker, duration) => hud.missionBanner(mission, kicker, duration),
  dialogue: (speaker, text) => hud.dialogue(speaker, text),
  objective: (label, mission, step, total) => hud.objective(label, mission, step, total),
  notify: (text, kind, duration) => hud.notify(text, kind, duration),
  missionComplete: (mission, reward) => {
    hud.missionComplete(mission, reward, MISSIONS[missions.index + 1]?.name);
    sfx('playMission');
    crew.syncStory(missions.state.done);
    save.write('auto', snapshot(game));
    glue.refreshTitle();
    if (missions.state.storyComplete) setTimeout(() => glue.showStoryComplete(), 700);
  },
  storyComplete: () => { save.write('auto', snapshot(game)); glue.refreshTitle(); },
  addRespect: (amount, reason) => progression.addRespect(amount, reason),
  findVehicleNear: (x, z, maxDist) => findVehicleNear(x, z, maxDist),
  spawnMissionCar: (type, x, z, heading) => {
    const car = createVehicle(type, x, z, heading, { parked: true, mission: true });
    car.y = world.groundHeight(x, z) + 0.02;
    parkedVehicles.push(car);
    return car;
  },
  playerPosition: () => ({ x: combat.player.x, z: combat.player.z }),
  playerVehicle: () => currentVehicle,
  notifyOnce: (() => {
    const seen = new Map();
    return (text, kind, cooldown = 4) => {
      const now = performance.now();
      if ((seen.get(text) ?? -99999) + cooldown * 1000 > now) return;
      seen.set(text, now);
      hud.notify(text, kind, 3000);
    };
  })(),
};

const traffic = createTraffic(world, { seed: 0x7ad10c });
const combat = createCombat(world, bus);
const police = createPolice(world, combat, bus);
const turf = createTurf({ combat, bus });
const crew = createCrew({ world, combat, police, bus });
const missions = createMissions({ world, combat, police, bus, turf });
const progression = createProgression({ combat, bus, turf });
const activities = createActivities({ combat, bus, progression, turf });
const cityMenu = createCityMenu({
  painter: hud.painter, portrait: hud.portrait, missions, activities, progression, combat, police, crew, turf,
  saves: () => ({ list: game.stagedSaves ?? save.list(), active: glue.activeSlot, time: glue.slotTime }),
  completion: () => game.stagedCompletion ?? completionOf(game),
});
const game = {
  renderer, world, audio, combat, traffic, police, missions, activities, progression, hud, save, crew, turf,
  tokens, pickups, hour: 19.05, playTime: 0, mouseScale: 1,
  get cash() { return combat.player.cash; },
};

let currentVehicle = null;
let mode = isShot ? 'shot' : 'title';
let elapsed = 0;
let sirenDistance = Infinity;
let chaseScare = 0;
let mouseDown = false;
let aimDown = false;
let deathHandled = false;
let stageCity = null;
let menuRedraw = 0;
const visitedDistricts = new Set(['palm']);
const streetProps = createStreetProps({ world, combat, progression, bus, sfx });
const rig = createCameraRig(world);
const camera = rig.camera;
const keys = new Set();
const pressedKeys = new Set();
const held = (...codes) => codes.some((c) => keys.has(c));

for (const p of world.parked) {
  const car = createVehicle(p.type, p.x, p.z, p.heading, { parked: true });
  car.y = world.groundHeight(p.x, p.z) + 0.02;
  parkedVehicles.push(car);
}

function allVehicles() {
  return parkedVehicles.concat(traffic.cars, police.allCars());
}

function findVehicleNear(x, z, maxDist = 7) {
  let best = null, bestDist = maxDist;
  for (const car of allVehicles()) {
    if (car.removed) continue;
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestDist) { bestDist = d; best = car; }
  }
  return best;
}

/** The city-progress chip; staged shots pin their own numbers. */
function cityProgress() {
  return stageCity ?? {
    districts: visitedDistricts.size,
    tokens: tokens.filter((t) => t.taken).length,
    safehouse: true,
    missions: missions.state.done.filter(Boolean).length,
  };
}

function initAudioOnce() {
  if (!audio.ready) {
    if (audio.init() && audio.station === 0) audio.setRadio(1);
    hud.setRadio(audio.currentStation()?.name ?? null);
  } else if (audio.context?.state === 'suspended') audio.context.resume();
}

/** Open the city menu (map, story, crew, activities, garage, stats, saves); the city waits. */
function openCityMenu(tab = 'map') {
  if (mode !== 'playing' && mode !== 'shot') return;
  if (mode === 'playing') mode = 'menu';
  cityMenu.show(tab);
  cityMenu.render(liveMapState());
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function closeCityMenu() {
  if (mode !== 'menu') return;
  mode = 'playing';
  cityMenu.hide();
}

/** What the HUD's SBPD table and wanted pill read: the live roster and who can see the suspect. */
function policeInfo() {
  return { units: police.getDispatchUnits(), inSight: police.inSight, airLocked: police.airLocked, jammed: police.jammed, label: police.label };
}

/** Everything the minimap and the city map draw, read from the live systems. */
function liveMapState() {
  const p = combat.player;
  return {
    player: p,
    vehicle: currentVehicle,
    policeCars: police.allCars(),
    trafficCars: traffic.cars,
    parkedCars: parkedVehicles,
    waypoint: activities.waypoint() ?? missions.waypoint(),
    checkpoints: activities.checkpoints,
    helicopter: police.helicopter,
    roadblocks: police.roadblocks,
    turf: turf.state.standing,
    activityStarts: activities.active ? [] : activities.ACTIVITIES,
    subtitle: `${world.districtName(p.x, p.z)} · ${clockAt(game.hour)} · ${timeNameAt(game.hour)}`,
  };
}

function respawnPlayer() {
  const p = combat.player;
  const activeIndex = missions.active ? missions.index : -1;
  Object.assign(p, { dead: false, health: 100, armor: 25, cash: Math.max(0, p.cash - 500), x: SAFEHOUSE.x + 16, z: SAFEHOUSE.z + 16 });
  Object.assign(p, { y: world.groundHeight(p.x, p.z), velocityX: 0, velocityZ: 0, inVehicle: null, cover: null });
  deathHandled = false;
  currentVehicle = null;
  police.clear();
  combat.clearEnemies();
  if (activeIndex >= 0) missions.startMission(activeIndex, false);
  rig.yaw = Math.PI;
  hud.notify('Patched up at the Safehouse · -$500', 'warn', 4000);
}

// ---------------------------------------------------------------------------
// Car theft: any civilian car within reach, parked or in traffic; cruisers stay locked.
// ---------------------------------------------------------------------------
function enterVehicle(car) {
  if (!car || mode !== 'playing' || currentVehicle) return;
  if (car.police) { hud.notify('Police cruiser is locked', 'warn', 2000); return; }
  if (car.wrecked) { hud.notify('That car is done', 'warn', 1800); return; }
  const fromTraffic = car.traffic;
  if (fromTraffic) traffic.removeCar(car);
  if (!parkedVehicles.includes(car) && (fromTraffic || !car.staged)) parkedVehicles.push(car);
  Object.assign(car, { parked: true, driver: 'player', sirenOn: false, health: Math.max(car.health, 60) });
  progression.tuneVehicle(car);
  if (!car.playerOwned) {
    car.playerOwned = true;
    progression.count('stolen');
    progression.addRespect(10);
  }
  currentVehicle = car;
  const p = combat.player;
  Object.assign(p, { inVehicle: car, cover: null, x: car.x, z: car.z, heading: car.heading });
  rig.yaw = car.heading;
  rig.offsetYaw = 0;
  sfx('playHorn');
  hud.showPrompt(null);
  hud.notify(`${car.spec.name.toUpperCase()} ACQUIRED`, 'mission', 2200);
  if (police.wanted === 0 && !car.mission) police.raise(1, 'Car theft');
  hud.setPlaying(true, true);
  hud.setHint('W / S THROTTLE · A / D STEER · SHIFT NITRO · SPACE HANDBRAKE · E / F EXIT · R RADIO · ESC PAUSE');
}

function exitVehicle() {
  if (!currentVehicle) return;
  const car = currentVehicle;
  const p = combat.player;
  const rx = Math.cos(car.heading) * 2.5, rz = -Math.sin(car.heading) * 2.5;
  let x = car.x + rx, z = car.z + rz;
  if (world.collideCircle(x, z, 0.5).hit) { x = car.x - rx; z = car.z - rz; }
  Object.assign(p, { x, z, y: world.groundHeight(x, z), inVehicle: null, velocityX: 0, velocityZ: 0 });
  Object.assign(car, { driver: null, speed: 0, velocityX: 0, velocityZ: 0, parked: true });
  currentVehicle = null;
  rig.yaw = car.heading;
  hud.setPlaying(true, false);
  hud.showPrompt(null);
}

function promptForPlayer() {
  if (currentVehicle) return `Exit ${currentVehicle.spec.name}`;
  if (combat.player.inVehicle) return null;
  const near = findVehicleNear(combat.player.x, combat.player.z, 6);
  if (!near) return null;
  return near.police ? 'Police cruiser locked' : `Steal ${near.spec.name}`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'KeyX', 'KeyZ', 'KeyH', 'KeyP', 'KeyQ', 'KeyC', 'KeyT',
  'ShiftLeft', 'ShiftRight', 'Space', 'Escape', 'Tab', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

window.addEventListener('keydown', (event) => {
  const code = event.code;
  if (GAME_KEYS.has(code)) event.preventDefault();
  keys.add(code);
  if (event.repeat) return;
  pressedKeys.add(code);
  initAudioOnce();
  if (code === 'KeyM' || code === 'Tab') {
    if (isShot) return;
    if (mode === 'playing') openCityMenu('map');
    else if (mode === 'menu') closeCityMenu();
    return;
  }
  if (code === 'Escape') {
    if (isShot) return;
    if (mode === 'menu') closeCityMenu();
    else if (mode === 'playing') glue.pauseGame();
    else if (mode === 'paused') glue.resumeGame();
    else if (!document.getElementById('controlsScreen').classList.contains('hidden')) hud.showControls(false);
    else if (!document.getElementById('slotsScreen').classList.contains('hidden')) hud.showSlots(false);
    return;
  }
  const titleOverlayOpen = () => !document.getElementById('controlsScreen').classList.contains('hidden')
    || !document.getElementById('slotsScreen').classList.contains('hidden');
  if (code === 'KeyP' && mode === 'playing') { glue.pauseGame(); return; }
  if (code === 'Enter') {
    if (mode === 'title') {
      if (titleOverlayOpen()) return;
      event.preventDefault();
      glue.continueGame();
    } else if (mode === 'paused') glue.resumeGame();
    return;
  }
  if (mode === 'title' && code === 'Space') {
    if (!titleOverlayOpen()) {
      event.preventDefault();
      glue.continueGame();
    }
    return;
  }
  if (mode !== 'playing' || isShot) return;

  if (code === 'KeyR' && !currentVehicle) {
    combat.reload();
  } else if (code === 'KeyR') {
    audio.nextStation();
    const st = audio.currentStation();
    hud.setRadio(st?.name ?? null);
    hud.notify(st ? `${st.name} · ${st.genre}` : 'Radio off', 'mission', 2400);
  } else if (code === 'KeyZ') {
    crew.useAbility('jam');
  } else if (code === 'KeyX') {
    crew.useAbility('patch');
  } else if (code === 'KeyC' && currentVehicle) {
    crew.useAbility('nitro');
  } else if (code === 'KeyE' || code === 'KeyF') {
    if (currentVehicle) exitVehicle();
    else {
      const near = findVehicleNear(combat.player.x, combat.player.z, 6.5);
      if (near) enterVehicle(near);
      else hud.notify('No vehicle within reach', 'warn', 1600);
    }
  } else if (code === 'KeyQ' || code === 'KeyC') {
    if (!currentVehicle) combat.toggleCover();
  } else if (code === 'KeyT') {
    crew.toggle('mateo');
  } else if (code === 'KeyH') {
    if (currentVehicle) sfx('playHorn');
  } else if (/^Digit[1-5]$/.test(code)) {
    if (!currentVehicle) combat.switchWeapon(Number(code.slice(-1)));
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; aimDown = false; });

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  initAudioOnce();
  if (isShot) return;
  if (event.button === 2) { aimDown = true; return; }
  if (event.button !== 0) return;
  if (mode === 'playing' && event.pointerType !== 'touch' && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
    canvas.requestPointerLock();
    return;
  }
  mouseDown = true;
  pressedKeys.add('Mouse0');
});
window.addEventListener('pointerup', (event) => {
  if (event.button === 0 || event.pointerType === 'touch') mouseDown = false;
  if (event.button === 2) aimDown = false;
});
window.addEventListener('mousemove', (event) => {
  if (isShot || mode !== 'playing') return;
  if (document.pointerLockElement !== canvas && !aimDown && !mouseDown) return;
  const dx = event.movementX ?? 0, dy = event.movementY ?? 0;
  if (currentVehicle) {
    rig.offsetYaw = clamp(rig.offsetYaw - dx * 0.0026 * game.mouseScale, -2.2, 2.2);
    rig.pitch = clamp(rig.pitch + dy * 0.0016 * game.mouseScale, -0.15, 0.55);
  } else {
    rig.yaw -= dx * 0.0031 * game.mouseScale;
    rig.pitch = clamp(rig.pitch + dy * 0.0022 * game.mouseScale, -0.34, 0.92);
  }
});
window.addEventListener('resize', () => renderer.resize());

function updateCamera(dt) {
  if (mode === 'title' || mode === 'shot') return;
  if (currentVehicle) rig.followCar(currentVehicle, dt, elapsed);
  else rig.followOnFoot(combat.player, dt, elapsed, aimDown || mouseDown);
}

// ---------------------------------------------------------------------------
// One 60 Hz step of the city
// ---------------------------------------------------------------------------
function driveStep(car, dt) {
  const p = combat.player;
  car.nitroRecharge = crew.nitroRecharge; // Elena on comms tunes the nitro refill.
  const events = updateVehicle(car, {
    throttle: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
    steer: (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0),
    handbrake: keys.has('Space'),
    boost: held('ShiftLeft', 'ShiftRight') || crew.surging,
  }, dt, world);
  for (const ev of events) {
    if (ev === 'crash' || ev === 'crashHard') { sfx('playCrash', ev === 'crashHard' ? 1.1 : 0.6); rig.shake = 0.35; }
    else if (ev === 'stunt') {
      hud.notify('STUNT AIR · +$150', 'cash', 2200);
      p.cash += 150;
      progression.count('stunts');
      progression.addRespect(15);
      sfx('playStunt');
    } else if (ev === 'splash') { sfx('playSplash'); hud.notify('Engine flooded — get out of the water', 'warn', 2600); }
    else if (ev === 'landing') rig.shake = 0.4;
  }
  Object.assign(p, { x: car.x, z: car.z, y: car.y, heading: car.heading });
  if (car.health <= 0 || car.wrecked) {
    sfx('playExplosion');
    hud.notify('Vehicle destroyed', 'wanted', 2600);
    combat.hurtPlayer(18);
    exitVehicle();
    Object.assign(car, { health: 0, wrecked: true, smoke: 1 });
    return;
  }
  rig.offsetYaw = lerp(rig.offsetYaw, 0, clamp(dt * 0.6, 0, 1));
  if (Math.abs(car.speed) <= 6) return;
  for (const ped of traffic.pedestrians) {
    if (ped.panic > 0 || Math.hypot(ped.x - car.x, ped.z - car.z) >= 2.2) continue;
    ped.panic = 4;
    ped.panicDir = Math.atan2(ped.x - car.x, ped.z - car.z);
    traffic.panicAt(car.x, car.z, 16);
    hud.notify('Pedestrian clipped', 'warn', 1800);
    police.raise(1, 'Hit and run');
    car.speed *= 0.88;
    sfx('playCrash', 0.4);
  }
}

function collectPickups(dt) {
  const p = combat.player;
  for (const token of tokens) {
    if (token.taken || Math.hypot(p.x - token.x, p.z - token.z) >= 2.4) continue;
    token.taken = true;
    p.cash += 250;
    progression.addRespect(25);
    hud.notify('+$250 · SUN TOKEN', 'cash', 2600);
    bus.pickup(token.x, 1.2, token.z, PALETTE.gold);
    sfx('playPickup', 'cash');
    glue.refreshTitle();
  }
  for (const pickup of pickups) {
    if (pickup.taken) {
      pickup.respawn -= dt;
      if (pickup.respawn <= 0) pickup.taken = false;
      continue;
    }
    if (Math.hypot(p.x - pickup.x, p.z - pickup.z) >= 1.9) continue;
    pickup.taken = true;
    pickup.respawn = 45;
    const health = pickup.type === 'health';
    if (health) p.health = Math.min(p.maxHealth, p.health + 50);
    else p.armor = Math.min(p.maxArmor, p.armor + 60);
    hud.notify(health ? '+50 HEALTH' : '+60 ARMOUR', 'mission', 2200);
    bus.pickup(pickup.x, 1, pickup.z, health ? PALETTE.health : PALETTE.armor);
    sfx('playPickup', pickup.type);
  }
}

/** The nearest wailing cruiser heard from the camera: stereo pan and Doppler closing speed. */
function sirenMix(sirens) {
  let pan = 0, closing = 0, best = Infinity;
  const lx = camera.pos[0], lz = camera.pos[2];
  const camYaw = Math.atan2(camera.target[0] - lx, camera.target[2] - lz);
  for (const cop of sirens) {
    const dx = cop.x - lx, dz = cop.z - lz;
    const d = Math.hypot(dx, dz);
    if (d >= best || d < 0.01) continue;
    best = d;
    pan = -Math.sin(Math.atan2(dx, dz) - camYaw);
    const lvx = currentVehicle?.velocityX ?? 0, lvz = currentVehicle?.velocityZ ?? 0;
    const cvx = Math.sin(cop.heading) * (cop.speed ?? 0), cvz = Math.cos(cop.heading) * (cop.speed ?? 0);
    closing = -((cvx - lvx) * dx + (cvz - lvz) * dz) / d;
  }
  return { pan, closing };
}

function updateGame(dt) {
  tickTyreFx(dt);
  streetProps.update(dt, currentVehicle);
  game.playTime += dt;
  game.hour = (game.hour + dt * 0.0085) % 24;
  hud.setSoundLabel(!audio.muted);
  const p = combat.player;
  const district = world.districtAt(p.x, p.z);
  if (district !== 'beach') visitedDistricts.add(district === 'commercial' ? 'midtown' : district);
  if (currentVehicle) driveStep(currentVehicle, dt);
  else {
    if (keys.has('ArrowLeft')) rig.yaw += dt * 1.8;
    if (keys.has('ArrowRight')) rig.yaw -= dt * 1.8;
    if (keys.has('ArrowUp')) rig.pitch = clamp(rig.pitch - dt * 0.7, -0.34, 0.92);
    if (keys.has('ArrowDown')) rig.pitch = clamp(rig.pitch + dt * 0.7, -0.34, 0.92);
  }
  const foot = !currentVehicle;
  const input = {
    forward: foot && keys.has('KeyW'), back: foot && keys.has('KeyS'),
    left: foot && keys.has('KeyA'), right: foot && keys.has('KeyD'),
    sprint: held('ShiftLeft', 'ShiftRight'),
    jump: foot && pressedKeys.has('Space'),
    fire: foot && mouseDown,
    firePressed: foot && pressedKeys.has('Mouse0'),
    aim: foot && (aimDown || mouseDown),
    reloadPressed: false, // R reloads through combat.reload() in the key handler
    switchWeapon: 0,
  };
  for (let i = 1; i <= 5; i += 1) if (pressedKeys.has(`Digit${i}`)) input.switchWeapon = i;
  combat.update(dt, input, rig.yaw, { aim: input.aim });
  pressedKeys.clear();
  crew.update(dt);
  turf.update(dt);

  police.update(dt, combat.player, currentVehicle);
  const sirens = police.allCars().filter((c) => c.sirenOn && !c.wrecked);
  traffic.update(dt, combat.player, currentVehicle, police.wanted > 0 && sirenDistance < 90, sirens);
  // A three-star chase tearing down the street scatters the pavements as it passes.
  chaseScare -= dt;
  if (currentVehicle && police.wanted >= 3 && Math.abs(currentVehicle.speed) > 10 && chaseScare <= 0) {
    chaseScare = 0.6;
    traffic.panicAt(currentVehicle.x, currentVehicle.z, 24);
  }
  collectPickups(dt);
  missions.update(dt);
  activities.update(dt);
  // Rolling slowly into the Safehouse Garage stores the car in the collection.
  const car = currentVehicle;
  if (car && !car.storedChecked && Math.abs(car.speed) < 4 && Math.hypot(car.x - SAFEHOUSE.x, car.z - (SAFEHOUSE.z + 12)) < 9) {
    car.storedChecked = true;
    progression.storeVehicle(car);
  }
  if (p.dead && !deathHandled) { deathHandled = true; exitVehicle(); }

  updateCamera(dt);
  const mix = sirenMix(sirens);
  audio.update(dt, {
    inVehicle: currentVehicle,
    throttle: currentVehicle ? (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) : 0,
    handbrake: !!currentVehicle && keys.has('Space'),
    drifting: currentVehicle?.drift ?? 0,
    sirenDist: sirenDistance, sirenPan: mix.pan, sirenClosing: mix.closing,
    wanted: police.wanted,
  });
  hud.update({
    ...liveMapState(),
    weapon: combat.currentWeapon(),
    ammo: combat.currentAmmo(),
    wanted: police.wanted,
    evasion: police.evasion,
    district: world.districtName(p.x, p.z),
    clock: clockAt(game.hour),
    timeName: timeNameAt(game.hour),
    radio: audio.currentStation()?.name ?? null,
    prompt: promptForPlayer(),
    aiming: aimDown || mouseDown,
    mission: missions.active ? missions.mission : null,
    objectiveText: missions.objectiveText(),
    missionStep: missions.stepIndex,
    missionTotal: missions.mission?.steps.length,
    missionProgress: missions.progress,
    activity: activities.hudInfo(),
    crew: crew.roster(),
    abilities: crew.abilities(),
    police: policeInfo(),
    tokens: tokens.filter((t) => t.taken).length,
    city: cityProgress(),
    envName: envAtHour(game.hour).name,
    moving: Math.hypot(p.velocityX, p.velocityZ),
  });
  hud.setRadio(audio.currentStation()?.name ?? null);
}

function renderFrame() {
  const env = envAtHour(game.hour);
  const scene = buildDynamicScene({
    time: elapsed, camera, env, world, traffic, combat, missions, activities, police, crew, tokens, pickups,
    vehicles: allVehicles(),
    playerVehicle: currentVehicle,
    aiming: aimDown || mouseDown || isShot,
    showSafehouse: !missions.active && !isShot,
  });
  renderer.renderFrame({ camera, env, time: elapsed, statics: world.meshes, dynamic: scene.geometry, glow: scene.glows, shadows: scene.shadows });
}

// ---------------------------------------------------------------------------
// Main loop: fixed 60 Hz simulation, render every animation frame.
// ---------------------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;
let ready = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.2, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;
  if (isShot) {
    glue.shotFrame(elapsed);
    renderFrame();
    return;
  }
  if (mode === 'title') {
    rig.titleOrbit(elapsed);
    hud.setPlaying(false, false);
    audio.update(dt, { wanted: 0 });
  } else if (mode === 'playing') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 12) {
      updateGame(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === 12) accumulator = 0;
  } else {
    accumulator = 0;
    updateCamera(dt);
    hud.setPlaying(true, !!currentVehicle);
    audio.update(dt, { wanted: 0 });
    if (mode === 'menu' && (menuRedraw += 1) % 6 === 1) cityMenu.render(liveMapState());
  }
  renderer.resize();
  renderFrame();
  if (!ready) { ready = true; hud.showLoadingDone(); }
}

// Everything the menus, photo mode and the test hooks in stage_glue.js reach for.
const glue = createStageGlue({
  canvas, isShot, shotName, renderer, world, audio, save, hud, bus, traffic, combat, police, turf, crew, missions,
  progression, activities, cityMenu, game, rig, camera, parkedVehicles, tokens, keys, pressedKeys,
  get mode() { return mode; }, set mode(v) { mode = v; },
  get vehicle() { return currentVehicle; }, set vehicle(v) { currentVehicle = v; },
  set deathHandled(v) { deathHandled = v; },
  set stageCity(v) { stageCity = v; },
  get mouse() { return { mouseDown, aimDown }; },
  initAudioOnce, openCityMenu, closeCityMenu, liveMapState, policeInfo, cityProgress, findVehicleNear, enterVehicle,
  updateGame, updateCamera, renderFrame,
});
window.addEventListener('load', () => renderer.resize());
glue.boot();
requestAnimationFrame(frame);

import { createStreetProps } from './streetprops.js';
import { createStageGlue } from './stage_glue.js';
