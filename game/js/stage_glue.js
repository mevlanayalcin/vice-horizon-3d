// stage_glue.js — everything around the game loop that is not the game: the title (with its
// live save-slot cards), Controls & Settings, pause, load and story-complete screens and
// their buttons, the clickable crew ability cards, photo mode (`?shot=<name>`, staged by
// shotstage.js and fed the same HUD state a live frame gets) and window.__solaris, the
// read-only surface the automated checks drive. main.js hands in `app`: its systems plus
// live getters and setters for the state it owns (mode, the car being driven).

import './screens.js';
import { STEP, createRandom } from './config.js';
import { MISSIONS } from './missions.js';
import { snapshot, applySnapshot, slotTime } from './save.js';
import { createVehicle, updateVehicle, skidMarks, tyreSmoke } from './vehicles.js';
import { envAtHour, timeNameAt, clockAt } from './daycycle.js';
import { cross3, normalize3 } from './renderer3d.js';
import { createShotStage } from './shotstage.js';

export function createStageGlue(app) {
  const { canvas, isShot, shotName, renderer, world, audio, save, hud, traffic, combat, police, turf, crew, missions } = app;
  const { progression, activities, cityMenu, game, rig, camera, parkedVehicles, tokens, keys, pressedKeys } = app;
  // The manual slot this session last saved to or loaded from; the city menu's save pill names it.
  let activeSlot = '1';
  let shotReadyFrames = 0;
  let sessionStarted = false;
  let restartArmed = false;
  let restartTimer = 0;

  function disarmRestart() {
    restartArmed = false;
    clearTimeout(restartTimer);
    restartTimer = 0;
    const btn = document.getElementById('restartBtn');
    if (btn) {
      btn.classList.remove('confirm');
      const label = btn.querySelector('.btn-label');
      if (label) label.textContent = 'RESTART STORY';
    }
  }

  /** Back into the city after a menu: HUD on, overlays off, camera behind the player. */
  function resumePlay() {
    sessionStarted = true;
    app.cancelRespawn?.();
    disarmRestart();
    app.mode = 'playing';
    hud.showTitle(false);
    hud.showPause(false);
    hud.showSlots(false);
    hud.hideStoryComplete();
    hud.setPlaying(true, false);
    app.vehicle = null;
    combat.player.inVehicle = null;
    rig.yaw = Math.PI;
    rig.pitch = 0.17;
    app.deathHandled = false;
  }

  /** Start the next unfinished job of a loaded story, or free roam when it is all done. */
  function resumeStory() {
    if (missions.state.storyComplete) {
      hud.objective('', null);
      hud.notify('Story complete · free roam', 'mission', 4000);
      return;
    }
    const idx = missions.state.index;
    const next = (idx >= 0 && idx < MISSIONS.length && !missions.state.done[idx])
      ? idx
      : MISSIONS.findIndex((_, i) => !missions.state.done[i]);
    if (next >= 0) missions.startMission(next, true);
    else {
      hud.objective('', null);
      hud.notify('Story complete · free roam', 'mission', 4000);
    }
  }

  function newGame(startMission = true) {
    app.initAudioOnce();
    resumePlay();
    hud.hideMissionPopup();
    combat.reset(world.spawn.x, world.spawn.z);
    const p = combat.player;
    p.cash = 640;
    p.respect = 0;
    p.weapons = ['fists', 'pistol'];
    p.weaponSlot = 2;
    Object.assign(p.ammo.pistol, { mag: 12, reserve: 96 });
    Object.assign(p.ammo.smg, { mag: 30, reserve: 180 });
    Object.assign(p.ammo.shotgun, { mag: 6, reserve: 36 });
    police.clear();
    police.setPeak(0);
    missions.reset();
    combat.clearEnemies();
    for (const token of tokens) token.taken = false;
    for (const pickup of world.pickups) { pickup.taken = false; pickup.respawn = 0; }
    progression.reset();
    activities.reset();
    crew.reset();
    turf.reset();
    game.hour = 18.62;
    game.playTime = 0;
    if (startMission) missions.startMission(0, true);
    hud.notify('Welcome to Solaris Bay', 'mission', 3000);
    hud.setHint('WASD MOVE · SHIFT SPRINT · E / F STEAL A CAR · R RADIO · ESC PAUSE');
    refreshTitle();
  }

  /** Load a slot (from the pause menu, the title's LOAD GAME or CONTINUE) and play it. */
  function loadSlot(slot, payload = save.read(slot)) {
    if (!payload) {
      hud.notify('That slot is empty', 'warn', 2500);
      return false;
    }
    app.initAudioOnce();
    combat.reset(world.spawn.x, world.spawn.z);
    applySnapshot(game, payload);
    if (combat.player.x === undefined) combat.player.x = world.spawn.x;
    if (slot !== 'auto' && slot !== 'latest') activeSlot = slot;
    cityMenu.hide();
    resumePlay();
    combat.clearEnemies();
    police.clear();
    resumeStory();
    hud.notify(slot === 'latest' ? 'Save loaded' : `Loaded ${slot === 'auto' ? 'autosave' : `slot ${slot}`} · ${payload.name ?? 'Solaris Bay'}`, 'mission', 2600);
    refreshTitle();
    return true;
  }

  function continueGame() {
    const data = save.latest();
    if (!data) newGame();
    else loadSlot('latest', data);
  }

  function quitToTitle() {
    app.cancelRespawn?.();
    missions.cancelHeatTimer?.();
    disarmRestart();
    app.mode = 'title';
    app.vehicle = null;
    combat.player.inVehicle = null;
    hud.showPause(false);
    hud.hideStoryComplete();
    hud.setPlaying(false, false);
    hud.showTitle(true);
    refreshTitle();
  }

  /** Title stats, CONTINUE / LOAD GAME labels and the three save cards (staged in photo mode). */
  function refreshTitle() {
    const slots = game.stagedSaves ?? save.list();
    const newest = slots.filter((s) => s.exists).sort((a, b) => b.savedAt - a.savedAt)[0];
    const saved = !isShot && !sessionStarted && newest ? save.read(newest.slot) : null;
    const savedTokens = saved
      ? (Array.isArray(saved.collectedTokens) ? saved.collectedTokens.length : (Number.isFinite(saved.tokens) ? saved.tokens : 0))
      : null;
    hud.setTitle({
      progress: saved ? (saved.progress ?? 0) : missions.progress,
      total: MISSIONS.length,
      cash: saved && Number.isFinite(saved.cash) ? saved.cash : combat.player.cash,
      tokens: savedTokens !== null ? savedTokens : tokens.filter((t) => t.taken).length,
      peak: saved && Number.isFinite(saved.peakWanted) ? saved.peakWanted : Math.max(police.peak, police.wanted),
      hasSave: !!newest,
      slotsUsed: slots.filter((s) => s.exists && s.slot !== 'auto').length,
      saveLabel: newest ? `${newest.label} · ${newest.act.split(' — ')[0]} · ${Math.round(newest.completion ?? 0)}%` : 'LATEST SAVE',
      storyComplete: saved ? !!saved.storyComplete : missions.state.storyComplete,
    });
    hud.setTitleSlots(slots, slotTime);
  }

  function refreshPauseSlots() {
    const p = combat.player;
    hud.refreshSlots(save.list(), {
      cash: p.cash,
      subtitle: `${world.districtName(p.x, p.z)} · ${timeNameAt(game.hour)} · ${clockAt(game.hour)}`,
      time: slotTime,
    });
  }

  function pauseGame() {
    if (app.mode !== 'playing') return;
    disarmRestart();
    app.mode = 'paused';
    hud.showPause(true);
    refreshPauseSlots();
    hud.setSoundLabel(!audio.muted);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function resumeGame() {
    if (app.mode !== 'paused') return;
    disarmRestart();
    app.mode = 'playing';
    hud.showPause(false);
  }

  function showStoryComplete() {
    app.mode = 'story';
    hud.showStoryComplete({
      total: MISSIONS.length,
      cash: combat.player.cash,
      respect: combat.player.respect,
      peak: Math.max(police.peak, police.wanted),
      tokens: tokens.filter((t) => t.taken).length,
    });
    hud.hideMissionPopup();
  }

  const rerender = () => { if (cityMenu.open) cityMenu.render(app.liveMapState()); };

  function handleAction(action, data) {
    app.initAudioOnce();
    if (audio.ready) audio.playUI();
    if (action !== 'restart') disarmRestart();
    switch (action) {
      case 'new': newGame(true); break;
      case 'restart':
        if (!restartArmed) {
          restartArmed = true;
          const btn = document.getElementById('restartBtn');
          if (btn) {
            btn.classList.add('confirm');
            const label = btn.querySelector('.btn-label');
            if (label) label.textContent = 'CLICK AGAIN TO CONFIRM';
          }
          clearTimeout(restartTimer);
          restartTimer = setTimeout(disarmRestart, 5000);
          break;
        }
        disarmRestart();
        newGame(true);
        break;
      case 'continue': continueGame(); break;
      case 'controls': hud.showControls(true); break;
      case 'closeControls': hud.showControls(false); break;
      case 'resume': resumeGame(); break;
      case 'quit': quitToTitle(); break;
      case 'freeRoam': app.mode = 'playing'; hud.hideStoryComplete(); break;
      case 'menuTab': cityMenu.setTab(data.tab); break;
      case 'closeMenu': app.closeCityMenu(); break;
      case 'buyUpgrade':
        if (progression.buyUpgrade(data.upgrade) && app.vehicle) progression.tuneVehicle(app.vehicle);
        rerender();
        break;
      case 'setPaint':
      case 'setNeon':
        // Paint Shop / underglow: restyle the current car live and keep the choice in the autosave.
        if (progression.setStyle(action === 'setNeon' ? 'neon' : 'paint', data.style)) {
          if (app.vehicle) progression.styleVehicle(app.vehicle);
          if (!isShot) save.write('auto', snapshot(game));
        }
        rerender();
        break;
      case 'toggleSound':
        audio.setMuted(!audio.muted);
        hud.setSoundLabel(!audio.muted);
        hud.notify(audio.muted ? 'Sound muted' : 'Sound on', 'info', 1800);
        break;
      case 'toggleFx': {
        const off = document.body.classList.toggle('no-fx');
        hud.setSetting('fx', off ? 'OFF' : 'ON');
        break;
      }
      case 'mouseSpeed': {
        const steps = [[0.6, 'SLOW'], [1, 'NORMAL'], [1.5, 'FAST']];
        const next = steps[(steps.findIndex(([v]) => v === game.mouseScale) + 1) % steps.length];
        game.mouseScale = next[0];
        hud.setSetting('mouse', next[1]);
        break;
      }
      case 'ability':
        if (app.mode === 'playing') crew.useAbility(data.ability);
        break;
      case 'saveSlot':
        if (save.write(data.slot, snapshot(game))) {
          activeSlot = data.slot;
          game.stagedSaves = null;
          hud.notify(`Saved to slot ${data.slot}`, 'mission', 2500);
        } else hud.notify('Could not save (storage blocked)', 'warn', 3000);
        refreshPauseSlots();
        rerender();
        refreshTitle();
        break;
      case 'deleteSlot':
        if (save.remove(data.slot)) hud.notify(`Deleted ${data.slot === 'auto' ? 'autosave' : `slot ${data.slot}`}`, 'warn', 2200);
        refreshPauseSlots();
        if (app.mode === 'title') hud.showSlots(true, save.list(), { time: slotTime });
        refreshTitle();
        break;
      case 'loadMenu': hud.showSlots(true, save.list(), { time: slotTime }); break;
      case 'closeSlots': hud.showSlots(false); break;
      case 'crewToggle': crew.toggle(data.crew); rerender(); break;
      case 'loadSlot': loadSlot(data.slot); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ photo mode
  const shotStage = createShotStage({
    world, traffic, police, combat, missions, activities, progression, hud, camera, game, parkedVehicles,
    random: createRandom(0x50a1b9), crew, turf,
    setVehicle: (car) => {
      app.vehicle = car;
      const p = combat.player;
      p.inVehicle = car;
      if (car) Object.assign(p, { x: car.x, z: car.z, y: car.y, heading: car.heading });
    },
    setCameraAngles: (yaw, pitch) => { rig.yaw = yaw; rig.pitch = pitch; },
    setStageCity: (city) => { app.stageCity = city; },
    openMenu: (tab) => app.openCityMenu(tab),
  });

  /** One photo-mode frame: the stage's own animation and the HUD a live frame would show. */
  function shotFrame(elapsed) {
    shotStage.frame(elapsed, shotName);
    renderer.resize();
    const p = combat.player;
    const mission = missions.active ? missions.mission : null;
    const near = app.vehicle ? null : app.findVehicleNear(p.x, p.z, 6);
    hud.update({
      ...app.liveMapState(),
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
      city: app.cityProgress(),
      crew: crew.roster(),
      abilities: crew.abilities(),
      police: app.policeInfo(),
    });
    hud.setPlaying(shotName !== 'title', !!app.vehicle);
    if (cityMenu.open) cityMenu.render(app.liveMapState());
    shotReadyFrames += 1;
    if (shotReadyFrames > 5 && !window.__shotReady) window.__shotReady = true;
  }

  function boot() {
    if (isShot) {
      shotStage.stage(shotName);
      hud.setRadio('SUNSET FM 96.6');
    } else {
      hud.showTitle(true);
      hud.setPlaying(false, false);
    }
    refreshTitle();
  }

  // ------------------------------------------------------------------ test hooks
  /** World point to canvas pixel through the live camera (null behind it). */
  function project(x, y, z) {
    const { width, height } = renderer.stats();
    const fwd = normalize3([camera.target[0] - camera.pos[0], camera.target[1] - camera.pos[1], camera.target[2] - camera.pos[2]]);
    const right = normalize3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);
    const rel = [x - camera.pos[0], y - camera.pos[1], z - camera.pos[2]];
    const dot = (a) => rel[0] * a[0] + rel[1] * a[1] + rel[2] * a[2];
    const zc = dot(fwd);
    if (zc <= 0.1) return null;
    const ty = Math.tan((camera.fov * Math.PI) / 360);
    const sx = (dot(right) / zc) / (ty * (width / height)), sy = (dot(up) / zc) / ty;
    return { x: Math.round((sx * 0.5 + 0.5) * width), y: Math.round((0.5 - sy * 0.5) * height), depth: zc };
  }

  window.__solaris = {
    get state() {
      const p = combat.player;
      const car = app.vehicle;
      return {
        mode: app.mode,
        missionsTotal: MISSIONS.length,
        cover: p.cover ? { kind: p.cover.kind, name: p.cover.name } : null,
        peek: p.peek ?? 0,
        crew: crew.roster().map((c) => ({ id: c.id, recruited: c.recruited, deployed: c.deployed, status: c.status })),
        mateo: { visible: crew.mateo.visible, x: crew.mateo.x, z: crew.mateo.z, crouch: crew.mateo.crouch, status: crew.mateo.status },
        crewShots: crew.state.shots,
        crewHits: crew.state.hits,
        turf: { ...turf.state.standing },
        turfPay: turf.payPerMinute(),
        turfDiscount: turf.discount(),
        roadblocks: police.roadblocks.length,
        barriers: police.roadblocks.reduce((n, b) => n + b.barriers.length, 0),
        flares: police.roadblocks.reduce((n, b) => n + b.flares.length, 0),
        dispatch: hud.els.dispatch.classList.contains('show') ? hud.els.dispatchTitle.textContent : null,
        dispatchUnits: police.getDispatchUnits(),
        dispatchTable: hud.els.dispatchTable.classList.contains('hidden') ? null : [...hud.els.dtRows.children].filter((r) => !r.classList.contains('hidden')).map((r) => r.textContent.trim()),
        abilities: crew.abilities().map((a) => ({ id: a.id, ready: a.ready, cooldown: a.cooldownLeft, running: a.running, status: a.status })),
        jammed: police.jammed,
        inSight: police.inSight,
        weapons: combat.player.weapons.slice(),
        weaponSlot: combat.player.weaponSlot,
        armor: p.armor,
        hack: missions.state.hack,
        cash: p.cash,
        wanted: police.wanted,
        wantedLabel: police.label,
        evasion: police.evasion,
        officers: combat.enemies.filter((e) => e.police && e.alive).length,
        mission: missions.index,
        missionActive: missions.active,
        missionStep: missions.stepIndex,
        objective: missions.objectiveText(),
        health: p.health,
        vehicle: car?.type ?? null,
        speed: car?.speed ?? 0,
        district: world.districtName(p.x, p.z),
        renders: renderer.stats(),
        tokens: tokens.filter((t) => t.taken).length,
        respect: p.respect,
        rank: progression.rank.name,
        upgrades: { ...progression.state.upgrades },
        stored: progression.state.stored.slice(),
        activity: activities.active?.id ?? null,
        activityStep: activities.state.index,
        menuOpen: cityMenu.open,
        helicopter: !!police.helicopter,
        police: police.allCars().length,
        paint: progression.state.paint,
        neon: progression.state.neon,
        carColor: car?.color ? Array.from(car.color) : null,
        underglow: car?.underglow ? Array.from(car.underglow) : null,
        radio: audio.currentStation()?.name ?? null,
        audioReady: audio.ready,
        gear: audio.gear,
        lampsDown: world.lampposts.filter((l) => l.knocked).length,
        hydrantsBroken: world.hydrants.filter((h) => h.broken).length,
        streak: activities.state.streak,
        cowering: traffic.pedestrians.filter((ped) => ped.duck > 0).length,
        fleeing: traffic.pedestrians.filter((ped) => ped.panic > 0).length,
        yielding: traffic.cars.filter((c) => (c.yield ?? 0) > 0.2).length,
      };
    },
    openMenu(tab = 'map') { app.openCityMenu(tab); },
    closeMenu() { app.closeCityMenu(); },
    start() { newGame(true); },
    continue() { continueGame(); },
    enterNearest() {
      const car = app.findVehicleNear(combat.player.x, combat.player.z, 8);
      if (car) app.enterVehicle(car);
    },
    drive(seconds = 1) {
      for (let i = 0; i < seconds * 60; i += 1) {
        const car = app.vehicle;
        if (!car) break;
        updateVehicle(car, { throttle: 1, steer: 0.08, handbrake: false, boost: true }, STEP, world);
        combat.player.x = car.x;
        combat.player.z = car.z;
      }
      app.updateCamera(0.016);
    },
    raise(n = 3) { police.raise(n, 'debug'); },
    ability(id) { return crew.useAbility(id); },
    spawnCop() { police.spawnCruiser(null, 30); },
    teleport(x, z) {
      const p = combat.player;
      Object.assign(p, { x, z, y: world.groundHeight(x, z) });
      if (app.vehicle) Object.assign(app.vehicle, { x, z });
    },
    save(slot = '1') { save.write(slot, snapshot(game)); refreshTitle(); },
    load(slot = '1') { const data = save.read(slot); if (data) { applySnapshot(game, data); refreshTitle(); } return !!data; },
    missionStage(i, s) { missions.stage(i, s); },
    setCam(px, py, pz, tx, ty, tz, fov = 55) {
      Object.assign(camera, { pos: [px, py, pz], target: [tx, ty, tz], fov });
      app.mode = 'shot';
    },
    setHour(h) { game.hour = h; },
    hero(x, z, heading) {
      const car = app.vehicle;
      if (!car) return;
      Object.assign(car, { x, z, heading, y: world.groundHeight(x, z) + 0.02 });
      Object.assign(combat.player, { x, z, heading });
    },
    stage(name) { shotStage.stage(name); },
    hideHud(hidden) { hud.els.hud.classList.toggle('hidden', !!hidden); },
    project,
    probe(x, y) {
      app.renderFrame();
      const gl = renderer.gl;
      const px = new Uint8Array(4);
      gl.readPixels(Math.round(x), Math.round(gl.drawingBufferHeight - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    },
    /** The raw camera ray for a pixel, so the sky can be checked without a screenshot. */
    probeSky(x, y) {
      const { width, height } = renderer.stats();
      const ndcX = (x / width) * 2 - 1, ndcY = 1 - (y / height) * 2;
      const fwd = normalize3([camera.target[0] - camera.pos[0], camera.target[1] - camera.pos[1], camera.target[2] - camera.pos[2]]);
      const right = normalize3(cross3(fwd, [0, 1, 0]));
      const up = cross3(right, fwd);
      const ty = Math.tan((camera.fov * Math.PI) / 360), tx = ty * (width / height);
      const dir = normalize3([0, 1, 2].map((i) => fwd[i] + right[i] * ndcX * tx + up[i] * ndcY * ty));
      const env = envAtHour(game.hour);
      const sd = Math.max(dir[0] * env.sunDir[0] + dir[1] * env.sunDir[1] + dir[2] * env.sunDir[2], 0);
      return { dir, sd, sunDir: env.sunDir, skyTop: env.skyTop, skyHorizon: env.skyHorizon, sunGlow: env.sunGlow };
    },
    debug: {
      missions, combat, police, traffic, world, crew, turf, progression, activities, save,
      /** Run the live update loop for `seconds` of game time (tests use this to step AI). */
      step(seconds = 1) { for (let i = 0; i < Math.round(seconds * 60); i += 1) app.updateGame(STEP); },
      keydown(code) { window.dispatchEvent(new KeyboardEvent('keydown', { code })); window.dispatchEvent(new KeyboardEvent('keyup', { code })); },
      placeCar(type, x, z, heading = 0) {
        const car = createVehicle(type, x, z, heading, { parked: true });
        car.y = world.groundHeight(x, z) + 0.02;
        parkedVehicles.push(car);
        return car.type;
      },
      get input() { return { ...app.mouse, keys: [...keys], pressed: [...pressedKeys] }; },
      get fx() { return { skids: skidMarks.length, smoke: tyreSmoke.length }; },
    },
    renderer,
  };

  return {
    handleAction, newGame, continueGame, pauseGame, resumeGame, refreshTitle, showStoryComplete, shotFrame, boot, slotTime,
    get activeSlot() { return activeSlot; },
  };
}
