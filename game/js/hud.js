// hud.js — the whole overlay: circular live minimap pre-rendered once and panned,
// wanted stars, cash, health/armour, weapon rail with hand-drawn SVG icons, mission
// card and banner, dialogue, notifications, speedometer/nitro, prompts and every
// menu (title, controls manual, pause/save, story complete). DOM + one 2D canvas.

import { WEAPONS, kmh, rgb } from './config.js';

const STAR_COUNT = 5;

const WEAPON_ICONS = {
  fists: '<svg viewBox="0 0 40 30" fill="none"><path d="M11 9h4v8h-4zM16 7h4v10h-4zM21 9h4v8h-4zM26 12h4v6h-4z" fill="currentColor"/><path d="M10 17c0 6 4 9 9 9h4c3 0 5-2 5-5v-6h-3v3h-2v-4h-3v4h-2v-6h-3v6h-2v-3h-3z" fill="currentColor" opacity=".7"/></svg>',
  pistol: '<svg viewBox="0 0 40 30" fill="none"><path d="M6 9h23v5H17v2h-4v-2H6z" fill="currentColor"/><path d="M16 16h6l-2 10h-5z" fill="currentColor" opacity=".75"/><path d="M29 10h5v3h-5z" fill="currentColor" opacity=".55"/></svg>',
  smg: '<svg viewBox="0 0 40 30" fill="none"><path d="M4 11h25v5H14v3H8v-3H4z" fill="currentColor"/><path d="M14 16h6v9h-6z" fill="currentColor" opacity=".7"/><path d="M29 12h7v2h-7z" fill="currentColor"/><path d="M22 9h6v2h-6z" fill="currentColor" opacity=".5"/></svg>',
  shotgun: '<svg viewBox="0 0 40 30" fill="none"><path d="M3 12h27v4H13v3H7v-3H3z" fill="currentColor"/><path d="M13 19h7l-3 8H9z" fill="currentColor" opacity=".75"/><path d="M30 11h8v2h-8z" fill="currentColor"/><path d="M10 9h14v2H10z" fill="currentColor" opacity=".5"/></svg>',
};

const SLOT_NAMES = ['fists', 'pistol', 'smg', 'shotgun'];

function byId(id) {
  return document.getElementById(id);
}

export function createHud({ onAction, world }) {
  const els = {
    hud: byId('hud'),
    title: byId('titleScreen'),
    controls: byId('controlsScreen'),
    pause: byId('pauseScreen'),
    story: byId('storyScreen'),
    popup: byId('missionPopup'),
    loading: byId('loading'),
    minimap: byId('minimap'),
    district: byId('districtName'),
    clock: byId('clock'),
    timeName: byId('timeName'),
    wantedRow: byId('wantedRow'),
    wantedLabel: byId('wantedLabel'),
    cash: byId('cashValue'),
    radio: byId('radioName'),
    missionCard: byId('missionCard'),
    missionCode: byId('missionCode'),
    missionFrac: byId('missionFrac'),
    missionName: byId('missionName'),
    objective: byId('objectiveText'),
    missionMeter: byId('missionMeterFill'),
    banner: byId('missionBanner'),
    bannerKicker: byId('bannerKicker'),
    bannerTitle: byId('bannerTitle'),
    bannerSub: byId('bannerSub'),
    notifications: byId('notifications'),
    dialogue: byId('dialogueCard'),
    dialogueSpeaker: byId('dialogueSpeaker'),
    dialogueText: byId('dialogueText'),
    dialoguePortrait: byId('dialoguePortrait'),
    crosshair: byId('crosshair'),
    hitmarker: byId('hitmarker'),
    prompt: byId('interactPrompt'),
    promptText: byId('interactText'),
    healthFill: byId('healthFill'),
    armorFill: byId('armorFill'),
    healthNum: byId('healthNum'),
    armorNum: byId('armorNum'),
    weaponIcon: byId('weaponIcon'),
    weaponName: byId('weaponName'),
    ammoMag: byId('ammoMag'),
    ammoReserve: byId('ammoReserve'),
    ammoHint: byId('ammoHint'),
    weaponSlots: byId('weaponSlots'),
    speedo: byId('speedo'),
    speedValue: byId('speedValue'),
    speedLabel: byId('speedo').querySelector('.speed-label'),
    gear: byId('gearValue'),
    rpm: byId('rpmFill'),
    nitro: byId('nitroFill'),
    drift: byId('driftTag'),
    hints: byId('controlsHint'),
    damage: byId('damageFlash'),
    speedLines: byId('speedLines'),
    continueBtn: byId('continueBtn'),
    continueMeta: byId('continueMeta'),
    titleProgress: byId('titleProgress'),
    titleCash: byId('titleCash'),
    titleTokens: byId('titleTokens'),
    titlePeak: byId('titlePeak'),
    pauseSub: byId('pauseSub'),
    pauseCash: byId('pauseCash'),
    saveSlots: byId('saveSlots'),
    loadSlots: byId('loadSlots'),
    soundLabel: byId('soundLabel'),
    storyStats: byId('storyStats'),
    popupName: byId('popupName'),
    popupReward: byId('popupReward'),
    popupNext: byId('popupNext'),
    status: byId('statusLine'),
  };
  const ctx = els.minimap.getContext('2d');
  const map = buildStaticMap(world);
  let bannerTimeout = 0;
  let dialogueTimeout = 0;
  let popupTimeout = 0;
  let lastWeapon = '';
  let lastAmmoText = '';
  let lastStars = -1;
  let lastDistrict = '';
  let lastClock = '';

  // ------------------------------------------------------------- static map
  function buildStaticMap(worldData) {
    const minX = -540, maxX = 810, minZ = -560, maxZ = 500;
    const scale = 1.25;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((maxX - minX) * scale);
    canvas.height = Math.ceil((maxZ - minZ) * scale);
    const g = canvas.getContext('2d');
    const px = (x) => (x - minX) * scale;
    const py = (z) => (z - minZ) * scale;
    const rect = (x, z, w, d, fill) => {
      g.fillStyle = fill;
      g.fillRect(px(x - w / 2), py(z - d / 2), w * scale, d * scale);
    };
    g.fillStyle = '#13323d';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Ocean sparkle bands.
    g.fillStyle = 'rgba(80, 190, 200, 0.06)';
    for (let i = 0; i < 22; i += 1) {
      g.fillRect(0, i * 80 + 20, canvas.width, 2);
    }
    // Land mass, island, beach, pier.
    rect(40, -84, 960, 772, '#202d35');
    rect(654, 185, 212, 230, '#202d35');
    rect(25, 319, 990, 34, '#8a7752');
    rect(-166, 374, 20, 144, '#5c4830');
    // Districts as very subtle bands.
    const tint = { '#ffb257': 'rgba(255,178,87,0.10)', '#c56cff': 'rgba(197,108,255,0.10)', '#57d8d0': 'rgba(87,216,208,0.08)', '#5cc8ff': 'rgba(92,200,255,0.09)', '#9ee06a': 'rgba(158,224,106,0.07)' };
    rect(0, 242, 900, 40, tint['#ffb257']);
    rect(-10, -60, 420, 300, tint['#c56cff']);
    rect(-350, -210, 230, 320, tint['#57d8d0']);
    rect(345, 200, 330, 190, tint['#5cc8ff']);
    // Roads.
    for (const r of worldData.roads) {
      const w = Math.max(1.2, r.w * scale * 0.62);
      g.strokeStyle = r.main ? '#a7b5b8' : '#7b8b90';
      g.lineWidth = w;
      g.lineCap = 'square';
      g.beginPath();
      g.moveTo(px(r.x1), py(r.z1));
      g.lineTo(px(r.x2), py(r.z2));
      g.stroke();
    }
    // Boulevard highlight.
    g.strokeStyle = '#c6b795';
    g.lineWidth = 32 * scale * 0.16;
    g.beginPath(); g.moveTo(px(-438), py(260)); g.lineTo(px(518), py(260)); g.stroke();
    // Buildings.
    for (const b of worldData.buildings) {
      if (!b || b.invisible) continue;
      const tall = b.h > 30;
      g.fillStyle = tall ? '#405a66' : '#2d3f48';
      g.fillRect(px(b.x - b.w / 2), py(b.z - b.d / 2), Math.max(2, b.w * scale * 0.9), Math.max(2, b.d * scale * 0.9));
      if (b.h > 60) {
        g.fillStyle = 'rgba(255, 194, 75, 0.45)';
        g.fillRect(px(b.x) - 1, py(b.z) - 1, 2, 2);
      }
    }
    // Coastline edge.
    g.strokeStyle = 'rgba(120, 220, 225, 0.28)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px(-440), py(303));
    g.lineTo(px(520), py(303));
    g.stroke();
    return { canvas, minX, maxX, minZ, maxZ, scale, px, py };
  }

  // --------------------------------------------------------------- utilities
  function money(value) {
    return Number(Math.round(value)).toLocaleString('en-US');
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }

  function showLoadingDone() {
    els.loading.classList.add('done');
  }

  function announce(text) {
    setText(els.status, text);
  }

  // ------------------------------------------------------------------ title
  function setTitle(info = {}) {
    setText(els.titleProgress, `${info.progress ?? 0} / 5`);
    setText(els.titleCash, `$${money(info.cash ?? 640)}`);
    setText(els.titleTokens, `${info.tokens ?? 0} / 12`);
    setText(els.titlePeak, `★ ${info.peak ?? 0}`);
    if (els.continueBtn) {
      els.continueBtn.disabled = !info.hasSave;
      setText(els.continueMeta, info.hasSave ? info.saveLabel ?? 'LATEST SAVE' : 'NO SAVE FOUND');
    }
    if (info.storyComplete) setText(els.titleProgress, '5 / 5');
  }

  function showTitle(show = true) {
    els.title.classList.toggle('hidden', !show);
    els.hud.classList.toggle('hidden', show);
    els.controls.classList.add('hidden');
    els.pause.classList.add('hidden');
  }

  function showControls(show = true) {
    els.controls.classList.toggle('hidden', !show);
  }

  function showPause(show = true) {
    els.pause.classList.toggle('hidden', !show);
    if (!show) els.controls.classList.add('hidden');
  }

  function refreshSlots(slots, info = {}) {
    const render = (target, mode) => {
      if (!target) return;
      target.innerHTML = '';
      const chosen = mode === 'save' ? slots.filter((s) => s.slot !== 'auto') : slots.filter((s) => s.exists);
      if (!chosen.length) {
        const empty = document.createElement('div');
        empty.className = 'slot empty';
        empty.innerHTML = '<div class="slot-name">NO SAVES YET</div><span class="slot-meta">Finish a mission to autosave</span>';
        target.appendChild(empty);
        return;
      }
      for (const slot of chosen) {
        const button = document.createElement('button');
        button.className = `slot${slot.exists ? '' : ' empty'}`;
        button.dataset.action = mode === 'save' ? 'saveSlot' : 'loadSlot';
        button.dataset.slot = slot.slot;
        button.innerHTML = `<div class="slot-name">${slot.label}${slot.exists ? '<em>READY</em>' : '<em>EMPTY</em>'}</div>
          <span class="slot-meta">${slot.exists ? `$${money(slot.cash)} · ${slot.progress}/5 missions${slot.storyComplete ? ' · COMPLETE' : ''}` : 'Click to write this slot'}</span>`;
        target.appendChild(button);
      }
    };
    render(els.saveSlots, 'save');
    render(els.loadSlots, 'load');
    if (info.cash !== undefined) setText(els.pauseCash, `$${money(info.cash)}`);
    if (info.subtitle) setText(els.pauseSub, info.subtitle);
  }

  function setSoundLabel(on) {
    setText(els.soundLabel, `SOUND · ${on ? 'ON' : 'OFF'}`);
  }

  function showStoryComplete(stats) {
    els.story.classList.remove('hidden');
    els.storyStats.innerHTML = `
      <div class="stat"><span class="stat-label">MISSIONS</span><span class="stat-value">5 / 5</span></div>
      <div class="stat"><span class="stat-label">CASH</span><span class="stat-value gold">$${money(stats.cash)}</span></div>
      <div class="stat"><span class="stat-label">RESPECT</span><span class="stat-value">${stats.respect}</span></div>
      <div class="stat"><span class="stat-label">PEAK HEAT</span><span class="stat-value">★ ${stats.peak}</span></div>
      <div class="stat"><span class="stat-label">SUN TOKENS</span><span class="stat-value">${stats.tokens} / 12</span></div>`;
  }

  function hideStoryComplete() {
    els.story.classList.add('hidden');
  }

  // ------------------------------------------------------------ notifications
  function notify(text, kind = 'info', duration = 3600) {
    if (!text) return;
    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    toast.innerHTML = `<span class="toast-dot"></span><span>${text}</span>`;
    els.notifications.appendChild(toast);
    while (els.notifications.children.length > 4) els.notifications.firstChild.remove();
    setTimeout(() => {
      toast.style.transition = 'opacity .3s ease, transform .3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(10px)';
      setTimeout(() => toast.remove(), 320);
    }, duration);
  }

  function missionBanner(mission, kicker = 'MISSION START', duration = 5200) {
    if (!mission) return;
    setText(els.bannerKicker, kicker);
    setText(els.bannerTitle, mission.name);
    setText(els.bannerSub, `${mission.giver ?? 'ELENA'} · ${mission.code ? `MISSION ${mission.code}` : ''}`);
    els.banner.classList.add('show');
    clearTimeout(bannerTimeout);
    if (duration > 0) {
      bannerTimeout = setTimeout(() => els.banner.classList.remove('show'), duration);
    }
  }

  function objective(label, mission, stepIndex, total) {
    setText(els.objective, label ?? '');
    if (mission) {
      setText(els.missionCode, `MISSION ${mission.code ?? mission.id + 1}`);
      setText(els.missionName, mission.name.toUpperCase());
      const step = Number.isFinite(stepIndex) ? stepIndex + 1 : 1;
      const steps = total ?? mission.steps?.length ?? 1;
      setText(els.missionFrac, `STEP ${step} / ${steps}`);
      els.missionMeter.style.width = `${Math.min(100, (step / steps) * 100)}%`;
      els.missionCard.classList.remove('hidden');
    } else {
      els.missionCard.classList.add('hidden');
    }
  }

  function dialogue(speaker, text, duration = 6200) {
    if (!text) return;
    setText(els.dialogueSpeaker, speaker ?? 'ELENA');
    setText(els.dialogueText, text);
    setText(els.dialoguePortrait, (speaker ?? 'ELENA').trim().charAt(0));
    els.dialogue.classList.add('show');
    clearTimeout(dialogueTimeout);
    if (duration > 0) {
      dialogueTimeout = setTimeout(() => els.dialogue.classList.remove('show'), duration);
    }
  }

  function missionComplete(mission, reward, nextName) {
    if (!mission) return;
    setText(els.popupName, mission.name.toUpperCase());
    setText(els.popupReward, `+$${money(reward)}`);
    setText(els.popupNext, nextName ? `NEXT · ${nextName.toUpperCase()}` : 'SOLARIS BAY IS YOURS');
    els.popup.classList.remove('hidden');
    clearTimeout(popupTimeout);
    popupTimeout = setTimeout(() => els.popup.classList.add('hidden'), 4600);
  }

  function hideMissionPopup() {
    els.popup.classList.add('hidden');
  }

  // ---------------------------------------------------------------- effects
  function flashDamage() {
    els.damage.classList.add('active');
    setTimeout(() => els.damage.classList.remove('active'), 110);
  }

  function hitmarker() {
    els.hitmarker.classList.remove('show');
    void els.hitmarker.offsetWidth;
    els.hitmarker.classList.add('show');
  }

  function setPrompt(text) {
    if (!text) {
      els.prompt.classList.remove('show');
      return;
    }
    setText(els.promptText, text);
    els.prompt.classList.add('show');
  }

  function setHint(text) {
    setText(els.hints, text);
  }

  function setRadio(name) {
    setText(els.radio, name ? `RADIO · ${name}` : 'RADIO OFF');
  }

  function setPlaying(playing, inVehicle) {
    els.hud.classList.toggle('hidden', !playing);
    document.body.classList.toggle('driving', !!inVehicle);
  }

  // ------------------------------------------------------------------ update
  function update(state) {
    const {
      player, vehicle, wanted, evasion, policeCars, trafficCars, parkedCars, targetVehicle,
      district, clock, timeName, radio, prompt, aiming, mission, missionStep,
      missionTotal, missionProgress, waypoint, tokens,
    } = state;
    if (!player) return;
    setText(els.district, (district ?? 'SOLARIS BAY').toUpperCase());
    if (els.district.textContent !== lastDistrict) {
      lastDistrict = els.district.textContent;
      els.district.parentElement?.querySelector('.district-dot')?.style.setProperty('--c', '#ffc24b');
    }
    if (clock !== lastClock) {
      setText(els.clock, clock);
      lastClock = clock;
    }
    setText(els.timeName, timeName);
    setText(els.cash, money(player.cash));
    setText(els.radio, radio ? `RADIO · ${radio}` : 'RADIO OFF');

    if (wanted !== lastStars) {
      lastStars = wanted;
      [...els.wantedRow.querySelectorAll('.star')].forEach((el, i) => el.classList.toggle('on', i < wanted));
      els.wantedRow.classList.toggle('high', wanted >= 3);
    }
    els.wantedRow.classList.toggle('evading', !!evasion);
    const label = wanted === 0 ? 'CLEAR' : evasion ? 'EVADING' : `${wanted}-STAR WANTED`;
    setText(els.wantedLabel, label);
    els.wantedLabel.classList.toggle('hot', wanted >= 3 || !!evasion);

    setText(els.healthNum, String(Math.ceil(player.health)));
    setText(els.armorNum, String(Math.ceil(player.armor)));
    els.healthFill.style.width = `${Math.max(0, Math.min(100, (player.health / player.maxHealth) * 100))}%`;
    els.armorFill.style.width = `${Math.max(0, Math.min(100, (player.armor / player.maxArmor) * 100))}%`;

    // Weapon panel.
    const weapon = state.weapon;
    if (weapon && weapon.id !== lastWeapon) {
      lastWeapon = weapon.id;
      els.weaponIcon.innerHTML = WEAPON_ICONS[weapon.id] ?? WEAPON_ICONS.pistol;
      setText(els.weaponName, weapon.name.toUpperCase());
      els.weaponSlots.querySelectorAll('span').forEach((el) => {
        const slot = Number(el.dataset.slot);
        el.classList.toggle('active', slot === player.weaponSlot);
        el.classList.toggle('locked', !player.weapons.includes(SLOT_NAMES[slot - 1]));
      });
    }
    const ammo = state.ammo;
    let ammoText;
    if (!weapon || weapon.melee) {
      ammoText = 'MELEE';
      setText(els.ammoMag, '∞');
      setText(els.ammoReserve, '');
      setText(els.ammoHint, '');
    } else if (player.reloadTimer > 0) {
      ammoText = 'RELOADING';
      setText(els.ammoMag, '…');
      setText(els.ammoReserve, '');
      setText(els.ammoHint, 'RELOADING');
    } else {
      ammoText = `${ammo?.mag ?? 0}/${ammo?.reserve ?? 0}`;
      setText(els.ammoMag, String(ammo?.mag ?? 0));
      setText(els.ammoReserve, String(ammo?.reserve ?? 0));
      setText(els.ammoHint, (ammo?.mag ?? 0) <= 3 ? 'RELOAD' : '');
    }
    if (ammoText !== lastAmmoText) lastAmmoText = ammoText;

    // Crosshair.
    const hasAim = !vehicle && !player.dead;
    els.crosshair.classList.toggle('active', hasAim);
    els.crosshair.classList.toggle('aim', hasAim && (!!aiming || (weapon && weapon.id !== 'fists')));

    // Mission card.
    if (mission) {
      if (els.missionCode.textContent !== `MISSION ${mission.code ?? mission.id + 1}` || els.missionName.textContent !== mission.name.toUpperCase()) {
        objective(state.objectiveText ?? els.objective.textContent, mission, missionStep, missionTotal);
      } else {
        setText(els.objective, state.objectiveText ?? els.objective.textContent);
      }
    } else if (!missionProgress) {
      els.missionCard.classList.add('hidden');
    }

    // Speedometer.
    if (vehicle) {
      els.speedo.classList.remove('hidden');
      const kph = kmh(Math.abs(vehicle.speed ?? 0));
      setText(els.speedValue, String(kph));
      const gear = vehicle.speed < -0.3 ? 'R' : vehicle.speed < 0.4 ? 'N' : String(Math.max(1, Math.min(6, 1 + Math.floor((Math.abs(vehicle.speed) / vehicle.spec.maxSpeed) * 5.6))));
      setText(els.gear, vehicle.airborne ? '✈' : gear);
      setText(els.speedLabel, (vehicle.spec?.name ?? 'SOLARIS').toUpperCase());
      const ratio = Math.min(1, Math.abs(vehicle.speed) / (vehicle.spec.maxSpeed * 1.05));
      els.rpm.style.width = `${6 + ratio * 94}%`;
      els.nitro.style.width = `${Math.round((vehicle.boost ?? 1) * 100)}%`;
      els.drift.classList.toggle('hidden', !((vehicle.drift ?? 0) > 2.2 && Math.abs(vehicle.speed) > 6));
      els.speedLines.classList.toggle('boosting', !!vehicle.boosting);
      setHint('W / S THROTTLE · A / D STEER · SHIFT NITRO · SPACE HANDBRAKE · E / F EXIT · R RADIO · ESC PAUSE');
    } else {
      els.speedo.classList.add('hidden');
      els.speedLines.classList.remove('boosting');
      setHint('WASD MOVE · SHIFT SPRINT · SPACE JUMP · LMB FIRE · 1-4 WEAPON · E / F VEHICLE · R RADIO · ESC PAUSE');
    }

    // Prompt.
    setPrompt(prompt);

    drawMinimap({
      player, vehicle, wanted, evasion, policeCars, trafficCars, parkedCars, targetVehicle,
      waypoint, mission, aiming, district,
    });
    void missionProgress; void tokens;
  }

  // ----------------------------------------------------------------- minimap
  function drawMinimap(state) {
    const size = els.minimap.width;
    const half = size / 2;
    const range = 195;
    const scale = size / (range * 2);
    const px = state.vehicle ? state.vehicle.x : state.player.x;
    const pz = state.vehicle ? state.vehicle.z : state.player.z;
    const heading = state.vehicle ? state.vehicle.heading : state.player.heading;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#102b35';
    ctx.fillRect(0, 0, size, size);
    const sx = (px - range - map.minX) * map.scale;
    const sy = (pz - range - map.minZ) * map.scale;
    const sw = range * 2 * map.scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map.canvas, sx, sy, sw, sw, 0, 0, size, size);
    const toScreen = (x, z) => [half + (x - px) * scale, half + (z - pz) * scale];

    // Traffic and parked cars.
    ctx.fillStyle = 'rgba(233, 238, 235, 0.55)';
    for (const car of state.trafficCars ?? []) {
      const [x, y] = toScreen(car.x, car.z);
      if (Math.hypot(x - half, y - half) > half - 9) continue;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.fillStyle = 'rgba(150, 170, 175, 0.6)';
    for (const car of state.parkedCars ?? []) {
      if (car === state.vehicle) continue;
      const [x, y] = toScreen(car.x, car.z);
      if (Math.hypot(x - half, y - half) > half - 9) continue;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    // Mission waypoint (gold diamond) and edge pin.
    const wp = state.waypoint;
    if (wp) {
      let [wx, wy] = toScreen(wp.x, wp.z);
      const dist = Math.hypot(wx - half, wy - half);
      const limit = half - 18;
      let pinned = false;
      if (dist > limit) {
        const t = limit / dist;
        wx = half + (wx - half) * t;
        wy = half + (wy - half) * t;
        pinned = true;
      }
      const pulse = 0.6 + Math.sin(performance.now() * 0.004) * 0.28;
      ctx.save();
      ctx.translate(wx, wy);
      if (pinned) {
        ctx.rotate(Math.atan2(wy - half, wx - half) + Math.PI / 2);
      }
      ctx.fillStyle = '#ffc24b';
      ctx.shadowColor = 'rgba(255, 194, 75, 0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(6, 0);
      ctx.lineTo(0, 7);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      if (!pinned) {
        ctx.strokeStyle = `rgba(255, 194, 75, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Police blips.
    const now = performance.now();
    const flash = Math.floor(now / 220) % 2;
    for (const car of state.policeCars ?? []) {
      let [x, y] = toScreen(car.x, car.z);
      const dist = Math.hypot(x - half, y - half);
      if (dist > half - 12) {
        const t = (half - 12) / dist;
        x = half + (x - half) * t;
        y = half + (y - half) * t;
      }
      ctx.save();
      ctx.shadowColor = flash ? 'rgba(255, 55, 80, 0.9)' : 'rgba(70, 120, 255, 0.9)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = flash ? '#ff4657' : '#4f82ff';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.restore();
    }

    // Player arrow.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(Math.PI - heading);
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = state.vehicle ? '#55ebff' : '#ffc24b';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3, 3);
    ctx.lineTo(-3, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // A subtle range ring.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(half, half, half * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    onAction?.(action, target.dataset);
  });

  return {
    els,
    update,
    setTitle,
    showTitle,
    showControls,
    showPause,
    refreshSlots,
    setSoundLabel,
    showStoryComplete,
    hideStoryComplete,
    notify,
    missionBanner,
    objective,
    dialogue,
    missionComplete,
    hideMissionPopup,
    flashDamage,
    hitmarker,
    setPrompt,
    showPrompt: setPrompt,
    setHint,
    setRadio,
    setPlaying,
    showLoadingDone,
    announce,
    money,
  };
}
