// police.js — the Solaris Bay Police Department, one to five stars.
//   1 ALERT       a patrol unit rolls; officers step out if the suspect is on foot
//   2 PURSUIT     two units: flanking runs and PIT nudges on the rear quarter
//   3 ROADBLOCKS  an intercept car, and cruiser barricades with burning flares ahead
//   4 AIR ONE     the helicopter orbits overhead, its searchlight hunting the suspect
//   5 LOCKDOWN    five units on nitro, a dedicated rammer, SMG officers at every stop
// Every unit has a vision cone and needs a clear line past the buildings; Air One sees
// whatever stands in its light. Out of sight an evasion timer runs and the stars fall one
// at a time; any unit spotting the suspect resets it. Cruisers are ordinary cars, built
// and stepped by vehicles.js through `bus.buildCar` / `bus.driveCar`: this module only
// steers them, routing round the blocks through the road grid's junctions.
// Every unit carries a radio callsign (UNIT-12, TAC-04, AIR ONE) and getDispatchUnits()
// reads the live roster for the HUD's SBPD RESPONSE table: each unit's current role
// (SPOTLIGHT, PIT/RAM, FLANKING, ROADBLOCK, CLOSING IN, FOOT CHASE, SEARCHING ...) worked out
// from what it is doing this frame, and its distance to the suspect. Elena's JAM DISPATCH
// (crew.js) calls jam(): for a few seconds no unit beyond earshot can see the suspect.

import { clamp, createRandom, lerp } from './config.js';

export const ROADBLOCK_STARS = 3;

// cars on the street, sight range (m), seconds out of sight to drop a star, barricades.
const TIERS = [
  { label: 'CLEAR', cars: 0, range: 0, evade: 0, blocks: 0 },
  { label: '1-STAR ALERT', cars: 1, range: 58, evade: 7, blocks: 0 },
  { label: '2-STAR PURSUIT', cars: 2, range: 70, evade: 9, blocks: 0 },
  { label: '3-STAR ROADBLOCKS', cars: 3, range: 82, evade: 11, blocks: 1 },
  { label: '4-STAR AIR ONE', cars: 4, range: 92, evade: 13, blocks: 2 },
  { label: '5-STAR LOCKDOWN', cars: 5, range: 104, evade: 15, blocks: 2 },
];
const CALLOUTS = [null,
  ['SBPD DISPATCH · 1-STAR ALERT', 'Unit 12, reports of a disturbance. Eyes open, approach with caution.'],
  ['SBPD DISPATCH · PURSUIT', 'Suspect fleeing. Units 12 and 7 in pursuit, PIT authorised on a clean line.'],
  ['SBPD DISPATCH · 3 STARS', 'All units, suspect is armed. Intercept car rolling, barricades going up ahead.'],
  null, // Air One announces itself when it arrives
  ['SBPD DISPATCH · 5-STAR LOCKDOWN', 'Code 5 citywide lockdown. Every unit, every bridge. Ram on sight.'],
];
// Dispatch street names: roads running along x keyed by z, roads along z keyed by x.
const STREETS = {
  x: { '-390': 'Hillcrest Road', '-260': 'Casa Hills Drive', '-130': 'Dockside Avenue', 0: 'Midtown Avenue', 130: 'Bayview Avenue', 260: 'Ocean Boulevard' },
  z: { '-390': 'Harbor Way', '-260': 'Coral Avenue', '-130': 'Flamingo Drive', 0: 'Solaris Avenue', 130: 'Neon Parkway', 260: 'Bayside Drive', 390: 'Causeway Road' },
};
const HEAR = 15; // noticed this close whichever way a unit faces
const CONE = 1.05; // half-angle of a unit's vision cone
const CONTACT = 3.3; // centre distance at which two cars touch

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Radio callsigns, handed out in order so a staged frame always reads the same.
const UNIT_CALLSIGNS = ['UNIT-12', 'UNIT-07', 'UNIT-21', 'UNIT-33', 'UNIT-18', 'UNIT-26', 'UNIT-05', 'UNIT-41'];
const TAC_CALLSIGNS = ['TAC-04', 'TAC-09', 'TAC-11', 'TAC-15'];

export function createPolice(world, combat, bus) {
  const random = createRandom(0x5b9d);
  const cruisers = [];
  const roadblockCars = [];
  const roadblocks = [];
  let helicopter = null;
  let wanted = 0, peak = 0, chasePeak = 0, time = 0;
  let seen = false, lastSeen = { x: 0, z: 0 }, evadeT = 0;
  let spawnT = 0, losT = 0, blockT = 0, bumpT = 0, boxedT = 0;
  let nearestSiren = Infinity;
  let heliCalled = false;
  let jamT = 0;
  let unitCount = 0, tacCount = 0;
  const nextUnit = () => UNIT_CALLSIGNS[unitCount++ % UNIT_CALLSIGNS.length];

  // Junctions of the road grid: the waypoints cruisers route through.
  const junctions = [];
  for (const a of world.roads.filter((r) => r.axis === 'x')) {
    for (const b of world.roads.filter((r) => r.axis === 'z')) {
      const x = b.x1, z = a.z1;
      if (x >= Math.min(a.x1, a.x2) - 1 && x <= Math.max(a.x1, a.x2) + 1 && z >= Math.min(b.z1, b.z2) - 1 && z <= Math.max(b.z1, b.z2) + 1) junctions.push([x, z]);
    }
  }

  function onRoad(x, z) {
    return world.roads.some((r) => {
      const h = r.w / 2 + 1.5;
      const [u, v, lo, hi] = r.axis === 'x' ? [z - r.z1, x, r.x1, r.x2] : [x - r.x1, z, r.z1, r.z2];
      return Math.abs(u) < h && v > Math.min(lo, hi) - h && v < Math.max(lo, hi) + h;
    });
  }

  /** Nothing solid between two points (sampled every 5 m)? */
  function clearLine(x1, z1, x2, z2) {
    const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 5);
    for (let i = 1; i < steps; i += 1) {
      const x = x1 + ((x2 - x1) * i) / steps, z = z1 + ((z2 - z1) * i) / steps;
      if (!onRoad(x, z) && world.insideBuilding(x, z)) return false;
    }
    return true;
  }

  function streetAt(x, z) {
    const r = world.nearestRoad(x, z);
    if (r?.bridge) return 'the Marina Causeway';
    if (r?.island) return 'Starlight Key';
    return (r && STREETS[r.axis][r.axis === 'x' ? r.z1 : r.x1]) ?? 'the Strip';
  }

  const allCars = () => cruisers.concat(roadblockCars);
  const officers = () => combat.enemies.filter((e) => e.police);
  /** Take officers out of the fight: every one matching `test`. */
  function dropOfficers(test) {
    const list = combat.enemies;
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].police && test(list[i])) list.splice(i, 1);
  }
  const forget = (car) => cruisers.splice(cruisers.indexOf(car), 1);

  // ------------------------------------------------------------------ units
  function makeCruiser(x, z, heading, extra = {}) {
    const car = bus.buildCar('cruiser', x, z, heading, { police: true, ...extra });
    Object.assign(car, {
      y: world.groundHeight(x, z) + 0.02, sirenPhase: (car.id * 0.37) % 1, role: cruisers.length % 5, damageScale: 0.35,
      repath: 0, waypoint: null, stuckT: 0, reverseT: 0, pitCd: 0, dismounted: false, offDuty: 0,
    });
    return car;
  }

  /** A pursuit cruiser on a road about `distance` m from the suspect, facing its way. */
  function spawnCruiser(at = null, distance = 120) {
    const p = combat.player;
    let spot = at && Number.isFinite(at.x) ? at : null;
    for (let i = 0; i < 8 && !spot; i += 1) {
      const pt = world.randomRoadPoint(p.x, p.z, distance * 0.8, distance * 1.25, random);
      if (!world.isWater(pt.x, pt.z) && !world.insideBuilding(pt.x, pt.z)) spot = pt;
    }
    if (!spot) return null;
    const toward = Math.atan2(p.x - spot.x, p.z - spot.z);
    const along = spot.axis === 'x' ? Math.PI / 2 : 0;
    const heading = spot.heading ?? (spot.axis ? (Math.cos(along - toward) >= 0 ? along : along + Math.PI) : toward);
    const car = makeCruiser(spot.x, spot.z, heading, { sirenOn: wanted > 0, pursuit: wanted > 0, callsign: nextUnit() });
    cruisers.push(car);
    bus.onPoliceSpawned?.(car);
    return car;
  }

  /** Photo mode: a cruiser parked exactly where the stage wants it. */
  function spawnStagedCruiser(x, z, heading) {
    const car = makeCruiser(x, z, heading, { staged: true, callsign: nextUnit() });
    cruisers.push(car);
    return car;
  }

  function spawnOfficer(x, z, heading, extra) {
    return combat.spawnEnemy(x, z, {
      style: 'cop', police: true, heading, health: 70 + wanted * 6, cash: 60,
      weapon: 'pistol', range: 36 + wanted * 2, damage: 4 + wanted, ...extra,
    });
  }

  /** Officers out of a stopped cruiser, one each side, up to the tier's head count. */
  function dismount(car, count) {
    if (car.dismounted) return;
    car.dismounted = true;
    car.speed = 0;
    const room = Math.min(9, 2 + Math.round(wanted * 1.4)) - officers().filter((e) => e.alive).length;
    const n = clamp(count, 0, room);
    for (let i = 0; i < n; i += 1) {
      const s = i % 2 ? 2.1 : -2.1;
      const cop = spawnOfficer(car.x + Math.cos(car.heading) * s, car.z - Math.sin(car.heading) * s, car.heading,
        { weapon: wanted >= 4 && i === 0 ? 'smg' : 'pistol' });
      cop.unit = car;
    }
    if (n > 0) bus.onOfficers?.(car);
  }

  // ------------------------------------------------------------------ roadblocks
  /**
   * A barricade at (x, z) facing `heading` (towards the oncoming suspect), `half` m either
   * side of centre: two cruisers nose-in in a V (`side` mirrors it), sawhorses in the gaps,
   * an arc of flares ahead and officers kneeling behind the cars.
   */
  function makeRoadblock(x, z, heading, side, half, street, staged) {
    const at = (u, f) => [x + Math.cos(heading) * u + Math.sin(heading) * f, z - Math.sin(heading) * u + Math.cos(heading) * f];
    const block = { x, z, heading, street, side, half, barriers: [], flares: [], cars: [], officers: [], age: 0, staged,
      callsign: TAC_CALLSIGNS[tacCount++ % TAC_CALLSIGNS.length] };
    for (const s of [-1, 1]) {
      const [cx, cz] = at(s * half * 0.5, 0);
      const car = makeCruiser(cx, cz, heading - s * side * 0.62, { sirenOn: true, roadblock: true, parked: true, staged });
      car.sirenPhase = s > 0 ? 0.5 : 0;
      block.cars.push(car);
      roadblockCars.push(car);
    }
    for (const [u, f] of [[0, 1.2], [-(half - 0.4), 0.9], [half - 0.4, 0.9]]) {
      const [bx, bz] = at(u, f);
      block.barriers.push({ x: bx, z: bz, rot: heading, knocked: false, tilt: 0, spin: 0 });
    }
    const count = Math.max(7, Math.round(half * 1.05));
    for (let i = 0; i < count; i += 1) {
      const t = (i / (count - 1)) * 2 - 1;
      const [px, pz] = at(t * half * 0.95, 4 + (1 - t * t) * 4.5 + (random() - 0.5) * 0.8);
      block.flares.push({ x: px, z: pz, phase: random() * Math.PI * 2, life: 1 });
    }
    if (!staged) {
      for (const s of [-1, 1]) {
        const [ox, oz] = at(s * (half * 0.5 + 0.6), -3);
        const cop = spawnOfficer(ox, oz, heading, { stationary: true, health: 80, range: 44, weapon: wanted >= 5 ? 'smg' : 'pistol' });
        cop.barricade = true;
        block.officers.push(cop);
      }
    }
    roadblocks.push(block);
    return block;
  }

  const stageRoadblock = (x, z, heading, side = 1, half = 8.6, street = 'Ocean Boulevard') => makeRoadblock(x, z, heading, side, half, street, true);

  /** Throw a barricade across the suspect's road 95-140 m ahead, clear of junctions. */
  function spawnRoadblock(car = combat.player.inVehicle) {
    const road = car && world.nearestRoad(car.x, car.z);
    if (!road || road.distance > road.w / 2) return null;
    const alongX = road.axis === 'x';
    const dir = Math.sign((alongX ? car.velocityX : car.velocityZ) || (alongX ? Math.sin(car.heading) : Math.cos(car.heading)));
    const [lo, hi] = alongX ? [Math.min(road.x1, road.x2), Math.max(road.x1, road.x2)] : [Math.min(road.z1, road.z2), Math.max(road.z1, road.z2)];
    let s = clamp((alongX ? car.x : car.z) + dir * (95 + Math.min(45, Math.abs(car.speed) * 1.1)), lo + 20, hi - 20);
    // A boulevard is closed one carriageway at a time: the half the suspect is driving on.
    const wide = road.w > 26;
    const lane = wide ? Math.sign(alongX ? car.z - road.z1 : car.x - road.x1) * road.w / 4 : 0;
    const pos = () => (alongX ? [s, road.z1 + lane] : [road.x1 + lane, s]);
    if (junctions.some(([jx, jz]) => Math.hypot(jx - pos()[0], jz - pos()[1]) < 18)) s += dir * 22;
    const [x, z] = pos();
    if (Math.hypot(x - car.x, z - car.z) < 60 || world.isWater(x, z) || roadblocks.some((b) => Math.hypot(b.x - x, b.z - z) < 60)) return null;
    const facing = alongX ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? Math.PI : 0);
    const block = makeRoadblock(x, z, facing, 1, wide ? road.w / 4 - 0.5 : road.w / 2 - 0.8, streetAt(x, z), false);
    bus.onRoadblock?.(block);
    return block;
  }

  function removeRoadblock(block) {
    roadblocks.splice(roadblocks.indexOf(block), 1);
    for (const car of block.cars) roadblockCars.splice(roadblockCars.indexOf(car), 1);
    dropOfficers((e) => block.officers.includes(e));
  }

  function updateRoadblocks(dt, pv, tx, tz) {
    for (const block of roadblocks.slice()) {
      block.age += dt;
      for (const bar of block.barriers) {
        if (bar.knocked) {
          bar.spin += dt * 9;
          bar.tilt = Math.min(1.5, bar.tilt + bar.spin * dt);
        } else if (pv && Math.abs(pv.speed) > 5 && Math.hypot(pv.x - bar.x, pv.z - bar.z) < 2.6) {
          bar.knocked = true;
          pv.speed *= 0.82; pv.velocityX *= 0.82; pv.velocityZ *= 0.82;
          pv.health = Math.max(0, pv.health - 3 * (pv.damageScale ?? 1));
          bus.onBarrierHit?.(bar, block);
        }
      }
      if (!block.staged) for (const f of block.flares) f.life = Math.max(0.35, 1 - block.age / 240);
      // Officers duck behind the cars and rise to fire.
      for (const cop of block.officers) if (cop.alive) cop.kneel = cop.fireTimer > 0.45;
      if (pv) for (const car of block.cars) contact(car, pv);
      const d = Math.hypot(block.x - tx, block.z - tz);
      if (!block.staged && (d > 240 || (wanted < ROADBLOCK_STARS && d > 110) || block.age > 150)) removeRoadblock(block);
    }
  }

  // ------------------------------------------------------------------ Air One
  function stageHelicopter(spec) {
    helicopter = { y: 18, heading: 0, spotX: spec.x, spotZ: spec.z, orbit: 0, staged: true, ...spec };
    return helicopter;
  }

  function updateHelicopter(dt, tx, tz) {
    if (!helicopter && wanted >= 4) {
      const a = random() * Math.PI * 2;
      helicopter = { x: tx + Math.cos(a) * 170, z: tz + Math.sin(a) * 170, y: 46, heading: a + Math.PI, spotX: tx, spotZ: tz, orbit: a, leaving: false };
      if (!heliCalled) { heliCalled = true; bus.onHelicopter?.(helicopter); }
    }
    const h = helicopter;
    if (!h || h.staged) return;
    if (wanted < 4) h.leaving = true;
    if (h.leaving) {
      // Peel away climbing, light off; gone past 320 m.
      h.y += dt * 4;
      h.x += Math.sin(h.heading) * 32 * dt;
      h.z += Math.cos(h.heading) * 32 * dt;
      h.spotX = h.x; h.spotZ = h.z;
      if (Math.hypot(h.x - tx, h.z - tz) > 320) helicopter = null;
      return;
    }
    // Orbit 34 m out round the suspect (or the last sighting), nose towards the centre.
    h.orbit += dt * 0.32;
    const cx = seen ? tx : lastSeen.x, cz = seen ? tz : lastSeen.z;
    const dx = cx + Math.cos(h.orbit) * 34 - h.x, dz = cz + Math.sin(h.orbit) * 34 - h.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, (d > 60 ? 48 : 22) * dt);
    h.x += (dx / d) * step;
    h.z += (dz / d) * step;
    h.y = lerp(h.y, 27 + Math.sin(time * 0.6) * 1.5, clamp(dt * 0.8, 0, 1));
    h.heading += wrap(Math.atan2(cx - h.x, cz - h.z) - h.heading) * clamp(dt * 1.6, 0, 1);
    // The searchlight leads the target while it has it, and sweeps a figure-of-eight round
    // the last sighting while it hunts.
    const sweep = seen ? 2.2 : 18;
    const k = clamp(dt * (seen ? 3.5 : 1.2), 0, 1);
    h.spotX = lerp(h.spotX, cx + Math.sin(time * 0.9) * sweep, k);
    h.spotZ = lerp(h.spotZ, cz + Math.sin(time * 1.8) * sweep * 0.5, k);
  }

  // ------------------------------------------------------------------ wanted level
  /** A crime: jump to `n` stars, or one more than now (one such bump per 7 s). */
  function raise(n = 1, reason = '') {
    if (n <= 0) return;
    const pos = bus.playerPosition?.() ?? combat.player;
    lastSeen = { x: pos.x, z: pos.z };
    seen = true;
    evadeT = 0;
    let next = wanted;
    if (n > wanted) next = n;
    else if (bumpT <= 0 && wanted < 5) { next = wanted + 1; bumpT = 7; }
    if (next === wanted) return;
    const prev = wanted;
    setWanted(next);
    bus.onWanted?.(wanted, reason);
    if (CALLOUTS[wanted]) bus.dispatch?.(...CALLOUTS[wanted], 5200);
    spawnT = Math.min(spawnT, 0.6);
    if (wanted >= ROADBLOCK_STARS && prev < ROADBLOCK_STARS) blockT = 3;
  }

  function setWanted(n) {
    wanted = clamp(n, 0, 5);
    peak = Math.max(peak, wanted);
    chasePeak = Math.max(chasePeak, wanted);
    evadeT = 0;
  }

  function clear() {
    cruisers.length = 0;
    roadblockCars.length = 0;
    roadblocks.length = 0;
    dropOfficers(() => true);
    helicopter = null;
    wanted = 0; chasePeak = 0; evadeT = 0;
    seen = false; heliCalled = false; jamT = 0;
    unitCount = 0; tacCount = 0;
    nearestSiren = Infinity;
    bus.onSirenLevel?.(Infinity);
  }

  /** Does any unit see (tx, tz)? Cones and sight lines for cars and officers, the light for Air One. */
  function detect(tx, tz) {
    // While Elena jams the band only a unit within earshot still has the suspect.
    const range = jamT > 0 ? HEAR : TIERS[wanted].range;
    const units = [...cruisers.filter((c) => !c.wrecked), ...roadblockCars, ...officers().filter((e) => e.alive)];
    for (const u of units) {
      const dx = tx - u.x, dz = tz - u.z;
      const d = Math.hypot(dx, dz);
      if (d > range || (d > HEAR && Math.abs(wrap(Math.atan2(dx, dz) - u.heading)) > CONE)) continue;
      if (clearLine(u.x, u.z, tx, tz)) return true;
    }
    return jamT <= 0 && airLock(tx, tz);
  }

  /** Air One's light is on the point (and nothing overhead hides it). */
  function airLock(tx, tz) {
    const h = helicopter;
    return !!h && !h.leaving && Math.hypot(h.spotX - tx, h.spotZ - tz) < 11 && !world.insideBuilding(tx, tz);
  }

  /** Elena's JAM DISPATCH: units lose the suspect for `seconds` unless they are close. */
  function jam(seconds = 8) {
    if (wanted === 0) return false;
    jamT = seconds;
    seen = false;
    losT = 0;
    bus.dispatch?.('SBPD DISPATCH · SIGNAL LOST', 'All units, repeat last? Band is full of static. Air One, we have lost your feed.', 4200);
    return true;
  }

  /** What one unit is doing right now, in dispatch words. */
  function roleOf(car, d, t) {
    if (car.wrecked) return 'DISABLED';
    if (car.dismounted) return 'FOOT CHASE';
    if (wanted === 0) return 'RESUMING PATROL';
    if (!seen) return 'SEARCHING';
    if (t.vehicle && d < 8) return 'PIT/RAM';
    if (t.vehicle && (car.role === 1 || car.role === 2) && d < 24) return 'FLANKING';
    if (t.vehicle && car.role === 3 && wanted >= 3 && d > 24) return 'INTERCEPT';
    if (d < 60) return 'CLOSING IN';
    return 'EN ROUTE';
  }

  /**
   * The live SBPD roster for the HUD: Air One, every cruiser, each roadblock (one entry per
   * barricade, its two cars and officers) and officers on foot, nearest first.
   */
  function getDispatchUnits() {
    const p = combat.player;
    const v = p.inVehicle;
    const t = { x: v ? v.x : p.x, z: v ? v.z : p.z, vehicle: v };
    const units = [];
    const dist = (x, z) => Math.round(Math.hypot(x - t.x, z - t.z));
    const h = helicopter;
    if (h) {
      const locked = !h.leaving && seen && airLock(t.x, t.z);
      units.push({ callsign: 'AIR ONE', kind: 'air', role: h.leaving ? 'RETURNING' : locked ? 'SPOTLIGHT' : 'SEARCHING', distMeters: dist(h.x, h.z), active: !h.leaving });
    }
    for (const car of cruisers) {
      const d = dist(car.x, car.z);
      if (d > 320) continue;
      units.push({ callsign: car.callsign ?? 'UNIT', kind: 'car', role: roleOf(car, d, t), distMeters: d, active: !car.wrecked && wanted > 0 });
    }
    for (const block of roadblocks) {
      const d = dist(block.x, block.z);
      if (d > 320) continue;
      units.push({ callsign: block.callsign, kind: 'block', role: 'ROADBLOCK', distMeters: d, active: true, street: block.street });
    }
    for (const cop of officers()) {
      if (cop.barricade || !cop.alive) continue;
      const d = dist(cop.x, cop.z);
      if (d > 160) continue;
      units.push({ callsign: cop.callsign ?? `OFC-${String(30 + (cop.id ?? units.length) % 60).padStart(2, '0')}`, kind: 'foot', role: d < 20 ? 'CLOSING IN' : 'FOOT CHASE', distMeters: d, active: true });
    }
    units.sort((a, b) => a.distMeters - b.distMeters);
    return units;
  }

  // ------------------------------------------------------------------ driving
  /** Straight at the target when the line is open, else via the cheapest open junction. */
  function route(car, tx, tz) {
    if (clearLine(car.x, car.z, tx, tz)) return [tx, tz];
    const options = [];
    for (const j of junctions) {
      const d1 = Math.hypot(j[0] - car.x, j[1] - car.z);
      if (d1 > 8 && d1 < 260) options.push([d1 + Math.hypot(tx - j[0], tz - j[1]) * 1.08, j]);
    }
    options.sort((a, b) => a[0] - b[0]);
    return options.slice(0, 6).find(([, j]) => clearLine(car.x, car.z, j[0], j[1]))?.[1] ?? [tx, tz];
  }

  function drive(car, tx, tz, dt, speed = 60, boost = false) {
    car.repath -= dt;
    if (car.repath <= 0 || !car.waypoint || Math.hypot(car.waypoint[0] - car.x, car.waypoint[1] - car.z) < 9) {
      car.repath = 0.5 + random() * 0.3;
      car.waypoint = route(car, tx, tz);
    }
    const diff = wrap(Math.atan2(car.waypoint[0] - car.x, car.waypoint[1] - car.z) - car.heading);
    let steer = clamp(diff * 2.4, -1, 1);
    let throttle = car.speed > speed ? (speed < 1 ? -1 : -0.3) : (speed < 1 ? 0 : 1);
    let handbrake = false;
    // Brake-slide into tight turns.
    if (Math.abs(diff) > 1.3 && car.speed > 15) { throttle = -0.6; handbrake = Math.abs(diff) > 1.7; }
    // Nosed into a wall: back out with the wheel the other way.
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      throttle = -1;
      steer = -Math.sign(diff || 1);
    } else if (throttle > 0 && Math.abs(car.speed) < 1.5) {
      car.stuckT += dt;
      if (car.stuckT > 1.1) { car.stuckT = 0; car.reverseT = 1.2; }
    } else car.stuckT = 0;
    const quiet = Math.hypot(car.x - combat.player.x, car.z - combat.player.z) > 140;
    const events = bus.driveCar(car, { throttle, steer, handbrake, boost: boost && Math.abs(diff) < 0.4 }, dt, quiet);
    if (events.includes('wrecked')) wreck(car);
  }

  function wreck(car) {
    Object.assign(car, { wrecked: true, sirenOn: false, pursuit: false, speed: 0, velocityX: 0, velocityZ: 0 });
    bus.onWreck?.(car);
  }

  /** Where a unit wants to be: on the bumper, on a rear quarter, across the suspect's path. */
  function pursuitTarget(car, t) {
    if (!seen) {
      // Search: each unit quarters its own sector round the last sighting.
      const a = time * 0.25 + car.id * 2.1;
      return [lastSeen.x + Math.cos(a) * 26, lastSeen.z + Math.sin(a) * 26, 24];
    }
    const d = Math.hypot(t.x - car.x, t.z - car.z);
    let lead = clamp(d / 45, 0, 1), ox = 0, oz = 0;
    if (t.vehicle) {
      if ((car.role === 1 || car.role === 2) && d < 70) {
        // Flankers ride the suspect's rear quarter, ready to PIT.
        const s = car.role === 1 ? 2.6 : -2.6;
        lead = 0.35;
        ox = Math.cos(t.heading) * s - Math.sin(t.heading) * 2.2;
        oz = -Math.sin(t.heading) * s - Math.cos(t.heading) * 2.2;
      } else if (car.role === 3 && wanted >= 3) lead = 2.8; // the intercept car cuts ahead
      else if (car.role === 4 && wanted >= 5) lead = 0.3; // the rammer goes for the doors
    }
    return [t.x + t.vx * lead + ox, t.z + t.vz * lead + oz, t.vehicle ? 62 : 26];
  }

  /** Police car `car` against the suspect's car `pv`: push apart, then a PIT or a ram. */
  function contact(car, pv) {
    const dx = car.x - pv.x, dz = car.z - pv.z;
    const d = Math.hypot(dx, dz);
    if (d >= CONTACT || d < 0.01) return;
    const nx = dx / d, nz = dz / d, push = CONTACT - d;
    const fixed = car.roadblock;
    const share = fixed ? 1 : 0.42;
    pv.x -= nx * push * share;
    pv.z -= nz * push * share;
    if (!fixed) { car.x += nx * push * (1 - share); car.z += nz * push * (1 - share); }
    const rel = (pv.velocityX - car.velocityX) * nx + (pv.velocityZ - car.velocityZ) * nz;
    if (rel <= 0.5) return;
    pv.velocityX -= nx * rel * 0.8;
    pv.velocityZ -= nz * rel * 0.8;
    if (!fixed) { car.velocityX += nx * rel * 0.5; car.velocityZ += nz * rel * 0.5; }
    // PIT: the cruiser's nose on the suspect's rear quarter, both heading the same way,
    // swings the tail out and the nose towards the cruiser's side.
    const fx = Math.sin(pv.heading), fz = Math.cos(pv.heading);
    const along = dx * fx + dz * fz, side = Math.sign(dx * fz - dz * fx);
    if (!fixed && wanted >= 2 && car.pitCd <= 0 && Math.cos(car.heading - pv.heading) > 0.7 && along < -0.4 && along > -4.6 && Math.abs(dx * fz - dz * fx) > 0.7) {
      car.pitCd = 4;
      pv.heading += side * (0.5 + random() * 0.25);
      pv.velocityX -= fz * side * 5;
      pv.velocityZ += fx * side * 5;
      pv.speed *= 0.8;
      pv.drift = 6;
      pv.health = Math.max(0, pv.health - 5 * (pv.damageScale ?? 1));
      bus.notifyOnce?.('SBPD PIT MANEUVER', 'wanted', 4);
      bus.onCrash?.(car, 'ram');
      bus.onCarHurt?.(5);
    } else if (rel > 4) {
      pv.health = Math.max(0, pv.health - Math.min(18, rel * 0.55) * (pv.damageScale ?? 1));
      car.health = Math.max(0, car.health - rel * 0.8);
      if (car.health <= 0 && !car.wrecked) wreck(car);
      bus.onCrash?.(car, 'ram');
      if (rel > 9) bus.onCarHurt?.(rel);
    }
  }

  // ------------------------------------------------------------------ the tick
  function update(dt, player, vehicle) {
    time += dt;
    bumpT -= dt;
    jamT = Math.max(0, jamT - dt);
    const src = vehicle ?? player;
    const t = { x: src.x, z: src.z, vx: src.velocityX ?? 0, vz: src.velocityZ ?? 0, heading: src.heading ?? 0, vehicle };

    // Line of sight six times a second; out of sight, the evasion timer runs.
    losT -= dt;
    if (wanted > 0 && losT <= 0) {
      losT = 1 / 6;
      seen = detect(t.x, t.z);
      if (seen) { lastSeen = { x: t.x, z: t.z }; evadeT = 0; }
    }
    if (wanted > 0 && !seen && (evadeT += dt * (bus.heatCoolRate?.() ?? 1)) >= TIERS[wanted].evade) {
      wanted -= 1;
      if (wanted > 0) {
        evadeT = TIERS[wanted].evade - 4.5; // the next star falls faster: the search is thinning
        bus.onWantedCool?.(wanted);
      } else {
        const shaken = chasePeak;
        chasePeak = 0; evadeT = 0; heliCalled = false;
        bus.dispatch?.('SBPD DISPATCH · CODE 4', 'Suspect lost. All units resume patrol.', 4200);
        bus.onEvaded?.(shaken);
      }
    }

    // Keep the tier's units on the street, and barricades ahead of a fast car.
    spawnT -= dt;
    blockT -= dt;
    const active = cruisers.filter((c) => !c.wrecked && !c.staged && !c.offDuty).length;
    if (wanted > 0 && active < TIERS[wanted].cars && spawnT <= 0) {
      spawnT = Math.max(1.2, 4 - wanted * 0.6);
      spawnCruiser(null, seen ? 110 : 150);
    }
    if (wanted >= ROADBLOCK_STARS && vehicle && seen && blockT <= 0 && Math.abs(vehicle.speed) > 12
      && roadblocks.filter((b) => !b.staged).length < TIERS[wanted].blocks) blockT = spawnRoadblock(vehicle) ? 20 : 2;

    let boxed = 0;
    nearestSiren = Infinity;
    for (const car of cruisers.slice()) {
      if (car.staged || car.remote) continue;
      car.pitCd -= dt;
      const d = Math.hypot(car.x - t.x, car.z - t.z);
      if (car.wrecked) {
        if ((car.offDuty += dt) > 25 && d > 80) forget(car);
        continue;
      }
      if (wanted === 0) {
        // Stand down: sirens off, cruise on down the road, gone once out of sight.
        car.pursuit = false;
        if ((car.offDuty += dt) > 2) car.sirenOn = false;
        drive(car, car.x + Math.sin(car.heading) * 40, car.z + Math.cos(car.heading) * 40, dt, 14);
        if (d > 75 || car.offDuty > 40) forget(car);
        continue;
      }
      Object.assign(car, { offDuty: 0, pursuit: true, sirenOn: true });
      nearestSiren = Math.min(nearestSiren, d);
      // Lost far behind (or circling a block): re-dispatched closer rather than crawling across town.
      car.staleT = d > 110 ? (car.staleT ?? 0) + dt : 0;
      if (d > 300 || car.staleT > 15) { forget(car); continue; }
      if (car.dismounted) {
        car.speed *= 0.9;
        // Back in the car once the suspect is long gone; anyone left on foot is recalled.
        if (d > 90) { car.dismounted = false; dropOfficers((e) => e.unit === car); }
        continue;
      }
      if (!vehicle && d < 30) {
        // On foot: pull up short and send the officers out.
        drive(car, t.x, t.z, dt, d < 18 ? 0 : 8);
        if (Math.abs(car.speed) < 2.5 || d < 12) dismount(car, wanted >= 3 ? 2 : 1 + (car.id % 2));
        continue;
      }
      let [gx, gz, cap] = pursuitTarget(car, t);
      const rammer = car.role === 4 && wanted >= 5;
      // Close in, match speed: only the rammer (and a flanker lining up a PIT) pushes harder.
      if (vehicle && d < 14) cap = Math.abs(vehicle.speed) < 4 ? 3 : Math.abs(vehicle.speed) + (rammer ? 8 : car.role === 1 || car.role === 2 ? 3 : 0.5);
      drive(car, gx, gz, dt, cap, (wanted >= 3 && d > 45) || rammer);
      if (vehicle) {
        contact(car, vehicle);
        if (d < 9) boxed += 1;
      }
    }
    for (const car of roadblockCars) nearestSiren = Math.min(nearestSiren, Math.hypot(car.x - t.x, car.z - t.z));
    // Cruisers shoulder each other apart rather than stacking.
    for (let i = 0; i < cruisers.length; i += 1) {
      for (let j = i + 1; j < cruisers.length; j += 1) {
        const a = cruisers[i], b = cruisers[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 0.01 || d >= CONTACT) continue;
        const k = (CONTACT - d) / 2 / d;
        a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k;
      }
    }

    // Boxed in: two units hard against a stopped car, and the officers get out.
    boxedT = vehicle && boxed >= 2 && Math.abs(vehicle.speed) < 2 ? boxedT + dt : 0;
    if (boxedT > 1.4) {
      boxedT = 0;
      for (const car of cruisers) if (!car.wrecked && Math.hypot(car.x - t.x, car.z - t.z) < 10) dismount(car, 2);
      bus.notifyOnce?.('BOXED IN · OFFICERS OUT', 'wanted', 6);
    }

    updateRoadblocks(dt, vehicle, t.x, t.z);
    updateHelicopter(dt, t.x, t.z);
    // The fallen are cleared after a while; officers far behind go back to the station.
    dropOfficers((e) => {
      if (e.barricade) return false;
      const far = Math.hypot(e.x - t.x, e.z - t.z) > 140;
      return (!e.alive && e.deathTimer > 8) || (far && (wanted === 0 || !cruisers.includes(e.unit)));
    });
    bus.onSirenLevel?.(wanted > 0 ? nearestSiren : Infinity);
  }

  return {
    cruisers, roadblockCars, roadblocks, allCars, update, raise, setWanted, clear,
    setPeak: (n) => { peak = n; },
    spawnCruiser, spawnStagedCruiser, stageHelicopter, stageRoadblock, spawnRoadblock, getDispatchUnits, jam,
    /** Photo mode: whether the units have eyes on the suspect in the staged frame. */
    setSeen: (v) => { seen = !!v; },
    /** A unit has eyes on the suspect this moment. */
    get inSight() { return wanted > 0 && seen; },
    /** Air One's searchlight is on the suspect. */
    get airLocked() {
      const p = combat.player, v = p.inVehicle;
      return wanted > 0 && seen && airLock(v ? v.x : p.x, v ? v.z : p.z);
    },
    get jammed() { return jamT; },
    get chasePeak() { return chasePeak; },
    get helicopter() { return helicopter; },
    get wanted() { return wanted; },
    /** 0 while a unit has eyes on the suspect, else progress through this star's evasion timer. */
    get evasion() { return wanted > 0 && !seen && evadeT > 0.6 ? Math.min(1, evadeT / TIERS[wanted].evade) : 0; },
    get nearestSiren() { return nearestSiren; },
    get label() { return TIERS[wanted].label; },
    get peak() { return peak; },
    get time() { return time; },
  };
}
