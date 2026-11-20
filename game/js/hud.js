// hud.js — the whole overlay in four dark-glass corner clusters: the vector minimap
// and vitals (bottom-left), heat stars, cash, respect rank and weapon rail with
// hand-drawn SVG icons (top-right), district, radio and speedometer (bottom-right), the
// mission card and activity timer (top-centre), plus dialogue, toasts, prompts and the
// title, manual, pause/save and story-complete screens. DOM + the minimap canvas.

import { kmh } from './config.js';
import { createMapPainter } from './minimap.js';
import { rankFor } from './progression.js';

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
    cityProgress: byId('cityProgress'),
    cpDistricts: byId('cpDistricts'),
    cpPips: byId('cpPips'),
    cpJobs: byId('cpJobs'),
    cpSafehouse: byId('cpSafehouse'),
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
    rankName: byId('rankName'),
    rankFill: byId('rankFill'),
    respect: byId('respectValue'),
    activityChip: byId('activityChip'),
    activityCode: byId('activityCode'),
    activityName: byId('activityName'),
    activityCp: byId('activityCp'),
    activityTimer: byId('activityTimer'),
  };
  const painter = createMapPainter(world);
  let bannerTimeout = 0;
  let dialogueTimeout = 0;
  let popupTimeout = 0;
  let lastWeapon = '';
  let lastAmmoText = '';
  let lastStars = -1;
  let lastDistrict = '';
  let lastClock = '';

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
    setText(els.bannerSub, mission.steps ? `${mission.giver ?? 'ELENA'} · MISSION ${mission.code}` : `${mission.giver ?? 'SIDE ACTIVITY'} · ${mission.code ?? ''}`);
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

    // Respect rank under the cash counter.
    const rank = rankFor(player.respect ?? 0);
    setText(els.rankName, rank.name.toUpperCase());
    setText(els.respect, `${money(player.respect ?? 0)} RP`);
    els.rankFill.style.width = `${Math.round(rank.progress * 100)}%`;

    // Side-activity timer under the mission card.
    const act = state.activity;
    els.activityChip.classList.toggle('hidden', !act);
    if (act) {
      setText(els.activityCode, act.code);
      setText(els.activityName, act.name.toUpperCase());
      setText(els.activityCp, `CP ${Math.min(act.total, act.step + 1)} / ${act.total}`);
      const t = Math.max(0, act.timer);
      setText(els.activityTimer, `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`);
    }

    painter.drawMinimap(els.minimap, {
      player, vehicle, wanted, policeCars, trafficCars, parkedCars, waypoint,
      helicopter: state.helicopter, activityStarts: state.activityStarts, checkpoints: state.checkpoints,
    });
    void missionProgress; void tokens; void evasion; void targetVehicle; void district; void mission;
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
    painter,
  };
}
