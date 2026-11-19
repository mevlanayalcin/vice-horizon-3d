// SOLARIS BAY — one place for every tuning number, colour and catalogue entry.
// Coordinates are metres: +X east, -Z north, +Y up. The beach and the Atlantic
// sit to the south (+Z); the residential hills climb away to the north (-Z).

export const TAU = Math.PI * 2;
export const STEP = 1 / 60;

/** sRGB hex to the 0..1 triple the renderer consumes. */
export function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
export function shade(color, factor) {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}
export function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
/** Deterministic PRNG (mulberry32) so the screenshots stage the same city every run. */
export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// City layout
// ---------------------------------------------------------------------------

export const CITY = {
  minX: -470,
  maxX: 520,
  minZ: -470,
  maxZ: 302,
  beachStart: 302,
  waterStart: 336,
  oceanY: -0.85,
  pitch: 130,
  roadWidth: 24,
  boulevard: 34,
  sidewalk: 5,
  roadsX: [-390, -260, -130, 0, 130, 260, 390],
  roadsZ: [-390, -260, -130, 0, 130, 260],
  boulevardZ: 260,
  marinaX: 512,
  island: { minX: 548, maxX: 760, minZ: 70, maxZ: 300 },
  hills: { z: -330 },
  spawn: { x: 36, z: 294, heading: Math.PI },
};

export const SAFEHOUSE = { x: -66, z: -118, name: 'Safehouse Garage' };

export const DISTRICTS = [
  { id: 'palm', name: 'Palm Strip', color: '#ffb257', x: 0, z: 265, blurb: 'Oceanfront boulevard, pastel hotels, endless palms' },
  { id: 'pier', name: 'Coral Pier', color: '#ff6f91', x: -166, z: 372, blurb: 'A wooden pier, a neon wheel, salt on everything' },
  { id: 'midtown', name: 'Neon Midtown', color: '#c56cff', x: 10, z: -55, blurb: 'Glass towers and magenta light after dark' },
  { id: 'harbor', name: 'Harbor Docks', color: '#57d8d0', x: -360, z: -180, blurb: 'Containers, cranes and quiet money' },
  { id: 'marina', name: 'Marina Causeway', color: '#5cc8ff', x: 330, z: 170, blurb: 'Bridges to the yachts, glass on the water' },
  { id: 'hills', name: 'Casa Hills', color: '#9ee06a', x: 130, z: -392, blurb: 'Pastel houses stacked against the hillside' },
];

// ---------------------------------------------------------------------------
// Palette — golden-hour coral, turquoise and magenta
// ---------------------------------------------------------------------------

export const PALETTE = {
  asphalt: rgb(0x3a3b45),
  asphaltDark: rgb(0x2e2f37),
  lane: rgb(0xf1e6c8),
  laneYellow: rgb(0xf2c153),
  sidewalk: rgb(0xb9a99a),
  sidewalkDark: rgb(0x9b8c80),
  curb: rgb(0xd6c8b4),
  sand: rgb(0xe8cfa0),
  sandWet: rgb(0xb99b73),
  concrete: rgb(0x8d8c92),
  concreteDark: rgb(0x5e5f66),
  white: rgb(0xf7f1e8),
  black: rgb(0x111318),
  glass: rgb(0x25445c),
  glassLight: rgb(0x6fa7bd),
  neonPink: rgb(0xff3f8e),
  neonMagenta: rgb(0xd43cff),
  neonCyan: rgb(0x39f0ff),
  neonAmber: rgb(0xffb43c),
  neonLime: rgb(0xa8ff5e),
  palm: rgb(0x2c6b45),
  palmLight: rgb(0x3e8a52),
  trunk: rgb(0x6b5138),
  coral: rgb(0xf56c5c),
  sunset: rgb(0xff8a5b),
  gold: rgb(0xffc24b),
  policeRed: rgb(0xff2a3d),
  policeBlue: rgb(0x2f6bff),
  headlight: rgb(0xfff1c9),
  taillight: rgb(0xff2a22),
  skin: rgb(0xc78a63),
  skinDark: rgb(0x8f5c3e),
  clothDark: rgb(0x232634),
  armor: rgb(0x67d8ff),
  health: rgb(0x5ee08a),
};

// ---------------------------------------------------------------------------
// Sky / lighting presets. sunDir points TOWARD the sun.
// ---------------------------------------------------------------------------

export const SKY_PRESETS = {
  day: {
    name: 'High Sun', clock: '12:40',
    sunDir: [0.38, 0.86, 0.32],
    sunColor: rgb(0xfff2d8), skyTop: rgb(0x2f7fd0), skyHorizon: rgb(0xbfe6f7),
    fogColor: rgb(0xcfe8f2), fogDensity: 0.00135, ambientSky: rgb(0x88b8dd), ambientGround: rgb(0x7b7466),
    sunGlow: rgb(0xffe9b8), cityGlow: rgb(0xffd9a8), night: 0.0, stars: 0.0, sunSize: 0.9994, exposure: 1.0,
  },
  golden: {
    name: 'Golden Hour', clock: '18:55',
    sunDir: [-0.72, 0.28, 0.34],
    sunColor: rgb(0xffb56a), skyTop: rgb(0x241d5e), skyHorizon: rgb(0xff8f52),
    fogColor: rgb(0xe89a72), fogDensity: 0.0016, ambientSky: rgb(0x9a7ab8), ambientGround: rgb(0x6c4b3b),
    sunGlow: rgb(0xffb169), cityGlow: rgb(0xff9a5c), night: 0.22, stars: 0.0, sunSize: 0.9992, exposure: 1.02,
  },
  sunset: {
    name: 'Sunset', clock: '19:35',
    sunDir: [-0.94, 0.11, 0.24],
    sunColor: rgb(0xff7a45), skyTop: rgb(0x2c2a62), skyHorizon: rgb(0xff8a58),
    fogColor: rgb(0xd97c72), fogDensity: 0.0021, ambientSky: rgb(0x79619c), ambientGround: rgb(0x5a3c37),
    sunGlow: rgb(0xff8352), cityGlow: rgb(0xff6f83), night: 0.42, stars: 0.15, sunSize: 0.9991, exposure: 1.05,
  },
  night: {
    name: 'Neon Night', clock: '22:18',
    sunDir: [-0.28, 0.78, -0.42],
    sunColor: rgb(0x93aade), skyTop: rgb(0x03050f), skyHorizon: rgb(0x231a45),
    fogColor: rgb(0x12122e), fogDensity: 0.0022, ambientSky: rgb(0x5a5f9e), ambientGround: rgb(0x2b2438),
    sunGlow: rgb(0x9db0e2), cityGlow: rgb(0xb05fc2), night: 1.0, stars: 1.0, sunSize: 0.9995, exposure: 1.0,
  },
  dawn: {
    name: 'Dawn', clock: '06:10',
    sunDir: [0.62, 0.16, 0.5],
    sunColor: rgb(0xffc7ae), skyTop: rgb(0x54669c), skyHorizon: rgb(0xffc9ac),
    fogColor: rgb(0xe8c6bd), fogDensity: 0.0019, ambientSky: rgb(0x9aa6c6), ambientGround: rgb(0x6b5a55),
    sunGlow: rgb(0xffc2a4), cityGlow: rgb(0xffb7a0), night: 0.3, stars: 0.1, sunSize: 0.9992, exposure: 1.0,
  },
};

/** Lighting blends as the clock advances; each entry is a fractional hour of the day. */
export const DAY_CYCLE = [
  { hour: 6.2, preset: 'dawn' },
  { hour: 9.0, preset: 'day' },
  { hour: 17.4, preset: 'day' },
  { hour: 18.9, preset: 'golden' },
  { hour: 19.6, preset: 'sunset' },
  { hour: 20.6, preset: 'night' },
  { hour: 28.2, preset: 'night' },
];

// ---------------------------------------------------------------------------
// Vehicles — all original Solaris Bay machines
// ---------------------------------------------------------------------------

export const VEHICLES = {
  coupe: {
    id: 'coupe', name: 'Vice Coupe', price: 42000,
    length: 4.6, width: 1.98, height: 1.24, wheelBase: 2.75, wheelRadius: 0.38,
    maxSpeed: 54, accel: 15.5, brake: 28, grip: 7.2, steer: 1.55, mass: 1.1,
    colors: { body: rgb(0xff5a3c), accent: rgb(0xffb26a), glass: rgb(0x1a2a3a), rim: rgb(0xd8d5cf) },
    lights: 'sleek', rarity: 0.22,
  },
  muscle: {
    id: 'muscle', name: 'Coastal Muscle', price: 28500,
    length: 4.9, width: 2.08, height: 1.32, wheelBase: 2.9, wheelRadius: 0.4,
    maxSpeed: 48, accel: 14.5, brake: 25, grip: 5.6, steer: 1.4, mass: 1.25,
    colors: { body: rgb(0x1f9e8f), accent: rgb(0xdff2e8), glass: rgb(0x172530), rim: rgb(0xbfc5c9) },
    lights: 'muscle', rarity: 0.18,
  },
  supercar: {
    id: 'supercar', name: 'Solaris GT', price: 148000,
    length: 4.7, width: 2.04, height: 1.08, wheelBase: 2.8, wheelRadius: 0.37,
    maxSpeed: 68, accel: 21, brake: 30, grip: 6.4, steer: 1.62, mass: 1.0,
    colors: { body: rgb(0xff2f86), accent: rgb(0x33f0ff), glass: rgb(0x121c2c), rim: rgb(0xe9e4d8) },
    lights: 'sleek', rarity: 0.06,
  },
  sedan: {
    id: 'sedan', name: 'Coral Sedan', price: 19000,
    length: 4.5, width: 1.94, height: 1.46, wheelBase: 2.7, wheelRadius: 0.37,
    maxSpeed: 38, accel: 10.5, brake: 22, grip: 7.8, steer: 1.35, mass: 1.2,
    colors: { body: rgb(0xe8e2d2), accent: rgb(0x7f9aa8), glass: rgb(0x1a2a34), rim: rgb(0xa8a8a8) },
    lights: 'sedan', rarity: 0.2,
  },
  taxi: {
    id: 'taxi', name: 'Sun Cab', price: 12000,
    length: 4.5, width: 1.94, height: 1.48, wheelBase: 2.7, wheelRadius: 0.37,
    maxSpeed: 40, accel: 11, brake: 22, grip: 7.6, steer: 1.35, mass: 1.2,
    colors: { body: rgb(0xf7c64d), accent: rgb(0x26262b), glass: rgb(0x1a2a34), rim: rgb(0xa8a8a8) },
    lights: 'sedan', rarity: 0.12,
  },
  van: {
    id: 'van', name: 'Harbor Van', price: 24000,
    length: 5.4, width: 2.24, height: 2.24, wheelBase: 3.1, wheelRadius: 0.42,
    maxSpeed: 35, accel: 8.6, brake: 20, grip: 6.4, steer: 1.2, mass: 1.55,
    colors: { body: rgb(0xd9d2c2), accent: rgb(0x3f7f7a), glass: rgb(0x1c2c36), rim: rgb(0x8e9295) },
    lights: 'van', rarity: 0.1,
  },
  cruiser: {
    id: 'cruiser', name: 'Patrol Cruiser', price: 0,
    length: 4.95, width: 2.05, height: 1.62, wheelBase: 2.9, wheelRadius: 0.4,
    maxSpeed: 54, accel: 17, brake: 28, grip: 6.9, steer: 1.5, mass: 1.35,
    colors: { body: rgb(0xf1f0ea), accent: rgb(0x25252b), glass: rgb(0x141f2a), rim: rgb(0xcfd2d2) },
    lights: 'cruiser', rarity: 0,
  },
};

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export const WEAPONS = [
  {
    id: 'fists', slot: 1, name: 'Fists', short: 'FIST', auto: false, melee: true,
    damage: 16, rate: 0.42, range: 2.6, mag: 0, reserve: 0, spread: 0,
    color: '#ffd9a8', unlock: null,
  },
  {
    id: 'pistol', slot: 2, name: 'Palm Pistol', short: 'PISTOL', auto: false,
    damage: 24, rate: 0.23, range: 120, mag: 12, reserve: 96, spread: 0.012, pellets: 1,
    color: '#ffd36a', unlock: null,
  },
  {
    id: 'smg', slot: 3, name: 'Reef SMG', short: 'SMG', auto: true,
    damage: 13, rate: 0.075, range: 100, mag: 30, reserve: 180, spread: 0.032, pellets: 1,
    color: '#6ff0ff', unlock: 1,
  },
  {
    id: 'shotgun', slot: 4, name: 'Breaker 12', short: 'SHOT', auto: false,
    damage: 11, rate: 0.78, range: 55, mag: 6, reserve: 36, spread: 0.085, pellets: 7,
    color: '#ff9a5c', unlock: 2,
  },
];

// ---------------------------------------------------------------------------
// Helpers used across modules
// ---------------------------------------------------------------------------

export function kmh(metersPerSecond) {
  return Math.round(metersPerSecond * 3.6);
}

export function isNightEnv(env) {
  return env.night > 0.5;
}

export const RADIO = [
  { id: 'sunset', name: 'SUNSET FM 96.6', genre: 'Miami Synthwave' },
  { id: 'coral', name: 'CORAL 88.1', genre: 'Sunset Lo-Fi' },
  { id: 'neon', name: 'NEON DRIVE 101.9', genre: 'Bass Chase' },
];

export const STORY = {
  city: 'SOLARIS BAY',
  tagline: 'Sun, salt and unfinished business.',
  heroes: 'Elena Vega & Mateo Cruz',
};
