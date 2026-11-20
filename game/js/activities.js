// activities.js — Solaris Bay's side hustles, playable between and during story jobs:
// two street races, a timed courier run, Sun Cab fares and the stunt-ramp hunt. Each
// timed activity starts when the player rolls into its cyan start ring, runs a chain
// of checkpoints against the clock and pays cash and respect; best times are saved.
// Back-to-back clears build a streak multiplier (to x2), and every best time earns a
// gold, silver or bronze medal against the activity's par. A clean run also raises the
// district standing (turf.js) of the district it serves.

export const ACTIVITIES = [
  {
    id: 'sprint', kind: 'race', name: 'Ocean Boulevard Sprint', code: 'RACE',
    blurb: 'Hotel to hotel down the Strip, then north past the Harbor gate.',
    start: [318, 255], needs: 'vehicle', time: 48, reward: 2500, respect: 120, district: 'palm', turf: 8,
    route: [[200, 254], [60, 254], [-80, 254], [-220, 254], [-388, 252], [-390, 140]],
  },
  {
    id: 'circuit', kind: 'race', name: 'Midtown Neon Circuit', code: 'RACE',
    blurb: 'A lap of the glass towers around the Solaris Vault.',
    start: [140, 130], needs: 'vehicle', time: 44, reward: 3200, respect: 140, district: 'midtown', turf: 8,
    route: [[130, 4], [4, 0], [0, -126], [126, -130], [130, -2], [138, 124]],
  },
  {
    id: 'courier', kind: 'courier', name: 'Coral Courier', code: 'JOB',
    blurb: 'A sealed parcel from the pier office to a Casa Hills porch. No questions.',
    start: [-150, 292], needs: null, time: 75, reward: 1800, respect: 80, district: 'hills', turf: 7,
    route: [[-130, 140], [-4, -128], [126, -380]],
  },
  {
    id: 'fares', kind: 'fare', name: 'Sun Cab Fares', code: 'TAXI',
    blurb: 'Take a Sun Cab to the rank and run tourists across the bay.',
    start: [-262, 262], needs: 'taxi', time: 60, reward: 1400, respect: 70, district: 'key', turf: 7,
    route: [[-262, 140], [-130, 4], [262, 6], [392, 136]],
  },
];

export const STUNT_GOAL = 8;

/** Medal thresholds as a share of the par time; the best time decides the medal. */
export const MEDALS = [
  { id: 'gold', name: 'GOLD', share: 0.72 },
  { id: 'silver', name: 'SILVER', share: 0.86 },
  { id: 'bronze', name: 'BRONZE', share: 1 },
];

/** The medal a time earns against an activity's par, or null. */
export function medalFor(def, time) {
  if (!Number.isFinite(time)) return null;
  return MEDALS.find((m) => time <= def.time * m.share) ?? null;
}

/** Back-to-back clears without a failure stack a cash multiplier: x1.25 per clear, to x2. */
export function streakMultiplier(streak) {
  return 1 + Math.min(4, Math.max(0, streak)) * 0.25;
}

export function createActivities({ combat, bus, progression, turf = null }) {
  const state = {
    active: null,
    index: 0,
    timer: 0,
    elapsed: 0,
    offFoot: 0,
    best: {},
    completed: {},
    cooldown: {},
    streak: 0,
    bestStreak: 0,
  };

  function reset() {
    state.active = null;
    state.best = {};
    state.completed = {};
    state.cooldown = {};
    state.streak = 0;
    state.bestStreak = 0;
  }

  function playerPosition() {
    const p = combat.player;
    return p.inVehicle ? [p.inVehicle.x, p.inVehicle.z] : [p.x, p.z];
  }

  function meetsNeeds(def) {
    const car = combat.player.inVehicle;
    if (def.needs === 'vehicle') return !!car;
    if (def.needs === 'taxi') return !!car && car.type === 'taxi';
    return true;
  }

  function start(def) {
    state.active = def;
    state.index = 0;
    state.timer = def.time;
    state.elapsed = 0;
    state.offFoot = 0;
    bus.missionBanner?.({ code: def.code, name: def.name, giver: 'SIDE ACTIVITY' }, `${def.code} START`, 2600);
    bus.notify?.(`${def.name.toUpperCase()} · beat ${def.time}s`, 'mission', 2600);
  }

  function finish(success) {
    const def = state.active;
    if (!def) return;
    state.active = null;
    state.cooldown[def.id] = 12;
    if (!success) {
      if (state.streak > 1) bus.notify?.(`STREAK LOST · x${streakMultiplier(state.streak).toFixed(2)}`, 'warn', 2400);
      state.streak = 0;
      bus.notify?.(`${def.name.toUpperCase()} FAILED`, 'warn', 2600);
      return;
    }
    const time = Math.round(state.elapsed * 10) / 10;
    const best = state.best[def.id];
    const personalBest = !best || time < best;
    if (personalBest) state.best[def.id] = time;
    state.completed[def.id] = (state.completed[def.id] ?? 0) + 1;
    const multiplier = streakMultiplier(state.streak);
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    const bonus = Math.round(def.reward * Math.max(0, state.timer / def.time) * 0.5);
    const pay = Math.round((def.reward + bonus) * multiplier);
    combat.player.cash += pay;
    progression.count('activities');
    progression.addRespect(Math.round(def.respect * multiplier), def.code);
    const medal = medalFor(def, time);
    bus.notify?.(`${def.name.toUpperCase()} · ${time}s · +$${pay.toLocaleString('en-US')}${multiplier > 1 ? ` · STREAK x${multiplier.toFixed(2)}` : ''}`, 'cash', 3800);
    if (personalBest && best) bus.notify?.(`NEW PERSONAL BEST · ${time}s (was ${best}s)${medal ? ` · ${medal.name}` : ''}`, 'mission', 3600);
    else if (medal) bus.notify?.(`${medal.name} MEDAL · ${def.name.toUpperCase()}`, 'mission', 3000);
    // Clean runs build the crew's name where the run ends.
    turf?.add(def.district, def.turf ?? 6, def.code);
    bus.activityComplete?.(def);
  }

  function update(dt) {
    for (const id of Object.keys(state.cooldown)) state.cooldown[id] = Math.max(0, state.cooldown[id] - dt);
    const [px, pz] = playerPosition();
    if (state.active) {
      const def = state.active;
      state.timer -= dt;
      state.elapsed += dt;
      if (!meetsNeeds(def)) {
        state.offFoot += dt;
        if (state.offFoot > 4) { finish(false); return; }
      } else {
        state.offFoot = 0;
      }
      const target = def.route[state.index];
      if (Math.hypot(px - target[0], pz - target[1]) < 10) {
        state.index += 1;
        bus.onCheckpoint?.();
        if (state.index >= def.route.length) { finish(true); return; }
      }
      if (state.timer <= 0) finish(false);
      return;
    }
    for (const def of ACTIVITIES) {
      if ((state.cooldown[def.id] ?? 0) > 0) continue;
      if (Math.hypot(px - def.start[0], pz - def.start[1]) > 7) continue;
      if (meetsNeeds(def)) start(def);
      else bus.notifyOnce?.(def.needs === 'taxi' ? 'Bring a Sun Cab to start fares' : 'You need a car for this race', 'warn', 5);
    }
  }

  /** The active checkpoint for the HUD waypoint and minimap route, or null. */
  function waypoint() {
    const def = state.active;
    if (!def) return null;
    const [x, z] = def.route[state.index];
    return { x, z, label: def.name, activity: true };
  }

  /** What the HUD's activity timer shows. */
  function hudInfo() {
    const def = state.active;
    if (!def) return null;
    return { name: def.name, code: def.code, timer: Math.max(0, state.timer), step: state.index, total: def.route.length, streak: streakMultiplier(state.streak), best: state.best[def.id] ?? null };
  }

  function stage(id, index, timer) {
    const def = ACTIVITIES.find((a) => a.id === id);
    if (!def) return;
    state.active = def;
    state.index = index;
    state.timer = timer;
    state.elapsed = def.time - timer;
  }

  function snapshot() {
    return { best: { ...state.best }, completed: { ...state.completed }, streak: state.streak, bestStreak: state.bestStreak };
  }

  function restore(data) {
    if (!data) return;
    state.best = { ...(data.best ?? {}) };
    state.completed = { ...(data.completed ?? {}) };
    state.streak = Math.max(0, Math.floor(Number(data.streak) || 0));
    state.bestStreak = Math.max(state.streak, Math.floor(Number(data.bestStreak) || 0));
  }

  return {
    ACTIVITIES, state, reset, update, waypoint, hudInfo, stage, snapshot, restore,
    get multiplier() { return streakMultiplier(state.streak); },
    get active() { return state.active; },
    get checkpoints() { return state.active ? state.active.route.slice(state.index) : []; },
  };
}
