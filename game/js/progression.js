// progression.js — what playing earns in Solaris Bay. Respect climbs through five
// street ranks, each paying a cash milestone and unlocking paints and neon underglow;
// cash buys garage upgrades at the Safehouse Garage (engine, nitro, armoured panels,
// street tyres) that apply to every car the player drives; the Paint Shop resprays and
// lights the player's ride; the garage keeps a collection of every model stolen; and
// district standing (turf.js) knocks up to 25% off every garage upgrade.

import { VEHICLES, rgb } from './config.js';

export const RANKS = [
  { name: 'Beach Rat', respect: 0, cash: 0, perk: 'Factory paint · no underglow' },
  { name: 'Boulevard Hustler', respect: 300, cash: 2000, perk: 'Lagoon Teal paint · Flamingo neon' },
  { name: 'Strip Operator', respect: 800, cash: 5000, perk: 'Solar Gold paint · Gold neon' },
  { name: 'Harbor Boss', respect: 1600, cash: 10000, perk: 'Midnight Violet paint · Violet neon' },
  { name: 'Bay Kingpin', respect: 3000, cash: 25000, perk: 'Pearl Chrome paint · Lime neon' },
];

/** Paint Shop resprays: free once the rank that unlocks them is reached. */
export const PAINTS = [
  { id: 'stock', name: 'Factory', hex: null, rank: 0 },
  { id: 'magenta', name: 'Sunset Magenta', hex: 0xff2f86, rank: 0 },
  { id: 'ember', name: 'Ember Orange', hex: 0xff6a2a, rank: 0 },
  { id: 'lagoon', name: 'Lagoon Teal', hex: 0x27e2d2, rank: 1 },
  { id: 'gold', name: 'Solar Gold', hex: 0xffc24b, rank: 2 },
  { id: 'violet', name: 'Midnight Violet', hex: 0x5b3cc8, rank: 3 },
  { id: 'pearl', name: 'Pearl Chrome', hex: 0xeef0f2, rank: 4 },
];

/** Neon underglow kits, lit under every car the player drives. */
export const NEONS = [
  { id: 'off', name: 'Off', hex: null, rank: 0 },
  { id: 'cyan', name: 'Bay Cyan', hex: 0x39f0ff, rank: 0 },
  { id: 'pink', name: 'Flamingo', hex: 0xff3f8e, rank: 1 },
  { id: 'gold', name: 'Gold', hex: 0xffc24b, rank: 2 },
  { id: 'violet', name: 'Violet', hex: 0xa36bff, rank: 3 },
  { id: 'lime', name: 'Lime', hex: 0x7dff6a, rank: 4 },
];

export const UPGRADES = [
  { id: 'engine', name: 'Turbo Engine', blurb: '+7% top speed and launch per stage', prices: [6000, 14000, 26000] },
  { id: 'nitro', name: 'Nitro Tank', blurb: 'Longer burn, faster refill', prices: [4000, 9000, 18000] },
  { id: 'armor', name: 'Armoured Panels', blurb: '-18% crash and gunfire damage per stage', prices: [5000, 12000, 22000] },
  { id: 'grip', name: 'Street Tyres', blurb: 'Sharper grip through the drift', prices: [3000, 8000, 15000] },
];

/** The car models a full garage holds: every civilian machine in the city. */
export const COLLECTION = Object.values(VEHICLES).filter((v) => v.id !== 'cruiser').map((v) => v.id);

export function rankFor(respect) {
  let index = 0;
  for (let i = 0; i < RANKS.length; i += 1) if (respect >= RANKS[i].respect) index = i;
  const next = RANKS[index + 1] ?? null;
  const floor = RANKS[index].respect;
  const span = next ? next.respect - floor : 1;
  return { index, name: RANKS[index].name, next, progress: next ? Math.min(1, (respect - floor) / span) : 1 };
}

export function createProgression({ combat, bus, turf = null }) {
  const freshStats = () => ({ stolen: 0, stunts: 0, evaded: 0, activities: 0, takedowns: 0, lamps: 0 });
  const state = {
    upgrades: { engine: 0, nitro: 0, armor: 0, grip: 0 },
    stored: [],
    stats: freshStats(),
    paint: 'stock',
    neon: 'off',
  };

  function reset() {
    state.upgrades = { engine: 0, nitro: 0, armor: 0, grip: 0 };
    state.stored = [];
    state.stats = freshStats();
    state.paint = 'stock';
    state.neon = 'off';
  }

  /** Award respect; a promotion pays its milestone cash and names what it unlocked. */
  function addRespect(amount, reason = '') {
    const p = combat.player;
    const before = rankFor(p.respect).index;
    p.respect = Math.max(0, p.respect + amount);
    const after = rankFor(p.respect);
    if (after.index > before) {
      let paid = 0;
      for (let i = before + 1; i <= after.index; i += 1) paid += RANKS[i].cash;
      p.cash += paid;
      bus.notify?.(`PROMOTED · ${after.name.toUpperCase()} · +$${paid.toLocaleString('en-US')}`, 'mission', 4200);
      bus.notify?.(`UNLOCKED · ${RANKS[after.index].perk}`, 'cash', 4200);
    } else if (reason && amount > 0) bus.notifyOnce?.(`+${amount} RESPECT · ${reason}`, 'cash', 2);
  }

  /** Is a paint or neon kit open at the player's rank? */
  function unlocked(item) {
    return rankFor(combat.player.respect).index >= item.rank;
  }

  /** Pick a Paint Shop colour or neon kit; returns true when it changed. */
  function setStyle(kind, id) {
    const list = kind === 'neon' ? NEONS : PAINTS;
    const item = list.find((x) => x.id === id);
    if (!item) return false;
    if (!unlocked(item)) {
      bus.notify?.(`Reach ${RANKS[item.rank].name.toUpperCase()} to unlock ${item.name}`, 'warn', 2200);
      return false;
    }
    state[kind === 'neon' ? 'neon' : 'paint'] = id;
    bus.notify?.(kind === 'neon' ? `UNDERGLOW · ${item.name.toUpperCase()}` : `RESPRAY · ${item.name.toUpperCase()}`, 'mission', 2000);
    return true;
  }

  /** Paint and light a car the player drives (the factory colour is kept to undo it). */
  function styleVehicle(car) {
    if (!car || car.police) return car;
    if (!car.factoryColor) car.factoryColor = car.color;
    const paint = PAINTS.find((x) => x.id === state.paint);
    car.color = paint?.hex != null ? rgb(paint.hex) : car.factoryColor;
    const neon = NEONS.find((x) => x.id === state.neon);
    car.underglow = neon?.hex != null ? rgb(neon.hex) : null;
    return car;
  }

  function count(stat, n = 1) {
    state.stats[stat] = (state.stats[stat] ?? 0) + n;
  }

  function upgradePrice(id) {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return null;
    const base = def.prices[state.upgrades[id]];
    if (base == null) return null;
    // District standing earns a garage discount (5% per district at RESPECTED or better).
    const off = turf?.discount() ?? 0;
    return Math.round((base * (1 - off)) / 50) * 50;
  }

  /** Buy the next stage of an upgrade; returns true when the cash changed hands. */
  function buyUpgrade(id) {
    const price = upgradePrice(id);
    const p = combat.player;
    if (price === null) { bus.notify?.('Already fully upgraded', 'warn', 1800); return false; }
    if (p.cash < price) { bus.notify?.(`Need $${price.toLocaleString('en-US')}`, 'warn', 1800); return false; }
    p.cash -= price;
    state.upgrades[id] += 1;
    const def = UPGRADES.find((u) => u.id === id);
    bus.notify?.(`${def.name.toUpperCase()} · STAGE ${state.upgrades[id]}`, 'mission', 2600);
    addRespect(40);
    return true;
  }

  /** Give a car the garage's tune: a per-car copy of its spec with the upgrade multipliers. */
  function tuneVehicle(car) {
    const base = VEHICLES[car.type] ?? car.spec;
    const u = state.upgrades;
    car.spec = {
      ...base,
      maxSpeed: base.maxSpeed * (1 + u.engine * 0.07),
      accel: base.accel * (1 + u.engine * 0.08),
      grip: base.grip * (1 + u.grip * 0.08),
    };
    car.nitroRate = 1 - u.nitro * 0.18;
    car.damageScale = 1 - u.armor * 0.18;
    return styleVehicle(car);
  }

  /** Park a car in the Safehouse Garage: the first of each model adds to the collection. */
  function storeVehicle(car) {
    if (!car || car.police) return false;
    if (state.stored.includes(car.type)) {
      bus.notify?.(`${car.spec.name.toUpperCase()} already in the garage`, 'info', 2000);
      return false;
    }
    state.stored.push(car.type);
    combat.player.cash += 1200;
    bus.notify?.(`STORED ${car.spec.name.toUpperCase()} · ${state.stored.length}/${COLLECTION.length} · +$1,200`, 'cash', 3200);
    addRespect(60);
    return true;
  }

  function snapshot() {
    return { upgrades: { ...state.upgrades }, stored: state.stored.slice(), stats: { ...state.stats }, paint: state.paint, neon: state.neon };
  }

  function restore(data) {
    if (!data) return;
    for (const key of Object.keys(state.upgrades)) {
      const level = Number(data.upgrades?.[key]);
      if (Number.isFinite(level)) state.upgrades[key] = Math.max(0, Math.min(3, Math.floor(level)));
    }
    if (Array.isArray(data.stored)) state.stored = data.stored.filter((id) => COLLECTION.includes(id));
    if (data.stats) for (const key of Object.keys(state.stats)) state.stats[key] = Number(data.stats[key]) || 0;
    state.paint = PAINTS.some((x) => x.id === data.paint) ? data.paint : 'stock';
    state.neon = NEONS.some((x) => x.id === data.neon) ? data.neon : 'off';
  }

  return {
    state, reset, addRespect, count, upgradePrice, buyUpgrade, tuneVehicle, storeVehicle, snapshot, restore,
    setStyle, styleVehicle, unlocked,
    get rank() { return rankFor(combat.player.respect); },
  };
}
