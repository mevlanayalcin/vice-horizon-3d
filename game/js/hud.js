// hud.js — the live overlay, laid out in corner clusters around a clear centre:
//   top-left      SBPD RESPONSE: one row per live unit (callsign, role, distance) read from
//                 police.getDispatchUnits(), with the dispatch radio card under it;
//   top-centre    the mission card: job, objective, a segmented STAGE n/m bar and NEXT: line;
//   top-right     the wanted pill (IN SIGHT · AIR ONE LOCKED / EVADING / JAMMED), five stars,
//                 cash and respect rank, and the five-slot weapon rail with SVG silhouettes,
//                 names and ammo per slot;
//   bottom-left   District Standing for the turf underfoot, labelled HEALTH / ARMOR bars and
//                 the vector minimap (drawn by minimap.js);
//   bottom-right  the three crew ability cards (Z / X / C, portrait, live cooldown), district,
//                 clock, radio and the speedometer with nitro and vehicle CONDITION;
//   centre        the portrait dialogue box, crosshair, cover chip, [F] prompt and toasts.
// It also owns the title screen's save cards, the pause / load slot lists, the story-complete
// screen and the mission popup. DOM plus the minimap canvas; every click with a data-action
// is routed to stage_glue.js through onAction.

import { kmh, WEAPONS } from './config.js';
import { createMapPainter } from './minimap.js';
import { rankFor } from './progression.js';
import { TURF, tierFor, turfIdAt } from './turf.js';
import { portraitSvg } from './portraits.js';
import { ABILITIES } from './crew.js';

const byId = (id) => document.getElementById(id);

/** The HUD's corner clusters; createHud() writes them into #hud and then fills them live. */
const HUD_MARKUP = `
<div class="hud-top-left">
<div class="dispatch-table hidden" id="dispatchTable" aria-label="SBPD units responding">
<div class="dt-head"><span class="dt-led"></span><span class="dt-title" id="dtTitle">SBPD RESPONSE · 0 UNITS</span><span class="dt-tier" id="dtTier">CLEAR</span></div>
<div class="dt-cols"><span>UNIT</span><span>ROLE</span><span>DIST</span></div>
<div class="dt-rows" id="dtRows"></div>
</div>
<div class="dispatch-card" id="dispatchCard" aria-live="polite">
<div class="dispatch-head"><span class="dispatch-led"></span><span id="dispatchTitle">SBPD DISPATCH · AIR ONE</span><span class="dispatch-freq">CH 7 · 460.15</span></div>
<div class="dispatch-text" id="dispatchText">All units, Air One on station.</div>
</div>
</div>

<div class="mission-card" id="missionCard">
<div class="mission-top"><span class="mission-code" id="missionCode">MISSION 01</span><span class="mission-frac" id="missionFrac">STAGE 1/3</span></div>
<div class="mission-name" id="missionName">BOARDWALK BOOST</div>
<div class="mission-objective"><span class="obj-diamond"></span><span id="objectiveText">Follow the gold marker</span></div>
<div class="stage-segs" id="stageSegs"></div>
<div class="mission-next" id="missionNextRow"><b>NEXT:</b><span id="missionNext">Deliver the coupe</span></div>
</div>
<div class="activity-chip hidden" id="activityChip">
<span class="act-code" id="activityCode">RACE</span><span class="act-name" id="activityName">OCEAN BOULEVARD SPRINT</span>
<span class="act-cp" id="activityCp">CP 1 / 6</span><span class="act-timer" id="activityTimer">0:48.0</span>
</div>
<div class="mission-banner" id="missionBanner">
<span class="banner-kicker" id="bannerKicker">MISSION START</span>
<span class="banner-title" id="bannerTitle">BOARDWALK BOOST</span>
<span class="banner-sub" id="bannerSub">Palm Strip · Elena Vega</span>
</div>

<div class="hud-top-right">
<div class="wanted-row" id="wantedRow" aria-label="Wanted level">
<div class="wanted-pill" id="wantedPill"><b id="wantedState">CLEAR</b><span id="wantedLabel">NO HEAT</span></div>
<div class="stars"><span class="star" data-star="1">★</span><span class="star" data-star="2">★</span><span class="star" data-star="3">★</span><span class="star" data-star="4">★</span><span class="star" data-star="5">★</span></div>
</div>
<div class="cash-row"><div class="rank-row"><span class="rank-name" id="rankName">BEACH RAT</span><div class="rank-bar"><span id="rankFill"></span></div><span class="rank-rp" id="respectValue">0 RP</span></div><div class="cash-chip"><span class="cash-mark">$</span><span id="cashValue">640</span></div></div>
<div class="weapon-rail" id="weaponRail" aria-label="Weapons 1 to 5"></div>
<div class="weapon-readout"><span class="weapon-name" id="weaponName">PALM PISTOL</span><span class="weapon-ammo"><b id="ammoMag">12</b><i>/</i><em id="ammoReserve">96</em></span><span class="ammo-hint" id="ammoHint"></span></div>
</div>

<div class="notification-stack" id="notifications"></div>

<div class="hud-bottom-left">
<div class="standing-bar" id="standingBar">
<div class="sb-top"><span class="sb-dot" id="standingDot"></span><span class="sb-name" id="standingName">PALM STRIP</span><span class="sb-tier" id="standingTier">CONTESTED</span><b id="standingValue">0</b></div>
<div class="sb-track"><span id="standingFill"></span><u style="left:25%"></u><u style="left:50%"></u><u style="left:75%"></u></div>
</div>
<div class="vitals">
<div class="vital"><span class="vital-label">HEALTH</span><div class="bar health-bar"><span id="healthFill"></span></div><em id="healthNum">100</em></div>
<div class="vital"><span class="vital-label">ARMOR</span><div class="bar armor-bar"><span id="armorFill"></span></div><em id="armorNum">0</em></div>
</div>
<div class="minimap-frame">
<canvas id="minimap" width="560" height="360" aria-label="Live minimap"></canvas>
<span class="compass-n">N</span>
<span class="minimap-key">M · CITY MAP</span>
</div>
</div>

<div class="hud-bottom-right">
<div class="ability-rail" id="abilityRail" aria-label="Crew abilities"></div>
<div class="location-row">
<div class="district-pill"><span class="district-dot"></span><span id="districtName">PALM STRIP</span></div>
<div class="time-chip"><span id="clock">19:04</span><span class="time-divider"></span><span id="timeName">GOLDEN HOUR</span></div>
</div>
<div class="radio-chip"><span class="radio-wave"><i></i><i></i><i></i></span><span id="radioName">RADIO OFF</span><span class="key-pill">R</span></div>
<div class="speedo hidden" id="speedo">
<div class="speedo-top"><span class="gear" id="gearValue">D</span><span class="speed-label" id="speedLabel">SOLARIS GT</span><div class="speed-main"><span id="speedValue">0</span><span class="speed-unit">KM/H</span></div></div>
<div class="rpm-bar"><span id="rpmFill"></span></div>
<div class="speedo-row"><span class="sp-label">NITRO</span><div class="nitro-bar"><span id="nitroFill"></span></div><span class="drift-tag hidden" id="driftTag">DRIFT</span></div>
<div class="speedo-row"><span class="sp-label">CONDITION</span><div class="cond-bar"><span id="conditionFill"></span></div><b class="cond-num" id="conditionNum">100%</b></div>
</div>
</div>

<div class="dialogue-card" id="dialogueCard">
<div class="dialogue-portrait" id="dialoguePortrait"></div>
<div class="dialogue-body"><div class="dialogue-speaker"><span id="dialogueSpeaker">ELENA VEGA</span><em id="dialogueRole">ON COMMS</em></div><div class="dialogue-text" id="dialogueText"></div></div>
</div>
<div class="crosshair" id="crosshair">
<span class="ch-dot"></span><span class="ch-line ch-t"></span><span class="ch-line ch-b"></span><span class="ch-line ch-l"></span><span class="ch-line ch-r"></span>
<span class="hitmarker" id="hitmarker"></span>
</div>
<div class="interact-prompt" id="interactPrompt"><span class="key-pill">F</span><span id="interactText">Steal Marisol Coupe</span></div>
<div class="cover-chip" id="coverChip"><span class="cover-shield"></span><b id="coverState">IN COVER</b><span id="coverText">COASTAL MUSCLE</span><span class="cover-keys">Q / C LEAVE · RMB PEEK</span></div>
<div class="controls-hint" id="controlsHint">WASD MOVE · SHIFT SPRINT · E/F VEHICLE · 1-5 WEAPON · Z/X/C CREW · M MAP · ESC PAUSE</div>
<div class="status-line" id="statusLine" role="status" aria-live="polite"></div>
`;

/** Weapon silhouettes for the rail, drawn on a 56 x 22 grid. */
const WEAPON_ICONS = {
  fists: '<path d="M18 6h5v8h-5zM24 4h5v10h-5zM30 5h5v9h-5zM36 8h4v7h-4z"/><path d="M17 14h23v2c0 4-3 6-7 6h-9c-4 0-7-3-7-6z" opacity=".75"/><path d="M14 9h4v6l-3 1z" opacity=".6"/>',
  pistol: '<path d="M10 5h30v6H10z"/><path d="M40 6h4v4h-4z" opacity=".6"/><path d="M16 11h10l-2 3h-2l-2 7h-6l2-7z" opacity=".8"/><path d="M24 11h4l-1 4h-3z" opacity=".5"/>',
  smg: '<path d="M8 7h34v6H8z"/><path d="M42 8h7v3h-7z"/><path d="M22 13h5v8h-5z" opacity=".85"/><path d="M14 13h6l-2 6h-5z" opacity=".7"/><path d="M1 8h7v4l-5 3H1z" opacity=".6"/><path d="M28 4h9v3h-9z" opacity=".5"/>',
  shotgun: '<path d="M14 7h40v4H14z"/><path d="M26 11h16v3H26z" opacity=".7"/><path d="M1 8h13v5l-9 6H1z" opacity=".75"/><path d="M14 11h7l-2 6h-5z" opacity=".8"/>',
  carbine: '<path d="M12 8h34v5H12z"/><path d="M46 9h9v2h-9z"/><path d="M22 3h12v3H22z" opacity=".85"/><path d="M26 6h3v2h-3z" opacity=".6"/><path d="M28 13h5l1 8h-5z" opacity=".85"/><path d="M18 13h5l-2 6h-5z" opacity=".7"/><path d="M1 8h11v5l-8 4H1z" opacity=".65"/>',
};
const RAIL_NAMES = { fists: 'FISTS', pistol: 'PISTOL', smg: 'SMG', shotgun: 'SHOTGUN', carbine: 'CARBINE' };

/** Dispatch roles to a colour class for the SBPD table. */
const ROLE_CLASS = {
  'SPOTLIGHT': 'r-air', 'PIT/RAM': 'r-hot', 'FLANKING': 'r-warm', 'INTERCEPT': 'r-warm', 'ROADBLOCK': 'r-block',
  'CLOSING IN': 'r-warm', 'FOOT CHASE': 'r-foot', 'SEARCHING': 'r-cool', 'EN ROUTE': 'r-cool', 'DISABLED': 'r-dead',
  'RETURNING': 'r-dead', 'RESUMING PATROL': 'r-dead',
};
const UNIT_ICONS = {
  air: '<path d="M2 6h14M9 6v2M5 8h8l2 3H6zM15 9l4-1v3z"/>',
  car: '<path d="M2 10l2-4h12l2 4v3H2z"/><circle cx="6" cy="13" r="1.6"/><circle cx="14" cy="13" r="1.6"/><path d="M8 4h4v2H8z"/>',
  block: '<path d="M1 7h18v4H1z"/><path d="M3 11v3M17 11v3"/><path d="M4 7l3 4M9 7l3 4M14 7l3 4" stroke-width="1.4"/>',
  foot: '<circle cx="10" cy="4" r="2"/><path d="M8 7h4l1 5h-2l-1 4H9l-1-4H7z"/>',
};

const SPEAKERS = {
  ELENA: ['ELENA VEGA', 'WHEELWOMAN · ON COMMS'],
  MATEO: ['MATEO CRUZ', 'ENFORCER · AT YOUR SIDE'],
  NICO: ['NICO VEGA', 'MECHANIC · SAFEHOUSE GARAGE'],
  SBPD: ['SBPD DISPATCH', 'CHANNEL 7'],
};
const CREW_LINE = { nico: 'ON THE PHONE' };

export function createHud({ onAction, world }) {
  byId('hud').innerHTML = HUD_MARKUP;
  const els = {
    hud: byId('hud'), title: byId('titleScreen'), controls: byId('controlsScreen'), pause: byId('pauseScreen'),
    story: byId('storyScreen'), popup: byId('missionPopup'), loading: byId('loading'), slotsScreen: byId('slotsScreen'),
    minimap: byId('minimap'), district: byId('districtName'), clock: byId('clock'), timeName: byId('timeName'),
    wantedRow: byId('wantedRow'), wantedPill: byId('wantedPill'), wantedState: byId('wantedState'), wantedLabel: byId('wantedLabel'),
    cash: byId('cashValue'), radio: byId('radioName'),
    missionCard: byId('missionCard'), missionCode: byId('missionCode'), missionFrac: byId('missionFrac'),
    missionName: byId('missionName'), objective: byId('objectiveText'), stageSegs: byId('stageSegs'),
    missionNext: byId('missionNext'), missionNextRow: byId('missionNextRow'),
    banner: byId('missionBanner'), bannerKicker: byId('bannerKicker'), bannerTitle: byId('bannerTitle'), bannerSub: byId('bannerSub'),
    notifications: byId('notifications'),
    dialogue: byId('dialogueCard'), dialogueSpeaker: byId('dialogueSpeaker'), dialogueRole: byId('dialogueRole'),
    dialogueText: byId('dialogueText'), dialoguePortrait: byId('dialoguePortrait'),
    crosshair: byId('crosshair'), hitmarker: byId('hitmarker'), prompt: byId('interactPrompt'), promptText: byId('interactText'),
    healthFill: byId('healthFill'), armorFill: byId('armorFill'), healthNum: byId('healthNum'), armorNum: byId('armorNum'),
    standingBar: byId('standingBar'), standingDot: byId('standingDot'), standingName: byId('standingName'),
    standingTier: byId('standingTier'), standingValue: byId('standingValue'), standingFill: byId('standingFill'),
    weaponRail: byId('weaponRail'), weaponName: byId('weaponName'), ammoMag: byId('ammoMag'), ammoReserve: byId('ammoReserve'), ammoHint: byId('ammoHint'),
    abilityRail: byId('abilityRail'),
    speedo: byId('speedo'), speedValue: byId('speedValue'), speedLabel: byId('speedLabel'), gear: byId('gearValue'),
    rpm: byId('rpmFill'), nitro: byId('nitroFill'), drift: byId('driftTag'), conditionFill: byId('conditionFill'), conditionNum: byId('conditionNum'),
    hints: byId('controlsHint'), damage: byId('damageFlash'), speedLines: byId('speedLines'),
    continueBtn: byId('continueBtn'), continueMeta: byId('continueBtnMeta'), loadMenuMeta: byId('loadMenuBtnMeta'),
    titleProgress: byId('titleProgress'), titleCash: byId('titleCash'), titleTokens: byId('titleTokens'), titlePeak: byId('titlePeak'),
    titleCards: byId('titleSaveCards'), titleSlotsMeta: byId('titleSlotsMeta'), titleAutoText: byId('titleAutoText'),
    pauseSub: byId('pauseSub'), pauseCash: byId('pauseCash'), saveSlots: byId('saveSlots'), loadSlots: byId('loadSlots'),
    titleSlots: byId('titleSlots'), soundLabel: byId('soundLabel'), fxLabel: byId('fxLabel'), mouseLabel: byId('mouseLabel'),
    storyStats: byId('storyStats'), popupName: byId('popupName'), popupReward: byId('popupReward'), popupNext: byId('popupNext'),
    status: byId('statusLine'), rankName: byId('rankName'), rankFill: byId('rankFill'), respect: byId('respectValue'),
    activityChip: byId('activityChip'), activityCode: byId('activityCode'), activityName: byId('activityName'),
    activityCp: byId('activityCp'), activityTimer: byId('activityTimer'),
    dispatch: byId('dispatchCard'), dispatchTitle: byId('dispatchTitle'), dispatchText: byId('dispatchText'),
    dispatchTable: byId('dispatchTable'), dtTitle: byId('dtTitle'), dtTier: byId('dtTier'), dtRows: byId('dtRows'),
    coverChip: byId('coverChip'), coverState: byId('coverState'), coverText: byId('coverText'),
  };
  const painter = createMapPainter(world);
  const timers = { banner: 0, dialogue: 0, popup: 0, dispatch: 0 };
  let lastStars = -1;
  let lastSegKey = '';
  let lastSpeaker = '';

  // --------------------------------------------------------------- utilities
  const money = (value) => Number(Math.round(value)).toLocaleString('en-US');
  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }
  function setWidth(el, pct) {
    if (!el) return;
    const w = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    if (el.style.width !== w) el.style.width = w;
  }
  const showLoadingDone = (instant = false) => {
    if (instant) els.loading.classList.add('instant');
    els.loading.classList.add('done');
  };
  const announce = (text) => setText(els.status, text);

  // ------------------------------------------------------------ weapon rail
  const railSlots = WEAPONS.map((w) => {
    const slot = document.createElement('div');
    slot.className = 'wr-slot';
    slot.dataset.slot = String(w.slot);
    slot.innerHTML = `<span class="wr-key">${w.slot}</span><svg class="wr-icon" viewBox="0 0 56 22" fill="currentColor" aria-hidden="true">${WEAPON_ICONS[w.id]}</svg>
      <span class="wr-name">${RAIL_NAMES[w.id]}</span><span class="wr-ammo">—</span>`;
    els.weaponRail?.appendChild(slot);
    return { w, el: slot, ammo: slot.querySelector('.wr-ammo') };
  });

  function updateRail(player, weapon) {
    for (const { w, el, ammo } of railSlots) {
      const owned = player.weapons.includes(w.id);
      el.classList.toggle('active', owned && w.id === weapon?.id);
      el.classList.toggle('locked', !owned);
      const a = player.ammo[w.id];
      setText(ammo, !owned ? 'LOCKED' : w.melee ? 'MELEE' : `${a?.mag ?? 0}/${a?.reserve ?? 0}`);
      el.classList.toggle('low', owned && !w.melee && (a?.mag ?? 0) <= Math.ceil(w.mag * 0.2));
    }
  }

  // ------------------------------------------------------------ crew ability cards
  let abilityCards = [];
  function buildAbilities(list) {
    els.abilityRail.innerHTML = '';
    abilityCards = list.map((a) => {
      const card = document.createElement('button');
      card.className = 'ab-card';
      card.dataset.action = 'ability';
      card.dataset.ability = a.id;
      card.style.setProperty('--c', a.color);
      card.innerHTML = `<span class="ab-portrait">${portraitSvg(a.crew)}</span>
        <span class="ab-body"><span class="ab-top"><span class="ab-key">${a.key}</span><b>${a.name}</b></span>
        <span class="ab-who">${a.who.split(' ')[0]}<i></i></span><span class="ab-cd"><i></i></span></span><span class="ab-status">READY</span>`;
      els.abilityRail.appendChild(card);
      return { id: a.id, el: card, who: card.querySelector('.ab-who i'), fill: card.querySelector('.ab-cd i'), status: card.querySelector('.ab-status') };
    });
  }

  buildAbilities(ABILITIES);

  function updateAbilities(list, roster) {
    if (!list) return;
    list.forEach((a, i) => {
      const card = abilityCards[i];
      card.el.classList.toggle('ready', a.ready);
      card.el.classList.toggle('cooling', a.cooldownLeft > 0 && !a.running);
      card.el.classList.toggle('running', a.running);
      card.el.classList.toggle('idle', !a.ready && a.cooldownLeft <= 0);
      setText(card.status, a.running ? `ACTIVE ${Math.ceil(a.effectLeft)}s` : a.status);
      setWidth(card.fill, a.running ? (a.effectLeft / Math.max(1, a.length)) * 100 : (1 - a.ratio) * 100);
      const mate = roster?.find((c) => c.id === a.crew);
      setText(card.who, ` · ${mate ? mate.status : CREW_LINE[a.crew] ?? ''}`);
    });
  }

  // ------------------------------------------------------------ SBPD response table
  const dtRows = [];
  function updateDispatchTable(info, wanted) {
    if (!els.dispatchTable) return;
    const units = info?.units ?? [];
    const show = wanted > 0 || units.some((u) => u.active);
    els.dispatchTable.classList.toggle('hidden', !show);
    if (!show) return;
    const live = units.filter((u) => u.active);
    setText(els.dtTitle, `SBPD RESPONSE · ${live.length} UNIT${live.length === 1 ? '' : 'S'}`);
    setText(els.dtTier, String(info.label ?? '').replace('-STAR', '★'));
    els.dispatchTable.classList.toggle('jammed', (info.jammed ?? 0) > 0);
    const shown = units.slice(0, 6);
    while (dtRows.length < shown.length) {
      const row = document.createElement('div');
      row.className = 'dt-row';
      row.innerHTML = '<span class="dt-call"><svg class="dt-ico" viewBox="0 0 20 16" fill="currentColor"></svg><b></b></span><span class="dt-role"></span><span class="dt-dist"></span>';
      els.dtRows.appendChild(row);
      dtRows.push({ el: row, ico: row.querySelector('svg'), call: row.querySelector('b'), role: row.querySelector('.dt-role'), dist: row.querySelector('.dt-dist'), kind: '' });
    }
    dtRows.forEach((r, i) => {
      const u = shown[i];
      r.el.classList.toggle('hidden', !u);
      if (!u) return;
      if (r.kind !== u.kind) { r.kind = u.kind; r.ico.innerHTML = UNIT_ICONS[u.kind] ?? UNIT_ICONS.car; }
      setText(r.call, u.callsign);
      const role = (info.jammed ?? 0) > 0 && u.role !== 'ROADBLOCK' && u.role !== 'DISABLED' ? 'NO SIGNAL' : u.role;
      setText(r.role, role);
      setText(r.dist, `${u.distMeters} m`);
      const cls = `dt-row ${ROLE_CLASS[role] ?? 'r-cool'}${u.active ? '' : ' off'}`;
      if (r.el.className !== cls) r.el.className = cls;
    });
  }

  /** The wanted pill: who has eyes on the suspect right now. */
  function updateWantedPill(wanted, evasion, info) {
    let state = 'CLEAR', sub = 'NO HEAT', cls = 'clear';
    if (wanted > 0) {
      if ((info?.jammed ?? 0) > 0) { state = 'JAMMED'; sub = `BAND DOWN · ${Math.ceil(info.jammed)}s`; cls = 'jam'; }
      else if (evasion > 0) { state = 'EVADING'; sub = `SEARCH ${Math.round(evasion * 100)}%`; cls = 'evade'; }
      else if (info?.inSight) { state = 'IN SIGHT'; sub = info.airLocked ? 'AIR ONE LOCKED' : 'UNITS ON YOU'; cls = 'sight'; }
      else { state = 'OUT OF SIGHT'; sub = 'UNITS SEARCHING'; cls = 'evade'; }
    }
    setText(els.wantedState, state);
    setText(els.wantedLabel, sub);
    const pc = `wanted-pill ${cls}`;
    if (els.wantedPill.className !== pc) els.wantedPill.className = pc;
  }

  // ------------------------------------------------------------------ title
  function setTitle(info = {}) {
    const total = info.total ?? 8;
    setText(els.titleProgress, `${info.storyComplete ? total : info.progress ?? 0} / ${total}`);
    setText(els.titleCash, `$${money(info.cash ?? 640)}`);
    setText(els.titleTokens, `${info.tokens ?? 0} / 12`);
    setText(els.titlePeak, `★ ${info.peak ?? 0}`);
    if (els.continueBtn) {
      els.continueBtn.disabled = !info.hasSave;
      els.continueBtn.classList.toggle('primary', !!info.hasSave);
      els.continueBtn.nextElementSibling?.classList.toggle('primary', !info.hasSave);
      setText(els.continueMeta, info.hasSave ? info.saveLabel ?? 'LATEST SAVE' : 'NO SAVE FOUND');
    }
    setText(els.loadMenuMeta, `3 SLOTS + AUTOSAVE · ${info.slotsUsed ?? 0} USED`);
  }

  /** The title screen's three save-slot cards (and the autosave line under them). */
  function setTitleSlots(list = [], time = () => '') {
    if (!els.titleCards) return;
    const manual = list.filter((s) => s.slot !== 'auto');
    setText(els.titleSlotsMeta, `${manual.filter((s) => s.exists).length} / ${manual.length} USED`);
    els.titleCards.innerHTML = manual.map((s) => {
      if (!s.exists) {
        return `<div class="tcard empty" aria-disabled="true"><div class="tc-head"><span class="tc-slot">${s.label}</span><span class="tc-tag">EMPTY</span></div>
          <div class="tc-empty"><span class="tc-plus">+</span><span>No save here yet. Start a new game, then save to ${s.label.toLowerCase()} from the pause menu or the city map.</span></div></div>`;
      }
      const pct = Math.max(0, Math.min(100, s.completion ?? 0));
      const lead = s.crew?.includes('mateo') ? 'mateo' : 'elena';
      return `<div class="tcard" data-action="loadSlot" data-slot="${s.slot}" role="button"><div class="tc-head"><span class="tc-slot">${s.label}</span><span class="tc-time">${time(s.savedAt).toUpperCase()}</span></div>
        <div class="tc-body"><span class="tc-portrait">${portraitSvg(lead)}</span><div class="tc-info"><b class="tc-act">${s.act}</b>
        <span class="tc-meta"><em>$${money(s.cash)}</em> · ${String(s.district).toUpperCase()} · ${s.progress}/${s.total} JOBS</span>
        <span class="tc-bar"><i style="width:${pct}%"></i></span></div><span class="tc-pct">${Math.round(pct)}<small>%</small></span></div>
        <span class="tc-load">LOAD ›</span></div>`;
    }).join('');
    const auto = list.find((s) => s.slot === 'auto');
    setText(els.titleAutoText, auto?.exists ? `AUTOSAVE · ${auto.act} · ${time(auto.savedAt).toUpperCase()}` : 'AUTOSAVE · WRITTEN AFTER EVERY JOB');
  }

  function showTitle(show = true) {
    els.title.classList.toggle('hidden', !show);
    els.hud.classList.toggle('hidden', show);
    els.controls.classList.add('hidden');
    els.pause.classList.add('hidden');
    if (!show) els.slotsScreen?.classList.add('hidden');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  }
  function showControls(show = true) {
    els.controls.classList.toggle('hidden', !show);
    if (!show && document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  }
  function showPause(show = true) {
    els.pause.classList.toggle('hidden', !show);
    if (!show) els.controls.classList.add('hidden');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  }

  /** One slot row for the pause and load lists: name, district, progress, cash, time, delete. */
  function slotCard(slot, action, options = {}) {
    const card = document.createElement('div');
    card.className = `slot${slot.exists ? '' : ' empty'}`;
    card.dataset.action = action;
    card.dataset.slot = slot.slot;
    card.setAttribute('role', 'button');
    const tag = !slot.exists ? 'EMPTY' : action === 'saveSlot' ? 'OVERWRITE' : 'LOAD';
    const meta = slot.exists
      ? `<span class="slot-title">${slot.act ?? slot.name}</span>
         <span class="slot-meta">${slot.district} · ${slot.progress}/${slot.total} jobs · ${Math.round(slot.completion ?? 0)}% · $${money(slot.cash)}</span>
         <span class="slot-meta slot-time">${options.time?.(slot.savedAt) ?? ''}</span>`
      : `<span class="slot-meta">${action === 'saveSlot' ? 'Click to write this slot' : 'Nothing saved here'}</span>`;
    const del = slot.exists && options.deletable ? `<button class="slot-del" data-action="deleteSlot" data-slot="${slot.slot}" aria-label="Delete ${slot.label}">✕</button>` : '';
    card.innerHTML = `<div class="slot-name">${slot.label}<em>${tag}</em></div>${meta}${del}`;
    return card;
  }

  function refreshSlots(slots, info = {}) {
    const render = (target, mode) => {
      if (!target) return;
      target.innerHTML = '';
      const chosen = mode === 'save' ? slots.filter((s) => s.slot !== 'auto') : slots.filter((s) => s.exists);
      if (!chosen.length) {
        target.innerHTML = '<div class="slot empty"><div class="slot-name">NO SAVES YET</div><span class="slot-meta">Finish a job to autosave</span></div>';
        return;
      }
      for (const slot of chosen) target.appendChild(slotCard(slot, mode === 'save' ? 'saveSlot' : 'loadSlot', { time: info.time, deletable: mode === 'save' }));
    };
    render(els.saveSlots, 'save');
    render(els.loadSlots, 'load');
    if (info.cash !== undefined) setText(els.pauseCash, `$${money(info.cash)}`);
    if (info.subtitle) setText(els.pauseSub, info.subtitle);
  }

  function showSlots(show, slots = [], info = {}) {
    if (!els.slotsScreen) return;
    els.slotsScreen.classList.toggle('hidden', !show);
    if (!show) {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
      return;
    }
    els.titleSlots.innerHTML = '';
    for (const slot of slots) els.titleSlots.appendChild(slotCard(slot, 'loadSlot', { time: info.time, deletable: true }));
  }

  /** Controls & Settings: the value shown beside a setting row. */
  function setSetting(name, value) {
    const el = { sound: els.soundLabel, fx: els.fxLabel, mouse: els.mouseLabel }[name];
    setText(el, value);
  }
  const setSoundLabel = (on) => setSetting('sound', on ? 'ON' : 'OFF');

  /** SBPD radio traffic: the card under the response table. */
  function dispatch(titleText, text, duration = 5200) {
    setText(els.dispatchTitle, titleText);
    setText(els.dispatchText, text);
    els.dispatch.classList.add('show');
    clearTimeout(timers.dispatch);
    if (duration > 0) timers.dispatch = setTimeout(() => els.dispatch.classList.remove('show'), duration);
  }

  function showStoryComplete(stats) {
    els.story.classList.remove('hidden');
    const stat = (label, value, cls = '') => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span></div>`;
    els.storyStats.innerHTML = stat('MISSIONS', `${stats.total ?? 8} / ${stats.total ?? 8}`) + stat('CASH', `$${money(stats.cash)}`, 'gold')
      + stat('RESPECT', stats.respect) + stat('PEAK HEAT', `★ ${stats.peak}`) + stat('SUN TOKENS', `${stats.tokens} / 12`);
  }
  const hideStoryComplete = () => els.story.classList.add('hidden');

  // ------------------------------------------------------------ notifications
  function notify(text, kind = 'info', duration = 3600) {
    if (!text) return;
    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    toast.innerHTML = `<span class="toast-dot"></span><span>${text}</span>`;
    els.notifications.appendChild(toast);
    while (els.notifications.children.length > 3) els.notifications.firstChild.remove();
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 320);
    }, duration);
  }
  const clearToasts = () => { els.notifications.innerHTML = ''; };

  function missionBanner(mission, kicker = 'MISSION START', duration = 5200) {
    if (!mission) return;
    setText(els.bannerKicker, kicker);
    setText(els.bannerTitle, mission.name);
    setText(els.bannerSub, mission.steps ? `${mission.giver ?? 'ELENA'} · MISSION ${mission.code}` : `${mission.giver ?? 'SIDE ACTIVITY'} · ${mission.code ?? ''}`);
    els.banner.classList.add('show');
    clearTimeout(timers.banner);
    if (duration > 0) timers.banner = setTimeout(() => els.banner.classList.remove('show'), duration);
  }

  /** The mission card: name, objective, STAGE n/m segments and the NEXT: step. */
  function objective(label, mission, stepIndex, total) {
    setText(els.objective, label ?? '');
    if (!mission) { els.missionCard.classList.add('hidden'); return; }
    const steps = total ?? mission.steps?.length ?? 1;
    const step = Math.min(steps, Number.isFinite(stepIndex) ? stepIndex + 1 : 1);
    setText(els.missionCode, `MISSION ${mission.code ?? mission.id + 1} · ${mission.giver ?? 'ELENA'}`);
    setText(els.missionName, mission.name.toUpperCase());
    setText(els.missionFrac, `STAGE ${step}/${steps}`);
    const key = `${mission.id}:${step}:${steps}`;
    if (key !== lastSegKey) {
      lastSegKey = key;
      els.stageSegs.innerHTML = Array.from({ length: steps }, (_, i) => `<i class="${i < step - 1 ? 'done' : i === step - 1 ? 'now' : ''}"></i>`).join('');
      const next = mission.steps?.[step];
      setText(els.missionNext, next ? next.label.replace(/\s+·\s+E \/ F$/, '') : `Job complete · +$${money(mission.reward ?? 0)}`);
    }
    els.missionCard.classList.remove('hidden');
  }

  function dialogue(speaker, text, duration = 6200) {
    if (!text) return;
    const key = String(speaker ?? 'ELENA').toUpperCase().split(' ')[0];
    const [name, role] = SPEAKERS[key] ?? [String(speaker ?? 'ELENA').toUpperCase(), 'ON COMMS'];
    setText(els.dialogueSpeaker, name);
    setText(els.dialogueRole, role);
    setText(els.dialogueText, text);
    if (key !== lastSpeaker) {
      lastSpeaker = key;
      els.dialoguePortrait.innerHTML = portraitSvg(key === 'SBPD' ? 'dispatch' : key.toLowerCase());
      els.dialogue.style.setProperty('--c', { MATEO: '#ffc24b', NICO: '#55ebff', SBPD: '#ff4c5f' }[key] ?? '#ff6f91');
    }
    els.dialogue.classList.add('show');
    clearTimeout(timers.dialogue);
    if (duration > 0) timers.dialogue = setTimeout(() => els.dialogue.classList.remove('show'), duration);
  }

  function missionComplete(mission, reward, nextName) {
    if (!mission) return;
    setText(els.popupName, mission.name.toUpperCase());
    setText(els.popupReward, `+$${money(reward)}`);
    setText(els.popupNext, nextName ? `NEXT · ${nextName.toUpperCase()}` : 'SOLARIS BAY IS YOURS');
    els.popup.classList.remove('hidden');
    clearTimeout(timers.popup);
    timers.popup = setTimeout(() => els.popup.classList.add('hidden'), 4600);
  }
  const hideMissionPopup = () => els.popup.classList.add('hidden');

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
    els.prompt.classList.toggle('show', !!text);
    if (text) setText(els.promptText, text);
  }
  const setHint = (text) => setText(els.hints, text);
  const setRadio = (name) => setText(els.radio, name ? `RADIO · ${name}` : 'RADIO OFF');
  function setPlaying(playing, inVehicle) {
    els.hud.classList.toggle('hidden', !playing);
    document.body.classList.toggle('driving', !!inVehicle);
  }

  // ------------------------------------------------------------------ update
  function update(state) {
    const { player, vehicle, wanted, evasion, district, clock, timeName, radio, prompt, aiming, mission } = state;
    if (!player) return;
    setText(els.district, (district ?? 'SOLARIS BAY').toUpperCase());
    setText(els.clock, clock);
    setText(els.timeName, timeName);
    setText(els.cash, money(player.cash));
    setRadio(radio);

    if (wanted !== lastStars) {
      lastStars = wanted;
      els.wantedRow.querySelectorAll('.star').forEach((el, i) => el.classList.toggle('on', i < wanted));
      els.wantedRow.classList.toggle('high', wanted >= 3);
    }
    els.wantedRow.classList.toggle('evading', !!evasion);
    updateWantedPill(wanted, evasion, state.police);
    updateDispatchTable(state.police, wanted);

    // District Standing for the turf underfoot.
    const turfId = turfIdAt(player.x, player.z);
    const turf = TURF.find((d) => d.id === turfId);
    const value = Math.round(state.turf?.[turfId] ?? 0);
    setText(els.standingName, turf.name.toUpperCase());
    setText(els.standingTier, tierFor(value).name);
    setText(els.standingValue, String(value));
    setWidth(els.standingFill, value);
    els.standingBar.style.setProperty('--c', turf.color);

    setText(els.healthNum, String(Math.max(0, Math.ceil(player.health))));
    setText(els.armorNum, String(Math.max(0, Math.ceil(player.armor))));
    setWidth(els.healthFill, (player.health / player.maxHealth) * 100);
    setWidth(els.armorFill, (player.armor / player.maxArmor) * 100);
    els.healthFill.parentElement.classList.toggle('critical', player.health < 30);

    // Weapon rail and the active weapon readout.
    const weapon = state.weapon;
    updateRail(player, weapon);
    setText(els.weaponName, (weapon?.name ?? 'Fists').toUpperCase());
    const ammo = state.ammo;
    if (!weapon || weapon.melee) {
      setText(els.ammoMag, '∞'); setText(els.ammoReserve, 'MELEE'); setText(els.ammoHint, '');
    } else if (player.reloadTimer > 0) {
      setText(els.ammoMag, '··'); setText(els.ammoReserve, String(ammo?.reserve ?? 0)); setText(els.ammoHint, 'RELOADING');
    } else {
      setText(els.ammoMag, String(ammo?.mag ?? 0));
      setText(els.ammoReserve, String(ammo?.reserve ?? 0));
      setText(els.ammoHint, (ammo?.mag ?? 0) <= 3 ? 'R RELOAD' : '');
    }

    const hasAim = !vehicle && !player.dead;
    els.crosshair.classList.toggle('active', hasAim);
    els.crosshair.classList.toggle('aim', hasAim && (!!aiming || (weapon && weapon.id !== 'fists')));

    if (mission) objective(state.objectiveText ?? els.objective.textContent, mission, state.missionStep, state.missionTotal);
    else els.missionCard.classList.add('hidden');

    // Speedometer with nitro and vehicle condition.
    if (vehicle) {
      els.speedo.classList.remove('hidden');
      setText(els.speedValue, String(kmh(Math.abs(vehicle.speed ?? 0))));
      const max = vehicle.spec.maxSpeed;
      const gear = vehicle.speed < -0.3 ? 'R' : vehicle.speed < 0.4 ? 'N' : String(Math.max(1, Math.min(6, 1 + Math.floor((Math.abs(vehicle.speed) / max) * 5.6))));
      setText(els.gear, vehicle.airborne ? 'AIR' : gear);
      setText(els.speedLabel, (vehicle.spec?.name ?? 'SOLARIS').toUpperCase());
      setWidth(els.rpm, 6 + Math.min(1, Math.abs(vehicle.speed) / (max * 1.05)) * 94);
      setWidth(els.nitro, (vehicle.boost ?? 1) * 100);
      const cond = Math.round(Math.max(0, (vehicle.health / (vehicle.maxHealth ?? 100)) * 100));
      setWidth(els.conditionFill, cond);
      setText(els.conditionNum, `${cond}%`);
      els.speedo.classList.toggle('damaged', cond < 40);
      els.drift.classList.toggle('hidden', !((vehicle.drift ?? 0) > 2.2 && Math.abs(vehicle.speed) > 6));
      els.speedLines.classList.toggle('boosting', !!vehicle.boosting);
      setHint('W / S THROTTLE · A / D STEER · SHIFT NITRO · SPACE HANDBRAKE · Z / X / C CREW · E / F EXIT · R RADIO');
    } else {
      els.speedo.classList.add('hidden');
      els.speedLines.classList.remove('boosting');
      setHint(player.cover ? 'WASD SHUFFLE · RMB PEEK · LMB FIRE · Q / C LEAVE COVER · Z / X CREW · R RELOAD'
        : 'WASD MOVE · SHIFT SPRINT · LMB FIRE · Q / C COVER · 1-5 WEAPON · Z / X / C CREW · E / F STEAL · M MAP');
    }

    setPrompt(prompt);
    updateAbilities(state.abilities, state.crew);
    const cover = !vehicle && !player.dead ? player.cover : null;
    els.coverChip.classList.toggle('show', !!cover);
    if (cover) {
      setText(els.coverState, (player.peek ?? 0) > 0.5 ? 'PEEKING' : 'IN COVER');
      setText(els.coverText, String(cover.name).toUpperCase());
    }

    const rank = rankFor(player.respect ?? 0);
    setText(els.rankName, rank.name.toUpperCase());
    setText(els.respect, `${money(player.respect ?? 0)} RP`);
    setWidth(els.rankFill, rank.progress * 100);

    const act = state.activity;
    els.activityChip.classList.toggle('hidden', !act);
    if (act) {
      setText(els.activityCode, act.code);
      setText(els.activityName, act.name.toUpperCase());
      setText(els.activityCp, `CP ${Math.min(act.total, act.step + 1)} / ${act.total}${act.streak > 1 ? ` · x${act.streak.toFixed(2)}` : ''}${act.best ? ` · PB ${act.best}s` : ''}`);
      const t = Math.max(0, act.timer);
      setText(els.activityTimer, `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`);
    }

    painter.drawMinimap(els.minimap, {
      player, vehicle, wanted, policeCars: state.policeCars, trafficCars: state.trafficCars, parkedCars: state.parkedCars,
      waypoint: state.waypoint, helicopter: state.helicopter, activityStarts: state.activityStarts, checkpoints: state.checkpoints,
      roadblocks: state.roadblocks, turf: state.turf,
    });
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    event.stopPropagation();
    onAction?.(target.dataset.action, target.dataset);
  });

  return {
    els, update, setTitle, setTitleSlots, showTitle, showControls, showPause, showSlots, dispatch, refreshSlots,
    setSoundLabel, setSetting, showStoryComplete, hideStoryComplete, notify, clearToasts, missionBanner, objective,
    dialogue, missionComplete, hideMissionPopup, flashDamage, hitmarker, setPrompt, showPrompt: setPrompt, setHint,
    setRadio, setPlaying, showLoadingDone, announce, money, painter, portrait: portraitSvg,
  };
}
