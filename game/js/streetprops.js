// streetprops.js — breakable street furniture. A car clipping a hydrant shears it off and
// the stump throws a water column for a while; a car hitting a lamppost at speed knocks it
// over: the pole pivots on its base in the direction of travel, sparks burst where it
// shears, the lamp goes dark and a second shower and a clang follow when the head lands.

export function createStreetProps({ world, combat, progression, bus, sfx }) {
  /** A burst of particles: lamp sparks by default, or a hydrant's water column. */
  function burst(x, y, z, count, { color = null, rise = 4, kick = [2, 5], life = 0.5, size = 0.14, gravity = 14, jitter = 0 } = {}) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2, s = kick[0] + Math.random() * kick[1];
      combat.particles.push({
        x: x + (Math.random() - 0.5) * jitter, y, z: z + (Math.random() - 0.5) * jitter,
        vx: Math.cos(a) * s, vy: rise * (1 + Math.random() * 0.5), vz: Math.sin(a) * s,
        life: life + Math.random() * 0.4, maxLife: life + 0.4, color: color ?? (i % 3 ? [1, 0.82, 0.4] : [1, 1, 0.85]),
        size: size + Math.random() * 0.1, gravity,
      });
    }
  }

  function hydrants(dt, car) {
    for (const h of world.hydrants) {
      if (!h.broken && car && Math.abs(car.speed) > 4) {
        const dx = h.x - car.x, dz = h.z - car.z;
        const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
        if (Math.abs(dx * fx + dz * fz) < car.spec.length / 2 + 0.25 && Math.abs(dx * fz - dz * fx) < car.spec.width / 2 + 0.25) {
          h.broken = true;
          h.spray = 14;
          car.speed *= 0.9;
          sfx('playCrash', 0.35);
          sfx('playSplash');
        }
      }
      if (h.broken && h.spray > 0) {
        h.spray -= dt;
        burst(h.x, world.groundHeight(h.x, h.z) + 0.3, h.z, 2, {
          color: [0.72, 0.88, 1.0], rise: 5 * Math.min(1, h.spray / 3), kick: [0, 1.2], life: 0.8, size: 0.3, gravity: 9.5, jitter: 0.2,
        });
      }
    }
  }

  function lamps(dt, car) {
    for (const lamp of world.lampposts) {
      if (!lamp.knocked) {
        if (!car || Math.abs(car.speed) < 6) continue;
        const dx = lamp.x - car.x, dz = lamp.z - car.z;
        if (dx * dx + dz * dz > 2.1 * 2.1) continue;
        lamp.knocked = true;
        lamp.fallYaw = Math.atan2(car.velocityX, car.velocityZ) + (Math.random() - 0.5) * 0.5;
        lamp.spin = 0.9 + Math.abs(car.speed) * 0.05;
        lamp.glow.alpha = 0;
        car.speed *= 0.86;
        car.velocityX *= 0.86;
        car.velocityZ *= 0.86;
        car.health = Math.max(1, car.health - 4 * (car.damageScale ?? 1));
        burst(lamp.x, 0.6, lamp.z, 18);
        progression.count('lamps');
        sfx('playCrash', 0.7);
        sfx('playClang');
        bus.notifyOnce('LAMPPOST DOWN', 'info', 6);
        continue;
      }
      if (lamp.landed) continue;
      // Topple: the pole accelerates as it leans, like a falling rod.
      lamp.spin += 2.9 * Math.sin(Math.max(0.05, lamp.tilt)) * dt * 1.6;
      lamp.tilt += lamp.spin * dt;
      if (lamp.tilt >= 1.5) {
        lamp.tilt = 1.5;
        lamp.landed = true;
        burst(lamp.x + Math.sin(lamp.fallYaw) * 5.2, 0.3, lamp.z + Math.cos(lamp.fallYaw) * 5.2, 14);
        sfx('playClang', 0.6);
      }
    }
  }

  /** One step with the player's car (or null on foot). */
  return { update(dt, car) { hydrants(dt, car); lamps(dt, car); } };
}
