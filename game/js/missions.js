// missions.js — the Solaris Bay story: eight connected jobs for Elena Vega and Mateo
// Cruz across all five districts, each with its own waypoints, objective chain, dialogue,
// cash, respect and district-standing reward. Steps are goto, steal, deliver, collect,
// kill, hack (hold a spot while Elena splices a relay) and escape. Missions never teleport
// the player: they spawn goons/crates, raise heat, and tell the HUD what to do.
// Completion unlocks weapons and crew, raises turf standing and feeds the save system.

import { PALETTE, SAFEHOUSE, rgb } from './config.js';

const LOCKUP = [76, 2];

export const MISSIONS = [
  {
    id: 0, code: '01', name: 'Boardwalk Boost', giver: 'ELENA', district: 'palm', turf: 18,
    brief: 'Elena needs a very specific coral coupe moved off the Palm Strip before sunrise.',
    dialogue: 'The coupe is on the boardwalk, keys under the visor. Deliver it to the Midtown lockup and we eat this week.',
    reward: 1400,
    steps: [
      { type: 'goto', pos: [-124, 286], radius: 7, label: 'Get to the marked Marisol Coupe on the Palm Strip boardwalk' },
      { type: 'steal', pos: [-124, 286], radius: 9, carPos: [-124, 286], label: 'Steal the Marisol Coupe  ·  E / F' },
      { type: 'deliver', pos: LOCKUP, radius: 9, label: 'Deliver the coupe to the Neon Midtown lockup' },
    ],
  },
  {
    id: 1, code: '02', name: 'Harbor Contraband', giver: 'ELENA', district: 'harbor', turf: 20,
    brief: 'Three crates came in on the night tide. The dock crew wants them back. They can not have them.',
    dialogue: 'Harbor Docks, container row. Three crates, no names. The dock crew is armed and very territorial.',
    reward: 4200,
    steps: [
      { type: 'goto', pos: [-380, -200], radius: 11, label: 'Meet Elena\'s contact at Harbor Docks' },
      {
        type: 'collect', pos: [-380, -200], radius: 30, crates: [[-380, -232], [-346, -168], [-402, -128]], label: 'Load 3 contraband crates',
        spawn: [[-348, -196], [-394, -170], [-370, -130]], raise: 2,
      },
      { type: 'escape', label: 'Lose the Harbor heat' },
      { type: 'goto', pos: [SAFEHOUSE.x, SAFEHOUSE.z + 16], radius: 11, label: 'Return to the Safehouse garage' },
    ],
  },
  {
    id: 2, code: '03', name: 'Neon Heist Getaway', giver: 'MATEO', district: 'midtown', turf: 22,
    brief: 'The Solaris Vault keeps its ledgers in the lobby tower. Mateo wants a look. The guards disagree.',
    dialogue: 'Vault plaza, after dark. Six guards, maybe more. I brought the SMG; you bring the plan.',
    reward: 9000,
    steps: [
      { type: 'goto', pos: [65, -16], radius: 9, label: 'Case the Solaris Vault plaza in Neon Midtown' },
      {
        type: 'kill', pos: [65, -18], radius: 28, label: 'Take down the vault security', count: 6, guards: true,
        spawn: [[38, -30], [92, -32], [36, -96], [94, -98], [50, -8], [82, -8]], health: 85, raise: 1,
        dialogue: 'Get low behind the car. Q or C. I\'ll lay down cover from the bollards.',
      },
      { type: 'escape', label: 'Lose the police · break their line of sight' },
      { type: 'goto', pos: [642, 196], radius: 13, label: 'Reach the Marina Causeway hideout' },
    ],
  },
  {
    id: 3, code: '04', name: 'Pier Ambush', giver: 'MATEO', district: 'palm', turf: 16,
    brief: 'The Coral Pier gang has been clipping our cargo. Mateo has a short, loud answer.',
    dialogue: 'Coral Pier, under the wheel. Five of them. They took the briefcase with the shipping codes. Bring it back.',
    reward: 7600,
    steps: [
      { type: 'goto', pos: [-166, 348], radius: 11, label: 'Meet Mateo at Coral Pier' },
      {
        type: 'kill', pos: [-166, 380], radius: 40, label: 'Clear the Coral Pier gang', count: 5,
        spawn: [[-172, 350], [-158, 370], [-172, 398], [-157, 405], [-166, 382]], health: 80, raise: 0,
      },
      { type: 'collect', pos: [-166, 420], radius: 26, crates: [[-166, 421]], label: 'Grab the briefcase at the end of the pier' },
    ],
  },
  {
    id: 4, code: '05', name: 'Casa Hills Hush', giver: 'ELENA', district: 'hills', turf: 26,
    brief: 'A councilman in Casa Hills keeps a second ledger in his villa safe. Elena wants it before the vote.',
    dialogue: 'Up the switchback to the pastel villas. His private security is five deep. The ledger is in the garden safe.',
    reward: 12500,
    steps: [
      { type: 'goto', pos: [130, -366], radius: 10, label: 'Drive up the Casa Hills switchback' },
      {
        type: 'kill', pos: [130, -392], radius: 34, label: 'Silence the villa security', count: 5,
        spawn: [[110, -392], [150, -388], [130, -410], [90, -392], [170, -392]], health: 85, raise: 1,
        dialogue: 'They saw you coming. Mateo, cover the gate.',
      },
      { type: 'collect', pos: [130, -430], radius: 22, crates: [[130, -430]], label: 'Crack the garden safe and take the ledger' },
      { type: 'goto', pos: [SAFEHOUSE.x, SAFEHOUSE.z + 16], radius: 11, label: 'Bring the ledger to the Safehouse garage' },
    ],
  },
  {
    id: 5, code: '06', name: 'Starlight Key Run', giver: 'MATEO', district: 'key', turf: 28,
    brief: 'Two cases of uncut stones are coming off a yacht at the Starlight Key slips. Mateo says they are ours now.',
    dialogue: 'Over the causeway to the Key. The yacht crew is armed. Grab both cases and get them to the Midtown lockup in one car.',
    reward: 15000,
    steps: [
      { type: 'goto', pos: [660, 150], radius: 12, label: 'Cross the causeway to Starlight Key' },
      {
        type: 'kill', pos: [655, 180], radius: 40, label: 'Clear the yacht crew off the Key', count: 4,
        spawn: [[690, 130], [640, 230], [620, 160], [650, 185]], health: 80, raise: 0,
      },
      { type: 'collect', pos: [665, 180], radius: 40, crates: [[690, 130], [640, 230]], label: 'Load both stone cases', raise: 3 },
      { type: 'escape', label: 'Shake the SBPD roadblocks off the causeway' },
      { type: 'deliver', pos: LOCKUP, radius: 9, label: 'Deliver the cases to the Neon Midtown lockup' },
    ],
  },
  {
    id: 6, code: '07', name: 'Crane Light Blackout', giver: 'ELENA', district: 'harbor', turf: 24,
    brief: 'The finale needs the harbor dark. Elena can kill the crane lights if someone stands at the relays long enough.',
    dialogue: 'Two relay cabinets in the crane yard. Hold at each one while I splice in. Dock crew will come running.',
    reward: 18000,
    steps: [
      { type: 'goto', pos: [-390, -200], radius: 12, label: 'Reach the Harbor crane yard' },
      { type: 'hack', pos: [-380, -260], radius: 6, duration: 7, label: 'Hold at crane relay A while Elena splices in' },
      {
        type: 'hack', pos: [-320, -260], radius: 6, duration: 7, label: 'Hold at crane relay B while Elena splices in',
        spawnGoons: [[-345, -240], [-300, -240], [-300, -280], [-345, -280]], raise: 2,
        dialogue: 'They\'re onto the splice. Stay on the relay, I\'m nearly through.',
      },
      { type: 'escape', label: 'Lose the dockside heat in the dark' },
    ],
  },
  {
    id: 7, code: '08', name: 'The Solaris Vault Finale', giver: 'ELENA', district: 'midtown', turf: 40,
    brief: 'The real vault is under the tower. Everything Elena has planned ends here — one case, one clean exit.',
    dialogue: 'This is it. The sub-vault under Solaris Vault. Take the case, then get to the marina. Don\'t stop for anything.',
    reward: 60000,
    steps: [
      { type: 'goto', pos: [65, -24], radius: 9, label: 'Breach the Solaris Vault sub-level' },
      {
        type: 'collect', pos: [65, -18], radius: 22, crates: [[65, -14]], label: 'Crack the vault and take the case',
        spawnGoons: [[30, -84], [100, -84], [30, -34], [100, -34]], raise: 4,
      },
      { type: 'escape', label: 'Lose the 4-star response' },
      { type: 'goto', pos: [700, 232], radius: 14, label: 'Deliver the case to the Marina hideout', needClear: true },
    ],
  },
];

export function createMissions({ world, combat, police, bus, turf }) {
  const blank = () => MISSIONS.map(() => false);
  const state = {
    index: 0,
    step: -1,
    active: false,
    done: blank(),
    nextTimer: 0,
    storyComplete: false,
    stepTimer: 0,
    crates: [],
    stepEnemies: [],
    results: [],
    // One medal per finished job (G / S / B), rated on the health and armour left at the finish.
    ratings: MISSIONS.map(() => null),
    startingSoon: false,
    hack: 0,
  };
  let time = 0;
  let bannerTimer = 0;
  let lastPositionKey = '';

  function mission() {
    return MISSIONS[state.index] ?? null;
  }
  function step() {
    const m = mission();
    return m ? m.steps[state.step] ?? null : null;
  }

  function reset() {
    state.index = 0;
    state.step = -1;
    state.active = false;
    state.done = blank();
    state.nextTimer = 0;
    state.storyComplete = false;
    state.crates = [];
    state.stepEnemies = [];
    state.results = [];
    state.ratings = MISSIONS.map(() => null);
    state.startingSoon = false;
    combat.clearEnemies();
  }

  function startMission(index = state.index, announce = true) {
    if (index < 0 || index >= MISSIONS.length) return;
    state.index = index;
    state.step = -1;
    state.active = true;
    state.done[index] = false;
    state.nextTimer = 0;
    state.startingSoon = false;
    state.crates = [];
    state.stepEnemies = [];
    const m = mission();
    if (announce) {
      bus.missionBanner?.(m, 'MISSION START');
      bus.dialogue?.(m.giver, m.dialogue);
      bus.notify?.(`Mission ${m.code}: ${m.name}`, 'mission');
    }
    advance();
  }

  function advance() {
    const m = mission();
    if (!m) return;
    state.step += 1;
    state.stepTimer = 0;
    if (state.step >= m.steps.length) {
      completeMission();
      return;
    }
    const s = step();
    state.crates = [];
    state.hack = 0;
    if (s.type === 'collect' && s.crates) {
      state.crates = s.crates.map(([x, z], i) => ({ x, z, y: 0.4, taken: false, phase: i * 1.3, big: !!s.crates && s.crates.length === 1 && (state.index >= 3) }));
    }
    if (s.type === 'steal') {
      const car = bus.findVehicleNear?.(s.pos[0], s.pos[1], 10);
      if (car) {
        car.mission = true;
        s.car = car;
      }
    }
    if (s.type === 'kill') {
      state.stepEnemies = [];
      const spawns = s.spawn ?? [];
      spawns.forEach(([x, z], i) => {
        const enemy = combat.spawnEnemy(x, z, {
          health: s.health ?? 80,
          style: s.guards ? 'guard' : 'goon',
          weapon: i % 3 === 0 ? 'smg' : 'pistol',
          cash: 55 + i * 15,
          mission: true,
          range: 48,
        });
        state.stepEnemies.push(enemy);
      });
    }
    if (s.spawnGoons) {
      s.spawnGoons.forEach(([x, z], i) => {
        combat.spawnEnemy(x, z, { health: 95, style: 'goon', weapon: i % 2 ? 'smg' : 'shotgun', cash: 120, mission: true, range: 50, damage: 9 });
      });
    }
    if (s.spawn && s.type !== 'kill') {
      s.spawn.forEach(([x, z], i) => {
        combat.spawnEnemy(x, z, { health: 70, style: 'goon', weapon: 'pistol', cash: 40, mission: true, range: 45 });
      });
    }
    if (s.raise) {
      // Heat is raised after the objective starts ticking so the player can react.
      setTimeout(() => police.raise(s.raise, 'Mission attention'), 900);
    }
    if (s.onEnter) s.onEnter();
    bus.objective?.(s.label, m, state.step, m.steps.length);
    bus.notify?.(s.label, 'objective');
    if (s.dialogue) bus.dialogue?.(m.giver, s.dialogue);
  }

  function completeMission() {
    const m = mission();
    if (!m) return;
    state.active = false;
    state.done[state.index] = true;
    state.results.push({ index: state.index, name: m.name, reward: m.reward });
    const p = combat.player;
    p.cash += m.reward;
    p.respect += 160;
    if (turf && m.district) turf.add(m.district, m.turf ?? 15, `JOB ${m.code}`);
    if (state.index === 0) combat.giveWeapon('smg');
    if (state.index === 1) combat.giveWeapon('shotgun');
    if (state.index === 2) combat.giveWeapon('carbine');
    const grade = (p.health + p.armor * 0.5) / p.maxHealth;
    state.ratings[state.index] = grade >= 0.8 ? 'G' : grade >= 0.5 ? 'S' : 'B';
    if (state.index === 3 || state.index === 5) {
      p.health = Math.min(p.maxHealth, p.health + 40);
    }
    // The finale flags itself before the bus fires, so the HUD can raise the story screen.
    const finale = state.index === MISSIONS.length - 1;
    if (finale) state.storyComplete = true;
    bus.missionComplete?.(m, m.reward);
    bus.notify?.(`Mission complete · $${m.reward.toLocaleString('en-US')}`, 'cash');
    bus.dialogue?.(m.giver, missionCompleteLine(state.index));
    if (finale) {
      state.nextTimer = 0;
      state.startingSoon = false;
      bus.storyComplete?.();
    } else {
      state.nextTimer = 9;
      state.startingSoon = true;
    }
    state.crates = [];
    for (const enemy of state.stepEnemies) {
      if (enemy.alive) enemy.alive = false;
    }
  }

  function missionCompleteLine(index) {
    return [
      'Coupe delivered. Clean. The Reef SMG is in the lockup — you earned it. I\'m on your comms from now on.',
      'Crates are ours and the docks are quiet. Shotgun\'s under the counter. Mateo wants to meet you.',
      'Ledgers are ours. Marina\'s waiting. Nice shooting from cover.',
      'Pier is clear and the briefcase is back. The wheel looks better without them.',
      'The councilman\'s ledger. Half of Casa Hills just became very polite to us.',
      'Two cases, one car, zero scratches. The Key knows our names now.',
      'Crane lights are dead. The harbor goes dark on my word. Next stop, the vault.',
      'That\'s everything. The marina hideout is open, the city is yours. Take a breath, partner.',
    ][index] ?? 'Nice work.';
  }

  function abandon() {
    state.active = false;
    state.step = -1;
    state.crates = [];
    combat.clearEnemies();
  }

  function update(dt) {
    time += dt;
    if (!state.active) {
      if (state.startingSoon && state.nextTimer > 0) {
        state.nextTimer -= dt;
        if (state.nextTimer <= 0) {
          state.startingSoon = false;
          startMission(state.index + 1, true);
        }
      }
      return;
    }
    const m = mission();
    const s = step();
    if (!m || !s) return;
    state.stepTimer += dt;
    const p = combat.player;
    const playerPos = p.inVehicle ? [p.inVehicle.x, p.inVehicle.z] : [p.x, p.z];
    // 'escape' steps have no marker of their own: the waypoint points at the safehouse.
    const hasTarget = Array.isArray(s.pos);
    const dx = hasTarget ? playerPos[0] - s.pos[0] : 0;
    const dz = hasTarget ? playerPos[1] - s.pos[1] : 0;
    const dist = hasTarget ? Math.hypot(dx, dz) : Infinity;

    const key = `${state.index}:${state.step}:${state.crates.map((c) => (c.taken ? 1 : 0)).join('')}`;
    if (key !== lastPositionKey) lastPositionKey = key;

    if (s.type === 'goto' || s.type === 'deliver') {
      const clearOk = !s.needClear || police.wanted === 0;
      const vehicleOk = s.type !== 'deliver' || !!p.inVehicle;
      if (dist < s.radius && clearOk && vehicleOk) {
        if (s.type === 'deliver') bus.notify?.('Delivery secured', 'cash');
        advance();
      } else if (s.type === 'deliver' && dist < s.radius && !p.inVehicle) {
        bus.notifyOnce?.('You need a car to make this delivery', 'warn', 4);
      }
    } else if (s.type === 'steal') {
      const car = s.car ?? bus.findVehicleNear?.(s.pos[0], s.pos[1], 12);
      if (car && p.inVehicle === car) {
        police.raise(2, 'Car theft');
        bus.notify?.('Car theft · 2 stars', 'wanted');
        bus.dialogue?.('ELENA', 'That\'s the one. Now move before the Strip wakes up.');
        car.mission = true;
        advance();
      } else if (car && !car.mission) {
        car.mission = true;
        s.car = car;
      }
    } else if (s.type === 'kill') {
      const alive = state.stepEnemies.filter((e) => e.alive).length;
      if (alive === 0 && state.stepEnemies.length > 0) {
        if (s.raise === 0) bus.notify?.(state.index === 3 ? 'Pier secured' : 'Area secured', 'objective');
        advance();
      }
    } else if (s.type === 'collect') {
      let taken = 0;
      for (const crate of state.crates) {
        if (crate.taken) { taken += 1; continue; }
        if (Math.hypot(playerPos[0] - crate.x, playerPos[1] - crate.z) < 3.2) {
          crate.taken = true;
          taken += 1;
          p.cash += 180;
          bus.notify?.('+$180  ·  cargo secured', 'cash');
          bus.pickup?.(crate.x, crate.z + 0.4, crate.y ?? 0.4, PALETTE.gold);
          bus.onCrate?.();
        }
      }
      if (taken >= state.crates.length && state.crates.length > 0) {
        if (s.type === 'collect' && !s.raise && m.steps[state.step + 1]?.type === 'goto' && m.steps[state.step + 1].needClear) {
          // no special case needed; escape stays honest
        }
        advance();
      }
    } else if (s.type === 'escape') {
      if (police.wanted === 0) {
        bus.notify?.('Heat lost', 'objective');
        advance();
      }
    } else if (s.type === 'hack') {
      // Hold the spot (on foot or in a car) while Elena splices the relay; leaving pauses it.
      if (dist < s.radius) {
        const rate = bus.hackRate?.() ?? 1;
        state.hack = Math.min(1, state.hack + (dt * rate) / s.duration);
        if (state.hack >= 1) {
          bus.notify?.('Relay spliced', 'objective');
          bus.onHacked?.(s);
          advance();
        }
      }
    }
  }

  /** The live objective line: hack steps carry their splice percentage. */
  function stepLabel(s) {
    if (s.type === 'hack') return `${s.label} · ${Math.round(state.hack * 100)}%`;
    return s.label;
  }

  function waypoint() {
    if (!state.active) return null;
    const s = step();
    if (!s) return null;
    if (s.type === 'escape') {
      return { x: SAFEHOUSE.x, z: SAFEHOUSE.z, label: s.label, escape: true };
    }
    return { x: s.pos[0], z: s.pos[1], label: s.label, escape: false };
  }

  function objectiveText() {
    if (!state.active) {
      if (state.storyComplete) return 'SOLARIS BAY COMPLETE — free roam the city';
      return state.done.some(Boolean) ? 'Free roam — return to the city' : 'Follow the gold marker';
    }
    const s = step();
    return s ? stepLabel(s) : '';
  }

  function stage(index, stepIndex, options = {}) {
    state.index = index;
    state.step = stepIndex;
    state.active = true;
    state.storyComplete = false;
    state.startingSoon = false;
    state.nextTimer = 0;
    state.crates = [];
    state.stepEnemies = [];
    state.hack = options.hack ?? 0;
    if (options.done) {
      for (let i = 0; i < options.done; i += 1) state.done[i] = true;
    }
    const m = mission();
    if (!m) return;
    const s = m.steps[stepIndex];
    if (!s) return;
    if (s.type === 'collect' && s.crates) {
      state.crates = s.crates.map(([x, z], i) => ({ x, z, y: 0.4, taken: false, phase: i * 1.3 }));
    }
    bus.objective?.(s.label, m, stepIndex, m.steps.length);
    bus.missionBanner?.(m, options.banner ?? 'ACTIVE MISSION');
  }

  function stageCrate(x, z) {
    state.crates.push({ x, z, y: 0.4, taken: false, phase: 0.5 });
  }

  return {
    MISSIONS,
    state,
    reset,
    startMission,
    update,
    abandon,
    waypoint,
    objectiveText,
    stage,
    stageCrate,
    get mission() { return mission(); },
    get progress() { return state.done.filter(Boolean).length; },
    get active() { return state.active; },
    get index() { return state.index; },
    get stepIndex() { return state.step; },
    get crates() { return state.crates; },
    get stepEnemies() { return state.stepEnemies; },
    /** The live hack step ({x, z, radius, progress}) for the in-world relay ring, or null. */
    get hackSpot() {
      const s = state.active ? step() : null;
      return s && s.type === 'hack' ? { x: s.pos[0], z: s.pos[1], radius: s.radius, progress: state.hack } : null;
    },
    get bannerTimer() { return bannerTimer; },
    time: () => time,
  };
}
