// Solaris Bay v10 module: minimap (vector road-graph GPS & turf overlay).
// minimap.js — the vector map painter behind the HUD minimap and the M / Tab city map.
//
// The static city (sea, organic shoreline, beach, Starlight Key, pier, building footprints
// and the road grid) is rasterised once into an offscreen base canvas at 2 px per metre.
// District standing is a second, low-resolution layer rebuilt only when standing changes,
// so the HUD frame is two scaled blits plus a handful of live overlays: the GPS route along
// the real road graph, SBPD cruisers with vision cones, the Air One searchlight, roadblock
// flares, activity starts, the safehouse pin and the player chevron.
//
// Coordinates are world metres: +X east, -Z north. Both maps are north-up, so a world point
// maps to the canvas with a plain scale and offset. Vehicles face (sin heading, cos heading).

import { DISTRICTS, SAFEHOUSE, CITY } from './config.js';
import { TURF, tierFor, turfIdAt } from './turf.js';

const RES = 2; // base canvas pixels per metre
const TURF_CELL = 5; // metres per turf-layer pixel
const FONT = '"Arial Black", "Helvetica Neue", "DejaVu Sans", sans-serif';
const UI_FONT = '"Helvetica Neue", "DejaVu Sans", Arial, sans-serif';

const INK = {
  deepSea: '#07263a',
  sea: '#0d4560',
  shallow: '#1a6f86',
  land: '#222c37',
  hills: '#25362b',
  sand: '#b89d6b',
  surf: 'rgba(220, 248, 255, 0.55)',
  sidewalk: '#38434f',
  road: '#5f6976',
  mainRoad: '#77818e',
  bridge: '#6f93a8',
  lane: 'rgba(255, 226, 150, 0.75)',
  pier: '#7b5d43',
  gps: '#ffc24b',
  gpsActivity: '#39f0ff',
  safehouse: '#5ee08a',
  police: '#ff2a3d',
  policeBlue: '#2f6bff',
};

/** Shoreline wobble so the beach edge reads as a coast rather than a ruler line. */
/** Trim a long objective to fit beside its pin. */
function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function shoreZ(x) {
  return CITY.waterStart + 2.6 * Math.sin(x * 0.043) + 1.7 * Math.sin(x * 0.117 + 1.3) + 0.9 * Math.sin(x * 0.31);
}

export function createMapPainter(world) {
  const map = world.map ?? {};
  const roads = map.roads ?? world.roads ?? [];
  const B = world.bounds ?? { minX: -470, maxX: 780, minZ: -520, maxZ: 470 };
  const spanX = B.maxX - B.minX;
  const spanZ = B.maxZ - B.minZ;

  let base = null;
  let turfLayer = null;
  let turfKey = '';
  const graph = buildRoadGraph(roads);
  const routeCache = { key: '', path: [] };
  const mini = { zoom: 1.8, cx: null, cz: null };

  // ------------------------------------------------------------------ base raster
  function buildBase() {
    const c = document.createElement('canvas');
    c.width = Math.ceil(spanX * RES);
    c.height = Math.ceil(spanZ * RES);
    const g = c.getContext('2d');
    g.setTransform(RES, 0, 0, RES, -B.minX * RES, -B.minZ * RES);

    // Open sea, darkening toward the horizon in the south.
    const sea = g.createLinearGradient(0, B.minZ, 0, B.maxZ);
    sea.addColorStop(0, INK.sea);
    sea.addColorStop(0.62, INK.sea);
    sea.addColorStop(1, INK.deepSea);
    g.fillStyle = sea;
    g.fillRect(B.minX, B.minZ, spanX, spanZ);

    // Mainland with an organic south shore; the harbour inlet bites the north-west corner.
    const land = new Path2D();
    land.moveTo(-440, B.minZ);
    land.lineTo(CITY.marinaX + 8, B.minZ);
    land.lineTo(CITY.marinaX + 8, CITY.waterStart);
    for (let x = CITY.marinaX + 8; x >= -470; x -= 6) land.lineTo(x, shoreZ(x));
    land.lineTo(-470, 160);
    land.quadraticCurveTo(-452, 158, -440, 148);
    land.closePath();

    // Shallow-water halo hugging every coast.
    g.save();
    g.strokeStyle = INK.shallow;
    g.globalAlpha = 0.55;
    g.lineWidth = 22;
    g.lineJoin = 'round';
    g.stroke(land);
    g.globalAlpha = 0.3;
    g.lineWidth = 44;
    g.stroke(land);
    g.restore();

    g.fillStyle = INK.land;
    g.fill(land);

    // Casa Hills: a greener band climbing to the north edge.
    const hills = g.createLinearGradient(0, CITY.hills.z + 40, 0, B.minZ);
    hills.addColorStop(0, 'rgba(37, 54, 43, 0)');
    hills.addColorStop(0.4, INK.hills);
    hills.addColorStop(1, '#2c4231');
    g.save();
    g.clip(land);
    g.fillStyle = hills;
    g.fillRect(B.minX, B.minZ, spanX, CITY.hills.z + 40 - B.minZ);

    // Beach: dry sand down to the wet edge, then a bright surf line.
    const sand = g.createLinearGradient(0, CITY.beachStart, 0, CITY.waterStart);
    sand.addColorStop(0, '#cbb07a');
    sand.addColorStop(1, '#8f7853');
    g.fillStyle = sand;
    g.fillRect(-470, CITY.beachStart, CITY.marinaX + 478, CITY.waterStart - CITY.beachStart + 6);
    g.restore();
    g.beginPath();
    for (let x = -470; x <= CITY.marinaX + 8; x += 6) g.lineTo(x, shoreZ(x) - 0.6);
    g.strokeStyle = INK.surf;
    g.lineWidth = 1.6;
    g.stroke();

    // Starlight Key and the pier.
    const isl = CITY.island;
    const key = new Path2D();
    key.roundRect(isl.minX, isl.minZ, isl.maxX - isl.minX, isl.maxZ - isl.minZ, 26);
    g.save();
    g.strokeStyle = INK.shallow;
    g.globalAlpha = 0.5;
    g.lineWidth = 26;
    g.stroke(key);
    g.restore();
    g.fillStyle = '#c3a874';
    g.fill(key);
    g.fillStyle = INK.land;
    g.beginPath();
    g.roundRect(isl.minX + 8, isl.minZ + 8, isl.maxX - isl.minX - 16, isl.maxZ - isl.minZ - 22, 20);
    g.fill();
    const pier = map.pier ?? { x: -166, z: 374, w: 20, d: 140 };
    g.fillStyle = INK.pier;
    g.fillRect(pier.x - pier.w / 2 + 4, CITY.beachStart, pier.w - 8, pier.z + pier.d / 2 - CITY.beachStart);
    g.fillRect(pier.x - 18, pier.z + pier.d / 2 - 22, 36, 22);

    // Faint swell lines across open water.
    g.save();
    g.strokeStyle = 'rgba(160, 225, 245, 0.07)';
    g.lineWidth = 1.2;
    for (let z = CITY.waterStart + 18; z < B.maxZ; z += 16) {
      g.beginPath();
      for (let x = B.minX; x <= B.maxX; x += 10) g.lineTo(x, z + 2.4 * Math.sin(x * 0.03 + z * 0.2));
      g.stroke();
    }
    g.restore();

    // Roads: kerbs first, then asphalt, then markings, so junctions merge cleanly.
    const rect = (r, grow) => {
      const half = r.w / 2 + grow;
      if (r.axis === 'z') {
        const z0 = Math.min(r.z1, r.z2), z1 = Math.max(r.z1, r.z2);
        return [r.x1 - half, z0 - grow, half * 2, z1 - z0 + grow * 2];
      }
      const x0 = Math.min(r.x1, r.x2), x1 = Math.max(r.x1, r.x2);
      return [x0 - grow, r.z1 - half, x1 - x0 + grow * 2, half * 2];
    };
    g.fillStyle = INK.sidewalk;
    for (const r of roads) if (!r.bridge) g.fillRect(...rect(r, CITY.sidewalk));
    for (const r of roads) {
      g.fillStyle = r.bridge ? INK.bridge : r.main ? INK.mainRoad : INK.road;
      g.fillRect(...rect(r, 0));
    }
    // The island avenue meets the causeway across the key's north shore.
    g.fillStyle = INK.road;
    g.fillRect(548, 121, 112 + 9, 18);
    g.strokeStyle = INK.lane;
    g.setLineDash([7, 7]);
    g.lineWidth = 0.9;
    for (const r of roads) {
      if (!r.main && !r.bridge) continue;
      g.beginPath();
      g.moveTo(r.x1, r.z1);
      g.lineTo(r.x2, r.z2);
      g.stroke();
    }
    g.setLineDash([]);

    // Building footprints, lighter as they climb.
    for (const b of map.buildings ?? []) {
      const t = Math.min(1, (b.h - 12) / 70);
      const l = Math.round(52 + t * 34);
      g.fillStyle = `rgb(${l - 6}, ${l + 4}, ${l + 18})`;
      g.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
      g.fillStyle = 'rgba(255, 255, 255, 0.07)';
      g.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, Math.min(2.5, b.d * 0.2));
    }
    return c;
  }

  /** Low-res district tint: each land cell takes its turf colour, alpha by standing. */
  function buildTurf(standing) {
    const w = Math.ceil(spanX / TURF_CELL), h = Math.ceil(spanZ / TURF_CELL);
    const c = turfLayer ?? Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const tint = Object.fromEntries(TURF.map((t) => {
      const [r, gg, b] = t.rgb.split(',').map(Number);
      const s = Math.max(0, Math.min(100, standing?.[t.id] ?? 0)) / 100;
      return [t.id, [r, gg, b, Math.round(14 + s * 160)]];
    }));
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const x = B.minX + (i + 0.5) * TURF_CELL, z = B.minZ + (j + 0.5) * TURF_CELL;
        if (world.isWater?.(x, z) || z > CITY.beachStart + 6) continue;
        const c4 = tint[turfIdAt(x, z)];
        if (!c4) continue;
        const o = (j * w + i) * 4;
        img.data[o] = c4[0]; img.data[o + 1] = c4[1]; img.data[o + 2] = c4[2]; img.data[o + 3] = c4[3];
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function layers(standing) {
    if (!base) base = buildBase();
    const k = TURF.map((t) => Math.round(standing?.[t.id] ?? 0)).join(',');
    if (k !== turfKey || !turfLayer) {
      turfLayer = buildTurf(standing);
      turfKey = k;
    }
  }

  // ------------------------------------------------------------------ GPS
  /** Shortest road path from one world point to another, as a list of {x, z}. */
  function gpsRoute(from, to) {
    if (!from || !to) return [];
    const key = `${Math.round(from.x / 6)},${Math.round(from.z / 6)}>${Math.round(to.x)},${Math.round(to.z)}`;
    if (key === routeCache.key) return routeCache.path;
    routeCache.key = key;
    routeCache.path = graph.route(from, to);
    return routeCache.path;
  }

  // ------------------------------------------------------------------ shared overlays
  function strokeRoute(g, pts, project, color, width) {
    if (pts.length < 2) return;
    g.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = project(p.x, p.z);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.save();
    g.shadowColor = color;
    g.shadowBlur = width * 3;
    g.strokeStyle = color;
    g.globalAlpha = 0.35;
    g.lineWidth = width * 2.6;
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(8, 12, 20, 0.85)';
    g.lineWidth = width + 2.2;
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    g.lineWidth = Math.max(1, width * 0.28);
    g.stroke();
  }

  function chevron(g, x, y, heading, size, color) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(Math.cos(heading), Math.sin(heading)));
    g.beginPath();
    g.moveTo(size, 0);
    g.lineTo(-size * 0.75, size * 0.68);
    g.lineTo(-size * 0.38, 0);
    g.lineTo(-size * 0.75, -size * 0.68);
    g.closePath();
    g.shadowColor = 'rgba(0, 0, 0, 0.6)';
    g.shadowBlur = size * 0.8;
    g.fillStyle = color;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = Math.max(1.2, size * 0.16);
    g.strokeStyle = '#0b1018';
    g.stroke();
    g.restore();
  }

  function carBox(g, x, y, heading, len, wid, fill) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(Math.cos(heading), Math.sin(heading)));
    g.fillStyle = fill;
    g.fillRect(-len / 2, -wid / 2, len, wid);
    g.restore();
  }

  function visionCone(g, x, y, heading, reach, spread, flash) {
    const a = Math.atan2(Math.cos(heading), Math.sin(heading));
    const grad = g.createRadialGradient(x, y, 0, x, y, reach);
    const tone = flash ? '255, 42, 61' : '47, 107, 255';
    grad.addColorStop(0, `rgba(${tone}, 0.42)`);
    grad.addColorStop(1, `rgba(${tone}, 0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, reach, a - spread, a + spread);
    g.closePath();
    g.fill();
  }

  function searchlight(g, heli, project, scale, t) {
    const [hx, hy] = project(heli.x, heli.z);
    const [sx, sy] = project(heli.spotX ?? heli.x, heli.spotZ ?? heli.z);
    const r = 15 * scale;
    const ang = Math.atan2(sy - hy, sx - hx);
    g.fillStyle = 'rgba(255, 246, 200, 0.14)';
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(sx + Math.cos(ang + Math.PI / 2) * r, sy + Math.sin(ang + Math.PI / 2) * r);
    g.lineTo(sx + Math.cos(ang - Math.PI / 2) * r, sy + Math.sin(ang - Math.PI / 2) * r);
    g.closePath();
    g.fill();
    const spot = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    spot.addColorStop(0, 'rgba(255, 250, 220, 0.75)');
    spot.addColorStop(0.7, 'rgba(255, 240, 180, 0.3)');
    spot.addColorStop(1, 'rgba(255, 240, 180, 0)');
    g.fillStyle = spot;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();
    // The chopper: a body dot with a spinning two-blade rotor.
    const s = Math.max(4, 3.2 * scale);
    g.save();
    g.translate(hx, hy);
    g.fillStyle = '#0b1018';
    g.beginPath();
    g.arc(0, 0, s * 0.95, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK.policeBlue;
    g.beginPath();
    g.arc(0, 0, s * 0.6, 0, Math.PI * 2);
    g.fill();
    g.rotate(t * 18);
    g.strokeStyle = 'rgba(230, 240, 255, 0.85)';
    g.lineWidth = Math.max(1, s * 0.22);
    g.beginPath();
    g.moveTo(-s * 1.9, 0); g.lineTo(s * 1.9, 0);
    g.moveTo(0, -s * 1.9); g.lineTo(0, s * 1.9);
    g.stroke();
    g.restore();
  }

  function pin(g, x, y, size, color, glyph) {
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.55)';
    g.shadowBlur = size * 0.6;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y - size * 1.25, size, Math.PI * 0.82, Math.PI * 0.18);
    g.lineTo(x, y);
    g.closePath();
    g.fill();
    g.restore();
    g.lineWidth = Math.max(1, size * 0.15);
    g.strokeStyle = '#0b1018';
    g.stroke();
    if (glyph) {
      g.fillStyle = '#0b1018';
      g.font = `${Math.round(size * 1.05)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(glyph, x, y - size * 1.22);
    }
  }

  function badge(g, x, y, r, fill, glyph) {
    g.fillStyle = 'rgba(8, 12, 20, 0.85)';
    g.beginPath();
    g.arc(x, y, r + 1.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b1018';
    g.font = `${Math.round(r * 1.15)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, x, y + 0.5);
  }

  function label(g, text, x, y, size, color, font = FONT, align = 'center') {
    g.font = `${size}px ${font}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, size * 0.32);
    g.strokeStyle = 'rgba(6, 10, 18, 0.9)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  /** Live layer shared by both maps: route, checkpoints, starts, police, pins, player. */
  function drawLive(g, s, project, scale, opts) {
    const t = performance.now() / 1000;
    const player = s.player;
    const me = s.vehicle ?? player;
    const wp = s.waypoint;
    const gpsColor = wp?.activity ? INK.gpsActivity : INK.gps;

    if (wp && me) strokeRoute(g, gpsRoute(me, wp), project, gpsColor, opts.route);

    // Activity checkpoints ahead, numbered from the next one.
    (s.checkpoints ?? []).slice(0, opts.checkpoints).forEach(([x, z], i) => {
      const [cx, cy] = project(x, z);
      g.strokeStyle = i === 0 ? INK.gpsActivity : 'rgba(57, 240, 255, 0.55)';
      g.lineWidth = i === 0 ? 2.4 : 1.6;
      g.beginPath();
      g.arc(cx, cy, opts.badge * (i === 0 ? 1.05 + 0.15 * Math.sin(t * 6) : 0.8), 0, Math.PI * 2);
      g.stroke();
    });

    for (const a of s.activityStarts ?? []) {
      if (!a.start) continue;
      const [ax, ay] = project(a.start[0], a.start[1]);
      badge(g, ax, ay, opts.badge * 0.8, a.kind === 'race' ? '#ff6f91' : a.kind === 'fare' ? '#ffe08a' : '#57d8d0', a.code?.[0] ?? '•');
      if (opts.names) label(g, a.name.toUpperCase(), ax, ay + opts.badge * 1.7, 10, 'rgba(235, 240, 248, 0.85)', UI_FONT);
    }

    // Roadblocks: flare glow and a barrier bar across the street.
    for (const block of s.roadblocks ?? []) {
      for (const f of block.flares ?? []) {
        const [fx, fy] = project(f.x, f.z);
        const r = Math.max(3, 4 * scale) * (0.8 + 0.25 * Math.sin(t * 13 + (f.phase ?? 0)));
        const glow = g.createRadialGradient(fx, fy, 0, fx, fy, r * 2.2);
        glow.addColorStop(0, 'rgba(255, 90, 60, 0.95)');
        glow.addColorStop(1, 'rgba(255, 40, 30, 0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(fx, fy, r * 2.2, 0, Math.PI * 2);
        g.fill();
      }
      for (const bar of block.barriers ?? []) {
        if (bar.knocked) continue;
        const [bx, by] = project(bar.x, bar.z);
        carBox(g, bx, by, (bar.rot ?? 0) + Math.PI / 2, Math.max(4, 3 * scale), Math.max(1.6, 0.9 * scale), '#ffd166');
      }
    }

    // Traffic as faint ticks so the police read clearly over it.
    if (opts.traffic) {
      for (const c of s.trafficCars ?? []) {
        if (c.removed || c.wrecked) continue;
        const [x, y] = project(c.x, c.z);
        carBox(g, x, y, c.heading, Math.max(3, 4.4 * scale), Math.max(1.8, 2 * scale), 'rgba(205, 214, 226, 0.55)');
      }
    }

    // SBPD cruisers: flashing red/blue body and a vision cone while hunting.
    const flash = Math.floor(t * 5) % 2 === 0;
    const hunting = (s.wanted ?? 0) > 0;
    for (const c of s.policeCars ?? []) {
      if (c.removed) continue;
      const [x, y] = project(c.x, c.z);
      if (!c.wrecked && (hunting || c.pursuit) && !c.roadblock) visionCone(g, x, y, c.heading, 62 * scale, 0.5, flash);
      g.save();
      if (!c.wrecked) {
        g.shadowColor = flash ? INK.police : INK.policeBlue;
        g.shadowBlur = 8;
      }
      carBox(g, x, y, c.heading, Math.max(6, 5 * scale), Math.max(3.4, 2.4 * scale), c.wrecked ? '#4a4f5a' : flash ? INK.police : INK.policeBlue);
      g.restore();
    }
    if (s.helicopter) searchlight(g, s.helicopter, project, scale, t);

    // Safehouse and the active waypoint.
    const [hx, hy] = project(SAFEHOUSE.x, SAFEHOUSE.z);
    badge(g, hx, hy, opts.badge, INK.safehouse, 'S');
    if (opts.names) label(g, 'SAFEHOUSE', hx, hy + opts.badge * 2, 11, INK.safehouse);
    if (wp) {
      const [wx, wy] = project(wp.x, wp.z);
      const pulse = (t * 0.9) % 1;
      g.strokeStyle = gpsColor;
      g.globalAlpha = 1 - pulse;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(wx, wy, opts.badge * (0.6 + pulse * 2.2), 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      pin(g, wx, wy, opts.badge * 1.05, gpsColor, wp.escape ? 'S' : wp.activity ? '!' : '★');
      if (opts.names && wp.label) label(g, shorten(String(wp.label).toUpperCase(), 30), wx, wy + opts.badge * 2.6, 11, gpsColor);
    }

    if (player) {
      const [px, py] = project(me.x, me.z);
      const ring = (t * 0.7) % 1;
      g.strokeStyle = `rgba(255, 255, 255, ${0.5 * (1 - ring)})`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(px, py, opts.player * (1 + ring * 1.6), 0, Math.PI * 2);
      g.stroke();
      chevron(g, px, py, me.heading ?? player.heading ?? 0, opts.player, s.vehicle ? '#ffffff' : '#ffe9b0');
    }
  }

  // ------------------------------------------------------------------ HUD minimap
  function drawMinimap(canvas, s) {
    if (!canvas || !s?.player) return;
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    layers(s.turf);
    const me = s.vehicle ?? s.player;
    const speed = Math.abs(s.vehicle?.speed ?? 0);
    const heading = me.heading ?? 0;

    // Zoom out with speed and lead the view ahead of the car, both eased frame to frame.
    const wantZoom = 1.95 - Math.min(1, speed / 42) * 0.85;
    mini.zoom += (wantZoom - mini.zoom) * 0.06;
    const lead = Math.min(46, speed * 0.9);
    const tx = me.x + Math.sin(heading) * lead, tz = me.z + Math.cos(heading) * lead;
    if (mini.cx === null || Math.hypot(tx - mini.cx, tz - mini.cz) > 120) { mini.cx = tx; mini.cz = tz; }
    mini.cx += (tx - mini.cx) * 0.1;
    mini.cz += (tz - mini.cz) * 0.1;
    const k = mini.zoom * (W / 560);
    const cx = mini.cx, cz = mini.cz;
    const project = (x, z) => [W / 2 + (x - cx) * k, H / 2 + (z - cz) * k];

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = INK.sea;
    g.fillRect(0, 0, W, H);
    const wx0 = cx - W / 2 / k, wz0 = cz - H / 2 / k;
    g.drawImage(base, (wx0 - B.minX) * RES, (wz0 - B.minZ) * RES, (W / k) * RES, (H / k) * RES, 0, 0, W, H);
    g.globalAlpha = 0.34;
    g.drawImage(turfLayer, (wx0 - B.minX) / TURF_CELL, (wz0 - B.minZ) / TURF_CELL, W / k / TURF_CELL, H / k / TURF_CELL, 0, 0, W, H);
    g.globalAlpha = 1;

    drawLive(g, s, project, k, { route: 6, badge: 11, player: 15, checkpoints: 3, traffic: true, names: false });

    // Off-screen waypoint and safehouse clamp to the rim with distance.
    const edge = (x, z, color, glyph) => {
      const [sx, sy] = project(x, z);
      const m = 18;
      if (sx > m && sx < W - m && sy > m && sy < H - m) return;
      const ang = Math.atan2(sy - H / 2, sx - W / 2);
      const rx = (W / 2 - m) / Math.abs(Math.cos(ang) || 1e-6);
      const ry = (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-6);
      const r = Math.min(rx, ry);
      const ex = W / 2 + Math.cos(ang) * r, ey = H / 2 + Math.sin(ang) * r;
      g.save();
      g.translate(ex, ey);
      g.rotate(ang);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(12, 0); g.lineTo(-4, 9); g.lineTo(-4, -9);
      g.closePath();
      g.fill();
      g.restore();
      badge(g, ex - Math.cos(ang) * 16, ey - Math.sin(ang) * 16, 8, color, glyph);
      const d = Math.hypot(x - me.x, z - me.z);
      label(g, d > 999 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d / 10) * 10}m`,
        ex - Math.cos(ang) * 44, ey - Math.sin(ang) * 34, 17, '#ffffff', UI_FONT);
    };
    if (s.waypoint) edge(s.waypoint.x, s.waypoint.z, s.waypoint.activity ? INK.gpsActivity : INK.gps, s.waypoint.escape ? 'S' : '★');
    else edge(SAFEHOUSE.x, SAFEHOUSE.z, INK.safehouse, 'S');

    // Radial vignette and a heat rim that pulses red/blue while wanted.
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    v.addColorStop(0, 'rgba(4, 8, 14, 0)');
    v.addColorStop(1, 'rgba(4, 8, 14, 0.62)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    if ((s.wanted ?? 0) > 0) {
      const on = Math.floor(performance.now() / 260) % 2 === 0;
      g.strokeStyle = on ? 'rgba(255, 42, 61, 0.8)' : 'rgba(47, 107, 255, 0.8)';
      g.lineWidth = 6;
      g.strokeRect(3, 3, W - 6, H - 6);
    }
  }

  // ------------------------------------------------------------------ city map
  function drawCityMap(canvas, s) {
    if (!canvas) return;
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    layers(s?.turf);
    const pad = 26;
    const k = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanZ);
    const ox = (W - spanX * k) / 2 - B.minX * k;
    const oz = (H - spanZ * k) / 2 - B.minZ * k;
    const project = (x, z) => [ox + x * k, oz + z * k];

    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b3550');
    bg.addColorStop(1, '#061c2c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const [x0, y0] = project(B.minX, B.minZ);
    g.drawImage(base, x0, y0, spanX * k, spanZ * k);
    g.globalAlpha = 0.5;
    g.drawImage(turfLayer, x0, y0, spanX * k, spanZ * k);
    g.globalAlpha = 1;

    // Lat/long style grid at the road pitch, very faint.
    g.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    g.lineWidth = 1;
    for (let x = Math.ceil(B.minX / CITY.pitch) * CITY.pitch; x < B.maxX; x += CITY.pitch) {
      const [gx] = project(x, 0);
      g.beginPath(); g.moveTo(gx, y0); g.lineTo(gx, y0 + spanZ * k); g.stroke();
    }
    for (let z = Math.ceil(B.minZ / CITY.pitch) * CITY.pitch; z < B.maxZ; z += CITY.pitch) {
      const [, gy] = project(0, z);
      g.beginPath(); g.moveTo(x0, gy); g.lineTo(x0 + spanX * k, gy); g.stroke();
    }

    // District names, with standing and tier for the five turf districts.
    for (const d of DISTRICTS) {
      const [dx, dy] = project(d.x, d.z);
      label(g, d.name.toUpperCase(), dx, dy, 15, d.color);
      const turf = TURF.find((t) => t.id === d.id);
      if (turf && s?.turf) {
        const v = Math.round(s.turf[d.id] ?? 0);
        label(g, `${v}% · ${tierFor(v).name}`, dx, dy + 16, 10, 'rgba(240, 244, 250, 0.9)', UI_FONT);
        const bw = 64;
        g.fillStyle = 'rgba(6, 10, 18, 0.8)';
        g.fillRect(dx - bw / 2, dy + 25, bw, 4);
        g.fillStyle = d.color;
        g.fillRect(dx - bw / 2, dy + 25, (bw * v) / 100, 4);
      }
    }
    for (const lm of map.landmarks ?? []) {
      if (DISTRICTS.some((d) => d.name === lm.name) || lm.name === 'Safehouse' || lm.name === 'Solaris Vault Plaza') continue;
      const [lx, ly] = project(lm.x, lm.z);
      g.save();
      g.translate(lx, ly);
      g.rotate(Math.PI / 4);
      g.fillStyle = lm.vault ? '#ffc24b' : '#e8eef6';
      g.fillRect(-4, -4, 8, 8);
      g.restore();
      label(g, lm.name.toUpperCase(), lx, ly - 13, 10, lm.vault ? '#ffc24b' : '#e8eef6', UI_FONT);
    }

    if (s?.player) drawLive(g, s, project, k * 1.6, { route: 4.5, badge: 9, player: 12, checkpoints: 12, traffic: false, names: true });

    // Compass and scale bar, bottom-right; the city menu's own legend sits bottom-left.
    const cx = W - pad - 34, cy = H - pad - 62;
    g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(cx, cy, 18, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffc24b';
    g.beginPath();
    g.moveTo(cx, cy - 16); g.lineTo(cx + 6, cy); g.lineTo(cx - 6, cy);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.6)';
    g.beginPath();
    g.moveTo(cx, cy + 16); g.lineTo(cx + 6, cy); g.lineTo(cx - 6, cy);
    g.closePath();
    g.fill();
    label(g, 'N', cx, cy - 28, 12, '#ffffff');
    const bar = 200 * k;
    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    g.fillRect(W - pad - bar, H - pad - 14, bar, 3);
    label(g, '200 m', W - pad - bar / 2, H - pad - 26, 10, '#ffffff', UI_FONT);
  }

  return { drawMinimap, drawCityMap, gpsRoute };
}

// ---------------------------------------------------------------------------
// Road graph: junctions where axis-aligned roads cross, Dijkstra between snapped ends.
// ---------------------------------------------------------------------------

function buildRoadGraph(roads) {
  const nodes = [];
  const index = new Map();
  const edges = [];
  const onRoad = roads.map(() => []);
  const node = (x, z) => {
    const key = `${Math.round(x)},${Math.round(z)}`;
    if (!index.has(key)) {
      index.set(key, nodes.length);
      nodes.push({ x, z });
      edges.push([]);
    }
    return index.get(key);
  };
  const link = (a, b, cost = 1) => {
    if (a === b) return;
    const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z) * cost;
    edges[a].push([b, d]);
    edges[b].push([a, d]);
  };
  const span = (r) => (r.axis === 'z'
    ? [Math.min(r.z1, r.z2), Math.max(r.z1, r.z2)]
    : [Math.min(r.x1, r.x2), Math.max(r.x1, r.x2)]);

  roads.forEach((r, i) => {
    onRoad[i].push(node(r.x1, r.z1), node(r.x2, r.z2));
  });
  roads.forEach((v, i) => {
    if (v.axis !== 'z') return;
    const [vz0, vz1] = span(v);
    roads.forEach((h, j) => {
      if (h.axis !== 'x') return;
      const [hx0, hx1] = span(h);
      const tol = Math.max(v.w, h.w) / 2;
      if (v.x1 >= hx0 - tol && v.x1 <= hx1 + tol && h.z1 >= vz0 - tol && h.z1 <= vz1 + tol) {
        const n = node(v.x1, h.z1);
        onRoad[i].push(n);
        onRoad[j].push(n);
      }
    });
  });
  const along = (r, n) => (r.axis === 'z' ? nodes[n].z : nodes[n].x);
  roads.forEach((r, i) => {
    const list = [...new Set(onRoad[i])].sort((a, b) => along(r, a) - along(r, b));
    onRoad[i] = list;
    for (let k = 1; k < list.length; k += 1) link(list[k - 1], list[k], r.main ? 0.88 : 1);
  });
  // Dangling ends (the causeway meeting the island avenue) join the nearest other junction.
  nodes.forEach((n, a) => {
    if (edges[a].length > 1) return;
    let best = -1, bestD = 120;
    nodes.forEach((m, b) => {
      if (b === a || edges[a].some(([c]) => c === b)) return;
      const d = Math.hypot(m.x - n.x, m.z - n.z);
      if (d < bestD) { bestD = d; best = b; }
    });
    if (best >= 0) link(a, best);
  });

  /** Nearest point on any road: {x, z, road, ends:[nodeA, nodeB]}. */
  function snap(p) {
    let best = null;
    roads.forEach((r, i) => {
      const [a, b] = span(r);
      const x = r.axis === 'z' ? r.x1 : Math.max(a, Math.min(b, p.x));
      const z = r.axis === 'z' ? Math.max(a, Math.min(b, p.z)) : r.z1;
      const d = Math.hypot(p.x - x, p.z - z);
      if (!best || d < best.d) best = { x, z, d, road: i };
    });
    if (!best) return null;
    const r = roads[best.road];
    const list = onRoad[best.road];
    const t = r.axis === 'z' ? best.z : best.x;
    let lo = list[0], hi = list[list.length - 1];
    for (const n of list) {
      const v = along(r, n);
      if (v <= t) lo = n;
      if (v >= t) { hi = n; break; }
    }
    best.ends = [lo, hi];
    return best;
  }

  function route(from, to) {
    const a = snap(from), b = snap(to);
    if (!a || !b) return [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
    const n = nodes.length, S = n, T = n + 1;
    const pos = (i) => (i === S ? a : i === T ? b : nodes[i]);
    const extra = new Map([[S, []], [T, []]]);
    const add = (i, j) => {
      const d = Math.hypot(pos(i).x - pos(j).x, pos(i).z - pos(j).z);
      for (const [p, q] of [[i, j], [j, i]]) {
        if (!extra.has(p)) extra.set(p, []);
        extra.get(p).push([q, d]);
      }
    };
    for (const e of a.ends) add(S, e);
    for (const e of b.ends) add(T, e);
    if (a.road === b.road) add(S, T);

    const dist = new Float64Array(n + 2).fill(Infinity);
    const prev = new Int32Array(n + 2).fill(-1);
    const done = new Uint8Array(n + 2);
    dist[S] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n + 2; i += 1) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === T) break;
      done[u] = 1;
      const out = (u < n ? edges[u] : []).concat(extra.get(u) ?? []);
      for (const [v, w] of out) {
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
      }
    }
    const path = [];
    for (let i = T; i >= 0; i = prev[i]) {
      path.push({ x: pos(i).x, z: pos(i).z });
      if (i === S) break;
    }
    if (prev[T] < 0 && !(a.road === b.road)) return [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
    path.reverse();
    return [{ x: from.x, z: from.z }, ...path, { x: to.x, z: to.z }];
  }

  return { route };
}
