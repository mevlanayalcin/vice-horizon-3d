// world.js — SOLARIS BAY itself. One deterministic procedural pass builds the whole
// coastal metropolis: road grid and boulevards, five districts plus the hills, lit
// towers with window grids and neon crowns, art-deco hotels, warehouses and gantry
// cranes, a pier with a neon wheel, marina bridges, boardwalk, palms and props.
// It also emits collision boxes, map data for the HUD minimap, parked-car spawns,
// mission landmarks and pickup spots. No network, no assets: geometry only.

import {
  CITY, DISTRICTS, PALETTE, SAFEHOUSE, createRandom, rgb, shade, mix3,
} from './config.js';
import { MeshBuilder } from './meshkit.js';
import { CAFE_NAMES, HOTEL_NAMES, SHOP_NAMES, addBulbMarquee, addNeonColumn, addNeonText, measureNeonText } from './signage.js';

const V = (x, y, z) => [x, y, z];

export function createWorld(renderer) {
  const rng = createRandom(0x50a1a5);
  const batches = new Map();
  const colliders = [];
  const buildings = [];
  const roads = [];
  const glows = [];
  const parked = [];
  const tokens = [];
  const pickups = [];
  const props = [];
  const landmarks = [];
  const hydrants = [];
  const lampposts = [];
  let hotelCount = 0;
  let lifeguardCount = 0;
  let shopCount = 0;

  function builder(key) {
    let b = batches.get(key);
    if (!b) {
      b = new MeshBuilder(20000);
      batches.set(key, b);
    }
    return b;
  }

  function collider(minX, maxX, minZ, maxZ, tag = 'building') {
    colliders.push({ minX, maxX, minZ, maxZ, tag });
  }

  function glow(x, y, z, color, size, alpha = 0.55) {
    glows.push({ x, y, z, color, r: size, alpha });
  }

  function choose(list, random = rng) {
    return list[Math.floor(random() * list.length) % list.length];
  }

  // -------------------------------------------------------------------------
  // District lookup
  // -------------------------------------------------------------------------
  function districtAt(x, z) {
    if (z > 296) return 'beach';
    if (z > 185) return 'palm';
    if (z < -300) return 'hills';
    if (x < -230 && z < 150) return 'harbor';
    if (x > 250 && z > 40) return 'marina';
    if (x > -235 && x < 235 && z > -215 && z < 150) return 'midtown';
    if (z > 120) return 'palm';
    return 'commercial';
  }

  // -------------------------------------------------------------------------
  // Ground: land plates, sand, sea walls
  // -------------------------------------------------------------------------
  function buildGround() {
    const g = builder('ground');
    // Main land plate, from the harbour water in the west to the marina channel.
    g.flat(40, -84, 960, 772, 0.0, rgb(0x6c6458));
    // Harbour quay strip and marina island.
    g.flat(40, -420, 960, 100, 0.01, rgb(0x5f5a52));
    g.flat(654, 185, 212, 230, 0.05, rgb(0x9b9182));
    // Sea walls / quays: dark vertical faces so the water edge reads.
    const wall = rgb(0x4d4b4a);
    g.quad(V(-440, 0, 302), V(-440, 0, 336), V(-440, -1.8, 336), V(-440, -1.8, 302), wall, { n: [-1, 0, 0] });
    g.quad(V(520, 0, 60), V(520, 0, 302), V(520, -1.8, 302), V(520, -1.8, 60), wall, { n: [1, 0, 0] });
    g.quad(V(-440, 0, -470), V(-440, 0, 160), V(-440, -1.8, 160), V(-440, -1.8, -470), wall, { n: [-1, 0, 0] });
    // Quay edge detail in the harbour.
    for (let z = -440; z < 140; z += 26) {
      g.box(-438, 0.55, z, 6, 1.1, 2.2, rgb(0x8b8377));
      g.box(-444, 0.35, z + 8, 1.4, 0.7, 1.4, rgb(0x3c3a38));
    }
    // Marina island skirt.
    g.quad(V(548, 0, 70), V(548, 0, 300), V(548, -1.8, 300), V(548, -1.8, 70), wall, { n: [-1, 0, 0] });
    g.quad(V(760, 0, 70), V(760, 0, 300), V(760, -1.8, 300), V(760, -1.8, 70), wall, { n: [1, 0, 0] });
    g.quad(V(548, 0, 300), V(760, 0, 300), V(760, -1.8, 300), V(548, -1.8, 300), wall, { n: [0, 0, 1] });
    // Sand: warm strip that dips into the surf.
    const sand = builder('palm');
    const steps = 10;
    for (let i = 0; i < steps; i += 1) {
      const z0 = CITY.beachStart + (i / steps) * 34;
      const z1 = CITY.beachStart + ((i + 1) / steps) * 34;
      const y0 = -0.02 - (i / steps) * 0.62;
      const y1 = -0.02 - ((i + 1) / steps) * 0.62;
      const c = mix3(PALETTE.sand, PALETTE.sandWet, i / (steps - 1));
      sand.quad(V(-470, y0, z0), V(520, y0, z0), V(520, y1, z1), V(-470, y1, z1), c, { n: [0, 1, 0] });
    }
    // Surf line and dark wet edge.
    sand.flat(-470, 335.2, 990, 3.2, -0.66, rgb(0xbfa888), { e: 0 });
    // Sea wall along the east marina channel and harbour.
    g.quad(V(520, 0, 302), V(520, 0, 60), V(520, -2.0, 60), V(520, -2.0, 302), rgb(0x505258), { n: [1, 0, 0] });
  }

  // -------------------------------------------------------------------------
  // Roads, sidewalks and blocks
  // -------------------------------------------------------------------------
  const XS = CITY.roadsX;
  const ZS = CITY.roadsZ;

  function roadX(x, width = CITY.roadWidth) {
    roads.push({ x1: x, z1: -455, x2: x, z2: 302, w: width, axis: 'z', main: width > 26 });
  }
  function roadZ(z, width = CITY.roadWidth) {
    roads.push({ x1: -440, z1: z, x2: 520, z2: z, w: width, axis: 'x', main: width > 26 });
  }

  function buildRoads() {
    const g = builder('ground');
    const asphalt = PALETTE.asphalt;
    const boulevardZ = CITY.boulevardZ;

    for (const x of XS) roadX(x);
    for (const z of ZS) roadZ(z, z === boulevardZ ? CITY.boulevard : CITY.roadWidth);
    // Boulevard: wider, with a palm median and a promenade.
    g.flat(40, boulevardZ, 960, CITY.boulevard, 0.022, PALETTE.asphalt);
    // Marina avenue across the channel to the island.
    g.flat(455, 130, 140, 22, 0.024, PALETTE.asphalt);
    roads.push({ x1: 390, z1: 130, x2: 548, z2: 130, w: 22, axis: 'x', main: true, bridge: true });
    roads.push({ x1: 660, z1: 130, x2: 660, z2: 292, w: 18, axis: 'z', main: false, island: true });

    for (const x of XS) {
      g.flat(x, -89, CITY.roadWidth, 732, 0.026, asphalt);
    }
    for (const z of ZS) {
      const w = z === boulevardZ ? CITY.boulevard : CITY.roadWidth;
      g.flat(40, z, 960, w, 0.028, asphalt);
    }
    // Boulevard median and promenade.
    const median = rgb(0x4c7d4b);
    for (let x = -420; x < 500; x += 46) {
      g.flat(x + 16, boulevardZ, 36, 3.2, 0.06, median);
      g.box(x + 16, 0.13, boulevardZ, 36, 0.26, 3.2, PALETTE.curb, { omitBottom: true });
    }

    // Lane markings.
    const dash = (x1, z1, x2, z2, color, w) => {
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.floor(len / 13));
      for (let i = 0; i < steps; i += 1) {
        const t0 = (i + 0.15) / steps, t1 = (i + 0.72) / steps;
        const cx = x1 + dx * (t0 + t1) / 2, cz = z1 + dz * (t0 + t1) / 2;
        if (Math.abs(dx) > Math.abs(dz)) g.flat(cx, cz, len / steps * 0.6, w, 0.062, color);
        else g.flat(cx, cz, w, len / steps * 0.6, 0.062, color);
      }
    };
    for (const x of XS) {
      for (const off of [-5.4, 5.4]) {
        // White dashes either side of the centre line.
        dash(x + off, -440, x + off, -392, PALETTE.lane, 0.34);
        dash(x + off, -258, x + off, -132, PALETTE.lane, 0.34);
        dash(x + off, 2, x + off, 128, PALETTE.lane, 0.34);
        dash(x + off, 132, x + off, 258, PALETTE.lane, 0.34);
      }
      // Double yellow centre line.
      for (const off of [-0.55, 0.55]) {
        g.flat(x + off, -170, 0.34, 560, 0.06, PALETTE.laneYellow);
      }
    }
    for (const z of ZS) {
      if (z === boulevardZ) continue;
      for (const off of [-5.4, 5.4]) {
        dash(-438, z + off, -392, z + off, PALETTE.lane, 0.34);
        dash(-258, z + off, -132, z + off, PALETTE.lane, 0.34);
        dash(-2, z + off, 128, z + off, PALETTE.lane, 0.34);
        dash(262, z + off, 388, z + off, PALETTE.lane, 0.34);
      }
      for (const off of [-0.55, 0.55]) g.flat(40, z + off, 560, 0.34, 0.059, PALETTE.laneYellow);
    }
    // Boulevard lane lines (three lanes each way, gold centre).
    for (const off of [-12, -6, 6, 12]) {
      dash(-436, boulevardZ + off, 516, boulevardZ + off, PALETTE.lane, 0.36);
    }
    for (const off of [-0.6, 0.6]) g.flat(40, boulevardZ + off, 956, 0.3, 0.063, PALETTE.laneYellow);

    // Crosswalks and stop lines at intersections of the boulevard and midtown grid.
    for (const x of XS) {
      for (const z of [-390, -260, -130, 0, 130, boulevardZ]) {
        const half = (z === boulevardZ ? CITY.boulevard : CITY.roadWidth) / 2 + 2;
        for (let i = -5; i <= 5; i += 1) {
          g.flat(x + i * 1.9, z + half + 2.5, 1.05, 3.2, 0.066, PALETTE.lane);
          g.flat(x + i * 1.9, z - half - 2.5, 1.05, 3.2, 0.066, PALETTE.lane);
        }
      }
    }

    // Blocks: sidewalk rings, plazas, parks and building lots.
    const xEdges = [];
    for (let i = 0; i <= XS.length; i += 1) {
      let a = i === 0 ? -440 : XS[i - 1] + CITY.roadWidth / 2;
      let b = i === XS.length ? 520 : XS[i] - CITY.roadWidth / 2;
      xEdges.push([a, b]);
    }
    const zEdges = [];
    for (let i = 0; i <= ZS.length; i += 1) {
      let a = i === 0 ? -470 : ZS[i - 1] + (ZS[i - 1] === boulevardZ ? CITY.boulevard / 2 : CITY.roadWidth / 2);
      let b = i === ZS.length ? 302 : ZS[i] - (ZS[i] === boulevardZ ? CITY.boulevard / 2 : CITY.roadWidth / 2);
      zEdges.push([a, b]);
    }
    // Prevent duplicate ranges where the boulevard was handled.
    let blockIndex = 0;
    for (let ix = 0; ix < xEdges.length; ix += 1) {
      for (let iz = 0; iz < zEdges.length; iz += 1) {
        const ax = xEdges[ix][0], bx = xEdges[ix][1];
        const az = zEdges[iz][0], bz = zEdges[iz][1];
        if (bx - ax < 40 || bz - az < 34) continue;
        blockIndex += 1;
        const cx = (ax + bx) / 2, cz = (az + bz) / 2;
        const district = districtAt(cx, cz);
        const isPark = blockIndex % 11 === 0 || (ix === 1 && iz === 2);
        const walk = PALETTE.sidewalk;
        g.flat(cx, cz, bx - ax, bz - az, 0.045, walk);
        // Kerb outline
        g.flat(cx, az + 0.6, bx - ax, 1.2, 0.07, PALETTE.curb);
        g.flat(cx, bz - 0.6, bx - ax, 1.2, 0.07, PALETTE.curb);
        g.flat(ax + 0.6, cz, 1.2, bz - az, 0.07, PALETTE.curb);
        g.flat(bx - 0.6, cz, 1.2, bz - az, 0.07, PALETTE.curb);
        const inner = { minX: ax + 6, maxX: bx - 6, minZ: az + 6, maxZ: bz - 6 };
        if (isPark) {
          g.flat(cx, cz, bx - ax - 14, bz - az - 14, 0.055, rgb(0x35633d));
          // winding paths
          g.flat(cx, cz, bx - ax - 14, 3, 0.06, rgb(0xcfc3ae));
          g.flat(cx, cz, 3, bz - az - 14, 0.061, rgb(0xcfc3ae));
          for (let i = 0; i < 7; i += 1) {
            const px = inner.minX + 6 + rng() * (inner.maxX - inner.minX - 12);
            const pz = inner.minZ + 6 + rng() * (inner.maxZ - inner.minZ - 12);
            if (Math.abs(px - cx) < 4 || Math.abs(pz - cz) < 4) continue;
            addPalm(px, pz, 0.8 + rng() * 0.5, 'palm');
            addBench(px + 3, pz, rng() * Math.PI);
          }
          addFountain(cx + 12, cz + 8);
          continue;
        }
        if (cz > 277) continue; // promenade, no buildings
        g.flat(cx, cz, bx - ax - 12, bz - az - 12, 0.052, district === 'harbor' ? rgb(0x7f7c73) : rgb(0x8d8375));
        if (district === 'hills') {
          buildHillsBlock(inner, cx, cz);
          continue;
        }
        buildBlock(inner, district, cx, cz, bx - ax, bz - az);
      }
    }

    // Sea-front promenade and boardwalk.
    g.flat(-440, 292, 960, 22, 0.08, rgb(0x9d8d7a));
    g.flat(-440, 296, 960, 12, 0.38, rgb(0x8a5d3d));
    for (let x = -430; x < 500; x += 4) {
      g.flat(x, 296, 1.7, 12, 0.395, rgb(0x936644));
    }
    g.flat(-440, 302.2, 960, 0.8, 0.42, rgb(0x6a452c));
    // Railings along the boardwalk edge.
    const rail = rgb(0x5d4a3e);
    for (let x = -430; x < 500; x += 9) {
      g.box(x, 0.85, 301.4, 0.22, 1.15, 0.22, rail, { omitBottom: true });
      g.box(x + 4.5, 1.28, 301.4, 9, 0.16, 0.16, rail, { omitBottom: true });
      g.box(x + 4.5, 0.78, 301.4, 9, 0.1, 0.1, rail, { omitBottom: true });
    }
    // Boulevard lamps + palms in the median.
    for (let x = -420; x < 500; x += 46) {
      addLamp(x - 8, boulevardZ - 14.5, Math.PI);
      addLamp(x - 8, boulevardZ + 14.5, 0);
      addPalm(x + 14, boulevardZ, 1.05 + rng() * 0.25, 'boulevard');
    }
    for (const x of XS) {
      for (let z = -430; z < 270; z += 52) {
        if (Math.abs(z - boulevardZ) < 24) continue;
        if (z % 3 === 0) addLamp(x + 13, z, Math.PI / 2);
        if (z % 5 === 0) addPalm(x - 13, z + 18, 0.8, 'street');
      }
    }
    // Traffic signals at the six main boulevard junctions.
    for (const x of XS) addTrafficLight(x + 15, boulevardZ + 19, Math.PI);
    // Fire hydrants on the kerbs: drawn live so a car can shear one off into a geyser.
    for (const x of XS) {
      for (let z = -404; z < 230; z += 104) hydrants.push({ x: x + 12.9, z, broken: false, spray: 0 });
      hydrants.push({ x: x + 42, z: boulevardZ - 19.4, broken: false, spray: 0 });
    }
    // Beachfront palms and props.
    for (let x = -430; x < 500; x += 17) {
      addPalm(x + rng() * 3, 307 + rng() * 2, 1.0 + rng() * 0.45, 'beach');
      if (x % 3 === 0) addUmbrella(x + 7, 318 + rng() * 6, choose([PALETTE.coral, PALETTE.neonPink, rgb(0x35c9b8), rgb(0xffd166)]));
    }
    addLifeguard(-90, 320, 1.05);
    addLifeguard(214, 316, 0.95);
    addLifeguard(-322, 318, 1.0);
    addLifeguard(396, 319, 1.0);
    addBeachBar(118, 311);
    addVolleyball(-250, 320);
    // Elaborate hotel face along the boulevard's north side.
    addArtDecoHotel(-186, 221, 40, 19, rgb(0xf2b9a0), PALETTE.neonPink, 'THE PALOMA');
    addArtDecoHotel(-74, 224, 32, 24, rgb(0xf4d8b0), PALETTE.neonCyan, 'HOTEL MARISOL');
    addArtDecoHotel(38, 219, 36, 16, rgb(0xa8d8c8), PALETTE.neonAmber, 'SOL CLUB');
    addArtDecoHotel(168, 223, 44, 22, rgb(0xf6c8d2), PALETTE.neonMagenta, 'CORAL PLAZA');
    addArtDecoHotel(292, 220, 30, 14, rgb(0xe9e2c9), PALETTE.neonPink, 'AZUR GRAND');
    addPalmRow(-420, 440, 287, 22, 1.15);
    addBillboard(-300, 286, 0, 'SUNSET');
    addBillboard(140, 286, 0, 'NEON');
    addBillboard(360, 286, 0, 'PALMS');
  }

  // -------------------------------------------------------------------------
  // Street-level detail: paving joints, asphalt patches, neon spill, beach props
  // -------------------------------------------------------------------------
  function buildStreetDetail() {
    const g = builder('ground');
    const p = builder('props');
    // Paving joints on the Palm Strip promenade and the hotel-side pavement.
    for (let x = -430; x < 500; x += 7) {
      g.flat(x, 283.5, 0.22, 8.5, 0.073, PALETTE.sidewalkDark);
      g.flat(x + 3.5, 237.5, 0.22, 9.5, 0.073, shade(PALETTE.sidewalk, 0.86));
      g.flat(x, 296.5, 0.22, 10.5, 0.4, rgb(0x7a5236));
    }
    // Asphalt repair patches and tyre-worn lanes give the roads a history.
    for (let i = 0; i < 46; i += 1) {
      const r = roads[Math.floor(rng() * roads.length)];
      const t = 0.08 + rng() * 0.84;
      const cx = r.x1 + (r.x2 - r.x1) * t;
      const cz = r.z1 + (r.z2 - r.z1) * t;
      const along = r.axis === 'z';
      const w = 3 + rng() * 6, d = 6 + rng() * 16;
      const patch = rng() < 0.4 ? shade(PALETTE.asphalt, 1.16) : shade(PALETTE.asphaltDark, 0.86);
      g.flat(cx, cz, along ? w : d, along ? d : w, 0.054, patch);
    }
    // Neon spill on the boulevard — the wet-looking colour wash under the hotels.
    const spillSpots = [
      [-186, PALETTE.neonPink], [-118, PALETTE.neonPink], [-74, PALETTE.neonCyan],
      [38, PALETTE.neonAmber], [168, PALETTE.neonMagenta], [292, PALETTE.neonPink],
      [65, PALETTE.gold], [-260, PALETTE.neonCyan],
    ];
    for (const [x, color] of spillSpots) {
      for (const z of [249, 266]) {
        g.flat(x + 2, z, 4.2, 26, 0.068, mix3(color, PALETTE.asphalt, 0.5), { e: 0.3 });
      }
    }
    // Midtown plaza reflections around the vault.
    for (const [x, z, color] of [[40, -18, PALETTE.neonMagenta], [92, -34, PALETTE.neonCyan], [65, 6, PALETTE.gold]]) {
      g.flat(x, z, 8, 12, 0.069, mix3(color, PALETTE.asphalt, 0.66), { e: 0.14 });
    }
    // Beach towels and extra parasols along the sand.
    const towelColors = [rgb(0xff8f6b), rgb(0x5fe0d2), rgb(0xffd166), rgb(0xff6f91), rgb(0x9ecbff)];
    for (let i = 0; i < 14; i += 1) {
      const x = -410 + rng() * 900;
      const z = 312 + rng() * 15;
      g.flat(x, z, 1.5, 2.4, 0.015, choose(towelColors), { rotY: rng() * 0.8 });
    }
    for (let x = -380; x < 470; x += 61) addUmbrella(x + rng() * 6, 316 + rng() * 6, choose([PALETTE.coral, PALETTE.neonPink, rgb(0x35c9b8), rgb(0xffd166)]));
    // Promenade benches, bins and planters along the boardwalk.
    for (let x = -400; x < 480; x += 58) {
      addBench(x, 289.5, Math.PI);
      p.box(x + 6, 0.55, 290.5, 0.7, 1.1, 0.7, rgb(0x3e4a4a), { omitBottom: true });
      p.box(x + 6, 1.15, 290.5, 0.8, 0.12, 0.8, PALETTE.curb, { omitBottom: true });
    }
    for (let x = -390; x < 480; x += 78) addLamp(x + 20, 291.5, Math.PI / 2);
    // Cafe tables under the hotel awnings.
    for (let i = 0; i < 7; i += 1) {
      const x = -220 + i * 74;
      p.cylinder(x, 0.05, 236.5, 0.9, 0.9, 0.12, 10, PALETTE.white, { capTop: true });
      p.box(x, 0.5, 236.5, 0.12, 0.9, 0.12, rgb(0x4b4b4b), { omitBottom: true });
      p.cylinder(x, 2.1, 236.5, 1.5, 0.06, 0.55, 8, i % 2 ? PALETTE.coral : PALETTE.neonCyan, { e: 0.1, capBottom: true });
      addBench(x - 2.2, 236.5, Math.PI / 2);
    }
    // A second palm row frames the Strip without closing the ocean view.
    for (let x = -414; x < 500; x += 42) addPalm(x + rng() * 3, 281.5, 1.05 + rng() * 0.3, 'street');
    // Glass bus shelters on both pavements of Ocean Boulevard.
    for (const x of [-330, -200, -60, 112, 206, 336]) addBusShelter(x, 240.3, 1);
    for (const x of [-268, -134, 108, 238, 372]) addBusShelter(x, 280.2, -1);
    // Palm Strip cafe patios: striped umbrellas, bistro tables and a bulb-lit name board.
    CAFE_NAMES.forEach((name, i) => addCafePatio(-183 + i * 74, 235.4, name, i));
  }

  /** A lit glass bus shelter facing the road (`face` +1 looks toward +z). */
  function addBusShelter(x, z, face) {
    const b = builder('props');
    const steel = rgb(0x3a3f47), glassTint = rgb(0x6fb8c8);
    const back = z - face * 0.75;
    b.box(x, 0.09, z, 4.8, 0.06, 1.8, PALETTE.concreteDark, { omitBottom: true });
    for (const dx of [-2.25, 2.25]) {
      for (const dz of [-0.75, 0.75]) b.box(x + dx, 1.3, z + dz * face, 0.1, 2.5, 0.1, steel, { omitBottom: true, s: -0.5 });
    }
    // Glass back wall and one glass end, a little emissive so they glow at dusk.
    b.box(x, 1.35, back, 4.4, 2.2, 0.05, glassTint, { s: -1, e: 0.12, omitBottom: true });
    b.box(x - 2.25, 1.35, z, 0.05, 2.2, 1.4, glassTint, { s: -1, e: 0.12, omitBottom: true });
    // Roof canopy with a light strip underneath.
    b.box(x, 2.62, z + face * 0.1, 5.1, 0.14, 2.1, rgb(0xe8e6df), { s: -0.4 });
    b.box(x, 2.53, z, 4.2, 0.04, 0.22, rgb(0xfff4d8), { e: 1, omitBottom: true });
    // A backlit advert in the open end: a sunset poster panel.
    b.box(x + 2.25, 1.4, z, 0.12, 1.9, 1.2, rgb(0x1a1c22), { omitBottom: true });
    b.box(x + 2.25 + face * 0, 1.75, z, 0.14, 0.9, 1.0, rgb(0xff7a52), { e: 0.9, omitBottom: true });
    b.box(x + 2.25, 1.05, z, 0.14, 0.5, 1.0, rgb(0x6a3cc8), { e: 0.85, omitBottom: true });
    // Bench and the route sign on the canopy fascia.
    b.box(x - 0.4, 0.5, back + face * 0.3, 2.6, 0.08, 0.4, rgb(0x8a5a3a), { omitBottom: true });
    addNeonText(b, 'BAY LINE', { x, y: 2.56, z: z + face * 1.17, height: 0.2, normal: [0, face], color: PALETTE.neonCyan, weight: 0.14 });
    glow(x, 2.35, z, rgb(0xfff0d0), 3.0, 0.42);
    glow(x + 2.25, 1.5, z + face * 0.3, rgb(0xff8a5a), 1.8, 0.4);
    glow(x, 2.6, z + face * 1.25, PALETTE.neonCyan, 1.4, 0.35);
    collider(x - 2.4, x + 2.4, back - 0.1, back + 0.1, 'shelter');
  }

  /** A pavement cafe: three bistro tables with chairs under striped umbrellas, and its name board. */
  function addCafePatio(x, z, name, i) {
    const p = builder('props');
    const stripes = [[PALETTE.coral, PALETTE.white], [rgb(0x35c9b8), PALETTE.white], [rgb(0xffd166), rgb(0xff5d8f)]][i % 3];
    for (let k = -1; k <= 1; k += 1) {
      const tx = x + k * 3.2;
      p.cylinder(tx, 0.74, z, 0.45, 0.45, 0.05, 10, PALETTE.white, { capTop: true });
      p.box(tx, 0.38, z, 0.08, 0.74, 0.08, rgb(0x3b3b3b), { omitBottom: true });
      for (const side of [-1, 1]) {
        p.box(tx + side * 0.75, 0.46, z, 0.42, 0.06, 0.42, rgb(0x9a6a44), { omitBottom: true });
        p.box(tx + side * 0.96, 0.75, z, 0.05, 0.6, 0.42, rgb(0x9a6a44), { omitBottom: true });
      }
      p.box(tx, 1.5, z, 0.06, 1.6, 0.06, PALETTE.white, { omitBottom: true });
      // An eight-panel umbrella in alternating stripes.
      for (let s = 0; s < 8; s += 1) {
        const a0 = (s / 8) * Math.PI * 2, a1 = ((s + 1) / 8) * Math.PI * 2;
        p.tri([tx, 2.55, z], [tx + Math.cos(a1) * 1.35, 2.15, z + Math.sin(a1) * 1.35], [tx + Math.cos(a0) * 1.35, 2.15, z + Math.sin(a0) * 1.35], stripes[s % 2], { e: 0.06 });
      }
      glow(tx, 2.0, z, rgb(0xffd9a0), 1.3, 0.3);
    }
    addBulbMarquee(p, name, { x, y: 3.2, z: z - 1.1, height: 0.5, normal: [0, 1], color: PALETTE.neonPink }, glow);
    collider(x - 4.4, x + 4.4, z - 0.6, z + 0.6, 'cafe');
  }

  // -------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------
  const BUILDING_STYLES = {
    midtown: [
      { body: rgb(0x233c4c), glass: rgb(0x5d94a8), window: rgb(0xffe3ae), neon: PALETTE.neonCyan },
      { body: rgb(0x2a3152), glass: rgb(0x6d7fc0), window: rgb(0xffd28a), neon: PALETTE.neonMagenta },
      { body: rgb(0x3c3a55), glass: rgb(0x8990b0), window: rgb(0xfff0c8), neon: PALETTE.neonPink },
      { body: rgb(0x1e3c3c), glass: rgb(0x59b9b0), window: rgb(0xfff2cf), neon: PALETTE.neonCyan },
    ],
    commercial: [
      { body: rgb(0x8d8276), glass: rgb(0x94a4a8), window: rgb(0xffe1ac), neon: PALETTE.neonAmber },
      { body: rgb(0x9a8c7e), glass: rgb(0x7f98a4), window: rgb(0xffd8a3), neon: PALETTE.neonPink },
      { body: rgb(0x6f6c67), glass: rgb(0x8aa5ad), window: rgb(0xfff0c8), neon: PALETTE.neonCyan },
    ],
    palm: [
      { body: rgb(0xf5c6a5), glass: rgb(0x5b8c8f), window: rgb(0xffe9ba), neon: PALETTE.neonPink },
      { body: rgb(0xf0e3c8), glass: rgb(0x68969a), window: rgb(0xffdfa8), neon: PALETTE.neonCyan },
      { body: rgb(0xbfd8c8), glass: rgb(0x4f7f86), window: rgb(0xffe9c0), neon: PALETTE.neonMagenta },
    ],
    harbor: [
      { body: rgb(0x8c8b83), glass: rgb(0x67767c), window: rgb(0xffd59a), neon: PALETTE.neonAmber },
      { body: rgb(0x7a736a), glass: rgb(0x5c6c72), window: rgb(0xffd59a), neon: PALETTE.neonPink },
    ],
    marina: [
      { body: rgb(0xe9e4d8), glass: rgb(0x74a9b8), window: rgb(0xffedc2), neon: PALETTE.neonCyan },
      { body: rgb(0xd9ddd8), glass: rgb(0x6fa3b3), window: rgb(0xffe6b8), neon: PALETTE.neonPink },
    ],
    hills: [
      { body: rgb(0xe8b9a0), glass: rgb(0x6a8a8c), window: rgb(0xffe6b0), neon: PALETTE.neonAmber },
      { body: rgb(0xc9d8a8), glass: rgb(0x6c8a80), window: rgb(0xffe6b0), neon: PALETTE.neonPink },
      { body: rgb(0xa8c5d6), glass: rgb(0x6a8792), window: rgb(0xffe6b0), neon: PALETTE.neonCyan },
    ],
  };

  function addWindows(b, x0, x1, z0, z1, yBase, height, style, random, faces = 4) {
    const colsX = Math.max(1, Math.min(11, Math.floor((x1 - x0) / 2.9)));
    const colsZ = Math.max(1, Math.min(11, Math.floor((z1 - z0) / 2.9)));
    const rows = Math.max(1, Math.min(15, Math.floor((height - 5) / 3.9)));
    const ww = 1.5, wh = 1.75;
    const litColor = style.window;
    const cool = rgb(0xbfe6ff);
    const darkPane = shade(style.glass, 0.5);
    const addOnFace = (axis, sign, offset) => {
      for (let r = 0; r < rows; r += 1) {
        const y = yBase + 4 + r * 3.9;
        if (y > yBase + height - 3) break;
        const litRow = random() < 0.68;
        if (axis === 'x') {
          const cols = colsX;
          for (let i = 0; i < cols; i += 1) {
            const isLit = litRow && random() < 0.78;
            const cx = x0 + 1.3 + ((i + 0.5) / cols) * (x1 - x0 - 2.6);
            const z = sign > 0 ? z1 + offset : z0 - offset;
            const n = [0, 0, sign];
            if (!isLit) {
              // Dark glass keeps the facade a grid instead of blank concrete.
              b.quad(V(cx - ww / 2, y, z), V(cx + ww / 2, y, z), V(cx + ww / 2, y + wh, z), V(cx - ww / 2, y + wh, z),
                shade(darkPane, 0.85 + random() * 0.3), { n, e: 0.03 });
              continue;
            }
            const c = random() < 0.26 ? cool : litColor;
            const shadeC = shade(c, 0.72 + random() * 0.46);
            b.quad(V(cx - ww / 2, y, z), V(cx + ww / 2, y, z), V(cx + ww / 2, y + wh, z), V(cx - ww / 2, y + wh, z),
              shadeC, { n, e: 0.68 });
          }
        } else {
          const cols = colsZ;
          for (let i = 0; i < cols; i += 1) {
            const isLit = litRow && random() < 0.78;
            const cz = z0 + 1.3 + ((i + 0.5) / cols) * (z1 - z0 - 2.6);
            const x = sign > 0 ? x1 + offset : x0 - offset;
            const n = [sign, 0, 0];
            if (!isLit) {
              b.quad(V(x, y, cz - ww / 2), V(x, y, cz + ww / 2), V(x, y + wh, cz + ww / 2), V(x, y + wh, cz - ww / 2),
                shade(darkPane, 0.85 + random() * 0.3), { n, e: 0.03 });
              continue;
            }
            const c = random() < 0.26 ? cool : litColor;
            const shadeC = shade(c, 0.72 + random() * 0.46);
            b.quad(V(x, y, cz - ww / 2), V(x, y, cz + ww / 2), V(x, y + wh, cz + ww / 2), V(x, y + wh, cz - ww / 2),
              shadeC, { n, e: 0.68 });
          }
        }
      }
    };
    addOnFace('x', 1, 0.05);
    addOnFace('x', -1, 0.05);
    if (faces > 2) {
      addOnFace('z', 1, 0.05);
      addOnFace('z', -1, 0.05);
    }
    // A warm double-height lobby band anchors the tower to the street.
    if (height > 12) {
      b.quad(V(x0, yBase + 0.7, z1 + 0.06), V(x1, yBase + 0.7, z1 + 0.06), V(x1, yBase + 3.4, z1 + 0.06), V(x0, yBase + 3.4, z1 + 0.06),
        shade(litColor, 0.55), { n: [0, 0, 1], e: 0.55 });
    }
  }

  function neonCrown(b, x0, x1, z0, z1, y, color, glowSize = 7) {
    const t = 0.5;
    b.box((x0 + x1) / 2, y, z0, x1 - x0, t, t, color, { e: 1, omitBottom: true });
    b.box((x0 + x1) / 2, y, z1, x1 - x0, t, t, color, { e: 1, omitBottom: true });
    b.box(x0, y, (z0 + z1) / 2, t, t, z1 - z0, color, { e: 1, omitBottom: true });
    b.box(x1, y, (z0 + z1) / 2, t, t, z1 - z0, color, { e: 1, omitBottom: true });
    glow((x0 + x1) / 2, y + 1, (z0 + z1) / 2, color, glowSize, 0.5);
  }

  function addTower(x, z, w, d, height, district, options = {}) {
    const b = builder(district === 'marina' ? 'marina' : district === 'harbor' ? 'harbor' : 'midtown');
    const style = options.style ?? choose(BUILDING_STYLES[district] ?? BUILDING_STYLES.commercial);
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    const body = options.color ?? style.body;
    const h = height;
    // Podium
    const podiumH = Math.min(6, h * 0.18);
    b.box(x, podiumH / 2, z, w + 4, podiumH, d + 4, mix3(body, PALETTE.white, 0.16), { omitBottom: true });
    // Shaft with one or two setbacks.
    const tiers = h > 58 ? 3 : h > 30 ? 2 : 1;
    let baseY = podiumH;
    for (let t = 0; t < tiers; t += 1) {
      const frac = t === 0 ? 1 : t === 1 ? 0.8 : 0.6;
      const tierH = t === 0 ? h * (tiers === 1 ? 0.94 : 0.56) : t === 1 ? h * 0.27 : h * 0.17;
      const tw = w * frac, td = d * frac;
      b.box(x, baseY + tierH / 2, z, tw, tierH, td, body, { omitBottom: true, top: shade(body, 0.72) });
      baseY += tierH;
      const tb = t === 0 ? builder(district === 'marina' ? 'marina' : district === 'harbor' ? 'harbor' : 'midtown') : b;
      addWindows(tb, x - tw / 2, x + tw / 2, z - td / 2, z + td / 2, baseY - tierH, tierH, style, rng, 4);
      if (height > 34) {
        // Horizontal neon band at the setback.
        const bandColor = t % 2 === 0 ? style.neon : PALETTE.neonAmber;
        if (rng() < 0.65) neonCrown(b, x - tw / 2, x + tw / 2, z - td / 2, z + td / 2, baseY - 0.3, bandColor, 5);
      }
    }
    // Ground-floor storefront glass.
    b.box(x, 1.6, z + d / 2 + 0.35, w * 0.6, 2.6, 0.4, style.glass, { e: 0.1, omitBottom: true });
    b.box(x, 1.6, z - d / 2 - 0.35, w * 0.6, 2.6, 0.4, style.glass, { e: 0.1, omitBottom: true });
    // Pastel architectural trim: crisp ledges every few floors read as Art Deco.
    if (h > 24) {
      const trim = mix3(body, PALETTE.white, 0.58);
      const accent = mix3(style.neon, PALETTE.white, 0.4);
      for (let ly = 9.2; ly < baseY - 5; ly += 7.4) {
        b.box(x, ly, z + d / 2 + 0.16, w + 0.55, 0.26, 0.34, trim, { omitBottom: true });
        b.box(x, ly, z - d / 2 - 0.16, w + 0.55, 0.26, 0.34, shade(trim, 0.9), { omitBottom: true });
        if (h > 48) {
          b.box(x + w / 2 + 0.16, ly, z, 0.34, 0.26, d + 0.55, shade(trim, 0.95), { omitBottom: true });
          b.box(x - w / 2 - 0.16, ly, z, 0.34, 0.26, d + 0.55, shade(trim, 0.86), { omitBottom: true });
        }
      }
      b.box(x, baseY - 1.1, z + d / 2 + 0.3, w + 0.8, 0.4, 0.5, accent, { omitBottom: true, e: 0.25 });
      b.box(x, baseY - 1.1, z - d / 2 - 0.3, w + 0.8, 0.4, 0.5, accent, { omitBottom: true, e: 0.25 });
    }
    // Glass curtain strips on the street corners of taller towers.
    if (h > 40) {
      const glassStrip = mix3(style.glass, PALETTE.glassLight, 0.35);
      b.box(x - w * 0.3, baseY * 0.5 + 4, z + d / 2 + 0.1, w * 0.09, baseY - 10, 0.2, glassStrip, { e: 0.18, omitBottom: true });
      b.box(x + w * 0.3, baseY * 0.5 + 4, z + d / 2 + 0.1, w * 0.09, baseY - 10, 0.2, glassStrip, { e: 0.18, omitBottom: true });
      b.box(x + w / 2 + 0.1, baseY * 0.5 + 4, z - d * 0.22, 0.2, baseY - 10, d * 0.1, shade(glassStrip, 0.8), { e: 0.12, omitBottom: true });
    }
    // Vertical neon corner strips.
    if (h > 40) {
      const cols = [style.neon, PALETTE.neonPink, PALETTE.neonCyan];
      const cA = options.neon ?? style.neon;
      const cB = choose(cols);
      for (const [sx, sz] of [[-1, -1], [1, 1]]) {
        b.box(x + sx * (w / 2 - 0.4), baseY / 2 + 3, z + sz * (d / 2 - 0.4), 0.55, baseY - 6, 0.55, cA, { e: 1, omitBottom: true });
        glow(x + sx * (w / 2 - 0.4), baseY * 0.78, z + sz * (d / 2 - 0.4), cA, 4.6, 0.55);
      }
      b.box(x, baseY + 0.4, z, w * 0.36, 0.5, d * 0.36, cB, { e: 1, omitBottom: true });
    }
    // Roof details: cap, antenna, glow crown.
    b.box(x, baseY + 0.4, z, w * (tiers > 1 ? 0.58 : 0.94), 0.8, d * (tiers > 1 ? 0.58 : 0.94), shade(body, 0.78), { omitBottom: true });
    if (h > 45) {
      neonCrown(b, x - w * 0.3, x + w * 0.3, z - d * 0.3, z + d * 0.3, baseY + 1.6, style.neon, 12);
      b.box(x + w * 0.16, baseY + 8, z - d * 0.1, 0.35, 15, 0.35, PALETTE.concreteDark, { omitBottom: true });
      glow(x + w * 0.16, baseY + 16, z - d * 0.1, PALETTE.policeRed, 1.8, 0.7);
      // Sky deck lounges / planters.
      b.box(x - w * 0.18, baseY + 2, z + d * 0.12, 3, 2.4, 3, PALETTE.glass, { omitBottom: true });
    } else {
      b.box(x + w * 0.22, baseY + 1.4, z, 1.1, 2.8, 1.1, PALETTE.concreteDark, { omitBottom: true });
      b.box(x - w * 0.18, baseY + 1.2, z + d * 0.2, 2.4, 2.4, 2.4, PALETTE.sidewalkDark, { omitBottom: true });
    }
    // Rooftop billboard on some towers.
    if (h > 28 && rng() < 0.5) addRoofSign(b, x, z - d / 2, baseY + 2, w * 0.8, style.neon);
    // Storefront awnings at street level.
    const awning = [PALETTE.coral, PALETTE.neonCyan, PALETTE.neonAmber, PALETTE.neonPink][Math.floor(rng() * 4)];
    b.box(x, 3.4, z + d / 2 + 1.1, w * 0.4, 0.35, 2.4, awning, { omitBottom: true, e: 0.15 });
    // Neon shop fronts make the night streets read as a city, not a canyon.
    if (rng() < 0.85) {
      const sign = [PALETTE.neonPink, PALETTE.neonCyan, PALETTE.neonAmber, PALETTE.neonMagenta, PALETTE.neonLime][Math.floor(rng() * 5)];
      addShopFront(x, z + d / 2, w * 0.62, 1, sign);
      if (rng() < 0.5) addShopFront(x, z - d / 2, w * 0.5, -1, style.neon);
    }
    buildings.push({ x, z, w, d, h, district, style });
    collider(x0, x1, z0, z1, 'building');
    if (h > 22) glow(x, h * 0.55, z, style.neon, h > 55 ? 16 : 8, 0.22);
    return { x, z, w, d, h, style };
  }

  /** Street-level neon: a lit shop band, a striped awning and a blade sign. */
  function addShopFront(x, z, width, faceZ, color) {
    const b = builder('props');
    const y = 4.15;
    const shopName = SHOP_NAMES[shopCount++ % SHOP_NAMES.length];
    const nameH = Math.min(1.05, (width * 0.7) / (measureNeonText(shopName, 1) || 1));
    b.box(x, y + 0.35, z + faceZ * 0.55, width, nameH + 0.6, 0.18, shade(color, 0.16), { e: 0.03, omitBottom: true });
    b.box(x, y - 0.05, z + faceZ * 0.62, width, 0.12, 0.12, color, { e: 1, omitBottom: true });
    addNeonText(b, shopName, { x, y: y + 0.35 - nameH / 2, z: z + faceZ * 0.68, height: nameH, normal: [0, faceZ], color, weight: 0.13 });
    // Striped awning: alternating warm slats under the sign, a Strip signature.
    for (let i = 0; i < 6; i += 1) {
      const ax = x - width * 0.42 + (i + 0.5) * (width * 0.84 / 6);
      b.box(ax, 3.55, z + faceZ * 1.0, (width * 0.84) / 6 - 0.06, 0.16, 2.1,
        i % 2 ? PALETTE.white : color, { e: 0.08, omitBottom: true });
    }
    b.box(x, 3.42, z + faceZ * 2.02, width * 0.84, 0.42, 0.12, shade(color, 0.7), { omitBottom: true });
    // Blade sign hanging out over the pavement.
    const bx = x + width * 0.5 - 1.1;
    b.box(bx, y + 1.5, z + faceZ * 1.35, 2.6, 1.5, 0.16, shade(color, 0.52), { e: 0.14, omitBottom: true });
    for (let i = 0; i < 3; i += 1) {
      b.box(bx - 0.8 + i * 0.8, y + 1.5, z + faceZ * 1.36, 0.42, 1.0, 0.1, color, { e: 1, omitBottom: true });
    }
    glow(x, y, z + faceZ * 1.6, color, 5.5, 0.5);
    glow(bx, y + 1.6, z + faceZ * 1.8, color, 4.2, 0.55);
    glow(x, 3.4, z + faceZ * 2.1, color, 3.2, 0.3);
  }

  function addRoofSign(b, x, z, y, width, color) {    b.box(x, y + 2.6, z, width, 0.4, 0.4, PALETTE.concreteDark, { omitBottom: true });
    b.box(x, y + 4.4, z, width, 3.4, 0.55, shade(color, 0.22), { e: 0, omitBottom: true });
    // Abstract neon lettering: bars of varying heights.
    let cursor = x - width * 0.42;
    for (let i = 0; i < 6; i += 1) {
      const barH = 1.2 + rng() * 1.6;
      b.box(cursor, y + 4.6, z - 0.35, 0.32, barH, 0.16, color, { e: 1, omitBottom: true });
      cursor += width * 0.14;
    }
    glow(x, y + 5, z - 0.5, color, width * 0.35, 0.55);
  }

  function addArtDecoHotel(x, z, width, height, color, neon, name = null) {
    const b = builder('palm');
    const title = name ?? HOTEL_NAMES[hotelCount++ % HOTEL_NAMES.length];
    const d = 22;
    b.box(x, height / 2, z, width, height, d, color, { omitBottom: true, top: shade(color, 0.9) });
    // White horizontal fins, the Strip's pastel Art Deco signature.
    for (let i = 1; i <= 6; i += 1) {
      const finColor = i % 3 === 0 ? mix3(color, PALETTE.white, 0.72) : PALETTE.white;
      b.box(x, (height / 7) * i, z, width + 1.4, 0.42, d + 1.2, finColor, { omitBottom: true });
    }
    // Balcony slabs and railings across the beach-facing face.
    for (let i = 1; i <= 4; i += 1) {
      const by = (height / 7) * i + 0.55;
      b.box(x, by, z + d / 2 + 0.75, width * 0.82, 0.18, 1.35, mix3(color, PALETTE.white, 0.5), { omitBottom: true });
      b.box(x, by + 0.5, z + d / 2 + 1.34, width * 0.8, 0.12, 0.12, PALETTE.white, { omitBottom: true });
    }
    // Central tower and rooftop sign.
    b.box(x, height / 2 + 3, z, width * 0.32, 6, d * 0.55, color, { omitBottom: true });
    b.box(x, height + 5.2, z, width * 0.14, 4.2, 1.2, shade(neon, 0.35), { e: 0.2, omitBottom: true });
    for (let i = 0; i < 4; i += 1) {
      b.box(x - width * 0.06 + i * width * 0.04, height + 5.3, z, 0.5, 2.6, 0.2, neon, { e: 1, omitBottom: true });
    }
    // Wide roof marquee with readable abstract lettering, aimed at the Strip.
    const signY = height + 8.6;
    const capH = Math.min(2.6, (width * 0.7) / (measureNeonText(title, 1) || 1));
    const boardW = measureNeonText(title, capH) + 1.6;
    b.box(x, signY, z + d * 0.32, boardW, capH + 1.5, 0.42, shade(neon, 0.18), { e: 0.04, omitBottom: true });
    for (const side of [-1, 1]) b.box(x + side * boardW * 0.32, signY - capH, z + d * 0.32, 0.28, capH + 1, 0.28, PALETTE.concreteDark, { omitBottom: true });
    addNeonText(b, title, { x, y: signY - capH / 2, z: z + d * 0.32 + 0.24, height: capH, normal: [0, 1], color: neon, glow, glowAlpha: 0.5 });
    // Vertical blade sign on the corners.
    b.box(x + width / 2 - 2, height * 0.55, z + d / 2 + 1, 0.35, height * 0.6, 3.2, shade(neon, 0.44), { e: 0.12, omitBottom: true });
    // The blade carries the hotel's short name, stacked letter by letter, on both faces.
    const bladeWord = title.replace(/^(HOTEL|THE|LA|CASA DEL) /, '').split(' ')[0].slice(0, 7);
    const letterH = Math.min(1.7, (height * 0.56) / (bladeWord.length * 1.25));
    for (const side of [-1, 1]) {
      addNeonColumn(b, bladeWord, { x: x + width / 2 - 2 + side * 0.24, yTop: height * 0.84, z: z + d / 2 + 1 - letterH * 0.33, height: letterH, gap: letterH * 0.25, normal: [side, 0], color: neon, glow: side > 0 ? glow : null });
    }
    // Neon corner edge on the other side so the silhouette glows from any angle.
    b.box(x - width / 2 - 0.15, height * 0.52, z + d / 2 - 1.2, 0.24, height * 0.82, 0.24, neon, { e: 0.9, omitBottom: true });
    addWindows(b, x - width / 2, x + width / 2, z - d / 2, z + d / 2, 0, height, BUILDING_STYLES.palm[0], rng, 4);
    // Ground-floor arches, simplified as alternating warm and dark bays.
    for (let i = 0; i < Math.floor(width / 4); i += 1) {
      const bx = x - width / 2 + 2.6 + i * 4;
      b.box(bx, 1.9, z + d / 2 + 0.3, 2.4, 3.8, 0.3, i % 2 ? PALETTE.glass : shade(color, 0.65), { omitBottom: true, e: i % 2 ? 0.2 : 0 });
    }
    // Neon marquee over the entrance — the Strip's signature at night.
    b.box(x, 4.6, z + d / 2 + 1.2, width * 0.44, 0.5, 0.22, neon, { e: 1, omitBottom: true });
    b.box(x, 5.3, z + d / 2 + 1.2, width * 0.3, 0.22, 0.14, shade(neon, 0.6), { e: 0.9, omitBottom: true });
    for (let i = 0; i < 3; i += 1) {
      b.box(x - width * 0.18 + i * width * 0.18, 5.3, z + d / 2 + 1.3, 0.34, 1.1, 0.16, neon, { e: 1, omitBottom: true });
    }
    // Scalloped coral-and-cream canopy over the door.
    for (let i = 0; i < 8; i += 1) {
      b.box(x - width * 0.2 + i * width * 0.05, 3.15, z + d / 2 + 2.4, width * 0.05 - 0.04, 0.14, 1.4,
        i % 2 ? PALETTE.white : PALETTE.coral, { e: 0.06, omitBottom: true });
    }
    glow(x, 4.9, z + d / 2 + 1.6, neon, 7.5, 0.6);
    glow(x - width * 0.18, 5.4, z + d / 2 + 1.8, neon, 3.6, 0.45);
    glow(x, 3.4, z + d / 2 + 2.6, PALETTE.coral, 4.0, 0.3);
    addDecoFeatures(b, x, z, width, d, height, color, neon);
    // Pool deck + palms at the front.
    b.flat(x, z + d / 2 + 5, width * 0.6, 6, 0.06, rgb(0x6f9c8f));
    addPalm(x - width * 0.32, z + d / 2 + 6, 1.2, 'hotel');
    addPalm(x + width * 0.3, z + d / 2 + 6, 1.15, 'hotel');
    buildings.push({ x, z, w: width, d, h: height + 6, district: 'palm', style: BUILDING_STYLES.palm[0] });
    collider(x - width / 2, x + width / 2, z - d / 2, z + d / 2);
    glow(x, height + 6, z, neon, 8, 0.6);
  }

  /**
   * Streamline Art Deco on a Strip hotel: rounded corner drums wrapped in eyebrow fins,
   * a stepped ziggurat crown with a neon-tipped spire, and a tall pylon fin over the door.
   */
  function addDecoFeatures(b, x, z, width, d, height, color, neon) {
    const cream = mix3(color, PALETTE.white, 0.62);
    const drumR = Math.min(4.2, width * 0.12);
    const drumH = height * 0.94;
    for (const side of [-1, 1]) {
      const cx = x + side * (width / 2 - drumR * 0.55), cz = z + d / 2 - drumR * 0.55;
      b.tube([[cx, 0, cz], [cx, drumH * 0.5, cz], [cx, drumH, cz]], [drumR, drumR, drumR], 18, mix3(color, PALETTE.white, 0.22));
      b.ellipsoid(cx, drumH, cz, drumR * 1.04, 0.5, drumR * 1.04, cream, { segments: 18, rings: 3, top: 0.5 });
      for (let y = 4.2; y < drumH - 1; y += 3.55) {
        b.tube([[cx, y, cz], [cx, y + 0.26, cz]], [drumR + 0.55, drumR + 0.55], 18, PALETTE.white);
        b.tube([[cx, y + 0.9, cz], [cx, y + 2.3, cz]], [drumR + 0.04, drumR + 0.04], 18, shade(PALETTE.glass, 1.4), { e: 0.12, s: -1 });
      }
      b.tube([[cx, drumH - 1.2, cz], [cx, drumH - 0.8, cz]], [drumR + 0.12, drumR + 0.12], 18, neon, { e: 1 });
      glow(cx, drumH - 1, cz + drumR, neon, 4.5, 0.4);
    }
    // Stepped crown over the central tower, ending in a fluted spire.
    let y = height + 6;
    let w = width * 0.3, dd = d * 0.5;
    for (let i = 0; i < 3; i += 1) {
      const h = 2.2 - i * 0.4;
      b.box(x, y + h / 2, z, w, h, dd, i % 2 ? color : cream, { omitBottom: true });
      b.box(x, y + h - 0.1, z + dd / 2 + 0.06, w * 0.96, 0.18, 0.1, neon, { e: 1 });
      y += h;
      w *= 0.72; dd *= 0.72;
    }
    b.tube([[x, y, z], [x, y + 5, z], [x, y + 9.5, z]], [0.75, 0.42, 0.02], 8, cream);
    b.ellipsoid(x, y + 9.4, z, 0.35, 0.35, 0.35, neon, { segments: 6, rings: 4, e: 1 });
    glow(x, y + 9.4, z, neon, 3.2, 0.8);
    // Pylon fin: a tall slab over the entrance with neon edges, the hotel's name tower.
    const finH = height * 0.5;
    const fz = z + d / 2 + 0.9;
    b.box(x + width * 0.24, height * 0.62, fz, 0.7, finH, 2.4, cream, { omitBottom: true });
    for (const e of [-1, 1]) {
      b.box(x + width * 0.24, height * 0.62, fz + e * 1.25, 0.3, finH * 0.96, 0.14, neon, { e: 1, omitBottom: true });
    }
    glow(x + width * 0.24, height * 0.7, fz + 1.4, neon, 5.5, 0.45);
  }

  function addWarehouse(x, z, w, d, color) {
    const b = builder('harbor');
    const h = 7 + rng() * 5;
    b.box(x, h / 2, z, w, h, d, color, { omitBottom: true, top: shade(color, 0.82) });
    // Corrugation ribs.
    for (let i = 0; i < Math.floor(w / 4); i += 1) {
      b.box(x - w / 2 + 2 + i * 4, h / 2, z + d / 2 + 0.1, 0.3, h - 1, 0.25, shade(color, 0.78), { omitBottom: true });
    }
    b.box(x, 4, z + d / 2 + 0.4, w * 0.38, 6, 0.5, rgb(0x4f5c5c), { omitBottom: true });
    // Roof vents and skylights.
    for (let i = 0; i < 3; i += 1) {
      b.box(x - w * 0.3 + i * (w * 0.3), h + 0.7, z + rng() * d * 0.4, 2.6, 1.4, 2.6, PALETTE.concreteDark, { omitBottom: true });
      b.flat(x - w * 0.3 + i * (w * 0.3), z - d * 0.2, 3.4, 2, h + 0.06, rgb(0x9cc4cc), { e: 0.4 });
    }
    b.box(x + w * 0.4, h + 1.2, z, 0.35, 3, 0.35, PALETTE.concreteDark, { omitBottom: true });
    glow(x, h + 0.6, z, PALETTE.neonAmber, 6, 0.3);
    buildings.push({ x, z, w, d, h, district: 'harbor', style: BUILDING_STYLES.harbor[0] });
    collider(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
  }

  function buildHillsBlock(inner, cx, cz) {
    const b = builder('hills');
    // A terrace the houses sit on, taller the further north, with retaining wall.
    const depth = inner.maxZ - inner.minZ;
    const northT = Math.max(0, Math.min(1, (-cz - 330) / 120));
    const lift = 1.2 + northT * 9;
    b.box(cx, lift / 2, cz, inner.maxX - inner.minX + 6, lift, depth + 4, rgb(0x8b7b62), { omitBottom: true });
    b.flat(cx, cz, inner.maxX - inner.minX, depth, lift + 0.04, rgb(0x4a7043));
    // Retaining wall stripe.
    b.box(cx, lift * 0.55, inner.maxZ + 2, inner.maxX - inner.minX, lift * 0.7, 1.2, rgb(0x9c8e78), { omitBottom: true });
    collider(inner.minX - 2, inner.maxX + 2, inner.minZ - 2, inner.maxZ + 2, 'terrace');
    const count = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i += 1) {
      const hx = inner.minX + 10 + rng() * (inner.maxX - inner.minX - 20);
      const hz = inner.minZ + 10 + rng() * (inner.maxZ - inner.minZ - 20);
      const w = 8 + rng() * 4, d = 7 + rng() * 4;
      const color = choose(BUILDING_STYLES.hills).body;
      const roof = choose([rgb(0xb5533f), rgb(0x8a4a3a), rgb(0x4e6f73), rgb(0xd6a05a)]);
      const tmp = new MeshBuilder(2000);
      addHouseInto(tmp, w, d, color, roof);
      appendTranslated(b, tmp, hx, lift + 0.05, hz);
      collider(hx - w / 2, hx + w / 2, hz - d / 2, hz + d / 2);
      buildings.push({ x: hx, z: hz, w, d, h: lift + 4, district: 'hills', style: BUILDING_STYLES.hills[0] });
      if (rng() < 0.6) addPalm(hx + w * 0.7, hz + d * 0.5, 0.75, 'hill', lift);
    }
    // Hillside vegetation.
    for (let i = 0; i < 5; i += 1) {
      addPalm(inner.minX + rng() * (inner.maxX - inner.minX), inner.minZ + rng() * (inner.maxZ - inner.minZ), 0.7 + rng() * 0.4, 'hill', lift);
    }
  }

  /** addHouse writes into the hills builder at the origin; this variant writes to `b` with an offset. */
  function addHouseInto(b, w, d, color, roof) {
    const h = 3.4 + rng() * 2.2;
    b.box(0, h / 2, 0, w, h, d, color, { omitBottom: true });
    const peak = h + 2.2;
    b.quad(V(-w / 2 - 0.5, h, -d / 2 - 0.5), V(w / 2 + 0.5, h, -d / 2 - 0.5), V(w / 2 + 0.5, peak, 0), V(-w / 2 - 0.5, peak, 0), roof, { n: [0, 0.8, -0.6] });
    b.quad(V(w / 2 + 0.5, h, d / 2 + 0.5), V(-w / 2 - 0.5, h, d / 2 + 0.5), V(-w / 2 - 0.5, peak, 0), V(w / 2 + 0.5, peak, 0), roof, { n: [0, 0.8, 0.6] });
    b.tri(V(-w / 2, h, -d / 2), V(-w / 2, h, d / 2), V(-w / 2, peak, 0), shade(color, 0.8), { n: [-1, 0, 0] });
    b.tri(V(w / 2, h, d / 2), V(w / 2, h, -d / 2), V(w / 2, peak, 0), shade(color, 0.8), { n: [1, 0, 0] });
    b.box(0, h * 0.55, -d / 2 - 0.03, w * 0.6, 1.2, 0.1, PALETTE.glass, { e: 0.3, omitBottom: true });
    b.box(w * 0.25, 1.3, d / 2 + 0.05, 1.2, 2.6, 0.12, shade(color, 0.55), { omitBottom: true });
  }

  function appendTranslated(dest, src, ox, oy, oz) {
    const oldLength = dest.length;
    dest.ensure(src.length / 11);
    const d = dest.data, s = src.data;
    for (let i = 0; i + 10 < src.length; i += 11) {
      const j = oldLength + i;
      d[j] = s[i] + ox; d[j + 1] = s[i + 1] + oy; d[j + 2] = s[i + 2] + oz;
      d[j + 3] = s[i + 3]; d[j + 4] = s[i + 4]; d[j + 5] = s[i + 5];
      d[j + 6] = s[i + 6]; d[j + 7] = s[i + 7]; d[j + 8] = s[i + 8];
      d[j + 9] = s[i + 9]; d[j + 10] = s[i + 10];
    }
    dest.length = oldLength + src.length;
    // Keep bounds fresh for culling.
    dest.bounds.minX = Math.min(dest.bounds.minX, src.bounds.minX + ox);
    dest.bounds.maxX = Math.max(dest.bounds.maxX, src.bounds.maxX + ox);
    dest.bounds.minY = Math.min(dest.bounds.minY, src.bounds.minY + oy);
    dest.bounds.maxY = Math.max(dest.bounds.maxY, src.bounds.maxY + oy);
    dest.bounds.minZ = Math.min(dest.bounds.minZ, src.bounds.minZ + oz);
    dest.bounds.maxZ = Math.max(dest.bounds.maxZ, src.bounds.maxZ + oz);
  }

  function buildBlock(inner, district, cx, cz, bw, bd) {
    const w = inner.maxX - inner.minX;
    const d = inner.maxZ - inner.minZ;
    const reserved = Math.hypot(cx - 65, cz + 65) < 70 || Math.hypot(cx - SAFEHOUSE.x, cz - SAFEHOUSE.z) < 55;
    if (reserved) return;
    if (district === 'midtown') {
      const count = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i += 1) {
        const tw = w * (0.5 + rng() * 0.3);
        const td = d * (0.5 + rng() * 0.3);
        const x = inner.minX + tw / 2 + rng() * (w - tw);
        const z = inner.minZ + td / 2 + rng() * (d - td);
        addTower(x, z, tw, td, 28 + rng() * 58, 'midtown');
      }
      // Plaza palm or two.
      addPalm(inner.minX + 5, inner.maxZ - 5, 0.8, 'street');
    } else if (district === 'palm') {
      const rows = 2;
      for (let r = 0; r < rows; r += 1) {
        const tw = w * (0.44 + rng() * 0.2);
        const td = d * 0.34;
        const x = cx + (r === 0 ? -1 : 1) * w * 0.22 + (rng() - 0.5) * 5;
        const z = inner.minZ + td + r * (d * 0.5);
        addArtDecoHotel(x, z, tw, 11 + rng() * 13, choose(BUILDING_STYLES.palm).body, choose([PALETTE.neonPink, PALETTE.neonCyan, PALETTE.neonAmber, PALETTE.neonMagenta]));
      }
    } else if (district === 'harbor') {
      const count = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i += 1) {
        const ww = w * (0.55 + rng() * 0.3), dd = d * (0.4 + rng() * 0.3);
        const x = inner.minX + ww / 2 + rng() * (w - ww);
        const z = inner.minZ + dd / 2 + rng() * (d - dd);
        addWarehouse(x, z, ww, dd, choose(BUILDING_STYLES.harbor).body);
      }
      addContainers(inner.minX, inner.minZ, w, d);
      if (rng() < 0.5) addPalm(inner.maxX - 5, inner.maxZ - 5, 0.8, 'street');
    } else if (district === 'marina') {
      const tw = w * (0.5 + rng() * 0.25);
      const td = d * (0.42 + rng() * 0.2);
      addTower(inner.minX + tw / 2 + rng() * (w - tw), inner.minZ + td / 2 + rng() * (d - td), tw, td, 20 + rng() * 34, 'marina');
      addPalm(inner.maxX - 5, inner.maxZ - 5, 0.85, 'street');
    } else if (district === 'commercial') {
      const count = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i += 1) {
        const tw = w * (0.42 + rng() * 0.25), td = d * (0.4 + rng() * 0.25);
        addTower(inner.minX + tw / 2 + rng() * (w - tw), inner.minZ + td / 2 + rng() * (d - td), tw, td, 12 + rng() * 30, 'commercial');
      }
    }
    buildings.push({ x: cx, z: cz, w: bw, d: bd, h: 4, district, style: null, invisible: true });
  }

  function addContainers(x, z, w, d) {
    const b = builder('harbor');
    const colors = [rgb(0xc4563c), rgb(0x2b7f8a), rgb(0xd9a53d), rgb(0x3b6b4c), rgb(0x9a4c6a), rgb(0x4a6e9e)];
    const count = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i += 1) {
      const cx = x + 5 + rng() * (w - 10);
      const cz = z + 5 + rng() * (d - 10);
      const color = choose(colors);
      const levels = 1 + Math.floor(rng() * 3);
      for (let l = 0; l < levels; l += 1) {
        b.box(cx, 1.3 + l * 2.6, cz, 6.1, 2.5, 2.5, color, { omitBottom: true });
        for (let r = 0; r < 4; r += 1) {
          b.box(cx - 2.4 + r * 1.4, 1.3 + l * 2.6, cz + 1.28, 0.18, 2.3, 0.1, shade(color, 0.7), { omitBottom: true });
        }
      }
      collider(cx - 3.2, cx + 3.2, cz - 1.5, cz + 1.5, 'container');
    }
  }

  // -------------------------------------------------------------------------
  // Palms, lamps, props
  // -------------------------------------------------------------------------
  function addPalm(x, z, scale = 1, kind = 'beach', baseY = 0) {
    const b = builder(kind === 'hill' ? 'hills' : 'palm');
    const h = (7 + rng() * 4.5) * scale;
    const lean = (rng() - 0.5) * 2.2 * scale;
    // Palms the camera meets up close (boulevard, beach, hotels, pier) get full detail;
    // backyard and side-street palms use a lighter build of the same silhouette.
    const hero = kind !== 'hill' && kind !== 'street';
    // A gently curved, tapered trunk with a flared root and banded bark rings.
    const trunkPts = [], radii = [];
    const segs = hero ? 8 : 5;
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs;
      trunkPts.push([x + lean * t * t, baseY + h * t - 0.1, z + lean * 0.35 * t]);
      radii.push(scale * (0.3 * (1 - t * 0.32) + 0.2 * Math.max(0, 1 - t * 7) ** 2));
    }
    const bark = PALETTE.trunk, barkDark = shade(PALETTE.trunk, 0.78);
    b.tube(trunkPts, radii, hero ? 7 : 5, bark, { colorAt: (i) => (i % 2 ? barkDark : bark) });
    const crown = trunkPts[segs];
    if (hero) b.ellipsoid(crown[0], crown[1] + 0.05, crown[2], 0.42 * scale, 0.5 * scale, 0.42 * scale, shade(PALETTE.palm, 0.7), { segments: 6, rings: 3 });
    const fronds = 7 + Math.floor(rng() * 3);
    for (let i = 0; i < fronds; i += 1) {
      const angle = (i / fronds) * Math.PI * 2 + rng() * 0.3;
      const length = (4.4 + rng() * 2.2) * scale;
      const lift = 1.4 + rng() * 1.3;
      addFrond(b, crown, angle, length, lift, scale, i % 3 === 0 ? PALETTE.palmLight : PALETTE.palm, hero ? 7 : 4);
    }
    // A younger inner tier: shorter, more upright fronds filling the crown.
    for (let i = 0; hero && i < 3; i += 1) {
      const angle = ((i + 0.5) / 3) * Math.PI * 2 + h * 0.37;
      addFrond(b, crown, angle, (2.6 + (i % 2) * 0.6) * scale, 2.4, scale * 0.8, PALETTE.palmLight, 5);
    }
    // Coconuts.
    for (let i = 0; i < 3; i += 1) {
      const cx = crown[0] + (rng() - 0.5) * 0.8, cz = crown[2] + (rng() - 0.5) * 0.8;
      if (hero) b.sphere(cx, crown[1] - 0.3, cz, 0.24 * scale, rgb(0x5d4a2e), { segments: 4, rings: 3 });
    }
    collider(x - 0.5 * scale, x + 0.5 * scale, z - 0.5 * scale, z + 0.5 * scale, 'palm');
    return crown;
  }

  /** One arching palm frond: a folded, serrated leaf that rises off the crown and droops. */
  function addFrond(b, crown, angle, length, lift, scale, color, K = 7) {
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const sx = -dz, sz = dx;
    const rows = [];
    const rise = lift * 1.7;
    const fall = rise + 1.5 * scale + 0.4;
    for (let k = 0; k <= K; k += 1) {
      const t = k / K;
      const d = length * t;
      const y = crown[1] + 0.15 + rise * t - fall * t * t;
      const w = 0.78 * scale * Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.6 * (k % 2 ? 1 : 0.78);
      const fold = w * 0.42;
      const cx = crown[0] + dx * d, cz = crown[2] + dz * d;
      rows.push([
        [cx - sx * w, y - fold, cz - sz * w],
        [cx, y + 0.04, cz],
        [cx + sx * w, y - fold, cz + sz * w],
      ]);
    }
    const tip = shade(color, 0.72);
    b.surface(rows, {
      s: 1,
      flip: true,
      colorAt: (i, j) => mix3(j ? color : shade(color, 0.88), tip, i / K),
    });
  }

  function addPalmRow(x0, x1, z, gap, scale) {
    for (let x = x0; x < x1; x += gap) addPalm(x + rng() * 2, z + (rng() - 0.5) * 3, scale + rng() * 0.3, 'beach');
  }

  /**
   * A street lamp. It is drawn live by scene.js (not baked into the props mesh) so a car
   * clipping it at speed can knock it over: the pole tilts, falls and goes dark.
   */
  function addLamp(x, z, rot = 0) {
    const armX = Math.cos(rot) * 1.15, armZ = Math.sin(rot) * 1.15;
    glow(x + armX, 4.9, z + armZ, PALETTE.headlight, 4.2, 0.55);
    const lamp = { x, z, rot, glow: glows[glows.length - 1], tilt: 0, spin: 0, fallYaw: 0, knocked: false, landed: false };
    lampposts.push(lamp);
    const c = { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, tag: 'lamp', lamp };
    colliders.push(c);
  }

  function addTrafficLight(x, z, rot) {
    const b = builder('props');
    const dark = rgb(0x2a2c30);
    b.box(x, 3.1, z, 0.28, 6.2, 0.28, dark, { omitBottom: true });
    const arm = 8;
    b.segment([x, 5.9, z], [x - arm, 5.9, z], 0.16, 0.16, dark, {});
    b.box(x - arm + 1, 5.4, z, 2.3, 0.7, 0.5, rgb(0x1d1f22), { omitBottom: true });
    const lights = [[PALETTE.policeRed, 0], [PALETTE.gold, 1], [rgb(0x39d178), 2]];
    for (const [color, i] of lights) {
      b.box(x - arm + 0.35 + i * 0.72, 5.4, z + 0.28, 0.45, 0.45, 0.12, color, { e: i === 2 ? 1 : 0.25, omitBottom: true });
    }
    glow(x - arm + 1, 5.4, z + 0.5, rgb(0x39d178), 2.2, 0.5);
    collider(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 'signal');
  }

  function addBench(x, z, rot) {
    const b = builder('props');
    b.box(x, 0.45, z, 2.4, 0.16, 0.7, rgb(0x8a5a3a), { rotY: rot, omitBottom: true });
    b.box(x, 0.26, z, 2.0, 0.5, 0.3, PALETTE.concreteDark, { rotY: rot, omitBottom: true });
    b.box(x, 0.85, z - 0.35, 2.4, 0.7, 0.12, rgb(0x8a5a3a), { rotY: rot, omitBottom: true });
  }

  function addUmbrella(x, z, color) {
    const b = builder('palm');
    b.box(x, 1.15, z, 0.12, 2.3, 0.12, PALETTE.white, { omitBottom: true });
    b.cylinder(x, 2.1, z, 2.2, 0.08, 0.55, 8, color, { e: 0.05, capBottom: true });
    b.flat(x - 0.5, z + 0.5, 2.2, 1.1, 0.02, choose([rgb(0xf7d4c1), rgb(0x8fd8d0), rgb(0xffe6a8)]));
    collider(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 'umbrella');
  }

  /** A beachfront lifeguard tower: stilts, a pastel cabin with a lit window band, a hip
   *  roof, a deck rail, a ramp down to the sand, a flag and its number in neon. */
  function addLifeguard(x, z, scale) {
    const b = builder('palm');
    const n = lifeguardCount += 1;
    const deck = rgb(0xe6e0cd), cabin = [PALETTE.coral, rgb(0x35c9b8), rgb(0xffd166), rgb(0xb98cf0)][n % 4];
    b.box(x, 1.6, z, 3.4, 0.2, 3.4, deck, { omitBottom: true });
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
      b.box(x + dx, 0.8, z + dz, 0.2, 1.6, 0.2, PALETTE.concrete, { omitBottom: true });
    }
    b.segment([x - 1.3, 0.2, z + 1.3], [x + 1.3, 1.5, z + 1.3], 0.08, 0.08, PALETTE.concrete);
    b.box(x, 2.55, z - 0.2, 2.5, 1.7, 2.2, cabin, { omitBottom: true });
    b.box(x, 2.75, z + 0.92, 2.2, 0.55, 0.05, rgb(0x9fd7e8), { e: 0.55, s: -1, omitBottom: true });
    b.box(x, 3.5, z - 0.2, 2.9, 0.16, 2.7, PALETTE.white, { omitBottom: true });
    b.cylinder(x, 3.58, z - 0.2, 1.9, 0.12, 0.55, 4, rgb(0xffb3a0), { capBottom: true });
    // Deck rail and the ramp to the sand.
    for (const dx of [-1.6, 1.6]) b.box(x + dx, 2.05, z + 0.4, 0.06, 0.06, 2.6, PALETTE.white, { omitBottom: true });
    b.box(x, 2.05, z + 1.65, 3.2, 0.06, 0.06, PALETTE.white, { omitBottom: true });
    const ramp = [];
    for (let k = 0; k <= 1; k += 1) ramp.push([[x - 0.55, 1.6 - k * 1.58, z + 1.7 + k * 3.6], [x + 0.55, 1.6 - k * 1.58, z + 1.7 + k * 3.6]]);
    b.surface(ramp, { color: rgb(0xc9a778) });
    // Flag pole and pennant.
    b.box(x + 1.45, 4.4, z - 1.3, 0.06, 2.0, 0.06, PALETTE.white, { omitBottom: true });
    b.tri([x + 1.45, 5.35, z - 1.3], [x + 2.4, 5.1, z - 1.3], [x + 1.45, 4.85, z - 1.3], rgb(0xff3a3a), { e: 0.15 });
    addNeonText(b, String(n), { x, y: 3.05, z: z + 0.95, height: 0.32, normal: [0, 1], color: PALETTE.white, emit: 0.9, weight: 0.16 });
    glow(x, 2.8, z + 1.2, rgb(0xbfeaff), 2.4, 0.3);
    glow(x, 3.9, z, cabin, 3, 0.25);
    collider(x - 1.7, x + 1.7, z - 1.7, z + 1.7, 'lifeguard');
    void scale;
  }

  function addBeachBar(x, z) {
    const b = builder('palm');
    b.box(x, 1.6, z, 10, 3.2, 6, rgb(0xe7c9a4), { omitBottom: true });
    b.box(x, 3.4, z, 11, 0.5, 7, PALETTE.palm, { omitBottom: true });
    b.box(x, 0.65, z + 4, 9, 0.5, 2.4, rgb(0x9a6b45), { omitBottom: true });
    // Neon signs.
    b.box(x, 4.3, z + 3.6, 4.6, 1.0, 0.28, PALETTE.neonPink, { e: 1, omitBottom: true });
    glow(x, 4.5, z + 3.8, PALETTE.neonPink, 5, 0.7);
    for (let i = 0; i < 3; i += 1) {
      b.box(x - 3 + i * 3, 2.3, z + 3.15, 0.9, 0.9, 0.12, rgb(0xffd98a), { e: 0.7, omitBottom: true });
    }
    addPalm(x - 6, z + 4, 1.1, 'beach');
    collider(x - 5, x + 5, z - 3, z + 3, 'bar');
  }

  function addVolleyball(x, z) {
    const b = builder('palm');
    b.box(x - 4, 1.5, z, 0.16, 3, 0.16, PALETTE.white, { omitBottom: true });
    b.box(x + 4, 1.5, z, 0.16, 3, 0.16, PALETTE.white, { omitBottom: true });
    for (let i = 0; i < 10; i += 1) {
      b.box(x - 4 + i * 0.8, 2.9, z, 0.8, 0.05, 0.05, PALETTE.white, { omitBottom: true });
    }
    b.flat(x, z, 6, 2, 0.02, rgb(0xe8d2a8));
  }

  function addFountain(x, z) {
    const b = builder('props');
    b.cylinder(x, 0.05, z, 4, 4, 0.7, 12, rgb(0xa39a8a), { capTop: true, capBottom: true });
    b.cylinder(x, 0.7, z, 3.5, 3.5, 0.12, 12, rgb(0x3f8f9b), { capTop: true });
    b.cylinder(x, 0.4, z, 0.7, 0.5, 2.2, 8, rgb(0xd4cbb8), { capTop: true });
    glow(x, 2.8, z, rgb(0x6fe6ff), 3.4, 0.35);
    collider(x - 4, x + 4, z - 4, z + 4, 'fountain');
  }

  function addBillboard(x, z, rot, name) {
    const b = builder('props');
    const y = 7.5;
    b.box(x - 2.5, y, z, 0.32, y * 2, 0.32, PALETTE.concreteDark, { omitBottom: true });
    b.box(x + 2.5, y, z, 0.32, y * 2, 0.32, PALETTE.concreteDark, { omitBottom: true });
    const W = 13, H = 7;
    b.box(x, y + 2, z, W, H, 0.5, shade(PALETTE.neonMagenta, 0.24), { rotY: rot, omitBottom: true });
    if (name === 'SUNSET') {
      for (let i = 0; i < 4; i += 1) {
        b.box(x, y - 0.6 + i * 0.85, z - 0.32, 9 - i * 1.2, 0.28, 0.12, i % 2 ? PALETTE.neonPink : PALETTE.neonAmber, { rotY: rot, e: 1, omitBottom: true });
      }
      b.sphere(x, y + 2.1, z - 0.32, 1.5, PALETTE.sunset, { segments: 10, rings: 6, e: 1 });
    } else if (name === 'NEON') {
      for (let i = 0; i < 5; i += 1) {
        b.box(x - 3.4 + i * 1.7, y + 1.0, z - 0.32, 0.8, 3.6, 0.14, i % 2 ? PALETTE.neonCyan : PALETTE.neonPink, { rotY: rot, e: 1, omitBottom: true });
      }
      b.box(x, y + 3.5, z - 0.3, 9, 0.2, 0.12, PALETTE.neonCyan, { rotY: rot, e: 1, omitBottom: true });
    } else {
      for (let i = 0; i < 3; i += 1) {
        b.box(x - 3 + i * 3, y + 3.0, z - 0.32, 2.5, 0.7, 0.14, PALETTE.neonAmber, { rotY: rot, e: 1, omitBottom: true });
      }
      b.box(x, y + 0.6, z - 0.32, 10, 1.2, 0.14, rgb(0x2b8f86), { rotY: rot, e: 0.3, omitBottom: true });
    }
    const slogan = { SUNSET: 'SUNSET FM 96.6', NEON: 'MIDNIGHT DRIVE 88.8', PALMS: 'PALM PULSE 104.2' }[name] ?? name;
    const capH = Math.min(1.25, (W * 0.84) / (measureNeonText(slogan, 1) || 1));
    addNeonText(b, slogan, { x, y: y + 4.6, z: z - 0.42, height: capH, normal: [0, -1], color: PALETTE.white, emit: 0.95, weight: 0.13 });
    glow(x, y + 2.4, z - 0.6, name === 'NEON' ? PALETTE.neonPink : PALETTE.neonCyan, 7, 0.6);
  }

  // -------------------------------------------------------------------------
  // Landmarks: pier, ferris wheel, cranes, ships, marina bridge
  // -------------------------------------------------------------------------
  function buildPier() {
    const b = builder('pier');
    const px = -166;
    for (let z = 302; z < 446; z += 4) {
      b.flat(px, z, 20, 4, 1.1, z % 8 === 0 ? rgb(0x8f623f) : rgb(0x9a6b47));
      // Pilings.
      for (const dx of [-8, 0, 8]) {
        b.box(px + dx, 0.3, z, 0.5, 1.7, 0.5, rgb(0x5b442f), { omitBottom: true });
      }
    }
    // Railings.
    for (let z = 303; z < 446; z += 7) {
      for (const dx of [-9.5, 9.5]) {
        b.box(px + dx, 1.8, z, 0.16, 1.4, 0.16, rgb(0x6b5138), { omitBottom: true });
        b.box(px + dx, 2.35, z + 3.5, 0.1, 0.1, 7, rgb(0x6b5138), { omitBottom: true });
      }
    }
    // Entry arch with neon.
    b.box(px - 10, 5, 306, 0.7, 10, 0.7, rgb(0x6b4a35), { omitBottom: true });
    b.box(px + 10, 5, 306, 0.7, 10, 0.7, rgb(0x6b4a35), { omitBottom: true });
    b.box(px, 10, 306, 21, 1.4, 0.8, PALETTE.neonPink, { e: 1, omitBottom: true });
    glow(px, 10, 308, PALETTE.neonPink, 9, 0.7);
    // Pier shops and stalls: striped awnings, lit counters, thin neon edges.
    const shops = [[-8, 330, 12, 10], [8, 356, 12, 12], [-8, 386, 14, 14], [7, 416, 11, 9]];
    for (const [dx, z, w, d] of shops) {
      const x = px + dx;
      const wall = choose([rgb(0xf0c9a8), rgb(0xd7e6d8), rgb(0xf2b9c8)]);
      b.box(x, 1.1 + 3 / 2, z, w, 3, d, wall, { omitBottom: true });
      // Roof: pale deck with a coral/cream canopy instead of a flat neon slab.
      b.box(x, 4.16, z, w + 1, 0.3, d + 1, rgb(0xd8cdb8), { omitBottom: true });
      for (let i = 0; i < 7; i += 1) {
        b.box(x - w / 2 + (i + 0.5) * (w / 7), 4.38, z + d / 2 + 0.4, w / 7 - 0.08, 0.16, 2.6,
          i % 2 ? PALETTE.white : PALETTE.coral, { e: 0.08, omitBottom: true });
      }
      // Thin neon borders around the roof edge.
      b.box(x, 4.42, z + d / 2 + 0.55, w + 1, 0.12, 0.12, PALETTE.neonCyan, { e: 1, omitBottom: true });
      b.box(x, 4.42, z - d / 2 - 0.55, w + 1, 0.12, 0.12, PALETTE.neonCyan, { e: 0.6, omitBottom: true });
      for (const side of [-1, 1]) b.box(x + side * (w / 2 + 0.55), 4.42, z, 0.12, 0.12, d + 1, PALETTE.neonPink, { e: 0.9, omitBottom: true });
      // Lit shop windows and a warm counter.
      for (let i = 0; i < Math.floor(w / 3); i += 1) {
        b.box(x - w / 2 + 2 + i * 3, 1.9, z + d / 2 + 0.06, 2.2, 1.9, 0.14, rgb(0xffd98a), { e: 0.55, omitBottom: true });
      }
      b.box(x, 3.0, z + d / 2 + 0.1, w * 0.7, 0.4, 0.26, PALETTE.neonAmber, { e: 1, omitBottom: true });
      b.box(x, 3.65, z + d / 2 + 0.12, w * 0.46, 0.22, 0.18, PALETTE.neonPink, { e: 1, omitBottom: true });
      glow(x, 4.5, z + d / 2, PALETTE.neonCyan, 4.0, 0.36);
      glow(x, 3.0, z + d / 2 + 0.6, PALETTE.neonAmber, 3.2, 0.4);
      collider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 'pier');
      addPalm(x + w / 2 + 2, z, 0.75, 'pier');
    }
    addPierDressing(b, px);
    // Ferris wheel at the end.
    addFerrisWheel(px, 432);
    // Landmark signs.
    b.box(px + 18, 8.5, 338, 1.2, 1.2, 1.2, PALETTE.neonPink, { e: 1, omitBottom: true });
    glow(px + 18, 8.5, 338, PALETTE.neonPink, 5, 0.5);
    landmarks.push({ name: 'Coral Pier', x: px, z: 372 });
    // The deck is walkable: only the railings, the far end and the wheel's base block.
    collider(px - 10.4, px - 9.2, 306, 446, 'pier');
    collider(px + 9.2, px + 10.4, 306, 446, 'pier');
    collider(px - 10, px + 10, 444.5, 446.5, 'pier');
    collider(px - 9, px + 9, 430.8, 433.2, 'pier');
  }

  /**
   * Pier dressing that doubles as cover: stacked cargo crates and banded oil drums
   * (solid, with colliders), plus warm festoon bulbs strung along both railings.
   */
  function addPierDressing(b, px) {
    const wood = rgb(0x9a6a3e), woodDark = rgb(0x6e4a2b);
    const crate = (x, z, s, rot, y = 1.1) => {
      b.box(x, y + s / 2, z, s, s, s, wood, { rotY: rot, omitBottom: true });
      for (const t of [0.12, 0.88]) b.box(x, y + s * t, z, s * 1.02, s * 0.1, s * 1.02, woodDark, { rotY: rot, omitBottom: true });
      b.box(x, y + s / 2, z, s * 1.02, s * 0.84, s * 0.1, woodDark, { rotY: rot + Math.PI / 4, omitBottom: true });
    };
    const drum = (x, z, color) => {
      b.tube([[x, 1.1, z], [x, 1.55, z], [x, 2.0, z]], [0.42, 0.44, 0.42], 12, color, { colorAt: (i) => (i ? color : shade(color, 0.7)), s: -0.4 });
      b.ellipsoid(x, 2.0, z, 0.42, 0.05, 0.42, shade(color, 0.8), { segments: 12, rings: 2, top: 0.5 });
      b.tube([[x, 1.5, z], [x, 1.6, z]], [0.455, 0.455], 12, shade(color, 0.55));
    };
    for (const [x, z, s, rot] of [[px + 4.6, 376.5, 1.5, 0.2], [px + 6.1, 377.4, 1.2, -0.3], [px - 4.8, 371, 1.4, 0.5], [px - 2.6, 394.5, 1.4, -0.15], [px + 3, 398, 1.3, 0.35]]) {
      crate(x, z, s, rot);
      collider(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 'cover');
    }
    crate(px + 4.9, 376.6, 1.0, 0.55, 2.6);
    for (const [x, z, c] of [[px + 7.4, 380.2, rgb(0x2f8fbf)], [px + 6.6, 381.3, rgb(0xd6452f)], [px - 6.3, 373.4, rgb(0xe0a83c)], [px - 0.8, 396.4, rgb(0x2f8fbf)]]) {
      drum(x, z, c);
      collider(x - 0.45, x + 0.45, z - 0.45, z + 0.45, 'cover');
    }
    // Festoon bulbs swagged between the railing posts, warm against the sunset.
    for (let z = 310; z < 440; z += 3.5) {
      for (const dx of [-9.5, 9.5]) {
        const sag = Math.sin(((z - 310) / 7) * Math.PI) * 0.35;
        const y = 3.05 - Math.abs(sag);
        const warm = Math.floor(z / 3.5) % 3 === 0 ? PALETTE.neonPink : rgb(0xffd98a);
        b.sphere(px + dx, y, z, 0.13, warm, { segments: 5, rings: 3, e: 1 });
        glow(px + dx, y, z, warm, 1.3, 0.42);
      }
    }
    for (const dx of [-9.5, 9.5]) {
      for (let z = 310; z < 440; z += 35) b.box(px + dx, 2.2, z, 0.14, 2.2, 0.14, rgb(0x5b442f), { omitBottom: true });
    }
  }

  function addFerrisWheel(x, z) {
    const b = builder('pier');
    const cy = 27, r = 19;
    const spokes = 12;
    for (let i = 0; i < spokes; i += 1) {
      const a0 = (i / spokes) * Math.PI * 2;
      const a1 = ((i + 1) / spokes) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, cy + Math.sin(a0) * r, z];
      const p1 = [x + Math.cos(a1) * r, cy + Math.sin(a1) * r, z];
      void p1;
      b.segment([x, cy, z], p0, 0.12, 0.12, rgb(0xc7c1b6), {});
      // Inner ring gives the wheel depth and a second colour band.
      const q0 = [x + Math.cos(a0) * r * 0.62, cy + Math.sin(a0) * r * 0.62, z - 0.9];
      const q1 = [x + Math.cos(a1) * r * 0.62, cy + Math.sin(a1) * r * 0.62, z - 0.9];
      void q1;
      b.segment(p0, q0, 0.1, 0.1, rgb(0xd7d2c7), {});
      if (i % 2 === 0) {
        const cabinColor = choose([rgb(0xf6a24b), rgb(0xf26f8f), rgb(0x54c7c3), rgb(0xf4d06f)]);
        b.box(p0[0], p0[1] - 0.6, z, 2.4, 2.0, 2.6, cabinColor, { omitBottom: true });
        b.box(p0[0], p0[1] + 0.75, z, 2.8, 0.3, 3.0, shade(cabinColor, 0.7), { omitBottom: true });
        b.box(p0[0], p0[1] - 0.4, z + 1.32, 1.6, 0.9, 0.06, PALETTE.glassLight, { e: 0.35, omitBottom: true });
        glow(p0[0], p0[1], z + 1, cabinColor, 2.6, 0.4);
      }
      // Bulbs around the rim every half-spoke.
      const mid = (a0 + a1) / 2;
      b.sphere(x + Math.cos(mid) * r, cy + Math.sin(mid) * r, z + 0.3, 0.42, i % 2 ? rgb(0xfff0b0) : PALETTE.neonPink, { segments: 5, rings: 3, e: 1 });
    }
    // Smooth neon rims: an outer pink/cyan ring and an inner amber/magenta ring.
    const ring = (radius, dz, thick, colA, colB) => {
      const path = [], radii = [];
      for (let k = 0; k <= 72; k += 1) {
        const a = (k / 72) * Math.PI * 2;
        path.push([x + Math.cos(a) * radius, cy + Math.sin(a) * radius, z + dz]);
        radii.push(thick);
      }
      b.tube(path, radii, 6, colA, { colorAt: (k) => (Math.floor(k / 6) % 2 ? colA : colB), e: 1 });
    };
    ring(r, 0, 0.24, PALETTE.neonPink, PALETTE.neonCyan);
    ring(r * 0.62, -0.9, 0.15, PALETTE.neonAmber, PALETTE.neonMagenta);
    // Hub and support legs with cross bracing.
    b.cylinder(x, cy - 1.6, z, 1.5, 1.5, 3.2, 8, PALETTE.concreteDark, { capTop: true });
    b.box(x, cy, z, 3.4, 0.5, 0.5, PALETTE.neonMagenta, { e: 1, omitBottom: true });
    b.segment([x - 8, 1.2, z], [x, cy, z], 0.65, 0.65, PALETTE.concrete, {});
    b.segment([x + 8, 1.2, z], [x, cy, z], 0.65, 0.65, PALETTE.concrete, {});
    b.segment([x - 6, 7, z], [x + 6, 13, z], 0.28, 0.28, PALETTE.concreteDark, {});
    b.segment([x + 6, 7, z], [x - 6, 13, z], 0.28, 0.28, PALETTE.concreteDark, {});
    // Boardwalk bulbs and catch-lights under the wheel.
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      glow(x + Math.cos(a) * r, cy + Math.sin(a) * r, z + 0.4, i % 2 ? PALETTE.neonPink : PALETTE.neonCyan, 2.4, 0.42);
    }
    for (let i = -2; i <= 2; i += 1) glow(x + i * 4, 3.4, z + 4, PALETTE.neonAmber, 2.2, 0.34);
    glow(x, cy, z, PALETTE.neonMagenta, 30, 0.34);
    glow(x, 5, z + 2, PALETTE.neonCyan, 12, 0.25);
  }

  function buildHarbor() {
    const b = builder('harbor');
    // Gantry cranes along the water.
    for (const z of [-320, -190, -40]) addCrane(-416, z);
    // Container ship outside the quay.
    addShip(-500, -120, 0.4);
    addShip(-528, 46, 255);
    // Fuel tanks.
    for (let i = 0; i < 3; i += 1) {
      b.cylinder(-330 + i * 24, 0, -300, 7, 7, 5.5, 12, rgb(0xc9c2b3), { capTop: true });
      b.cylinder(-330 + i * 24, 5.5, -300, 7, 7.6, 0.8, 12, rgb(0xb0a99a), { capTop: true });
      glow(-330 + i * 24, 6.3, -300, PALETTE.neonAmber, 3, 0.2);
    }
    // Warehouse signage skin.
    b.box(-380, 9, -260, 20, 3, 0.5, PALETTE.neonCyan, { e: 0.9, omitBottom: true });
    glow(-380, 9, -258, PALETTE.neonCyan, 6, 0.6);
    landmarks.push({ name: 'Harbor Docks', x: -380, z: -220 });
  }

  function addCrane(x, z) {
    const b = builder('harbor');
    const orange = rgb(0xd96a2c);
    const steel = rgb(0x9b978e);
    const H = 34;
    for (const dz of [-5, 5]) {
      b.segment([x, 0, z + dz], [x, H, z + dz], 1.1, 1.1, orange, {});
      b.segment([x - 7, 0, z + dz], [x + 7, 0, z + dz], 1.2, 1.2, steel, {});
    }
    b.segment([x, H + 2, z - 6], [x, H + 2, z + 16], 1.2, 1.2, orange, {});
    b.segment([x, H + 2, z + 16], [x, H + 10, z + 16], 0.5, 0.5, orange, {});
    b.segment([x, H + 10, z + 16], [x, H + 10, z + 20], 0.4, 0.4, steel, {});
    b.box(x + 2, H - 1, z - 3, 4.5, 3.2, 5, rgb(0x394550), { omitBottom: true });
    b.box(x, H + 2.2, z - 7, 3.2, 2.4, 2.4, rgb(0x394550), { omitBottom: true });
    glow(x, H + 11, z + 19, PALETTE.policeRed, 2.2, 0.8);
    collider(x - 8, x + 8, z - 6, z + 6, 'crane');
  }

  function addShip(x, z, angle) {
    const b = builder('harbor');
    const hull = rgb(0x2c3e4a);
    b.box(x, 2.2, z, 22, 4.4, 92, hull, { rotY: angle, omitBottom: true });
    b.box(x, 5.4, z, 20, 2.4, 88, rgb(0x3b5563), { rotY: angle, omitBottom: true });
    // Bridge tower.
    b.box(x, 9, z - 30, 12, 11, 10, rgb(0xe4e1d8), { rotY: angle, omitBottom: true });
    b.box(x, 15.8, z - 30, 10, 2, 8, PALETTE.glass, { rotY: angle, omitBottom: true });
    // Stacks of containers.
    for (let i = 0; i < 9; i += 1) {
      const cz = z - 20 + (i % 3) * 12;
      const cx = x + (Math.floor(i / 3) - 1) * 6.4;
      b.box(cx, 7.6, cz, 5.6, 2.4, 11, choose([rgb(0xc4563c), rgb(0x2b7f8a), rgb(0xd9a53d)]), { rotY: angle, omitBottom: true });
    }
    glow(x, 16, z, PALETTE.neonAmber, 8, 0.35);
  }

  function buildMarina() {
    const b = builder('marina');
    // Bridge across the channel.
    b.box(534, 1.5, 130, 30, 3.0, 26, rgb(0x9b9b98), { omitBottom: true });
    b.flat(534, 130, 30, 20, 3.06, PALETTE.asphalt);
    for (let x = 522; x <= 546; x += 8) {
      for (const dz of [-14, 14]) {
        b.box(x, 1.5, 130 + dz, 0.7, 3, 0.7, PALETTE.concreteDark, { omitBottom: true });
      }
    }
    for (let x = 522; x < 548; x += 12) {
      b.box(x, 4.0, 117, 0.3, 1.8, 0.3, PALETTE.neonCyan, { e: 1, omitBottom: true });
      b.box(x, 4.0, 143, 0.3, 1.8, 0.3, PALETTE.neonCyan, { e: 1, omitBottom: true });
    }
    glow(534, 4.2, 130, PALETTE.neonCyan, 9, 0.5);
    // Marina island towers.
    addTower(600, 108, 30, 26, 58, 'marina', { style: BUILDING_STYLES.marina[0] });
    addTower(668, 92, 26, 22, 42, 'marina', { style: BUILDING_STYLES.marina[1] });
    addTower(722, 190, 30, 28, 50, 'marina', { style: BUILDING_STYLES.marina[0] });
    addTower(640, 246, 24, 20, 30, 'marina', { style: BUILDING_STYLES.marina[1] });
    addTower(720, 270, 22, 18, 22, 'marina', { style: BUILDING_STYLES.marina[0] });
    // Dock fingers with yachts.
    for (let i = 0; i < 4; i += 1) {
      const z = 150 + i * 26;
      b.flat(760, z, 26, 3.4, 0.4, rgb(0x9b7a57));
      for (let d = 0; d < 12; d += 1) b.box(752 + d * 1.5, 0.7, z, 0.16, 0.7, 0.16, rgb(0x6b5138), { omitBottom: true });
      addYacht(772, z + 7, i % 2 === 0 ? 0 : Math.PI);
      addPalm(752, z - 6, 0.75, 'marina');
    }
    // Boardwalk and rails around the island.
    b.flat(654, 296, 212, 8, 0.32, rgb(0x8f6a46));
    // Marina sign.
    b.box(566, 9, 148, 0.8, 18, 0.8, PALETTE.concreteDark, { omitBottom: true });
    b.box(576, 16, 148, 20, 3.2, 0.5, PALETTE.neonCyan, { e: 1, omitBottom: true });
    glow(576, 16, 149, PALETTE.neonCyan, 9, 0.6);
    landmarks.push({ name: 'Marina Causeway', x: 640, z: 200 });
  }

  /** A sleek motor yacht: raked white hull, two stepped decks with dark glass bands. */
  function addYacht(x, z, rot) {
    const b = builder('marina');
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const deckBox = (lz, y, w, h, l, color, opts = {}) => {
      const [px, pz] = at(0, lz);
      b.box(px, y, pz, w, h, l, color, { rotY: -rot, omitBottom: true, ...opts });
    };
    const hullPts = [[0, 8.2], [1.5, 4.5], [2.0, 0], [1.95, -5.6], [-1.95, -5.6], [-2.0, 0], [-1.5, 4.5]];
    const y0 = CITY.oceanY - 0.2, y1 = CITY.oceanY + 1.7;
    for (let i = 0; i < hullPts.length; i += 1) {
      const a = hullPts[i], q = hullPts[(i + 1) % hullPts.length];
      const [ax, az] = at(a[0] * 0.85, a[1] * 0.9), [bx, bz] = at(q[0] * 0.85, q[1] * 0.9);
      const [cx, cz] = at(q[0], q[1]), [dx, dz] = at(a[0], a[1]);
      b.quad([ax, y0, az], [bx, y0, bz], [cx, y1, cz], [dx, y1, dz], PALETTE.white, { s: -0.6 });
    }
    for (let i = 1; i < hullPts.length - 1; i += 1) {
      const [ax, az] = at(...hullPts[0]), [bx, bz] = at(...hullPts[i]), [cx, cz] = at(...hullPts[i + 1]);
      b.tri([ax, y1, az], [bx, y1, bz], [cx, y1, cz], rgb(0xc9a77a), { n: [0, 1, 0] });
    }
    deckBox(-1.2, y1 + 0.7, 3.4, 1.4, 7.6, PALETTE.white, { s: -0.5 });
    deckBox(-1.0, y1 + 0.75, 3.46, 0.55, 7.0, PALETTE.glass, { s: -1 });
    deckBox(-1.8, y1 + 1.85, 2.7, 0.9, 4.6, rgb(0xf3f0ea), { s: -0.5 });
    deckBox(-1.6, y1 + 1.9, 2.76, 0.36, 4.0, PALETTE.glass, { s: -1 });
    deckBox(-2.2, y1 + 2.6, 0.18, 1.6, 0.18, PALETTE.white);
    const [gx, gz] = at(0, -2.2);
    glow(gx, y1 + 3.5, gz, PALETTE.headlight, 1.6, 0.45);
    const [hx, hz] = at(0, -1.0);
    glow(hx, y1 + 0.8, hz, PALETTE.neonCyan, 3.2, 0.25);
  }

  function buildLandmarks() {
    // Solaris Vault — the tallest tower in the city.
    const vault = addTower(65, -65, 42, 42, 136, 'midtown', {
      style: BUILDING_STYLES.midtown[1], neon: PALETTE.neonMagenta,
    });
    landmarks.push({ name: 'Solaris Vault', x: 65, z: -65, vault: true });
    // A gold crown and a huge halo.
    const b = builder('midtown');
    b.cylinder(65, 132, -65, 3.2, 0.2, 16, 8, PALETTE.gold, { e: 1, capTop: true });
    glow(65, 148, -65, PALETTE.gold, 16, 0.75);
    addVaultPlaza();
    // The Grand Palms hotel.
    addArtDecoHotel(-118, 202, 46, 30, rgb(0xf7cdb0), PALETTE.neonPink, 'MIRAMAR');
    // Safehouse garage.
    addSafehouse();
    // Hills backdrop: layered ridges behind the houses.
    const h = builder('hills');
    for (let i = 0; i < 9; i += 1) {
      const x = -370 + i * 92 + rng() * 30;
      const z = -500 - rng() * 40;
      h.sphere(x, -4, z, 60 + rng() * 34, mix3(rgb(0x3c5a3a), rgb(0x54714a), rng()), { segments: 10, rings: 5 });
      if (i % 2 === 0) addPalm(x + 20, -455 + rng() * 18, 1.4, 'hill', 12);
    }
    // Radio mast on the hills.
    const mast = builder('hills');
    mast.segment([0, 10, -430], [0, 58, -430], 0.5, 0.5, rgb(0x9ca3a8), {});
    mast.box(0, 40, -430, 5, 0.4, 0.4, rgb(0x9ca3a8), {});
    glow(0, 58, -430, PALETTE.policeRed, 2.5, 0.9);
    landmarks.push({ name: 'Casa Hills', x: 60, z: -395 });
    // Parked cars and mission vehicles.
    const parking = [
      [-124, 286, Math.PI / 2, 'coupe'],
      [86, 281, Math.PI / 2, 'muscle'],
      [-240, 281, Math.PI / 2, 'sedan'],
      [206, 286, Math.PI / 2, 'supercar'],
      [-166, 314, Math.PI / 2, 'coupe'],
      [-70, 330, 0.4, 'van'],
      [352, 270, Math.PI, 'taxi'],
      [12, 128, 0, 'sedan'],
      [-386, 44, Math.PI / 2, 'muscle'],
      [-396, -150, 0, 'van'],
      [610, 234, Math.PI / 2, 'supercar'],
      [676, 166, Math.PI, 'coupe'],
      [SAFEHOUSE.x + 8, SAFEHOUSE.z + 12, 0, 'muscle'],
      [-44, 84, Math.PI, 'taxi'],
    ];
    for (const [x, z, heading, type] of parking) parked.push({ x, z, heading, type });
    // Sun-token collectibles around the districts.
    const tokenSpots = [
      [-166, 344], [-166, 432], [118, 312], [-90, 320], [65, -20], [-330, -300],
      [640, 200], [600, 130], [-70, 330], [352, 290], [0, -430], [436, 200],
    ];
    for (const [x, z] of tokenSpots) tokens.push({ x, z, y: 1.3, taken: false, phase: rng() * Math.PI * 2 });
    // Health/armour pickups.
    pickups.push({ x: SAFEHOUSE.x + 14, z: SAFEHOUSE.z + 4, type: 'health', taken: false, respawn: 0 });
    pickups.push({ x: -160, z: 320, type: 'armor', taken: false, respawn: 0 });
    pickups.push({ x: 350, z: 260, type: 'health', taken: false, respawn: 0 });
    pickups.push({ x: -380, z: -40, type: 'armor', taken: false, respawn: 0 });
    pickups.push({ x: 660, z: 250, type: 'health', taken: false, respawn: 0 });
    // Stunt ramps.
    props.push({ type: 'ramp', x: -260, z: 285, w: 14, d: 30, h: 3.2, rot: 0 });
    props.push({ type: 'ramp', x: 320, z: -18, w: 14, d: 30, h: 3.2, rot: Math.PI });
    props.push({ type: 'ramp', x: -350, z: 120, w: 14, d: 28, h: 2.8, rot: Math.PI / 2 });
    for (const r of props) addRamp(r);
  }

  /**
   * The Solaris Vault Bank Plaza: an Art Deco colonnade in front of the tower's podium,
   * the gold SOLARIS VAULT marquee over glowing lobby glass, inlaid stone paving, security
   * bollards, striped barricades and the bank's loot cases on the steps.
   */
  function addVaultPlaza() {
    const b = builder('midtown');
    const cx = 65, front = -42;
    const stone = rgb(0xe9dccb), stoneDark = rgb(0xb9a893), bronze = rgb(0x8a6a3c);
    // Paving: pale stone with gold inlay bands radiating from the doors.
    b.flat(cx, -27, 52, 30, 0.075, rgb(0xcbbca8));
    for (let i = -3; i <= 3; i += 1) b.flat(cx + i * 7, -27, 0.28, 30, 0.08, PALETTE.gold, { e: 0.35 });
    for (const z of [-16, -24, -32]) b.flat(cx, z, 52, 0.24, 0.08, mix3(PALETTE.gold, stone, 0.4), { e: 0.2 });
    // Three broad steps up to the portico.
    for (let s = 0; s < 3; s += 1) b.box(cx, 0.14 + s * 0.14, front + 5.2 - s * 1.3, 38 - s * 1.2, 0.28 + s * 0.28, 2.6 + s * 0.2, s % 2 ? stone : stoneDark, { omitBottom: true });
    // Glowing lobby glass with bronze mullions behind the columns.
    b.box(cx, 3.4, front + 0.25, 22, 6.6, 0.3, rgb(0xffd79a), { e: 0.75, omitBottom: true });
    for (let i = -5; i <= 5; i += 1) b.box(cx + i * 2.2, 3.4, front + 0.45, 0.16, 6.6, 0.16, bronze, { omitBottom: true, s: -0.5 });
    b.box(cx, 6.85, front + 0.45, 22.4, 0.3, 0.3, bronze, { omitBottom: true, s: -0.5 });
    for (let i = -2; i <= 2; i += 1) glow(cx + i * 4.5, 3.2, front + 1.2, rgb(0xffcf86), 4.2, 0.32);
    // The colonnade: fluted columns with gold capitals and bases.
    const colZ = front + 3.6;
    for (let i = 0; i < 8; i += 1) {
      const x = cx - 15.75 + i * 4.5;
      b.cylinder(x, 0.84, colZ, 0.95, 0.95, 0.5, 12, stoneDark, {});
      b.cylinder(x, 1.34, colZ, 0.72, 0.62, 8.6, 14, stone, { capTop: false });
      b.cylinder(x, 9.94, colZ, 0.7, 1.05, 0.5, 12, PALETTE.gold, { s: -0.6 });
      collider(x - 0.8, x + 0.8, colZ - 0.8, colZ + 0.8, 'prop');
    }
    // Entablature, stepped Deco crown and the neon marquee.
    b.box(cx, 11.4, colZ - 0.4, 37, 2.4, 5.4, stone, { omitBottom: true });
    b.box(cx, 12.75, colZ - 0.8, 33, 0.3, 4.6, PALETTE.gold, { omitBottom: true, e: 0.4 });
    b.box(cx, 13.8, colZ - 1.2, 26, 1.8, 3.6, stone, { omitBottom: true });
    b.box(cx, 15.4, colZ - 1.6, 14, 1.4, 2.8, stone, { omitBottom: true });
    b.box(cx, 16.9, colZ - 1.8, 5, 1.6, 2.2, PALETTE.gold, { e: 0.6, omitBottom: true });
    glow(cx, 17.2, colZ, PALETTE.gold, 6, 0.5);
    for (const side of [-1, 1]) {
      // Fluted pylons with vertical cyan neon fins either side of the portico.
      const px = cx + side * 20.5;
      b.box(px, 8.5, colZ - 0.5, 3.2, 17, 4.2, stone, { omitBottom: true });
      for (const f of [-0.9, 0, 0.9]) b.box(px + f, 8.5, colZ + 1.65, 0.16, 15, 0.16, PALETTE.neonCyan, { e: 1, omitBottom: true });
      glow(px, 9, colZ + 2.4, PALETTE.neonCyan, 7, 0.35);
    }
    addNeonText(b, 'SOLARIS VAULT', {
      x: cx, y: 10.55, z: colZ + 2.42, height: 1.5, normal: [0, 1], color: PALETTE.gold,
      weight: 0.14, board: rgb(0x1b1520), boardPad: 0.32, glow, glowAlpha: 0.55,
    });
    addNeonText(b, 'EST 1931', { x: cx, y: 13.9, z: colZ + 0.62, height: 0.7, normal: [0, 1], color: PALETTE.neonPink, weight: 0.13 });
    // Uplights washing the columns gold.
    for (let i = 0; i < 8; i += 1) glow(cx - 15.75 + i * 4.5, 1.2, colZ + 1.1, PALETTE.neonAmber, 2.4, 0.45);
    // Security bollards along the kerb with lit caps.
    for (let x = cx - 24; x <= cx + 24; x += 3) {
      if (Math.abs(x - cx) < 4) continue;
      b.cylinder(x, 0.08, -13.4, 0.24, 0.22, 0.95, 10, rgb(0x4a4c55), { s: -0.4 });
      b.cylinder(x, 1.03, -13.4, 0.23, 0.18, 0.12, 10, PALETTE.gold, { e: 0.9 });
    }
    // Striped tactical barricades angled across the plaza.
    const stripe = [PALETTE.white, PALETTE.policeRed];
    for (const [x, z, rot] of [[55, -19.5, 0.25], [73, -24.5, -0.2], [62, -34, 0.1], [83, -15.5, -0.35]]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      for (let k = 0; k < 6; k += 1) {
        const u = (k - 2.5) * 0.62;
        b.box(x + u * c, 0.82, z - u * s, 0.62, 0.32, 0.16, stripe[k % 2], { rotY: rot, omitBottom: true, e: 0.08 });
      }
      for (const u of [-1.7, 1.7]) {
        b.box(x + u * c, 0.45, z - u * s, 0.12, 0.9, 0.12, rgb(0x2a2c33), { omitBottom: true });
        b.box(x + u * c, 0.06, z - u * s, 0.16, 0.12, 0.9, rgb(0x2a2c33), { rotY: rot, omitBottom: true });
      }
      glow(x + 1.8 * c, 1.08, z - 1.8 * s, PALETTE.neonAmber, 0.5, 0.8);
    }
    // Gold loot: bullion crates and briefcases stacked on the steps by the armoured van.
    for (const [x, z, w, h, d] of [[78.5, -36.2, 1.3, 0.75, 0.9], [80.1, -36.0, 1.2, 0.6, 0.9], [79.2, -36.1, 1.0, 0.55, 0.8]]) {
      const y = 0.84 + (x === 79.2 ? 0.75 : 0);
      b.box(x, y + h / 2, z, w, h, d, rgb(0x5a3c1e), { omitBottom: true });
      b.box(x, y + h + 0.03, z, w * 0.86, 0.06, d * 0.8, PALETTE.gold, { e: 0.9, omitBottom: true });
    }
    for (const [x, z] of [[49.5, -35.5], [51, -35.7]]) {
      b.box(x, 1.08, z, 0.9, 0.48, 0.22, rgb(0x1f1c22), { omitBottom: true, s: -0.6 });
      b.box(x, 1.36, z, 0.3, 0.06, 0.06, PALETTE.gold, { e: 0.8, omitBottom: true });
    }
    glow(79.2, 2.0, -35.6, PALETTE.gold, 2.6, 0.6);
    glow(50.2, 1.4, -35.2, PALETTE.gold, 1.4, 0.45);
    // Clipped planters flanking the steps.
    for (const x of [cx - 23, cx + 23]) {
      b.box(x, 0.5, -31, 3, 1, 3, stoneDark, { omitBottom: true });
      b.ellipsoid(x, 1.7, -31, 1.4, 0.9, 1.4, PALETTE.palm, { segments: 8, rings: 4 });
      b.ellipsoid(x + 0.4, 2.3, -31.3, 0.8, 0.7, 0.8, PALETTE.palmLight, { segments: 7, rings: 4 });
      glow(x, 1.2, -29.3, PALETTE.neonAmber, 1.6, 0.4);
    }
    landmarks.push({ name: 'Solaris Vault Plaza', x: cx, z: -27 });
  }

  function addSafehouse() {
    const b = builder('commercial');
    const x = SAFEHOUSE.x, z = SAFEHOUSE.z;
    b.box(x, 4, z, 26, 8, 20, rgb(0x5f6c74), { omitBottom: true });
    b.box(x, 8.4, z, 27, 0.8, 21, rgb(0x4a555c), { omitBottom: true });
    // Roll-up garage door with neon trim.
    b.box(x, 2.6, z + 10.1, 9.5, 5.2, 0.3, rgb(0x35414a), { omitBottom: true });
    for (let i = 0; i < 7; i += 1) b.box(x, 0.4 + i * 0.7, z + 10.25, 9.5, 0.1, 0.2, rgb(0x6c7a80), { omitBottom: true });
    b.box(x, 5.4, z + 10.3, 10.4, 0.3, 0.3, PALETTE.neonCyan, { e: 1, omitBottom: true });
    b.box(x, 8.8, z + 10.4, 8, 1.2, 0.4, PALETTE.neonPink, { e: 1, omitBottom: true });
    glow(x, 8.8, z + 11, PALETTE.neonPink, 6, 0.6);
    glow(x, 5.4, z + 11, PALETTE.neonCyan, 4, 0.4);
    collider(x - 13, x + 13, z - 10, z + 10, 'safehouse');
    landmarks.push({ name: 'Safehouse', x: x + 4, z: z + 14 });
  }

  function addRamp(r) {
    const b = builder('props');
    const { x, z, w, d, h, rot } = r;
    // Wedge: a raised lip on one end.
    const y0 = 0.06;
    if (Math.abs(rot) < 0.01) {
      b.quad(V(x - w / 2, y0, z - d / 2), V(x + w / 2, y0, z - d / 2), V(x + w / 2, h, z + d / 2), V(x - w / 2, h, z + d / 2), PALETTE.gold, { n: [0, 0.8, -0.6] });
      b.quad(V(x - w / 2, y0, z + d / 2), V(x + w / 2, y0, z + d / 2), V(x + w / 2, h, z + d / 2), V(x - w / 2, h, z + d / 2), PALETTE.concreteDark, { n: [0, 0, 1] });
      b.tri(V(x - w / 2, y0, z - d / 2), V(x - w / 2, y0, z + d / 2), V(x - w / 2, h, z + d / 2), rgb(0x4b4a46), { n: [-1, 0, 0] });
      b.tri(V(x + w / 2, y0, z + d / 2), V(x + w / 2, y0, z - d / 2), V(x + w / 2, h, z + d / 2), rgb(0x4b4a46), { n: [1, 0, 0] });
    } else {
      b.quad(V(x - w / 2, y0, z - d / 2), V(x - w / 2, y0, z + d / 2), V(x + w / 2, h, z + d / 2), V(x + w / 2, h, z - d / 2), PALETTE.gold, { n: [0.7, 0.7, 0] });
      b.quad(V(x + w / 2, y0, z - d / 2), V(x + w / 2, y0, z + d / 2), V(x + w / 2, h, z + d / 2), V(x + w / 2, h, z - d / 2), PALETTE.concreteDark, { n: [1, 0, 0] });
    }
    for (let i = 0; i < 5; i += 1) {
      const t = i / 5;
      b.box(x, 0.25 + t * h + 0.2, z - d / 2 + t * d, w * 0.9, 0.18, 1.2, i % 2 ? PALETTE.white : PALETTE.coral, { omitBottom: true });
    }
    glow(x, 2, z, PALETTE.gold, 4, 0.28);
    collider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 'ramp');
  }

  /** A moored sailboat off the beach: tapered hull, cabin, mast, mainsail and jib. */
  function addSailboat(x, z, rot, scale, sail) {
    const b = builder('marina');
    const y = CITY.oceanY + 0.15;
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, ly, lz) => [x + (lx * c + lz * s) * scale, y + ly * scale, z + (-lx * s + lz * c) * scale];
    const hull = PALETTE.white, deck = rgb(0xc9a77a);
    const L = 5.2, W = 1.25;
    const ring = [[0, L], [W * 0.75, L * 0.45], [W, -L * 0.25], [W * 0.8, -L * 0.62], [-W * 0.8, -L * 0.62], [-W, -L * 0.25], [-W * 0.75, L * 0.45]];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i], bq = ring[(i + 1) % ring.length];
      b.quad(P(a[0] * 0.82, -0.25, a[1] * 0.92), P(bq[0] * 0.82, -0.25, bq[1] * 0.92), P(bq[0], 0.75, bq[1]), P(a[0], 0.75, a[1]), hull);
    }
    for (let i = 1; i < ring.length - 1; i += 1) b.tri(P(ring[0][0], 0.76, ring[0][1]), P(ring[i][0], 0.76, ring[i][1]), P(ring[i + 1][0], 0.76, ring[i + 1][1]), deck, { n: [0, 1, 0] });
    b.box(...P(0, 1.15, -1.0), 1.5 * scale, 0.8 * scale, 2.4 * scale, PALETTE.white, { rotY: rot, omitBottom: true });
    b.box(...P(0, 1.2, -0.2), 1.3 * scale, 0.32 * scale, 0.1 * scale, PALETTE.glass, { rotY: rot, omitBottom: true });
    b.segment(P(0, 0.75, 0.6), P(0, 10.5, 0.6), 0.14 * scale, 0.14 * scale, rgb(0xe8e4dc));
    b.segment(P(0, 1.9, 0.6), P(0, 1.9, -3.6), 0.1 * scale, 0.1 * scale, rgb(0xd8d2c6));
    b.tri(P(0.02, 10.2, 0.6), P(0.02, 2.0, 0.6), P(0.02, 2.0, -3.5), sail, { n: [c, 0, -s] });
    b.tri(P(-0.02, 10.2, 0.6), P(-0.02, 2.0, -3.5), P(-0.02, 2.0, 0.6), shade(sail, 0.9), { n: [-c, 0, s] });
    b.tri(P(0, 9.6, 0.75), P(0, 1.2, 4.9), P(0, 1.2, 0.85), mix3(sail, PALETTE.white, 0.5));
    glow(...P(0, 10.6, 0.6), PALETTE.policeRed, 0.9, 0.5);
  }

  function buildBayBoats() {
    const sails = [PALETTE.white, rgb(0xffe2c4), rgb(0xff8f7a), rgb(0x7fe0d6), PALETTE.white, rgb(0xffd166)];
    const spots = [
      [-392, 372, 0.4, 1.0], [-318, 418, 2.2, 1.2], [-250, 366, 1.1, 0.9], [-96, 388, 2.8, 1.1],
      [-40, 452, 0.9, 1.3], [12, 372, 1.8, 1.0], [74, 410, 0.2, 1.15], [138, 380, 2.5, 0.95],
      [206, 446, 1.4, 1.25], [262, 372, 0.7, 1.0], [330, 404, 2.0, 1.1], [402, 378, 1.2, 0.9],
      [452, 452, 2.6, 1.2], [-200, 470, 1.6, 1.35],
    ];
    spots.forEach(([x, z, r, sc], i) => addSailboat(x, z, r, sc, sails[i % sails.length]));
    // Two motor yachts riding at anchor off the Strip.
    addYacht(-20, 404, 1.3);
    addYacht(300, 430, 2.1);
  }

  // -------------------------------------------------------------------------
  // Assemble the city
  // -------------------------------------------------------------------------
  buildGround();
  buildRoads();
  buildStreetDetail();
  buildPier();
  buildHarbor();
  buildMarina();
  buildBayBoats();
  buildLandmarks();

  // Trees on the hills and extra greenery.
  for (let i = 0; i < 26; i += 1) {
    const x = -420 + rng() * 900;
    const z = -330 - rng() * 130;
    addPalm(x, z, 0.7 + rng() * 0.7, 'hill', 1 + rng() * 8);
  }

  // Convert builders to GPU meshes.
  const meshes = [];
  for (const [key, b] of batches) {
    if (b.length === 0) continue;
    const geometry = b.geometry();
    meshes.push({ key, mesh: renderer.createMesh(geometry, key), count: geometry.count });
  }

  const map = {
    roads,
    beach: { x: -470, z: CITY.beachStart, w: 990, d: 34 },
    ocean: { south: 336, west: -440, east: 520 },
    island: { x: 654, z: 185, w: 212, d: 230 },
    pier: { x: -166, z: 374, w: 20, d: 140 },
    districts: DISTRICTS,
    landmarks,
    buildings: buildings.filter((x) => x.h > 12 && !x.invisible),
  };

  function groundHeight(x, z) {
    // Boardwalk
    if (x > -440 && x < 520 && z > 288 && z < 302) return 0.39;
    // Pier deck
    if (x > -178 && x < -154 && z > 302 && z < 446) return 1.1;
    // Marina island boardwalk
    if (x > 548 && x < 760 && z > 292 && z < 300) return 0.32;
    // Beach slope
    if (x > -470 && x < 520 && z >= 302) {
      if (z <= 336) return -0.02 - ((z - 302) / 34) * 0.62;
    }
    return 0;
  }

  function isWater(x, z) {
    if (z > 336) return true;
    if (x < -440 && z < 160) return true;
    if (x > 520 && (z < 60 || z > 300) && !(x > 548 && x < 760 && z >= 70 && z <= 300)) return true;
    if (x > 520 && x < 548 && z > 60 && z < 130 - 11) return true;
    if (x > 520 && x < 548 && z > 130 + 11) return true;
    return false;
  }

  function collideCircle(x, z, radius) {
    for (const c of colliders) {
      if (c.tag === 'ramp') continue;
      if (c.lamp && c.lamp.knocked) continue;
      const nx = Math.max(c.minX, Math.min(x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const dx = x - nx, dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = radius - d;
        return { x: x + (dx / d) * push, z: z + (dz / d) * push, hit: true, nx: dx / d, nz: dz / d };
      }
    }
    return { x, z, hit: false, nx: 0, nz: 0 };
  }

  function insideBuilding(x, z) {
    for (const c of colliders) {
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return c;
    }
    return null;
  }

  function districtName(x, z) {
    if (z > 302) return 'Coral Beach';
    const d = districtAt(x, z);
    const found = DISTRICTS.find((item) => item.id === d || (d === 'commercial' && item.id === 'midtown'));
    return found ? found.name : 'Solaris Bay';
  }

  function nearestRoad(x, z) {
    let best = null, bestD = Infinity;
    for (const r of roads) {
      const dx = r.x2 - r.x1, dz = r.z2 - r.z1;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - r.x1) * dx + (z - r.z1) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = r.x1 + dx * t, pz = r.z1 + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) { bestD = d; best = { ...r, px, pz, t, distance: d }; }
    }
    return best;
  }

  function randomRoadPoint(centerX, centerZ, minDist, maxDist, random = rng) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const r = roads[Math.floor(random() * roads.length)];
      const t = random();
      const x = r.x1 + (r.x2 - r.x1) * t;
      const z = r.z1 + (r.z2 - r.z1) * t;
      const d = Math.hypot(x - centerX, z - centerZ);
      if (d > minDist && d < maxDist) return { x, z, axis: r.axis, road: r };
    }
    return { x: centerX + minDist, z: centerZ, axis: 'x', road: roads[0] };
  }

  return {
    meshes: meshes.map((m) => m.mesh),
    meshInfo: meshes,
    colliders,
    buildings,
    roads,
    glows,
    parked,
    tokens,
    pickups,
    props,
    hydrants,
    lampposts,
    map,
    landmarks,
    safehouse: SAFEHOUSE,
    spawn: CITY.spawn,
    groundHeight,
    isWater,
    collideCircle,
    insideBuilding,
    districtName,
    districtAt,
    nearestRoad,
    randomRoadPoint,
    bounds: { minX: -470, maxX: 780, minZ: -520, maxZ: 470 },
  };
}
