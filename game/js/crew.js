// crew.js — the player's two crewmates. Elena Vega (wheelwoman and tech) rides on comms:
// while she is deployed, nitro refills faster, SBPD heat cools faster and her grid hacks
// run quicker. Mateo Cruz (enforcer and pointman) is a body in the world: on foot he
// jogs at the player's shoulder, drops to a kneel when hostiles are near, and fires
// covering bursts (real tracers, real damage) at the nearest armed threat; he also draws
// some of their fire. He rides along when the player drives. Recruitment follows the story,
// and each crewmate can be stood down or deployed from the city menu (or `T` for Mateo).
// Three crew abilities sit on Z / X / C, each with a live cooldown the HUD cards show:
// Elena's JAM DISPATCH blinds the SBPD band, Mateo's FIELD PATCH heals the player (and the
// car), and Nico Vega's NITRO SURGE (Elena's brother, the Safehouse mechanic) refills the
// nitro and holds it open for a few seconds behind the wheel.

import { clamp, lerp, rgb } from './config.js';

export const CREW = [
  {
    id: 'elena', name: 'Elena Vega', role: 'Wheelwoman · Tech', initial: 'E', color: '#ff6f91',
    perks: ['Nitro refills 35% faster', 'Heat cools 30% faster', 'Grid hacks 40% faster'],
    joins: 0, joinLine: 'I\'m on your comms from here on. Keep the throttle honest.',
  },
  {
    id: 'mateo', name: 'Mateo Cruz', role: 'Enforcer · Pointman', initial: 'M', color: '#ffc24b',
    perks: ['Fights beside you on foot', 'Covering fire on hostiles', 'Draws enemy fire'],
    joins: 1, joinLine: 'You drive, I shoot. Whistle and I\'m at your shoulder.',
  },
];

/** Mateo's tactical kit: charcoal plate carrier, olive shirt, gold unit stripe. */
const MATEO_COLORS = {
  skin: rgb(0xa8714b), shirt: rgb(0x4d5a3c), pants: rgb(0x26292e), hair: rgb(0x141213),
  accent: rgb(0xffc24b), vest: rgb(0x2b2f36),
};

/** Z / X / C: who calls it, what it does and how long before it is ready again (s). */
export const ABILITIES = [
  { id: 'jam', key: 'Z', name: 'JAM DISPATCH', crew: 'elena', who: 'ELENA VEGA', color: '#ff6f91', cooldown: 40, length: 8, blurb: 'SBPD blind for 8 s' },
  { id: 'patch', key: 'X', name: 'FIELD PATCH', crew: 'mateo', who: 'MATEO CRUZ', color: '#ffc24b', cooldown: 30, length: 0, blurb: '+35 HP · +25 armour' },
  { id: 'nitro', key: 'C', name: 'NITRO SURGE', crew: 'nico', who: 'NICO VEGA', color: '#55ebff', cooldown: 25, length: 4, blurb: 'Full nitro · 4 s surge' },
];

const BURST = 3;
const ENGAGE_RANGE = 34;

export function createCrew({ world, combat, police, bus }) {
  const state = {
    recruited: { elena: false, mateo: false },
    deployed: { elena: true, mateo: true },
    shots: 0,
    hits: 0,
    cooldown: { jam: 0, patch: 0, nitro: 0 },
    effect: { jam: 0, patch: 0, nitro: 0 },
    used: 0,
  };
  const mateo = {
    x: 0, z: 0, y: 0, heading: 0, aimYaw: 0, phase: 0, speed: 0, crouch: 0,
    fireTimer: 1, burstLeft: 0, burstGap: 0, target: null, visible: false, status: 'STANDBY', staged: false,
  };

  const active = (id) => state.recruited[id] && state.deployed[id];

  function reset() {
    state.recruited = { elena: false, mateo: false };
    state.deployed = { elena: true, mateo: true };
    state.shots = 0;
    state.hits = 0;
    state.cooldown = { jam: 0, patch: 0, nitro: 0 };
    state.effect = { jam: 0, patch: 0, nitro: 0 };
    state.used = 0;
    mateo.visible = false;
    mateo.staged = false;
    mateo.target = null;
  }

  /** Recruit whoever the finished story jobs unlock; announces newcomers. */
  function syncStory(done, announce = true) {
    for (const def of CREW) {
      if (!state.recruited[def.id] && done[def.joins]) {
        state.recruited[def.id] = true;
        if (announce) {
          bus.notify?.(`CREW · ${def.name.toUpperCase()} JOINED · ${def.role.toUpperCase()}`, 'mission', 4200);
          bus.dialogue?.(def.id.toUpperCase(), def.joinLine);
        }
      }
    }
  }

  function toggle(id) {
    if (!state.recruited[id]) {
      bus.notify?.(`${CREW.find((c) => c.id === id)?.name ?? 'Crewmate'} has not joined yet`, 'warn', 2200);
      return false;
    }
    state.deployed[id] = !state.deployed[id];
    const def = CREW.find((c) => c.id === id);
    bus.notify?.(`${def.name.toUpperCase()} · ${state.deployed[id] ? 'DEPLOYED' : 'STOOD DOWN'}`, 'mission', 2200);
    if (id === 'mateo' && state.deployed.mateo) placeBesidePlayer();
    return true;
  }

  function placeBesidePlayer() {
    const p = combat.player;
    const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    mateo.x = p.x + rx * 1.8 - Math.sin(p.heading) * 1.2;
    mateo.z = p.z + rz * 1.8 - Math.cos(p.heading) * 1.2;
    mateo.y = world.groundHeight(mateo.x, mateo.z);
    mateo.heading = p.heading;
    mateo.aimYaw = p.heading;
  }

  function nearestThreat() {
    let best = null, bestD = ENGAGE_RANGE;
    for (const e of combat.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - mateo.x, e.z - mateo.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** One covering round: a tracer from Mateo's muzzle; a hit hurts the target for real. */
  function fireRound(target) {
    const yaw = Math.atan2(target.x - mateo.x, target.z - mateo.z);
    const muzzleY = mateo.y + (mateo.crouch > 0.2 ? 1.0 : 1.42);
    const sx = mateo.x + Math.sin(yaw) * 0.78, sz = mateo.z + Math.cos(yaw) * 0.78;
    const dist = Math.hypot(target.x - mateo.x, target.z - mateo.z);
    const hit = Math.random() < clamp(0.72 - dist / 70, 0.3, 0.68);
    const spread = hit ? 0.25 : 1.6;
    const ex = target.x + (Math.random() - 0.5) * spread, ez = target.z + (Math.random() - 0.5) * spread;
    combat.spawnTracer(sx, muzzleY, sz, ex, target.y + 1.15, ez, rgb(0x9ff3ff), 0.08);
    state.shots += 1;
    if (hit) {
      state.hits += 1;
      combat.damageEnemy(target, 14, [ex, target.y + 1.15, ez]);
    }
    bus.onCrewShot?.(mateo);
  }

  /**
   * Fire a crew ability. Returns true when it went off (and its cooldown started); false with
   * a toast saying why when it is cooling down or has nothing to act on.
   */
  function useAbility(id) {
    const def = ABILITIES.find((a) => a.id === id);
    if (!def) return false;
    if ((id === 'jam' || id === 'patch') && !state.recruited[def.crew]) {
      bus.notify?.(`${def.who} has not joined the crew yet`, 'warn', 1800);
      return false;
    }
    const p = combat.player;
    if (state.cooldown[id] > 0) {
      bus.notify?.(`${def.name} · READY IN ${Math.ceil(state.cooldown[id])}s`, 'warn', 1600);
      return false;
    }
    if (p.dead) return false;
    const car = p.inVehicle;
    if (id === 'jam') {
      if (!police.jam(def.length)) {
        bus.notify?.('JAM DISPATCH · no SBPD units on you', 'warn', 1800);
        return false;
      }
      bus.dialogue?.('ELENA', 'Flooding their band with static. You have eight seconds, break the line.');
    } else if (id === 'patch') {
      if (p.health >= p.maxHealth && p.armor >= p.maxArmor && (!car || car.health >= car.maxHealth)) {
        bus.notify?.('FIELD PATCH · nothing to patch', 'warn', 1600);
        return false;
      }
      p.health = Math.min(p.maxHealth, p.health + 35);
      p.armor = Math.min(p.maxArmor, p.armor + 25);
      if (car) { car.health = Math.min(car.maxHealth, car.health + 30); car.smoke = 0; }
      bus.dialogue?.('MATEO', car ? 'Taped the radiator, strapped your arm. Keep driving.' : 'Hold still. Gauze, plate insert, done.');
    } else if (id === 'nitro') {
      if (!car) {
        bus.notify?.('NITRO SURGE · get behind the wheel first', 'warn', 1800);
        return false;
      }
      car.boost = 1;
      bus.dialogue?.('NICO', 'Bypassed the limiter on that tank. Floor it, it will hold.');
    }
    state.cooldown[id] = def.cooldown;
    state.effect[id] = def.length;
    state.used += 1;
    bus.notify?.(`${def.who} · ${def.name}`, 'mission', 2200);
    bus.onAbility?.(def);
    return true;
  }

  function tickAbilities(dt) {
    for (const def of ABILITIES) {
      state.cooldown[def.id] = Math.max(0, state.cooldown[def.id] - dt);
      state.effect[def.id] = Math.max(0, state.effect[def.id] - dt);
    }
    // The surge keeps the tank brim-full while it lasts; main.js holds the boost open.
    const car = combat.player.inVehicle;
    if (car && state.effect.nitro > 0) car.boost = 1;
  }

  /** The three ability cards: ready, cooling (seconds left and fraction) or running. */
  function abilities() {
    const p = combat.player;
    return ABILITIES.map((def) => {
      const cd = state.cooldown[def.id];
      const running = state.effect[def.id] > 0;
      const locked = (def.id === 'jam' || def.id === 'patch') && !state.recruited[def.crew];
      const needsCar = def.id === 'nitro' && !p.inVehicle;
      const needsHeat = def.id === 'jam' && police.wanted === 0;
      const status = locked ? 'LOCKED' : running ? 'ACTIVE' : cd > 0 ? `${Math.ceil(cd)}s` : needsCar ? 'IN VEHICLE' : needsHeat ? 'NO HEAT' : 'READY';
      return { ...def, cooldownLeft: cd, ratio: cd / def.cooldown, running, effectLeft: state.effect[def.id], ready: !locked && cd <= 0 && !needsCar && !needsHeat, status };
    });
  }

  function update(dt) {
    const p = combat.player;
    tickAbilities(dt);
    if (mateo.staged) return;
    if (!active('mateo') || p.dead) {
      mateo.visible = false;
      mateo.status = state.recruited.mateo ? 'STOOD DOWN' : 'NOT RECRUITED';
      return;
    }
    if (p.inVehicle) {
      mateo.visible = false;
      mateo.status = 'RIDING SHOTGUN';
      return;
    }
    if (!mateo.visible) {
      placeBesidePlayer();
      mateo.visible = true;
    }
    mateo.phase += dt * 7;
    const threat = nearestThreat();
    mateo.target = threat;
    // Formation slot: off the player's right shoulder, a step back; tighter while in cover.
    const tight = p.cover ? 0.65 : 1;
    const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    const tx = p.x + rx * 2.1 * tight - Math.sin(p.heading) * 1.3 * tight;
    const tz = p.z + rz * 2.1 * tight - Math.cos(p.heading) * 1.3 * tight;
    const dx = tx - mateo.x, dz = tz - mateo.z;
    const gap = Math.hypot(dx, dz);
    if (gap > 40) placeBesidePlayer();
    const run = gap > 1.2 ? clamp(gap * 1.6, 0, threat ? 6.5 : 8.6) : 0;
    mateo.speed = lerp(mateo.speed, run, clamp(dt * 6, 0, 1));
    if (gap > 0.05 && mateo.speed > 0.05) {
      mateo.x += (dx / gap) * Math.min(gap, mateo.speed * dt);
      mateo.z += (dz / gap) * Math.min(gap, mateo.speed * dt);
    }
    const hit = world.collideCircle(mateo.x, mateo.z, 0.45);
    if (hit.hit) { mateo.x = hit.x; mateo.z = hit.z; }
    mateo.y = world.groundHeight(mateo.x, mateo.z);
    const kneel = threat && mateo.speed < 1.5 ? 0.62 : 0;
    mateo.crouch = lerp(mateo.crouch, kneel, clamp(dt * 8, 0, 1));
    if (threat) {
      const want = Math.atan2(threat.x - mateo.x, threat.z - mateo.z);
      let diff = want - mateo.aimYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      mateo.aimYaw += diff * clamp(dt * 9, 0, 1);
      mateo.heading = mateo.aimYaw;
      mateo.status = 'COVERING FIRE';
      mateo.fireTimer -= dt;
      if (mateo.burstLeft > 0) {
        mateo.burstGap -= dt;
        if (mateo.burstGap <= 0) {
          mateo.burstGap = 0.11;
          mateo.burstLeft -= 1;
          fireRound(threat);
        }
      } else if (mateo.fireTimer <= 0 && Math.abs(diff) < 0.3) {
        mateo.burstLeft = BURST;
        mateo.burstGap = 0;
        mateo.fireTimer = 1.25 + Math.random() * 0.5;
      }
    } else {
      mateo.burstLeft = 0;
      if (mateo.speed > 0.3) mateo.heading = Math.atan2(dx, dz);
      mateo.aimYaw = mateo.heading;
      mateo.status = gap > 1.2 ? 'ON YOUR SIX' : 'HOLDING';
    }
  }

  /**
   * A hostile picking a target: while Mateo is up and in range, about a third of their shots
   * go his way instead of the player's. Returns his chest point or null.
   */
  function decoyFor(enemy) {
    if (!mateo.visible || !active('mateo')) return null;
    if (Math.hypot(enemy.x - mateo.x, enemy.z - mateo.z) > enemy.range) return null;
    if (Math.random() > 0.34) return null;
    return { x: mateo.x, y: mateo.y + 1.2 - mateo.crouch * 0.4, z: mateo.z };
  }

  function build(b, time) {
    if (!mateo.visible) return;
    combat.buildCharacter(b, {
      x: mateo.x, z: mateo.z, y: mateo.y,
      heading: mateo.heading, aimYaw: mateo.aimYaw, phase: mateo.phase,
      speed: mateo.speed, colors: MATEO_COLORS, style: 'crew',
      weapon: 'smg', aiming: true, duck: mateo.crouch, kneel: mateo.crouch > 0.2,
    }, time);
  }

  function shadow(list) {
    if (mateo.visible) list.push({ x: mateo.x, z: mateo.z, y: mateo.y + 0.03, rx: 0.6, rz: 0.6, alpha: 0.3 });
  }

  /** Freeze Mateo at a pose for photo mode. */
  function stageMateo(pose) {
    Object.assign(mateo, { visible: true, staged: true, speed: 0, phase: 0, ...pose });
    mateo.y = world.groundHeight(mateo.x, mateo.z);
    mateo.status = pose.status ?? 'COVERING FIRE';
  }

  function elenaStatus() {
    if (!state.recruited.elena) return 'NOT RECRUITED';
    if (!state.deployed.elena) return 'STOOD DOWN';
    if (police.wanted > 0) return 'ON THE SBPD BAND';
    return combat.player.inVehicle ? 'ON COMMS · NITRO+' : 'ON COMMS';
  }

  /** The roster for the HUD badge and the city menu. */
  function roster() {
    return CREW.map((def) => ({
      ...def,
      recruited: state.recruited[def.id],
      deployed: state.deployed[def.id],
      active: active(def.id),
      status: def.id === 'mateo' ? mateo.status : elenaStatus(),
    }));
  }

  function snapshot() {
    return { recruited: { ...state.recruited }, deployed: { ...state.deployed } };
  }

  function restore(data) {
    reset();
    if (!data) return;
    for (const def of CREW) {
      state.recruited[def.id] = !!data.recruited?.[def.id];
      state.deployed[def.id] = data.deployed?.[def.id] !== false;
    }
  }

  return {
    CREW, ABILITIES, state, mateo, reset, syncStory, toggle, update, decoyFor, build, shadow, stageMateo, roster,
    snapshot, restore, active, useAbility, abilities,
    /** NITRO SURGE is holding the boost open. */
    get surging() { return state.effect.nitro > 0; },
    /** Elena's multipliers, 1 when she is not on comms. */
    get nitroRecharge() { return active('elena') ? 1.35 : 1; },
    get heatCool() { return active('elena') ? 1.3 : 1; },
    get hackRate() { return active('elena') ? 1.4 : 1; },
  };
}
