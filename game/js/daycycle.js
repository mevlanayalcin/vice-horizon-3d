// Solaris Bay v10 module: daycycle (golden-hour & neon-night lighting).
// daycycle.js — Solaris Bay's clock. Blends the sky presets in config.js into one
// lighting environment for any hour (dawn, high sun, golden hour, sunset, neon night),
// and names the hour for the HUD clock chip. Pure functions: no state, no DOM.

import { SKY_PRESETS, lerp, mix3, rgb } from './config.js';
import { normalize3 } from './renderer3d.js';

const STOPS = [
  { h: 0, p: 'night' }, { h: 4.7, p: 'night' }, { h: 6.2, p: 'dawn' },
  { h: 9.2, p: 'day' }, { h: 17.2, p: 'day' }, { h: 18.85, p: 'golden' },
  { h: 19.65, p: 'sunset' }, { h: 20.7, p: 'night' }, { h: 24, p: 'night' },
];

/** The lighting environment (sun, sky, fog, ambient, water tint) at a fractional hour. */
export function envAtHour(hourInput) {
  const hour = ((hourInput % 24) + 24) % 24;
  let a = STOPS[0], b = STOPS[1];
  for (let i = 0; i < STOPS.length - 1; i += 1) {
    if (hour >= STOPS[i].h && hour <= STOPS[i + 1].h) {
      a = STOPS[i]; b = STOPS[i + 1];
      break;
    }
  }
  const t = b.h === a.h ? 0 : (hour - a.h) / (b.h - a.h);
  const A = SKY_PRESETS[a.p];
  const B = SKY_PRESETS[b.p];
  const color = (key) => mix3(A[key], B[key], t);
  const num = (key) => lerp(A[key], B[key], t);
  const night = num('night');
  return {
    name: timeNameAt(hour),
    sunDir: normalize3([0, 1, 2].map((i) => lerp(A.sunDir[i], B.sunDir[i], t))),
    sunColor: color('sunColor'),
    skyTop: color('skyTop'),
    skyHorizon: color('skyHorizon'),
    fogColor: color('fogColor'),
    ambientSky: color('ambientSky'),
    ambientGround: color('ambientGround'),
    sunGlow: color('sunGlow'),
    cityGlow: color('cityGlow'),
    fogDensity: num('fogDensity'),
    night,
    stars: num('stars'),
    sunSize: A.sunSize,
    exposure: 1,
    deepWater: mix3(rgb(0x0a3e5e), rgb(0x0a1d42), night),
    shallowWater: mix3(rgb(0x2fc9bd), rgb(0x12505f), night * 0.85),
  };
}

/** The HUD's name for the hour: DAWN, HIGH SUN, GOLDEN HOUR, SUNSET or NEON NIGHT. */
export function timeNameAt(hour) {
  if (hour >= 5.4 && hour < 8.2) return 'DAWN';
  if (hour >= 8.2 && hour < 17.4) return 'HIGH SUN';
  if (hour >= 17.4 && hour < 19.35) return 'GOLDEN HOUR';
  if (hour >= 19.35 && hour < 20.4) return 'SUNSET';
  return 'NEON NIGHT';
}

/** A 24-hour HH:MM clock string for a fractional hour. */
export function clockAt(hour) {
  const total = Math.floor(hour * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
