// main.js — boot, the fixed 60 Hz loop, input, camera, the title/pause/mission state
// machine, day cycle, and the deterministic staging used by the four screenshots.
// It wires the renderer, city, combat, traffic, police, missions, audio, HUD and save
// slots together; nothing here reaches the network.

import {
  CITY, DAY_CYCLE, PALETTE, SAFEHOUSE, SKY_PRESETS, STEP, TAU,
  WEAPONS, clamp, createRandom, lerp, mix3, rgb, shade,
} from './config.js';
import { MeshBuilder, createRenderer, cross3, normalize3 } from './renderer3d.js';
import { createWorld } from './world.js';
import { createVehicle, updateVehicle, buildVehicle, vehicleGlow } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';
import { createCombat, buildCharacter } from './combat.js';
import { createMissions, MISSIONS } from './missions.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
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

const game = {
  renderer, world, audio, combat, traffic, police, missions, hud, save,
  tokens, pickups, hour: 18.62, playTime: 0,
  get cash() { return combat.player.cash; },
};

let currentVehicle = null;
let mode = isShot ? 'shot' : 'title';
let playTime = 0;
let elapsed = 0;
let cameraYaw = Math.PI;
let cameraPitch = 0.18;
let cameraOffsetYaw = 0;
let cameraShake = 0;
let sirenDistance = Infinity;
let mouseDown = false;
let aimDown = false;
let moduleReady = false;
let lastCrimeAt = -9;
let deathHandled = false;
const visitedDistricts = new Set(['palm']);
let stageCity = null;
let stagedHelo = null;

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

const camera = {
  pos: [80, 26, 430],
  target: [0, 8, 150],
  fov: 58,
  up: [0, 1, 0],
  right: [1, 0, 0],
  forward: [0, 0, -1],
};

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

// ---------------------------------------------------------------------------
// Environment / day cycle
// ---------------------------------------------------------------------------
function envAtHour(hourInput) {
  const hour = ((hourInput % 24) + 24) % 24;
  const stops = [
    { h: 0, p: 'night' }, { h: 4.7, p: 'night' }, { h: 6.2, p: 'dawn' },
    { h: 9.2, p: 'day' }, { h: 17.2, p: 'day' }, { h: 18.85, p: 'golden' },
    { h: 19.65, p: 'sunset' }, { h: 20.7, p: 'night' }, { h: 24, p: 'night' },
  ];
  let a = stops[0], b = stops[1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (hour >= stops[i].h && hour <= stops[i + 1].h) {
      a = stops[i]; b = stops[i + 1];
      break;
    }
  }
  const t = b.h === a.h ? 0 : (hour - a.h) / (b.h - a.h);
  const A = SKY_PRESETS[a.p];
  const Bp = SKY_PRESETS[b.p];
  const mixColor = (key) => mix3(A[key], Bp[key], t);
  const num = (key) => lerp(A[key], Bp[key], t);
  const dir = normalize3([
    lerp(A.sunDir[0], Bp.sunDir[0], t),
    lerp(A.sunDir[1], Bp.sunDir[1], t),
    lerp(A.sunDir[2], Bp.sunDir[2], t),
  ]);
  const night = num('night');
  return {
    name: timeNameAt(hour),
    sunDir: dir,
    sunColor: mixColor('sunColor'),
    skyTop: mixColor('skyTop'),
    skyHorizon: mixColor('skyHorizon'),
    fogColor: mixColor('fogColor'),
    ambientSky: mixColor('ambientSky'),
    ambientGround: mixColor('ambientGround'),
    sunGlow: mixColor('sunGlow'),
    cityGlow: mixColor('cityGlow'),
    fogDensity: num('fogDensity'),
    night,
    stars: num('stars'),
    sunSize: A.sunSize,
    exposure: 1,
    deepWater: mix3(rgb(0x0a3e5e), rgb(0x0a1d42), night),
    shallowWater: mix3(rgb(0x2fc9bd), rgb(0x12505f), night * 0.85),
  };
}

function timeNameAt(hour) {
  if (hour >= 5.4 && hour < 8.2) return 'DAWN';
  if (hour >= 8.2 && hour < 17.4) return 'HIGH SUN';
  if (hour >= 17.4 && hour < 19.35) return 'GOLDEN HOUR';
  if (hour >= 19.35 && hour < 20.4) return 'SUNSET';
  return 'NEON NIGHT';
}

function clockAt(hour) {
  const total = Math.floor(hour * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  game.hour = 18.62;
  game.playTime = 0;
  playTime = 0;
  currentVehicle = null;
  cameraYaw = Math.PI;
  cameraPitch = 0.17;
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
  cameraYaw = Math.PI;
  cameraPitch = 0.17;
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
        cameraYaw = Math.PI;
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
  cameraYaw = Math.PI;
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
  currentVehicle = car;
  const p = combat.player;
  p.inVehicle = car;
  p.x = car.x;
  p.z = car.z;
  p.heading = car.heading;
  cameraYaw = car.heading;
  cameraOffsetYaw = 0;
  if (audio.ready) audio.playHorn();
  hud.showPrompt(null);
  hud.notify(`${car.spec.name.toUpperCase()} ACQUIRED`, 'mission', 2200);
  if (police.wanted === 0 && !car.mission) police.raise(1, 'Grand theft auto');
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
  cameraYaw = car.heading;
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
  'ShiftLeft', 'ShiftRight', 'Space', 'Escape', 'Tab',
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

  if (event.code === 'Escape') {
    if (isShot) return;
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
    cameraOffsetYaw = clamp(cameraOffsetYaw - dx * 0.0026, -2.2, 2.2);
    cameraPitch = clamp(cameraPitch + dy * 0.0016, -0.15, 0.55);
  } else {
    cameraYaw -= dx * 0.0031;
    cameraPitch = clamp(cameraPitch + dy * 0.0022, -0.34, 0.92);
  }
});
window.addEventListener('resize', () => renderer.resize());

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
function cameraForward(yaw) {
  return [Math.sin(yaw), Math.cos(yaw)];
}

function updateCamera(dt) {
  const p = combat.player;
  if (mode === 'title' || mode === 'shot') {
    return;
  }
  if (currentVehicle) {
    const car = currentVehicle;
    cameraOffsetYaw = lerp(cameraOffsetYaw, 0, clamp(dt * 1.4, 0, 1));
    const baseYaw = car.heading + cameraOffsetYaw;
    const speedRatio = clamp(Math.abs(car.speed) / car.spec.maxSpeed, 0, 1);
    const dist = 7.0 + speedRatio * 2.2;
    const height = 3.2 + Math.sin(cameraPitch * 2.2) * 2.4;
    const desired = [
      car.x - Math.sin(baseYaw) * dist,
      car.y + height,
      car.z - Math.cos(baseYaw) * dist,
    ];
    const target = [
      car.x + Math.sin(car.heading) * (3.4 + speedRatio * 4),
      car.y + 1.25,
      car.z + Math.cos(car.heading) * (3.4 + speedRatio * 4),
    ];
    const smooth = clamp(dt * (7 + speedRatio * 4), 0, 1);
    camera.pos[0] = lerp(camera.pos[0], desired[0], smooth);
    camera.pos[1] = lerp(camera.pos[1], desired[1], smooth);
    camera.pos[2] = lerp(camera.pos[2], desired[2], smooth);
    camera.target[0] = lerp(camera.target[0], target[0], clamp(dt * 9, 0, 1));
    camera.target[1] = lerp(camera.target[1], target[1], clamp(dt * 9, 0, 1));
    camera.target[2] = lerp(camera.target[2], target[2], clamp(dt * 9, 0, 1));
    const shake = speedRatio * 0.035 + (car.airborne ? 0.06 : 0) + (car.drift > 3 ? 0.03 : 0);
    camera.pos[0] += Math.sin(elapsed * 31) * shake;
    camera.pos[1] += Math.cos(elapsed * 27) * shake * 0.6;
    camera.fov = 58 + speedRatio * 13 + (car.boosting ? 4 : 0);
  } else {
    const fwd = cameraForward(cameraYaw);
    const horizontal = Math.cos(cameraPitch);
    const dist = 5.2;
    const desired = [
      p.x - fwd[0] * dist * horizontal,
      p.y + 2.2 + Math.sin(cameraPitch) * 4.2,
      p.z - fwd[1] * dist * horizontal,
    ];
    // Keep the camera out of solid blocks.
    let camX = desired[0], camZ = desired[2];
    if (world.insideBuilding(camX, camZ)) {
      const inner = world.collideCircle(camX, camZ, 0.6);
      if (inner.hit) { camX = inner.x; camZ = inner.z; }
    }
    const smooth = clamp(dt * 9, 0, 1);
    camera.pos[0] = lerp(camera.pos[0], camX, smooth);
    camera.pos[1] = lerp(camera.pos[1], desired[1], smooth);
    camera.pos[2] = lerp(camera.pos[2], camZ, smooth);
    const target = [p.x + fwd[0] * 4, p.y + 1.42, p.z + fwd[1] * 4];
    camera.target[0] = lerp(camera.target[0], target[0], clamp(dt * 11, 0, 1));
    camera.target[1] = lerp(camera.target[1], target[1], clamp(dt * 11, 0, 1));
    camera.target[2] = lerp(camera.target[2], target[2], clamp(dt * 11, 0, 1));
    camera.fov = aimDown || mouseDown ? 50 : 62;
    const bob = Math.hypot(p.velocityX, p.velocityZ) > 0.4 ? Math.sin(p.walkPhase * 2) * 0.035 : 0;
    camera.pos[1] += bob;
    cameraShake = lerp(cameraShake, 0, dt * 6);
    camera.pos[0] += Math.sin(elapsed * 41) * cameraShake;
    camera.pos[1] += Math.cos(elapsed * 37) * cameraShake * 0.7;
  }
  camera.up = [0, 1, 0];
}

function titleCamera() {
  const t = (performance.now() - titleCameraStart) / 1000;
  camera.pos[0] = 118 + Math.sin(t * 0.06) * 34;
  camera.pos[1] = 30 + Math.sin(t * 0.11) * 3;
  camera.pos[2] = 404 + Math.cos(t * 0.05) * 16;
  camera.target[0] = 4 + Math.sin(t * 0.04) * 16;
  camera.target[1] = 8;
  camera.target[2] = 150;
  camera.fov = 57;
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
        cameraShake = 0.35;
      } else if (ev === 'stunt') {
        hud.notify('STUNT AIR · +$150', 'cash', 2200);
        p.cash += 150;
        if (audio.ready) audio.playStunt();
      } else if (ev === 'splash') {
        if (audio.ready) audio.playSplash();
        hud.notify('Engine flooded — get out of the water', 'warn', 2600);
      } else if (ev === 'landing') {
        cameraShake = 0.4;
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
    cameraOffsetYaw = lerp(cameraOffsetYaw, 0, clamp(dt * 0.6, 0, 1));
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
    if (keys.has('ArrowLeft')) cameraYaw += dt * 1.8;
    if (keys.has('ArrowRight')) cameraYaw -= dt * 1.8;
    if (keys.has('ArrowUp')) cameraPitch = clamp(cameraPitch - dt * 0.7, -0.34, 0.92);
    if (keys.has('ArrowDown')) cameraPitch = clamp(cameraPitch + dt * 0.7, -0.34, 0.92);
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
  combat.update(dt, input, cameraYaw, { aim: input.aim });
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
    waypoint: missions.waypoint(),
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
function buildScene(time) {
  const b = new MeshBuilder(60000);
  const glows = [];
  const shadows = [];
  const p = combat.player;
  const camX = camera.pos[0], camZ = camera.pos[2];

  const addGlow = (x, y, z, color, r, alpha) => {
    glows.push({ x, y, z, color, r, alpha });
  };

  // Static neon halos.
  const nightBoost = 0.34 + getEnv().night * 0.66;
  for (const g of world.glows) {
    const dx = g.x - camX, dz = g.z - camZ;
    if (dx * dx + dz * dz > 420 * 420) continue;
    addGlow(g.x, g.y, g.z, g.color, g.r, g.alpha * nightBoost);
  }

  // Vehicles (deduplicated).
  const seen = new Set();
  const vehicles = allVehicles();
  for (const car of vehicles) {
    if (seen.has(car)) continue;
    seen.add(car);
    const dx = car.x - camX, dz = car.z - camZ;
    if (dx * dx + dz * dz > 330 * 330) continue;
    buildVehicle(b, car, time);
    vehicleGlow(car, time, addGlow);
    shadows.push({ x: car.x, z: car.z, y: world.groundHeight(car.x, car.z) + 0.03, rx: 2.9, rz: 1.7, alpha: 0.3 });
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
    }, time);
    shadows.push({ x: ped.x, z: ped.z, y: world.groundHeight(ped.x, ped.z) + 0.025, rx: 0.55, rz: 0.55, alpha: 0.25 });
  }

  // Player + enemies + tracers/particles.
  combat.build(b, { aim: !currentVehicle && (aimDown || mouseDown || isShot) });
  if (!currentVehicle && !p.dead) {
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
    const gold = PALETTE.gold;
    b.box(wp.x, 11, wp.z, 0.1, 22, 0.1, gold, { e: 1, omitBottom: true });
    b.cylinder(wp.x, 0.12, wp.z, 2.5, 2.2, 0.16, 16, gold, { e: 0.85, capTop: true });
    const spin = time * 1.7;
    for (let i = 0; i < 8; i += 1) {
      const a = spin + (i / 8) * TAU;
      const x = wp.x + Math.cos(a) * 2.5;
      const z = wp.z + Math.sin(a) * 2.5;
      b.box(x, 0.32, z, 0.28, 0.16, 0.7, gold, { rotY: -a, e: 1, omitBottom: true });
    }
    b.box(wp.x, 4.1 + Math.sin(time * 2.4) * 0.25, wp.z, 1.1, 1.1, 1.1, gold, { rotY: spin, e: 1, omitBottom: true });
    b.box(wp.x, 4.1 + Math.sin(time * 2.4) * 0.25, wp.z, 0.55, 0.55, 0.55, rgb(0xfff4cf), { rotY: -spin, e: 1, omitBottom: true });
    addGlow(wp.x, 4.2, wp.z, gold, 3.2, 0.7);
    addGlow(wp.x, 1.2, wp.z, gold, 3.6, 0.35);
  }

  // Safehouse marker when free roaming.
  if (!missions.active && !isShot) {
    const x = SAFEHOUSE.x, z = SAFEHOUSE.z + 12;
    addGlow(x, 3, z, PALETTE.neonCyan, 2.4, 0.3);
  }

  // Police helicopter and its searchlight cone.
  if (stagedHelo) {
    const h = stagedHelo;
    const rotor = time * 18;
    b.box(h.x, h.y, h.z, 4.8, 1.9, 3.1, rgb(0x1e2836), { rotY: h.heading, omitBottom: true });
    b.box(h.x, h.y + 0.85, h.z, 3.0, 1.0, 2.2, rgb(0x2d3b4d), { rotY: h.heading, omitBottom: true });
    b.box(h.x + Math.sin(h.heading) * 3.4, h.y + 0.05, h.z + Math.cos(h.heading) * 3.4, 1.3, 1.3, 4.6, rgb(0x26313f), { rotY: h.heading + Math.PI / 2, omitBottom: true });
    b.box(h.x + Math.sin(h.heading) * 3.2, h.y + 0.95, h.z + Math.cos(h.heading) * 3.2, 0.16, 2.4, 0.16, rgb(0x394757), { omitBottom: true });
    b.box(h.x + Math.sin(h.heading) * 3.3, h.y + 2.1, h.z + Math.cos(h.heading) * 3.3, 0.16, 0.16, 2.6, rgb(0x8f979e), { rotY: -time * 26, omitBottom: true });
    // Main rotor blur: two crossed, fast-spinning blades.
    for (let i = 0; i < 2; i += 1) {
      b.box(h.x, h.y + 1.95 + i * 0.06, h.z, 11.5, 0.07, 0.42, rgb(0x1b2028), { rotY: rotor + i * Math.PI / 2, omitBottom: true });
      b.box(h.x, h.y + 1.95 + i * 0.06, h.z, 0.42, 0.07, 11.5, rgb(0x1b2028), { rotY: rotor + i * Math.PI / 2, omitBottom: true });
    }
    b.box(h.x, h.y + 1.6, h.z, 0.5, 0.6, 0.5, rgb(0x111722), { omitBottom: true });
    // Skids and canopy glass.
    for (const side of [-1, 1]) {
      b.box(h.x + Math.cos(h.heading) * side * 1.3, h.y - 1.3, h.z - Math.sin(h.heading) * side * 1.3, 0.16, 0.16, 3.4, rgb(0x4a5158), { rotY: h.heading, omitBottom: true });
    }
    b.box(h.x + Math.sin(h.heading) * 1.55, h.y + 0.35, h.z + Math.cos(h.heading) * 1.55, 2.4, 1.1, 0.14, PALETTE.glassLight, { rotY: h.heading, e: 0.35, omitBottom: true });
    // Nav lights.
    addGlow(h.x - Math.cos(h.heading) * 1.7, h.y - 0.6, h.z + Math.sin(h.heading) * 1.7, rgb(0xff2a3d), 1.0, 0.8);
    addGlow(h.x + Math.cos(h.heading) * 1.7, h.y - 0.6, h.z - Math.sin(h.heading) * 1.7, rgb(0x39ff9e), 0.9, 0.7);
    addGlow(h.x, h.y + 1.9, h.z, rgb(0xfff0c0), 1.2, 0.45);
    // Searchlight cone: stacked halos falling to the street, then a bright pool.
    const sx = h.spotX, sz = h.spotZ;
    for (let i = 1; i <= 7; i += 1) {
      const t = i / 7;
      const px = h.x + (sx - h.x) * t;
      const pz = h.z + (sz - h.z) * t;
      const py = h.y + (0.4 - h.y) * t;
      addGlow(px, py, pz, rgb(0xfff1c2), 1.2 + t * 3.6, 0.06 + t * 0.07);
    }
    addGlow(sx, 0.14, sz, rgb(0xfff1c2), 9.0, 0.22);
    addGlow(sx, 0.1, sz, rgb(0xffe7a8), 5.0, 0.3);
  }

  return { geometry: b.geometry(), glows, shadows };
}

function renderFrame(dt) {
  const env = getEnv();
  const scene = buildScene(elapsed);
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
// Shot staging — deterministic frames for screenshots
// ---------------------------------------------------------------------------
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
  combat.player.dead = false;
  combat.player.inVehicle = null;
  currentVehicle = null;
  stagedHelo = null;
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

function stageShot(name) {
  hud.showLoadingDone();
  hud.showTitle(name === 'title');
  hud.setPlaying(name !== 'title', name === 'cover' || name === 'chase');
  stageCity = null;
  document.getElementById('coverBrand').classList.add('hidden');
  if (name === 'title') {
    setStageHour(18.55);
    stageTitle();
  } else if (name === 'start') {
    stageStart();
  } else if (name === 'cover') {
    stageCover();
  } else if (name === 'chase') {
    stageChase();
  } else if (name === 'combat') {
    stageCombat();
  } else if (name === 'beach') {
    stageBeach();
  } else if (name === 'night') {
    stageNight();
  } else {
    stageTitle();
    hud.showTitle(true);
    hud.setPlaying(false, false);
  }
  mode = 'shot';
}

function stageTitle() {
  clearScene();
  setStageHour(18.5);
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
  camera.pos = [132, 31, 402];
  camera.target = [0, 7, 152];
  camera.fov = 57;
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
  currentVehicle = null;
}

function stageCover() {
  clearScene();
  setStageHour(18.92);
  // Mission state: Neon Heist getaway, three stars.
  missions.stage(2, 2, { banner: 'ACTIVE MISSION', done: 2 });
  hud.missionBanner(missions.mission, 'ACTIVE MISSION', 120000);
  const p = combat.player;
  p.cash = 23850;
  p.health = 88;
  p.armor = 45;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = 3;
  p.ammo.smg.mag = 27;
  p.ammo.smg.reserve = 180;
  p.respect = 340;
  p.dead = false;

  const car = stageCar('supercar', 158, 254, -Math.PI / 2, 29);
  car.boost = 0.72;
  car.drift = 2.2;
  car.colors = undefined;
  car.color = rgb(0xff2f86);
  car.heading = -Math.PI / 2;
  currentVehicle = car;
  p.inVehicle = car;
  p.x = car.x;
  p.z = car.z;
  p.y = car.y;
  p.heading = car.heading;

  police.setWanted(3);
  police.spawnStagedCruiser(187, 239, -Math.PI / 2 + 0.2);
  police.spawnStagedCruiser(121, 268, Math.PI / 2);
  police.spawnStagedCruiser(96, 243, -Math.PI / 2 + 0.05);
  police.spawnStagedCruiser(228, 262, -Math.PI / 2);
  police.setPeak(3);

  stageCar('coupe', 34, 254, -Math.PI / 2, 0);
  stageCar('sedan', 276, 265, Math.PI / 2, 0);
  stageCar('taxi', -40, 253, -Math.PI / 2, 0);
  stageCar('muscle', 206, 250, -Math.PI / 2, 0);
  for (const [x, z, h, p2] of [[176, 291, 1.7, false], [136, 293, 2.5, false], [110, 290, 0.6, false], [246, 292, 3.1, false], [60, 288, 1.2, false]]) {
    traffic.addStagedPed(x, z, h, 'civ', { panic: p2 ? 3 : 0 });
  }
  hud.dialogue('ELENA', 'Three stars and the marina lockup is still open. Lose them on the Strip, Mateo.', 120000);
  camera.pos = [216, 5.4, 276];
  camera.target = [144, 1.1, 251];
  camera.fov = 68;
}

function stageCombat() {
  clearScene();
  setStageHour(19.42);
  stageCity = { districts: 5, tokens: 9, safehouse: true, missions: 4 };
  // Mission 04, Coral Pier: on foot, gold waypoint on the gang, neon wheel behind.
  missions.stage(3, 1, { banner: 'ACTIVE MISSION', done: 3 });
  hud.els.banner.classList.remove('show');
  const p = combat.player;
  combinePlayerOnFoot(-150, 301, -Math.PI / 2);
  p.health = 74;
  p.armor = 45;
  p.cash = 36480;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = 3;
  p.ammo.smg.mag = 21;
  p.ammo.smg.reserve = 180;
  p.moving = true;
  p.walkPhase = 1.1;
  p.aimYaw = -Math.PI / 2 + 0.08;
  p.respect = 520;
  cameraYaw = -Math.PI / 2;
  cameraPitch = 0.1;

  combat.spawnEnemy(-161, 299, { health: 80, style: 'goon', weapon: 'pistol' });
  combat.spawnEnemy(-168, 308, { health: 80, style: 'goon', weapon: 'smg', stationary: true });
  combat.spawnEnemy(-174, 294, { health: 80, style: 'goon', weapon: 'pistol', stationary: true });
  const enemyA = combat.enemies[0];
  const enemyB = combat.enemies[1];
  const enemyC = combat.enemies[2];
  if (enemyA) { enemyA.heading = Math.PI / 2 + 0.1; enemyA.phase = 1.4; enemyA.hitFlash = 0.2; }
  if (enemyB) { enemyB.heading = Math.PI / 2 - 0.1; enemyB.phase = 0.4; }
  if (enemyC) { enemyC.heading = Math.PI / 2 + 0.3; enemyC.phase = 2.2; enemyC.hitFlash = 0.1; }
  // A frozen frame of the exchange: muzzle flash, tracers, sparks and shell casings.
  combat.tracers.push({ x1: -150.8, y1: 1.75, z1: 300.4, x2: -160.8, y2: 1.55, z2: 299.2, color: rgb(0xffd27a), life: 999, maxLife: 999 });
  combat.tracers.push({ x1: -151.2, y1: 1.72, z1: 300.8, x2: -167.6, y2: 1.5, z2: 307.6, color: rgb(0xffb44a), life: 999, maxLife: 999 });
  combat.tracers.push({ x1: -167.4, y1: 1.6, z1: 307.4, x2: -151.4, y2: 1.55, z2: 301.2, color: rgb(0xff5a3c), life: 999, maxLife: 999 });
  for (let i = 0; i < 7; i += 1) {
    combat.particles.push({ x: -160.8, y: 1.6, z: 299.2, vx: (random() - 0.5) * 3, vy: random() * 2, vz: (random() - 0.5) * 3, life: 999, maxLife: 999, color: rgb(0xa81f2a), size: 0.5, gravity: 0 });
  }
  for (let i = 0; i < 5; i += 1) {
    combat.particles.push({ x: -150.9, y: 1.7, z: 300.5, vx: (random() - 0.5) * 2, vy: random() * 1.6, vz: (random() - 0.5) * 2, life: 999, maxLife: 999, color: rgb(0xffcf6a), size: 0.24, gravity: 0 });
  }
  combat.addImpact(-160.9, 1.6, 299.1, PALETTE.gold, 999);
  const cover = stageCar('coupe', -137, 293.5, -Math.PI / 2 + 0.28, 0);
  cover.color = rgb(0x2fc2b4);
  stageCar('van', -112, 299, Math.PI / 2 + 0.2, 0);
  stageCar('sedan', -196, 292, Math.PI / 2, 0);
  stageCar('supercar', -186, 304, Math.PI / 2 + 0.1, 0);
  traffic.addStagedPed(-142, 291, 2.6, 'civ', { panic: 3, panicArms: true });
  traffic.addStagedPed(-186, 291, -1.2, 'civ', { panic: 3, panicArms: true });
  traffic.addStagedPed(-128, 303, 1.1, 'civ', { panic: 2, panicArms: true });
  traffic.addStagedPed(-176, 297, 2.4, 'civ', { panic: 3, panicArms: true });
  police.setWanted(1);
  const cruiser = police.spawnStagedCruiser(-104, 294, Math.PI / 2 + 0.16);
  cruiser.sirenOn = true;
  hud.dialogue('MATEO', 'Coral Pier, under the wheel. They took the codes — take them back.', 120000);
  camera.pos = [-147, 2.6, 298.8];
  camera.target = [-164, 1.7, 303.5];
  camera.fov = 62;
}

function stageBeach() {
  clearScene();
  setStageHour(11.9);
  missions.stage(0, 1, { banner: 'ACTIVE MISSION' });
  hud.missionBanner(missions.mission, 'ACTIVE MISSION', 120000);
  const p = combat.player;
  combinePlayerOnFoot(-57, 284, -0.6);
  p.health = 100;
  p.armor = 20;
  p.cash = 18450;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = 2;
  p.aimYaw = -0.6;
  p.respect = 210;
  const car = stageCar('coupe', -68, 286.5, Math.PI / 2);
  car.color = rgb(0xff5a3c);
  car.accent = rgb(0xffb26a);
  car.mission = true;
  const c2 = stageCar('muscle', -24, 255, Math.PI / 2);
  c2.color = rgb(0x1f9e8f);
  stageCar('taxi', -112, 266, -Math.PI / 2);
  stageCar('sedan', 30, 254, Math.PI / 2);
  stageCar('van', 112, 266, -Math.PI / 2);
  for (const [x, z, h] of [[-44, 291, 2.2], [-30, 296, 1.1], [-78, 291, 0.4], [-96, 294, 2.9], [8, 288, 1.6], [-120, 312, 0.8], [-140, 320, 2.4]]) {
    traffic.addStagedPed(x, z, h, 'civ');
  }
  hud.dialogue('ELENA', 'Coupe is right there on the boardwalk. Keys are in the visor. Make it look casual.', 120000);
  camera.pos = [-31, 3.9, 325];
  camera.target = [-64, 1.2, 286];
  camera.fov = 63;
}

// ---------------------------------------------------------------------------
// Screenshot staging — one deterministic scene per hero frame
// ---------------------------------------------------------------------------

/** The cover: a golden-hour hero frame over the Palm Strip with the live HUD. */
function stageStart() {
  clearScene();
  setStageHour(18.88);
  stageCity = { districts: 4, tokens: 5, safehouse: true, missions: 2 };
  missions.stage(0, 2, { banner: 'ACTIVE MISSION', done: 1 });
  hud.els.banner.classList.remove('show');
  const p = combat.player;
  p.cash = 23850;
  p.health = 96;
  p.armor = 40;
  p.weapons = ['fists', 'pistol', 'smg', 'shotgun'];
  p.weaponSlot = 3;
  p.ammo.smg.mag = 27;
  p.respect = 340;

  // The hero car, nose west down the boulevard into the sun.
  const hero = stageCar('supercar', 26, 270, -Math.PI / 2, 24);
  hero.boost = 0.62;
  hero.boosting = true;
  hero.drift = 1.6;
  hero.color = rgb(0xff2f86);
  hero.accent = rgb(0x39e9ff);
  currentVehicle = hero;
  p.inVehicle = hero;
  p.x = hero.x; p.z = hero.z; p.y = hero.y;
  p.heading = hero.heading;

  // A living boulevard: traffic both ways, parked cars, boardwalk strollers.
  stageCar('coupe', 104, 252, -Math.PI / 2, 22);
  stageCar('muscle', -44, 253.5, -Math.PI / 2, 18);
  stageCar('taxi', 74, 266, Math.PI / 2, 13);
  stageCar('sedan', -12, 267.5, Math.PI / 2, 11);
  stageCar('van', -110, 266, Math.PI / 2, 9);
  stageCar('sedan', 150, 267, Math.PI / 2, 12);
  stageCar('supercar', -176, 251, -Math.PI / 2, 25);
  // Parked cars along the promenade and hotel kerb.
  stageCar('coupe', -96, 283, Math.PI / 2, 0);
  stageCar('muscle', 60, 282, -Math.PI / 2, 0);
  for (const [x, z, h] of [
    [-30, 291, 1.2], [26, 293, 2.7], [-84, 290, 0.4], [104, 292, 3.3],
    [-130, 288, 1.9], [150, 289, 2.4], [-205, 291, 1.1], [62, 294, 0.6],
    [-60, 238, 1.5], [16, 237, 3.0], [118, 239, 0.2], [-152, 240, 2.2],
    [-6, 312, 1.6], [86, 316, 2.9], [-142, 318, 0.9],
  ]) {
    traffic.addStagedPed(x, z, h, 'civ');
  }
  hud.dialogue('ELENA', 'Boulevard is ours tonight. Keep the coupe clean and the cops bored.', 120000);
  // Chase framing: car centre-low, sun and ocean ahead, hotels stacked on the right.
  camera.pos = [46, 4.6, 270];
  camera.target = [10, 1.0, 271];
  camera.fov = 74;
  document.getElementById('coverBrand').classList.remove('hidden');
  hud.els.missionCard.classList.add('hidden');
}

/** Twilight pursuit: cruisers at the player's door, helicopter above, stars lit. */
function stageChase() {
  clearScene();
  setStageHour(19.14);
  stageCity = { districts: 4, tokens: 7, safehouse: true, missions: 3 };
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

  const hero = stageCar('supercar', 128, 251.4, -Math.PI / 2, 41);
  hero.boost = 0.42;
  hero.boosting = true;
  hero.drift = 3.8;
  hero.color = rgb(0xff2f86);
  hero.accent = rgb(0x39e9ff);
  hero.braking = true;
  currentVehicle = hero;
  p.inVehicle = hero;
  p.x = hero.x; p.z = hero.z; p.y = hero.y;
  p.heading = hero.heading;

  police.setWanted(4);
  police.setPeak(4);
  const c1 = police.spawnStagedCruiser(136, 257.5, Math.PI / 2 + 0.4);
  const c2 = police.spawnStagedCruiser(111, 245.5, Math.PI / 2 + 0.22);
  const c3 = police.spawnStagedCruiser(101, 258, Math.PI / 2 - 0.26);
  const c4 = police.spawnStagedCruiser(89, 250, -Math.PI / 2);
  [c1, c2, c3, c4].forEach((c, i) => { c.sirenOn = true; c.braking = true; c.remote = true; c.sirenPhase = i * 0.37; });

  // Roadblock ahead: two cruisers wall the westbound lanes, officers on foot.
  const r1 = police.spawnStagedCruiser(54, 249, Math.PI / 2);
  const r2 = police.spawnStagedCruiser(50, 264, Math.PI / 2 + 0.1);
  [r1, r2].forEach((c, i) => { c.sirenOn = true; c.braking = true; c.remote = true; c.sirenPhase = 0.6 + i * 0.3; });
  traffic.addStagedPed(62, 245, Math.PI / 2, 'cop');
  traffic.addStagedPed(58, 268, -Math.PI / 2, 'cop');
  stagedHelo = { x: 80, z: 205, y: 24, heading: 2.2, spotX: 40, spotZ: 262 };

  stageCar('coupe', -6, 254, -Math.PI / 2, 18);
  stageCar('taxi', -30, 266, Math.PI / 2, 0);
  stageCar('van', 196, 268, Math.PI / 2, 0);
  stageCar('muscle', 58, 244, -Math.PI / 2, 24);
  stageCar('sedan', -76, 266, Math.PI / 2, 0);
  // Tyre smoke and sparks boiling off the rear wheels of the drifting hero car.
  for (let i = 0; i < 9; i += 1) {
    combat.particles.push({
      x: 128 + 2.2 + (random() - 0.5) * 1.6, y: 0.4 + random() * 0.5, z: 251.4 + (random() - 0.5) * 2.2,
      vx: 0, vy: 0, vz: 0, life: 520, maxLife: 999, color: rgb(0x77726c), size: 0.8 + random() * 0.7, gravity: 0,
    });
  }
  for (let i = 0; i < 5; i += 1) {
    combat.particles.push({
      x: 128 + 1.8, y: 0.3, z: 251.4 + (random() - 0.5) * 2.0, vx: 0, vy: 0, vz: 0,
      life: 800, maxLife: 999, color: i % 2 ? rgb(0xffa53c) : rgb(0xff5a2a), size: 0.5, gravity: 0,
    });
  }
  for (const [x, z, h] of [[150, 291, 1.7], [122, 293, 2.5], [176, 290, 0.6], [96, 292, 3.1], [64, 288, 1.2], [44, 238, 2.2]]) {
    traffic.addStagedPed(x, z, h, 'civ', { panic: 3, panicArms: true });
  }
  hud.dialogue('MATEO', 'Four stars on the Strip. Marina lockup stays open if you drive like that.', 120000);
  camera.pos = [150, 5.6, 251.5];
  camera.target = [112, 1.2, 248];
  camera.fov = 60;
}

/** Midnight vista down Neon Midtown and the Palm Strip: skyline, bay wheel, wet road. */
function stageNight() {
  clearScene();
  setStageHour(22.34);
  stageCity = { districts: 5, tokens: 10, safehouse: true, missions: 4 };
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
  currentVehicle = hero;
  p.inVehicle = hero;
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
  camera.pos = [330, 8.6, 244];
  camera.target = [258, 3.6, 240];
  camera.fov = 70;
}

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
    if (shotName === 'cover') stageCoverFrame();
    renderer.resize();
    if (shotName === 'combat') {
      const pulse = 0.9 + Math.sin(elapsed * 2) * 0.05;
      combat.particles.forEach((pt) => { pt.size = 0.5 * pulse; });
    }
    syncShotHud();
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
  }
  renderer.resize();
  renderFrame(dt);
  if (!moduleReady) { moduleReady = true; hud.showLoadingDone(); }
}

function stageCoverFrame() {
  // Keep the hero frame exact and alive: subtle camera drift and siren pulse only.
  camera.pos[1] = 5.4 + Math.sin(elapsed * 0.7) * 0.06;
  camera.target[1] = 1.1 + Math.sin(elapsed * 0.6) * 0.04;
}

function syncShotHud() {
  const p = combat.player;
  // The cover carries its own wordmark instead of the mission card.
  const mission = shotName === 'start' ? null : (missions.active ? missions.mission : null);
  hud.update({
    player: p,
    vehicle: currentVehicle,
    weapon: combat.currentWeapon(),
    ammo: combat.currentAmmo(),
    wanted: police.wanted,
    evasion: false,
    policeCars: police.allCars(),
    trafficCars: traffic.cars,
    parkedCars: parkedVehicles,
    district: world.districtName(p.x, p.z),
    clock: clockAt(game.hour),
    timeName: timeNameAt(game.hour),
    radio: audio.currentStation()?.name ?? 'SUNSET FM 96.6',
    prompt: currentVehicle ? null : (findVehicleNear(p.x, p.z, 6) ? `Steal ${findVehicleNear(p.x, p.z, 6).spec.name}` : null),
    aiming: true,
    mission,
    objectiveText: mission ? missions.objectiveText() : '',
    missionStep: missions.stepIndex,
    missionTotal: mission?.steps.length,
    missionProgress: mission ? missions.progress : 0,
    waypoint: missions.waypoint(),
    tokens: tokens.filter((t) => t.taken).length,
    city: cityProgress(),
  });
  if (shotName === 'beach' || shotName === 'combat' || shotName === 'chase' || shotName === 'night') hud.setPlaying(true, false);
  if (shotName === 'chase') hud.setPlaying(true, true);
  if (shotName === 'title') hud.setPlaying(false, false);
}

// capture staged shot before first frame
window.addEventListener('load', () => { renderer.resize(); });

if (isShot) {
  stageShot(shotName);
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
    };
  },
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
  stage(name) { stageShot(name); },
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
