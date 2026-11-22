// save.js — multi-slot localStorage persistence for SOLARIS BAY: three named manual slots
// plus an autosave. Each slot records a name (the job in progress), district, story
// progress, cash, crew, turf standing and a timestamp, and can be overwritten or deleted.
// Every read is defensive (private mode, quota, corrupt JSON) and snapshots are plain data
// so a save from an older build can be skipped safely. Each slot also carries its act, the
// overall completion figure and the job medals, for the title screen's and city menu's slot
// cards. Nothing leaves the browser.

import { MISSIONS } from './missions.js';
import { ACTIVITIES } from './activities.js';

// The story in three acts: jobs 01-02, 03-05 and 06-08, each with the short title a slot card shows.
const ACTS = ['I', 'I', 'II', 'II', 'II', 'III', 'III', 'III'];
const JOB_TITLES = ['BOARDWALK BOOST', 'HARBOR CONTRABAND', 'NEON HEIST', 'PIER AMBUSH', 'CASA HILLS HUSH',
  'STARLIGHT KEY RUN', 'CRANE LIGHT BLACKOUT', 'THE SOLARIS VAULT'];

const PREFIX = 'solarisbay.v1.';
const SLOTS = ['auto', '1', '2', '3'];
const VERSION = 1;
const MANUAL = SLOTS.filter((s) => s !== 'auto');

function key(slot) {
  return `${PREFIX}${slot}`;
}

function safeParse(text) {
  try {
    const data = JSON.parse(text);
    if (!data || data.version !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function createSave() {
  function list() {
    const out = [];
    for (const slot of SLOTS) {
      let data = null;
      try {
        const raw = window.localStorage.getItem(key(slot));
        if (raw) data = safeParse(raw);
      } catch {
        data = null;
      }
      out.push({
        slot,
        exists: !!data,
        savedAt: data?.savedAt ?? 0,
        label: slot === 'auto' ? 'AUTOSAVE' : `SLOT ${slot}`,
        name: data?.name ?? '',
        cash: data?.cash ?? 0,
        mission: data?.missionIndex ?? 0,
        progress: data?.progress ?? 0,
        total: MISSIONS.length,
        district: data?.district ?? 'Palm Strip',
        crew: Object.entries(data?.crew?.recruited ?? {}).filter(([, on]) => on).map(([id]) => id),
        storyComplete: !!data?.storyComplete,
        completion: Number.isFinite(data?.completion) ? data.completion : 0,
        tokens: Array.isArray(data?.collectedTokens) ? data.collectedTokens.length : (Number.isFinite(data?.tokens) ? data.tokens : 0),
        peakWanted: Number.isFinite(data?.peakWanted) ? data.peakWanted : 0,
        act: actLabel(data?.missionIndex ?? 0, !!data?.storyComplete),
      });
    }
    return out;
  }

  function hasAny() {
    return list().some((s) => s.exists);
  }

  function latest() {
    const slots = list().filter((s) => s.exists);
    if (!slots.length) return null;
    slots.sort((a, b) => b.savedAt - a.savedAt);
    return read(slots[0].slot);
  }

  function read(slot) {
    try {
      const raw = window.localStorage.getItem(key(slot));
      if (!raw) return null;
      return safeParse(raw);
    } catch {
      return null;
    }
  }

  function write(slot, data) {
    try {
      const payload = {
        version: VERSION,
        savedAt: Date.now(),
        ...data,
      };
      window.localStorage.setItem(key(slot), JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  function remove(slot) {
    try {
      window.localStorage.removeItem(key(slot));
      return true;
    } catch {
      return false;
    }
  }

  return { SLOTS, MANUAL, list, hasAny, latest, read, write, remove };
}

/** "20 Nov 18:42" for a slot's timestamp, in the player's own locale clock. */
export function slotTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "ACT II — NEON HEIST" for the job a save sits on. */
export function actLabel(index, storyComplete = false) {
  if (storyComplete) return 'EPILOGUE — FREE ROAM';
  const i = Math.max(0, Math.min(MISSIONS.length - 1, index));
  return `ACT ${ACTS[i]} — ${JOB_TITLES[i]}`;
}

/**
 * Overall completion in percent, one decimal: story jobs 50, district standing 20, side
 * activities cleared 15, garage upgrade stages 10 and Sun Tokens 5. The city menu's ring and
 * every save card read this same figure.
 */
export function completion({ jobs = 0, turf = 0, activities = 0, upgrades = 0, tokens = 0 }) {
  const pct = (jobs / MISSIONS.length) * 50 + (turf / 100) * 20 + (activities / ACTIVITIES.length) * 15
    + (upgrades / 12) * 10 + (tokens / 12) * 5;
  return Math.round(Math.min(100, pct) * 10) / 10;
}

/** Completion read from the live systems. */
export function completionOf(game) {
  const ups = game.progression?.state.upgrades ?? {};
  return completion({
    jobs: game.missions.progress,
    turf: game.turf?.overall() ?? 0,
    activities: ACTIVITIES.filter((a) => (game.activities?.state.completed[a.id] ?? 0) > 0).length,
    upgrades: Object.values(ups).reduce((n, v) => n + v, 0),
    tokens: game.tokens.filter((t) => t.taken).length,
  });
}

/** The job index a save points at: the live job, or the next unfinished one after a finish. */
function currentMissionIndex(game) {
  const m = game.missions;
  if (m.state.storyComplete) return MISSIONS.length - 1;
  if (m.active) return m.index;
  const next = m.state.done.findIndex((d) => !d);
  return next >= 0 ? next : m.index;
}

/** The name a slot gets: the job in progress, or the next one up. */
function slotName(game) {
  const m = game.missions;
  if (m.state.storyComplete) return 'Free roam · the city is yours';
  const index = currentMissionIndex(game);
  const def = MISSIONS[index >= 0 ? index : 0];
  return `${def.code} · ${def.name}`;
}

export function snapshot(game) {
  const p = game.combat.player;
  const collectedTokens = game.tokens.reduce((acc, t, i) => {
    if (t.taken) acc.push(i);
    return acc;
  }, []);
  return {
    name: slotName(game),
    cash: p.cash,
    respect: p.respect,
    health: p.health,
    armor: p.armor,
    weaponSlot: p.weaponSlot,
    weapons: p.weapons.slice(),
    ammo: JSON.parse(JSON.stringify(p.ammo)),
    missionIndex: currentMissionIndex(game),
    progress: game.missions.progress,
    storyComplete: game.missions.state.storyComplete,
    done: game.missions.state.done.slice(),
    ratings: game.missions.state.ratings.slice(),
    completion: completionOf(game),
    player: { x: p.inVehicle ? p.inVehicle.x : p.x, z: p.inVehicle ? p.inVehicle.z : p.z, onFoot: !p.inVehicle },
    district: game.world.districtName(p.x, p.z),
    tokens: collectedTokens.length,
    collectedTokens,
    peakWanted: Math.max(game.police.peak, game.police.wanted),
    playTime: game.playTime,
    hour: game.hour,
    radio: game.audio.station,
    vehicleType: p.inVehicle ? p.inVehicle.type : null,
    progression: game.progression?.snapshot(),
    activities: game.activities?.snapshot(),
    crew: game.crew?.snapshot(),
    turf: game.turf?.snapshot(),
  };
}

export function applySnapshot(game, data) {
  if (!data) return false;
  const p = game.combat.player;
  p.cash = Number.isFinite(data.cash) ? data.cash : p.cash;
  p.respect = Number.isFinite(data.respect) ? data.respect : p.respect;
  p.health = Number.isFinite(data.health) ? data.health : 100;
  p.armor = Number.isFinite(data.armor) ? data.armor : 0;
  p.weaponSlot = Number.isFinite(data.weaponSlot) ? data.weaponSlot : 2;
  if (Array.isArray(data.weapons)) p.weapons = data.weapons.filter((id) => ['fists', 'pistol', 'smg', 'shotgun', 'carbine'].includes(id));
  if (data.ammo) {
    for (const id of Object.keys(p.ammo)) {
      if (data.ammo[id]) {
        p.ammo[id].mag = Math.max(0, Number(data.ammo[id].mag) || 0);
        p.ammo[id].reserve = Math.max(0, Number(data.ammo[id].reserve) || 0);
      }
    }
  }
  if (Array.isArray(data.done)) game.missions.state.done = MISSIONS.map((_, i) => !!data.done[i]);
  game.missions.state.done = game.missions.state.done.map(Boolean);
  game.missions.state.ratings = MISSIONS.map((_, i) => (['G', 'S', 'B'].includes(data.ratings?.[i]) ? data.ratings[i] : null));
  game.missions.state.storyComplete = !!data.storyComplete;
  game.missions.cancelHeatTimer?.();
  game.missions.state.active = false;
  game.missions.state.step = -1;
  game.missions.state.nextTimer = 0;
  game.missions.state.startingSoon = false;
  game.missions.state.index = Math.min(MISSIONS.length - 1, Math.max(0, Number(data.missionIndex) || 0));
  if (Number.isFinite(data.hour)) game.hour = data.hour;
  if (Number.isFinite(data.playTime)) game.playTime = data.playTime;
  if (data.player) {
    const x = Number(data.player.x) || game.world.spawn.x;
    const z = Number(data.player.z) || game.world.spawn.z;
    p.x = x;
    p.z = z;
    p.y = game.world.groundHeight(x, z);
    p.velocityX = 0;
    p.velocityZ = 0;
  }
  game.police.clear();
  game.police.setPeak(Math.max(0, Math.min(5, Math.floor(Number(data.peakWanted) || 0))));
  for (const token of game.tokens) token.taken = false;
  if (Array.isArray(data.collectedTokens)) {
    for (const idx of data.collectedTokens) {
      const i = Math.floor(Number(idx));
      if (Number.isInteger(i) && i >= 0 && i < game.tokens.length) game.tokens[i].taken = true;
    }
  } else if (Number.isFinite(data.tokens) && data.tokens > 0) {
    const n = Math.min(game.tokens.length, Math.max(0, Math.floor(data.tokens)));
    for (let i = 0; i < n; i += 1) game.tokens[i].taken = true;
  }
  game.combat.clearEnemies();
  if (data.weapons?.includes('smg')) game.combat.giveWeapon('smg');
  if (data.weapons?.includes('shotgun')) game.combat.giveWeapon('shotgun');
  if (data.weapons?.includes('carbine')) game.combat.giveWeapon('carbine');
  if (Number.isFinite(data.radio)) game.audio.setRadio(data.radio);
  game.progression?.restore(data.progression);
  game.activities?.restore(data.activities);
  game.turf?.restore(data.turf);
  game.crew?.restore(data.crew);
  // Older saves carry no crew block: recruit from the story they record.
  game.crew?.syncStory(game.missions.state.done, false);
  return true;
}
