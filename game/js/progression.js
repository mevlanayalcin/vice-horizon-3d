// progression.js — what playing earns in Solaris Bay. Respect climbs through five
// street ranks; cash buys garage upgrades at the Safehouse Garage (engine, nitro,
// armoured panels, street tyres) that apply to every car the player drives; and the
// garage keeps a collection of every model the player has stolen and stored.

import { VEHICLES } from './config.js';

export const RANKS = [
  { name: 'Beach Rat', respect: 0 },
  { name: 'Boulevard Hustler', respect: 300 },
  { name: 'Strip Operator', respect: 800 },
  { name: 'Harbor Boss', respect: 1600 },
  { name: 'Bay Kingpin', respect: 3000 },
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

export function createProgression({ combat, bus }) {
  const state = {
    upgrades: { engine: 0, nitro: 0, armor: 0, grip: 0 },
    stored: [],
    stats: { stolen: 0, stunts: 0, evaded: 0, activities: 0, takedowns: 0 },
  };

  function reset() {
    state.upgrades = { engine: 0, nitro: 0, armor: 0, grip: 0 };
    state.stored = [];
    state.stats = { stolen: 0, stunts: 0, evaded: 0, activities: 0, takedowns: 0 };
  }

  /** Award respect; announces a promotion when it crosses into a new rank. */
  function addRespect(amount, reason = '') {
    const p = combat.player;
    const before = rankFor(p.respect).index;
    p.respect = Math.max(0, p.respect + amount);
    const after = rankFor(p.respect);
    if (after.index > before) bus.notify?.(`PROMOTED · ${after.name.toUpperCase()}`, 'mission', 4200);
    else if (reason && amount > 0) bus.notifyOnce?.(`+${amount} RESPECT · ${reason}`, 'cash', 2);
  }

  function count(stat, n = 1) {
    state.stats[stat] = (state.stats[stat] ?? 0) + n;
  }

  function upgradePrice(id) {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return null;
    return def.prices[state.upgrades[id]] ?? null;
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
    return car;
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
    return { upgrades: { ...state.upgrades }, stored: state.stored.slice(), stats: { ...state.stats } };
  }

  function restore(data) {
    if (!data) return;
    for (const key of Object.keys(state.upgrades)) {
      const level = Number(data.upgrades?.[key]);
      if (Number.isFinite(level)) state.upgrades[key] = Math.max(0, Math.min(3, Math.floor(level)));
    }
    if (Array.isArray(data.stored)) state.stored = data.stored.filter((id) => COLLECTION.includes(id));
    if (data.stats) for (const key of Object.keys(state.stats)) state.stats[key] = Number(data.stats[key]) || 0;
  }

  return {
    state, reset, addRespect, count, upgradePrice, buyUpgrade, tuneVehicle, storeVehicle, snapshot, restore,
    get rank() { return rankFor(combat.player.respect); },
  };
}
