// main.js — boot, the fixed 60 Hz loop, input, follow camera and the title / play /
// pause / city-menu state machine. It wires the renderer, city, traffic, police,
// combat, missions, side activities, progression, audio, HUD, city menu, save slots
// and photo mode together; nothing here reaches the network.

import { PALETTE, SAFEHOUSE, STEP, clamp, createRandom, lerp } from './config.js';
import { createRenderer, cross3, normalize3 } from './renderer3d.js';
import { createWorld } from './world.js';
import { envAtHour, timeNameAt, clockAt } from './daycycle.js';
import { createVehicle, updateVehicle } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions, MISSIONS } from './missions.js';
import { createActivities } from './activities.js';
import { createProgression } from './progression.js';
import { buildDynamicScene } from './scene.js';
import { createCameraRig } from './camera.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createCityMenu } from './citymenu.js';
import { createShotStage } from './shotstage.js';
import { createSave, snapshot, applySnapshot } from './save.js';

const canvas = document.getElementById('game');
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const isShot = !!shotName;
const random = createRandom(0x50a1b9);

const renderer = createRenderer(canvas);
const world = createWorld(renderer);
const audio = createAudio();
const save = createSave();
const hud = createHud({ onAction: handleAction, world });
const parkedVehicles = [];
const tokens = world.tokens;
const pickups = world.pickups;
// The event bus is built before the systems so each one receives the live object:
// they keep the reference they are handed, so a later assignment would never reach them.
const bus = {
  onWanted: (level, reason) => {
    hud.notify(level === 0 ? 'Wanted level cleared' : `${level}-star response${reason ? ` · ${reason}` : ''}`, level >= 3 ? 'wanted' : 'warn');
    if (audio.ready) audio.playWanted();
    hud.flashDamage();
  },
  onWantedCool: (level) => {
    hud.notify(level === 0 ? 'You lost the cops' : `Heat cooling · ${level} star${level === 1 ? '' : 's'} left`, 'mission');
  },
  onEvaded: () => {
    hud.notify('EVADED · wanted level clear', 'mission');
    progression.count('evaded');
    progression.addRespect(50, 'EVADED');
  },
  onPoliceSpawned: () => {},
  onOfficers: () => hud.notify('Officers deploying', 'wanted', 2200),
  onWreck: () => hud.notify('Cruiser disabled', 'mission', 2200),
  onCrash: (car, kind) => {
    if (audio.ready && kind !== 'citizen') audio.playCrash(kind === 'ram' ? 0.8 : 0.5);
  },
  onSirenLevel: (dist) => { sirenDistance = dist; },
  onGunshot: (kind) => {
    traffic.panicAt(combat.player.x, combat.player.z, 40);
    if (police.wanted === 0) police.raise(1, 'Shots fired');
    else if (police.wanted < 3 && Math.random() < 0.12) police.raise(1, 'Shots fired');
  },
  onShotFired: (spec) => {
    if (audio.ready) audio.playShot(spec.id);
  },
  onMelee: () => { if (audio.ready) audio.playCrash(0.35); },
  onReload: () => { if (audio.ready) audio.playUI(); },
  onHitEnemy: () => hud.hitmarker(),
  onKill: (enemy) => {
    hud.hitmarker();
    progression.count('takedowns');
    if (enemy.police) police.raise(2, 'Officer down');
    else if (!enemy.mission && police.wanted < 4) police.raise(1, 'Homicide');
    if (audio.ready) audio.playPickup('cash');
  },
  onPlayerHurt: (amount) => {
    hud.flashDamage();
    if (audio.ready) audio.playCrash(0.3);
    hud.announce(`Hurt. ${Math.ceil(amount)} damage.`);
  },
  onPlayerDeath: () => {
    hud.notify('WASTED · medical bill $500', 'wanted', 5000);
    if (audio.ready) audio.playExplosion();
    setTimeout(() => respawnPlayer(), 1700);
  },
  onCarHurt: () => hud.flashDamage(),
  onCombatState: () => {},
  onEnemyShot: () => {},
  onWeapon: (weapon) => {
    hud.notify(weapon.name.toUpperCase(), 'info', 1500);
    if (audio.ready) audio.playUI();
  },
  onCrate: () => { if (audio.ready) audio.playPickup('cash'); },
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
    const next = MISSIONS[missions.index + 1];
    hud.missionComplete(mission, reward, next?.name);
    if (audio.ready) audio.playMission();
    save.write('auto', snapshot(game));
    refreshTitle();
    if (missions.state.storyComplete) {
      setTimeout(() => showStoryComplete(), 700);
    }
  },
  storyComplete: () => {
    save.write('auto', snapshot(game));
    refreshTitle();
  },
  findVehicleNear: (x, z, maxDist) => findVehicleNear(x, z, maxDist),
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
// The systems are built after the bus and each keeps the live reference it is given.
const traffic = createTraffic(world, { seed: 0x7ad10c });
const combat = createCombat(world, bus);
const police = createPolice(world, combat, bus);
const missions = createMissions({ world, combat, police, bus });
const progression = createProgression({ combat, bus });
const activities = createActivities({ combat, bus, progression });
const cityMenu = createCityMenu({ painter: hud.painter, missions, activities, progression, combat, police });

const game = {
  renderer, world, audio, combat, traffic, police, missions, activities, progression, hud, save,
  tokens, pickups, hour: 18.62, playTime: 0,
  get cash() { return combat.player.cash; },
};

let currentVehicle = null;
let mode = isShot ? 'shot' : 'title';
let playTime = 0;
let elapsed = 0;
let sirenDistance = Infinity;
let mouseDown = false;
let aimDown = false;
let moduleReady = false;
let lastCrimeAt = -9;
let deathHandled = false;
const visitedDistricts = new Set(['palm']);
let stageCity = null;
let menuRedraw = 0;

/** Everything the city-progress chip needs; staged shots pin their own numbers. */
function cityProgress() {
  if (stageCity) return stageCity;
  return {
    districts: visitedDistricts.size,
    tokens: tokens.filter((t) => t.taken).length,
    safehouse: true,
    missions: missions.state.done.filter(Boolean).length,
  };
}

const rig = createCameraRig(world);
const camera = rig.camera;

const keys = new Set();
const pressedKeys = new Set();
const titleCameraStart = performance.now();
let shotReadyFrames = 0;

// ---------------------------------------------------------------------------
// Boot: parked cars
// ---------------------------------------------------------------------------
for (const p of world.parked) {
  const car = createVehicle(p.type, p.x, p.z, p.heading, { parked: true });
  car.y = world.groundHeight(p.x, p.z) + 0.02;
  parkedVehicles.push(car);
}

function allVehicles() {
  const list = parkedVehicles.slice();
  for (const car of traffic.cars) list.push(car);
  for (const car of police.allCars()) list.push(car);
  return list;
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

function canEnter(car) {
  return car && !car.police;
}

function getEnv() {
  return envAtHour(game.hour);
}

// ---------------------------------------------------------------------------
// Actions & menus
// ---------------------------------------------------------------------------
function initAudioOnce() {
  if (!audio.ready) {
    const ok = audio.init();
    if (ok && audio.station === 0) audio.setRadio(1);
    hud.setRadio(audio.currentStation()?.name ?? null);
  } else if (audio.context?.state === 'suspended') {
    audio.context.resume();
  }
}

function newGame(startMission = true) {
  initAudioOnce();
  mode = 'playing';
  hud.showTitle(false);
  hud.showPause(false);
  hud.hideStoryComplete();
  hud.hideMissionPopup();
  hud.setPlaying(true, false);
  combat.reset(world.spawn.x, world.spawn.z);
  const p = combat.player;
  p.cash = 640;
  p.weapons = ['fists', 'pistol'];
  p.weaponSlot = 2;
  p.ammo.pistol.mag = 12;
  p.ammo.pistol.reserve = 96;
  p.ammo.smg.mag = 30;
  p.ammo.smg.reserve = 180;
  p.ammo.shotgun.mag = 6;
  p.ammo.shotgun.reserve = 36;
  police.clear();
  missions.reset();
  combat.clearEnemies();
  for (const token of tokens) token.taken = false;
  for (const pickup of pickups) { pickup.taken = false; pickup.respawn = 0; }
  progression.reset();
  activities.reset();
  game.hour = 18.62;
  game.playTime = 0;
  playTime = 0;
  currentVehicle = null;
  rig.yaw = Math.PI;
  rig.pitch = 0.17;
  deathHandled = false;
  if (startMission) {
    missions.startMission(0, true);
  }
  hud.notify('Welcome to Solaris Bay', 'mission', 3000);
  hud.setHint('WASD MOVE · SHIFT SPRINT · E / F STEAL A CAR · R RADIO · ESC PAUSE');
  save.write('auto', snapshot(game));
  refreshTitle();
}

function continueGame() {
  const data = save.latest();
  if (!data) {
    newGame();
    return;
  }
  initAudioOnce();
  mode = 'playing';
  hud.showTitle(false);
  hud.showPause(false);
  hud.hideStoryComplete();
  hud.setPlaying(true, false);
  combat.reset(world.spawn.x, world.spawn.z);
  applySnapshot(game, data);
  const p = combat.player;
  currentVehicle = null;
  p.inVehicle = null;
  if (p.x === undefined) p.x = world.spawn.x;
  rig.yaw = Math.PI;
  rig.pitch = 0.17;
  deathHandled = false;
  police.clear();
  combat.clearEnemies();
  const next = MISSIONS.findIndex((_, i) => !missions.state.done[i]);
  if (next >= 0 && !missions.state.storyComplete) {
    missions.startMission(next, true);
  } else {
    hud.notify('Story complete · free roam', 'mission', 4000);
  }
  hud.notify('Save loaded', 'mission', 2600);
  refreshTitle();
}

function quitToTitle() {
  mode = 'title';
  currentVehicle = null;
  combat.player.inVehicle = null;
  hud.showPause(false);
  hud.hideStoryComplete();
  hud.setPlaying(false, false);
  hud.showTitle(true);
  refreshTitle();
}

function refreshTitle() {
  const slots = save.list();
  const latest = save.latest();
  hud.setTitle({
    progress: missions.progress,
    cash: combat.player.cash,
    tokens: tokens.filter((t) => t.taken).length,
    peak: Math.max(police.peak, police.wanted),
    hasSave: slots.some((s) => s.exists) || (mode === 'title' && isShot),
    saveLabel: latest ? `MISSION ${Math.min(5, (latest.progress ?? 0) + 1)} · $${(latest.cash ?? 0).toLocaleString('en-US')}` : 'LATEST SAVE',
    storyComplete: missions.state.storyComplete,
  });
}

function pauseGame() {
  if (mode !== 'playing') return;
  mode = 'paused';
  hud.showPause(true);
  hud.refreshSlots(save.list(), {
    cash: combat.player.cash,
    subtitle: `${world.districtName(combat.player.x, combat.player.z)} · ${timeNameAt(game.hour)} · ${clockAt(game.hour)}`,
  });
  hud.setSoundLabel(!audio.muted);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function resumeGame() {
  if (mode !== 'paused') return;
  mode = 'playing';
  hud.showPause(false);
}

/** Open the city menu (map, story, activities, garage, stats); the city waits. */
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
    activityStarts: activities.active ? [] : activities.ACTIVITIES,
    subtitle: `${world.districtName(p.x, p.z)} · ${clockAt(game.hour)} · ${timeNameAt(game.hour)}`,
  };
}

function showStoryComplete() {
  mode = 'story';
  hud.showStoryComplete({
    cash: combat.player.cash,
    respect: combat.player.respect,
    peak: Math.max(police.peak, police.wanted),
    tokens: tokens.filter((t) => t.taken).length,
  });
  hud.hideMissionPopup();
}

function handleAction(action, data) {
  initAudioOnce();
  if (audio.ready) audio.playUI();
  switch (action) {
    case 'new': newGame(true); break;
    case 'continue': continueGame(); break;
    case 'controls': hud.showControls(true); break;
    case 'closeControls': hud.showControls(false); break;
    case 'resume': resumeGame(); break;
    case 'restart': newGame(true); break;
    case 'quit': quitToTitle(); break;
    case 'freeRoam': mode = 'playing'; hud.hideStoryComplete(); break;
    case 'menuTab': cityMenu.setTab(data.tab); break;
    case 'closeMenu': closeCityMenu(); break;
    case 'buyUpgrade':
      if (progression.buyUpgrade(data.upgrade) && currentVehicle) progression.tuneVehicle(currentVehicle);
      cityMenu.render(liveMapState());
      break;
    case 'toggleSound':
      audio.setMuted(!audio.muted);
      hud.setSoundLabel(!audio.muted);
      hud.notify(audio.muted ? 'Sound muted' : 'Sound on', 'info', 1800);
      break;
    case 'saveSlot': {
      if (save.write(data.slot, snapshot(game))) {
        hud.notify(`Saved to slot ${data.slot}`, 'mission', 2500);
      } else {
        hud.notify('Could not save (storage blocked)', 'warn', 3000);
      }
      hud.refreshSlots(save.list(), { cash: combat.player.cash });
      refreshTitle();
      break;
    }
    case 'loadSlot': {
      const payload = save.read(data.slot);
      if (payload) {
        combat.reset(world.spawn.x, world.spawn.z);
        applySnapshot(game, payload);
        currentVehicle = null;
        combat.player.inVehicle = null;
        rig.yaw = Math.PI;
        mode = 'playing';
        hud.showPause(false);
        hud.showTitle(false);
        hud.setPlaying(true, false);
        combat.clearEnemies();
        police.clear();
        const next = MISSIONS.findIndex((_, i) => !missions.state.done[i]);
        if (next >= 0 && !missions.state.storyComplete) missions.startMission(next, true);
        hud.notify('Save loaded', 'mission', 2500);
      } else {
        hud.notify('That slot is empty', 'warn', 2500);
      }
      break;
    }
    default: break;
  }
}

function respawnPlayer() {
  const p = combat.player;
  p.dead = false;
  deathHandled = false;
  p.health = Math.min(100, 100);
  p.armor = 25;
  p.cash = Math.max(0, p.cash - 500);
  p.x = SAFEHOUSE.x + 16;
  p.z = SAFEHOUSE.z + 16;
  p.y = world.groundHeight(p.x, p.z);
  p.velocityX = 0;
  p.velocityZ = 0;
  p.inVehicle = null;
  currentVehicle = null;
  police.clear();
  combat.clearEnemies();
  rig.yaw = Math.PI;
  hud.notify('Patched up at the Safehouse · -$500', 'warn', 4000);
}

// ---------------------------------------------------------------------------
// Vehicles: enter / exit
// ---------------------------------------------------------------------------
function enterVehicle(car) {
  if (!car || mode !== 'playing' || currentVehicle) return;
  if (car.police) {
    hud.notify('Police cruiser is locked', 'warn', 2000);
    return;
  }
  if (car.wrecked) {
    hud.notify('That car is done', 'warn', 1800);
    return;
  }
  if (car.traffic) {
    traffic.removeCar(car);
    if (!parkedVehicles.includes(car)) parkedVehicles.push(car);
  }
  if (!parkedVehicles.includes(car) && !car.staged) parkedVehicles.push(car);
  car.parked = true;
  car.driver = 'player';
  car.sirenOn = false;
  car.health = Math.max(car.health, 60);
  progression.tuneVehicle(car);
  if (!car.playerOwned) {
    car.playerOwned = true;
    progression.count('stolen');
    progression.addRespect(10);
  }
  currentVehicle = car;
  const p = combat.player;
  p.inVehicle = car;
  p.x = car.x;
  p.z = car.z;
  p.heading = car.heading;
  rig.yaw = car.heading;
  rig.offsetYaw = 0;
  if (audio.ready) audio.playHorn();
  hud.showPrompt(null);
  hud.notify(`${car.spec.name.toUpperCase()} ACQUIRED`, 'mission', 2200);
  if (police.wanted === 0 && !car.mission) police.raise(1, 'Car theft');
  hud.setPlaying(true, true);
  const hints = 'W / S THROTTLE · A / D STEER · SHIFT NITRO · SPACE HANDBRAKE · E / F EXIT · R RADIO · ESC PAUSE';
  hud.setHint(hints);
}

function exitVehicle() {
  if (!currentVehicle) return;
  const car = currentVehicle;
  const p = combat.player;
  const side = 1;
  const rx = Math.cos(car.heading) * 2.5 * side;
  const rz = -Math.sin(car.heading) * 2.5 * side;
  let x = car.x + rx;
  let z = car.z + rz;
  const hit = world.collideCircle(x, z, 0.5);
  if (hit.hit) { x = car.x - rx; z = car.z - rz; }
  p.x = x;
  p.z = z;
  p.y = world.groundHeight(x, z);
  p.inVehicle = null;
  p.velocityX = 0;
  p.velocityZ = 0;
  car.driver = null;
  car.speed = 0;
  car.velocityX = 0;
  car.velocityZ = 0;
  car.parked = true;
  currentVehicle = null;
  rig.yaw = car.heading;
  hud.setPlaying(true, false);
  hud.showPrompt(null);
}

function promptForPlayer() {
  const p = combat.player;
  if (currentVehicle) return `Exit ${currentVehicle.spec.name}`;
  if (p.inVehicle) return null;
  const near = findVehicleNear(p.x, p.z, 6);
  if (near && !near.police) return `Steal ${near.spec.name}`;
  if (near && near.police) return 'Police cruiser locked';
  return null;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'KeyX', 'KeyH', 'KeyP',
  'ShiftLeft', 'ShiftRight', 'Space', 'Escape', 'Tab', 'KeyM',
  'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
]);

window.addEventListener('keydown', (event) => {
  if (GAME_KEYS.has(event.code)) event.preventDefault();
  if (event.repeat) {
    keys.add(event.code);
    return;
  }
  keys.add(event.code);
  pressedKeys.add(event.code);
  initAudioOnce();

  if (event.code === 'KeyM' || event.code === 'Tab') {
    if (isShot) return;
    if (mode === 'playing') openCityMenu('map');
    else if (mode === 'menu') closeCityMenu();
    return;
  }
  if (event.code === 'Escape') {
    if (isShot) return;
    if (mode === 'menu') { closeCityMenu(); return; }
    if (mode === 'playing') pauseGame();
    else if (mode === 'paused') resumeGame();
    else if (!document.getElementById('controlsScreen').classList.contains('hidden')) {
      hud.showControls(false);
    }
    return;
  }
  if (event.code === 'KeyP' && mode === 'playing') { pauseGame(); return; }
  if (event.code === 'Enter') {
    if (mode === 'title') newGame(true);
    else if (mode === 'paused') resumeGame();
    return;
  }
  if (mode === 'title' && (event.code === 'Space')) newGame(true);
  if (mode !== 'playing' || isShot) return;

  if (event.code === 'KeyR') {
    const station = audio.nextStation();
    hud.setRadio(audio.currentStation()?.name ?? null);
    hud.notify(audio.currentStation() ? `${audio.currentStation().name} · ${audio.currentStation().genre}` : 'Radio off', 'mission', 2400);
    void station;
  } else if (event.code === 'KeyE' || event.code === 'KeyF') {
    if (currentVehicle) exitVehicle();
    else {
      const near = findVehicleNear(combat.player.x, combat.player.z, 6.5);
      if (near) enterVehicle(near);
      else hud.notify('No vehicle within reach', 'warn', 1600);
    }
  } else if (event.code === 'KeyX') {
    if (!currentVehicle) combat.reload();
  } else if (event.code === 'KeyH') {
    if (currentVehicle && audio.ready) audio.playHorn();
  } else if (/^Digit[1-4]$/.test(event.code)) {
    if (!currentVehicle) combat.switchWeapon(Number(event.code.slice(-1)));
  }
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});
window.addEventListener('blur', () => {
  keys.clear();
  mouseDown = false;
  aimDown = false;
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  initAudioOnce();
  if (isShot) return;
  if (event.button === 2) { aimDown = true; return; }
  if (event.button === 0) {
    mouseDown = true;
    pressedKeys.add('Mouse0');
    if (mode === 'playing' && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  }
});
window.addEventListener('pointerup', (event) => {
  if (event.button === 0 || event.pointerType === 'touch') mouseDown = false;
  if (event.button === 2) aimDown = false;
});
window.addEventListener('mousemove', (event) => {
  if (isShot || mode !== 'playing') return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && !aimDown && !mouseDown) return;
  const dx = event.movementX ?? 0;
  const dy = event.movementY ?? 0;
  if (currentVehicle) {
    rig.offsetYaw = clamp(rig.offsetYaw - dx * 0.0026, -2.2, 2.2);
    rig.pitch = clamp(rig.pitch + dy * 0.0016, -0.15, 0.55);
  } else {
    rig.yaw -= dx * 0.0031;
    rig.pitch = clamp(rig.pitch + dy * 0.0022, -0.34, 0.92);
  }
});
window.addEventListener('resize', () => renderer.resize());

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
function updateCamera(dt) {
  if (mode === 'title' || mode === 'shot') return;
  if (currentVehicle) rig.followCar(currentVehicle, dt, elapsed);
  else rig.followOnFoot(combat.player, dt, elapsed, aimDown || mouseDown);
}

function titleCamera() {
  rig.titleOrbit((performance.now() - titleCameraStart) / 1000);
}

// ---------------------------------------------------------------------------
// Game update
// ---------------------------------------------------------------------------
function updateGame(dt) {
  game.playTime += dt;
  playTime += dt;
  game.hour = (game.hour + dt * 0.0085) % 24;
  hud.setSoundLabel(!audio.muted);

  const p = combat.player;
  const driving = !!currentVehicle;
  const district = world.districtAt(p.x, p.z);
  if (district !== 'beach' && district !== 'commercial') visitedDistricts.add(district);
  if (district === 'commercial') visitedDistricts.add('midtown');

  if (driving) {
    const car = currentVehicle;
    const throttle = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const steer = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const events = updateVehicle(car, {
      throttle,
      steer,
      handbrake: keys.has('Space'),
      boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    }, dt, world);
    for (const ev of events) {
      if (ev === 'crash' || ev === 'crashHard') {
        if (audio.ready) audio.playCrash(ev === 'crashHard' ? 1.1 : 0.6);
        rig.shake = 0.35;
      } else if (ev === 'stunt') {
        hud.notify('STUNT AIR · +$150', 'cash', 2200);
        p.cash += 150;
        progression.count('stunts');
        progression.addRespect(15);
        if (audio.ready) audio.playStunt();
      } else if (ev === 'splash') {
        if (audio.ready) audio.playSplash();
        hud.notify('Engine flooded — get out of the water', 'warn', 2600);
      } else if (ev === 'landing') {
        rig.shake = 0.4;
      } else if (ev === 'wrecked') {
        if (audio.ready) audio.playExplosion();
        hud.notify('Vehicle destroyed', 'wanted', 2600);
        p.hurtPlayer(18);
        exitVehicle();
        car.wrecked = true;
        car.smoke = 1;
      }
    }
    p.x = car.x;
    p.z = car.z;
    p.y = car.y;
    p.heading = car.heading;
    car.health = Math.max(0, car.health);
    if (car.health <= 0 && !car.wrecked) {
      car.wrecked = true;
      if (audio.ready) audio.playExplosion();
      p.hurtPlayer(18);
      exitVehicle();
      hud.notify('Vehicle destroyed', 'wanted', 2600);
    }
    rig.offsetYaw = lerp(rig.offsetYaw, 0, clamp(dt * 0.6, 0, 1));
    // Run over pedestrians.
    if (Math.abs(car.speed) > 6) {
      for (const ped of traffic.pedestrians) {
        if (Math.hypot(ped.x - car.x, ped.z - car.z) < 2.2 && ped.panic <= 0) {
          ped.panic = 4;
          ped.panicDir = Math.atan2(ped.x - car.x, ped.z - car.z);
          traffic.panicAt(car.x, car.z, 16);
          hud.notify('Pedestrian clipped', 'warn', 1800);
          police.raise(1, 'Hit and run');
          car.speed *= 0.88;
          if (audio.ready) audio.playCrash(0.4);
        }
      }
    }
  } else {
    // Camera look by keyboard.
    if (keys.has('ArrowLeft')) rig.yaw += dt * 1.8;
    if (keys.has('ArrowRight')) rig.yaw -= dt * 1.8;
    if (keys.has('ArrowUp')) rig.pitch = clamp(rig.pitch - dt * 0.7, -0.34, 0.92);
    if (keys.has('ArrowDown')) rig.pitch = clamp(rig.pitch + dt * 0.7, -0.34, 0.92);
  }

  const input = {
    forward: driving ? false : keys.has('KeyW'),
    back: driving ? false : keys.has('KeyS'),
    left: driving ? false : keys.has('KeyA'),
    right: driving ? false : keys.has('KeyD'),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump: !driving && pressedKeys.has('Space'),
    fire: !driving && mouseDown,
    firePressed: !driving && pressedKeys.has('Mouse0'),
    aim: !driving && (aimDown || mouseDown),
    reloadPressed: !driving && pressedKeys.has('KeyX'),
    switchWeapon: 0,
  };
  for (let i = 1; i <= 4; i += 1) {
    if (pressedKeys.has(`Digit${i}`)) input.switchWeapon = i;
  }
  combat.update(dt, input, rig.yaw, { aim: input.aim });
  pressedKeys.clear();

  police.update(dt, combat.player, currentVehicle);
  traffic.update(dt, combat.player, currentVehicle, police.wanted > 0 && sirenDistance < 90);

  // Pickups & tokens.
  for (const token of tokens) {
    if (token.taken) continue;
    const dx = p.x - token.x, dz = p.z - token.z;
    if (Math.hypot(dx, dz) < 2.4) {
      token.taken = true;
      p.cash += 250;
      p.respect += 25;
      hud.notify('+$250 · SUN TOKEN', 'cash', 2600);
      bus.pickup(token.x, 1.2, token.z, PALETTE.gold);
      if (audio.ready) audio.playPickup('cash');
      refreshTitle();
    }
  }
  for (const pickup of pickups) {
    if (pickup.taken) {
      pickup.respawn -= dt;
      if (pickup.respawn <= 0) pickup.taken = false;
      continue;
    }
    if (Math.hypot(p.x - pickup.x, p.z - pickup.z) < 1.9) {
      pickup.taken = true;
      pickup.respawn = 45;
      if (pickup.type === 'health') {
        p.health = Math.min(p.maxHealth, p.health + 50);
        hud.notify('+50 HEALTH', 'mission', 2200);
      } else {
        p.armor = Math.min(p.maxArmor, p.armor + 60);
        hud.notify('+60 ARMOUR', 'mission', 2200);
      }
      bus.pickup(pickup.x, 1, pickup.z, pickup.type === 'health' ? PALETTE.health : PALETTE.armor);
      if (audio.ready) audio.playPickup(pickup.type);
    }
  }

  missions.update(dt);
  activities.update(dt);
  // Rolling slowly into the Safehouse Garage stores the car in the collection.
  if (currentVehicle && !currentVehicle.storedChecked && Math.abs(currentVehicle.speed) < 4
    && Math.hypot(currentVehicle.x - SAFEHOUSE.x, currentVehicle.z - (SAFEHOUSE.z + 12)) < 9) {
    currentVehicle.storedChecked = true;
    progression.storeVehicle(currentVehicle);
  }

  if (combat.player.dead && !deathHandled) {
    deathHandled = true;
    if (currentVehicle) exitVehicle();
  }
  if (combat.player.dead && combat.player.deathTimer <= 0 && deathHandled) {
    // respawn is scheduled by the death callback
    deathHandled = false;
  }

  updateCamera(dt);
  const env = getEnv();
  const moving = Math.hypot(combat.player.velocityX, combat.player.velocityZ);
  audio.update(dt, {
    inVehicle: currentVehicle,
    throttle: driving ? 1 : 0,
    drifting: currentVehicle?.drift ?? 0,
    sirenDist: sirenDistance,
    wanted: police.wanted,
  });
  hud.update({
    player: combat.player,
    vehicle: currentVehicle,
    weapon: combat.currentWeapon(),
    ammo: combat.currentAmmo(),
    wanted: police.wanted,
    evasion: police.evasion,
    policeCars: police.allCars(),
    trafficCars: traffic.cars,
    parkedCars: parkedVehicles,
    district: world.districtName(combat.player.x, combat.player.z),
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
    waypoint: activities.waypoint() ?? missions.waypoint(),
    checkpoints: activities.checkpoints,
    activity: activities.hudInfo(),
    activityStarts: activities.active ? [] : activities.ACTIVITIES,
    helicopter: police.helicopter,
    tokens: tokens.filter((t) => t.taken).length,
    city: cityProgress(),
    envName: env.name,
    moving,
  });
  hud.setRadio(audio.currentStation()?.name ?? null);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderFrame(dt) {
  const env = getEnv();
  const scene = buildDynamicScene({
    time: elapsed, camera, env, world, traffic, combat, missions, activities, police, tokens, pickups,
    vehicles: allVehicles(),
    playerVehicle: currentVehicle,
    aiming: aimDown || mouseDown || isShot,
    showSafehouse: !missions.active && !isShot,
  });
  renderer.renderFrame({
    camera,
    env,
    time: elapsed,
    statics: world.meshes,
    dynamic: scene.geometry,
    glow: scene.glows,
    shadows: scene.shadows,
  });
  void dt;
}

// ---------------------------------------------------------------------------
// Photo mode: ?shot=<name> stages a moment of play for the screenshots
// ---------------------------------------------------------------------------
const shotStage = createShotStage({
  world, traffic, police, combat, missions, activities, progression, hud, camera, game, parkedVehicles, random,
  setVehicle: (car) => {
    currentVehicle = car;
    combat.player.inVehicle = car;
    if (car) { combat.player.x = car.x; combat.player.z = car.z; combat.player.y = car.y; combat.player.heading = car.heading; }
  },
  setCameraAngles: (yaw, pitch) => { rig.yaw = yaw; rig.pitch = pitch; },
  setStageCity: (city) => { stageCity = city; },
  openMenu: (tab) => openCityMenu(tab),
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.2, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;

  if (isShot) {
    shotStage.frame(elapsed, shotName);
    renderer.resize();
    syncShotHud();
    if (cityMenu.open) cityMenu.render(liveMapState());
    renderFrame(dt);
    shotReadyFrames += 1;
    if (shotReadyFrames > 4 && !window.__shotReady) window.__shotReady = true;
    return;
  }

  if (mode === 'title') {
    titleCamera();
    hud.setPlaying(false, false);
    renderer.resize();
    renderFrame(dt);
    if (!moduleReady) { moduleReady = true; hud.showLoadingDone(); }
    return;
  }

  if (mode === 'playing') {
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
    if (mode === 'menu' && (menuRedraw += 1) % 6 === 1) cityMenu.render(liveMapState());
  }
  renderer.resize();
  renderFrame(dt);
  if (!moduleReady) { moduleReady = true; hud.showLoadingDone(); }
}

/** Photo mode feeds the HUD the same state a live frame would. */
function syncShotHud() {
  const p = combat.player;
  const mission = missions.active ? missions.mission : null;
  const near = currentVehicle ? null : findVehicleNear(p.x, p.z, 6);
  const live = liveMapState();
  hud.update({
    ...live,
    weapon: combat.currentWeapon(),
    ammo: combat.currentAmmo(),
    wanted: police.wanted,
    evasion: false,
    district: world.districtName(p.x, p.z),
    clock: clockAt(game.hour),
    timeName: timeNameAt(game.hour),
    radio: audio.currentStation()?.name ?? 'SUNSET FM 96.6',
    prompt: near && !near.police ? `Steal ${near.spec.name}` : null,
    aiming: true,
    mission,
    objectiveText: mission ? missions.objectiveText() : '',
    missionStep: missions.stepIndex,
    missionTotal: mission?.steps.length,
    missionProgress: mission ? missions.progress : 0,
    activity: activities.hudInfo(),
    tokens: tokens.filter((t) => t.taken).length,
    city: cityProgress(),
  });
  hud.setPlaying(shotName !== 'title', !!currentVehicle);
}

// capture staged shot before first frame
window.addEventListener('load', () => { renderer.resize(); });

if (isShot) {
  shotStage.stage(shotName);
  hud.setRadio('SUNSET FM 96.6');
  refreshTitle();
  requestAnimationFrame(frame);
} else {
  hud.showTitle(true);
  hud.setPlaying(false, false);
  refreshTitle();
  requestAnimationFrame(frame);
}

// expose a tiny read-only debug surface for automated checks
window.__solaris = {
  get state() {
    return {
      mode,
      cash: combat.player.cash,
      wanted: police.wanted,
      mission: missions.index,
      missionActive: missions.active,
      missionStep: missions.stepIndex,
      objective: missions.objectiveText(),
      health: combat.player.health,
      vehicle: currentVehicle?.type ?? null,
      speed: currentVehicle?.speed ?? 0,
      district: world.districtName(combat.player.x, combat.player.z),
      renders: renderer.stats(),
      tokens: tokens.filter((t) => t.taken).length,
      respect: combat.player.respect,
      rank: progression.rank.name,
      upgrades: { ...progression.state.upgrades },
      stored: progression.state.stored.slice(),
      activity: activities.active?.id ?? null,
      activityStep: activities.state.index,
      menuOpen: cityMenu.open,
      helicopter: !!police.helicopter,
      police: police.allCars().length,
    };
  },
  openMenu(tab = 'map') { openCityMenu(tab); },
  closeMenu() { closeCityMenu(); },
  start() { newGame(true); },
  continue() { continueGame(); },
  enterNearest() { const car = findVehicleNear(combat.player.x, combat.player.z, 8); if (car) enterVehicle(car); },
  drive(seconds = 1) {
    for (let i = 0; i < seconds * 60; i += 1) {
      const car = currentVehicle;
      if (!car) break;
      updateVehicle(car, { throttle: 1, steer: 0.08, handbrake: false, boost: true }, STEP, world);
      combat.player.x = car.x;
      combat.player.z = car.z;
    }
    updateCamera(0.016);
  },
  raise(n = 3) { police.raise(n, 'debug'); },
  spawnCop() { police.spawnCruiser(null, 30); },
  teleport(x, z) { combat.player.x = x; combat.player.z = z; combat.player.y = world.groundHeight(x, z); if (currentVehicle) { currentVehicle.x = x; currentVehicle.z = z; } },
  save(slot = '1') { save.write(slot, snapshot(game)); refreshTitle(); },
  load(slot = '1') { const data = save.read(slot); if (data) { applySnapshot(game, data); refreshTitle(); } return !!data; },
  missionStage(i, s) { missions.stage(i, s); },
  setCam(px, py, pz, tx, ty, tz, fov = 55) {
    camera.pos = [px, py, pz];
    camera.target = [tx, ty, tz];
    camera.fov = fov;
    mode = 'shot';
  },
  setHour(h) { game.hour = h; },
  hero(x, z, heading) {
    const car = currentVehicle;
    if (!car) return;
    car.x = x; car.z = z; car.heading = heading;
    car.y = world.groundHeight(x, z) + 0.02;
    combat.player.x = x; combat.player.z = z; combat.player.heading = heading;
  },
  stage(name) { shotStage.stage(name); },
  hideHud(hidden) { hud.els.hud.classList.toggle('hidden', !!hidden); },
  project(x, y, z) {
    const { width, height } = renderer.stats();
    const fwd = normalize3([camera.target[0] - camera.pos[0], camera.target[1] - camera.pos[1], camera.target[2] - camera.pos[2]]);
    const right = normalize3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);
    const rel = [x - camera.pos[0], y - camera.pos[1], z - camera.pos[2]];
    const zc = rel[0] * fwd[0] + rel[1] * fwd[1] + rel[2] * fwd[2];
    if (zc <= 0.1) return null;
    const xc = rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2];
    const yc = rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2];
    const ty = Math.tan((camera.fov * Math.PI) / 180 / 2);
    const sx = (xc / zc) / (ty * (width / height));
    const sy = (yc / zc) / ty;
    return { x: Math.round((sx * 0.5 + 0.5) * width), y: Math.round((0.5 - sy * 0.5) * height), depth: zc };
  },
  probe(x, y) {
    renderFrame(0.016);
    const gl = renderer.gl;
    const px = new Uint8Array(4);
    const dh = gl.drawingBufferHeight;
    gl.readPixels(Math.round(x), Math.round(dh - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  },
  probeSky(x, y) {    // Dump the raw camera ray for a pixel so the sky can be checked without a screenshot.
    const { width, height } = renderer.stats();
    const f = camera.fov * Math.PI / 180;
    const ndcX = (x / width) * 2 - 1;
    const ndcY = 1 - (y / height) * 2;
    const fwd = normalize3([camera.target[0] - camera.pos[0], camera.target[1] - camera.pos[1], camera.target[2] - camera.pos[2]]);
    const right = normalize3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);
    const ty = Math.tan(f / 2), tx = ty * (width / height);
    const dir = normalize3([
      fwd[0] + right[0] * ndcX * tx + up[0] * ndcY * ty,
      fwd[1] + right[1] * ndcX * tx + up[1] * ndcY * ty,
      fwd[2] + right[2] * ndcX * tx + up[2] * ndcY * ty,
    ]);
    const env = getEnv();
    const sd = Math.max(dir[0] * env.sunDir[0] + dir[1] * env.sunDir[1] + dir[2] * env.sunDir[2], 0);
    return { dir, sd, sunDir: env.sunDir, skyTop: env.skyTop, skyHorizon: env.skyHorizon, sunGlow: env.sunGlow };
  },
  debug: {
    missions, combat, police, traffic, world,
    get input() { return { mouseDown, aimDown, keys: [...keys], pressed: [...pressedKeys] }; },
  },
  renderer,
};
