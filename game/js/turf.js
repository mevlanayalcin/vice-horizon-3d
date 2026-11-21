// Solaris Bay v10 module: turf (5-district standing & passive income).
// turf.js — district standing in Solaris Bay. Five districts (Palm Strip, Neon Midtown,
// Harbor Docks, Casa Hills and Starlight Key) each carry a 0–100% standing. Story jobs,
// street races, courier and cab runs, and shaking off a three-star-plus chase raise the
// standing of the district they happen in. Standing pays a passive cash trickle every
// minute of play, earns a garage discount, and tints the district on the minimap and the
// city map. Plain data, so the save system stores it as-is.

export const TURF = [
  { id: 'palm', name: 'Palm Strip', short: 'PALM', color: '#ffb257', rgb: '255, 178, 87' },
  { id: 'midtown', name: 'Neon Midtown', short: 'MIDTOWN', color: '#c56cff', rgb: '197, 108, 255' },
  { id: 'harbor', name: 'Harbor Docks', short: 'HARBOR', color: '#57d8d0', rgb: '87, 216, 208' },
  { id: 'hills', name: 'Casa Hills', short: 'HILLS', color: '#9ee06a', rgb: '158, 224, 106' },
  { id: 'key', name: 'Starlight Key', short: 'KEY', color: '#ffe08a', rgb: '255, 224, 138' },
];

/** Standing tiers: the label a district shows and what it pays per trickle. */
export const TURF_TIERS = [
  { min: 0, name: 'CONTESTED', pay: 0 },
  { min: 25, name: 'KNOWN', pay: 60 },
  { min: 50, name: 'RESPECTED', pay: 140 },
  { min: 75, name: 'FEARED', pay: 240 },
  { min: 100, name: 'CONTROLLED', pay: 400 },
];

/** Seconds of play between passive cash payouts. */
export const TRICKLE_SECONDS = 60;

export function tierFor(standing) {
  let tier = TURF_TIERS[0];
  for (const t of TURF_TIERS) if (standing >= t.min) tier = t;
  return tier;
}

/** Which turf a world position belongs to; the pier, beach and causeway fold into their neighbours. */
export function turfIdAt(x, z) {
  if (x > 540 && z > 60 && z < 310) return 'key';
  if (z > 120) return 'palm';
  if (z < -300) return 'hills';
  if (x < -230) return 'harbor';
  if (x > 250 && z > 40) return 'key';
  return 'midtown';
}

const fresh = () => Object.fromEntries(TURF.map((d) => [d.id, 0]));

export function createTurf({ combat, bus }) {
  const state = { standing: fresh(), trickle: 0, earned: 0 };

  function reset() {
    state.standing = fresh();
    state.trickle = 0;
    state.earned = 0;
  }

  /** Raise (or lower) a district's standing; announces tier changes. Returns the new value. */
  function add(id, amount, reason = '') {
    if (!(id in state.standing) || !amount) return state.standing[id] ?? 0;
    const before = state.standing[id];
    const after = Math.max(0, Math.min(100, Math.round((before + amount) * 10) / 10));
    state.standing[id] = after;
    const def = TURF.find((d) => d.id === id);
    const gained = Math.round(after - before);
    if (gained > 0) bus.notify?.(`${def.name.toUpperCase()} STANDING +${gained}%${reason ? ` · ${reason}` : ''}`, 'mission', 2600);
    const t0 = tierFor(before), t1 = tierFor(after);
    if (t1.min > t0.min) {
      bus.notify?.(`${def.name.toUpperCase()} · ${t1.name}${t1.pay ? ` · +$${t1.pay}/min` : ''}`, 'cash', 3800);
      bus.onTurfTier?.(def, t1);
    }
    return after;
  }

  /** Passive cash: every district pays its tier rate once per TRICKLE_SECONDS of play. */
  function update(dt) {
    state.trickle += dt;
    if (state.trickle < TRICKLE_SECONDS) return 0;
    state.trickle -= TRICKLE_SECONDS;
    const pay = payPerMinute();
    if (pay > 0) {
      combat.player.cash += pay;
      state.earned += pay;
      bus.notify?.(`TURF PAYOUT · +$${pay.toLocaleString('en-US')} from ${controlledCount(25)} districts`, 'cash', 3000);
    }
    return pay;
  }

  function payPerMinute() {
    return TURF.reduce((sum, d) => sum + tierFor(state.standing[d.id]).pay, 0);
  }

  function controlledCount(min = 50) {
    return TURF.filter((d) => state.standing[d.id] >= min).length;
  }

  /** Garage discount: 5% for every district at RESPECTED or better, up to 25%. */
  function discount() {
    return controlledCount(50) * 0.05;
  }

  /** Average standing across the five districts, 0–100. */
  function overall() {
    return TURF.reduce((sum, d) => sum + state.standing[d.id], 0) / TURF.length;
  }

  function snapshot() {
    return { standing: { ...state.standing }, earned: state.earned };
  }

  function restore(data) {
    state.standing = fresh();
    state.trickle = 0;
    if (!data) return;
    for (const d of TURF) {
      const v = Number(data.standing?.[d.id]);
      if (Number.isFinite(v)) state.standing[d.id] = Math.max(0, Math.min(100, v));
    }
    state.earned = Math.max(0, Number(data.earned) || 0);
  }

  /** Pin standings for staged frames. */
  function stage(values) {
    Object.assign(state.standing, values);
  }

  return {
    TURF, state, reset, add, update, payPerMinute, discount, overall, controlledCount, snapshot, restore, stage,
    at: turfIdAt,
    standing: (id) => state.standing[id] ?? 0,
  };
}
