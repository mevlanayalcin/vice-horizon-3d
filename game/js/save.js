// save.js — multi-slot localStorage persistence for SOLARIS BAY. Three manual slots
// plus an autosave; every read is defensive (private mode, quota, corrupt JSON) and
// snapshots are plain data so a save from an older build can be skipped safely.

const PREFIX = 'solarisbay.v1.';
const SLOTS = ['auto', '1', '2', '3'];
const VERSION = 1;

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
        cash: data?.cash ?? 0,
        mission: data?.missionIndex ?? 0,
        progress: data?.progress ?? 0,
        district: data?.district ?? 'Palm Strip',
        storyComplete: !!data?.storyComplete,
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

  return { SLOTS, list, hasAny, latest, read, write, remove };
}

export function snapshot(game) {
  const p = game.combat.player;
  return {
    cash: p.cash,
    respect: p.respect,
    health: p.health,
    armor: p.armor,
    weaponSlot: p.weaponSlot,
    weapons: p.weapons.slice(),
    ammo: JSON.parse(JSON.stringify(p.ammo)),
    missionIndex: game.missions.index,
    progress: game.missions.progress,
    storyComplete: game.missions.state.storyComplete,
    done: game.missions.state.done.slice(),
    player: { x: p.inVehicle ? p.inVehicle.x : p.x, z: p.inVehicle ? p.inVehicle.z : p.z, onFoot: !p.inVehicle },
    district: game.world.districtName(p.x, p.z),
    tokens: game.tokens.filter((t) => t.taken).length,
    peakWanted: Math.max(game.police.peak, game.police.wanted),
    playTime: game.playTime,
    hour: game.hour,
    radio: game.audio.station,
    vehicleType: p.inVehicle ? p.inVehicle.type : null,
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
  if (Array.isArray(data.weapons)) p.weapons = data.weapons.filter((id) => ['fists', 'pistol', 'smg', 'shotgun'].includes(id));
  if (data.ammo) {
    for (const id of Object.keys(p.ammo)) {
      if (data.ammo[id]) {
        p.ammo[id].mag = Math.max(0, Number(data.ammo[id].mag) || 0);
        p.ammo[id].reserve = Math.max(0, Number(data.ammo[id].reserve) || 0);
      }
    }
  }
  if (Array.isArray(data.done)) game.missions.state.done = data.done.slice(0, 5);
  game.missions.state.done = game.missions.state.done.map(Boolean);
  game.missions.state.storyComplete = !!data.storyComplete;
  game.missions.state.active = false;
  game.missions.state.step = -1;
  game.missions.state.nextTimer = 0;
  game.missions.state.startingSoon = false;
  game.missions.state.index = Math.min(4, Math.max(0, (Number(data.missionIndex) || 0) + (data.storyComplete ? 0 : 0)));
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
  game.combat.clearEnemies();
  if (data.weapons?.includes('smg')) game.combat.giveWeapon('smg');
  if (data.weapons?.includes('shotgun')) game.combat.giveWeapon('shotgun');
  if (Number.isFinite(data.radio)) game.audio.setRadio(data.radio);
  return true;
}
