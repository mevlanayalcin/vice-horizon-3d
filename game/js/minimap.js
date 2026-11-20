// minimap.js — the vector cartography of Solaris Bay. One painter draws the city from
// world.map (ocean, coastline, beach, pier, district tints, building footprints, roads
// with casings and lane dashes) at any zoom, then layers the live blips: GPS route,
// mission and activity markers, safehouse garage, traffic, pulsing police vision cones,
// the helicopter's searchlight and the player arrow. It feeds both the HUD minimap and
// the full-screen city map in the pause menu.

import { DISTRICTS, SAFEHOUSE, CITY } from './config.js';

const COLORS = {
  water: '#127186',
  waterDeep: '#0a2346',
  shallow: 'rgba(64, 226, 214, 0.20)',
  land: '#1d2830',
  hills: '#20352b',
  sand: '#e2bf7a',
  sandWet: '#a98a5a',
  surf: 'rgba(225, 255, 250, 0.85)',
  pier: '#8a643e',
  building: '#33434d',
  buildingTall: '#4a6274',
  roadCase: '#0b1115',
  road: '#7d8d94',
  roadMain: '#a9b6ba',
  boulevard: '#e8d9b8',
  dash: 'rgba(255, 214, 120, 0.85)',
};

/** District footprints on the map: tinted zones with a lit border, keyed by district id. */
const DISTRICT_ZONES = [
  { id: 'palm', x0: -440, x1: 520, z0: 196, z1: 300, color: '255, 178, 87' },
  { id: 'midtown', x0: -200, x1: 200, z0: -200, z1: 66, color: '197, 108, 255' },
  { id: 'harbor', x0: -470, x1: -230, z0: -330, z1: 150, color: '87, 216, 208' },
  { id: 'marina', x0: 250, x1: 520, z0: 40, z1: 196, color: '92, 200, 255' },
  { id: 'hills', x0: -440, x1: 520, z0: -470, z1: -320, color: '158, 224, 106' },
];

/** Map-only place names beside the six districts. */
const PLACE_LABELS = [
  { name: 'Starlight Key', color: '#ffe08a', x: 654, z: 112 },
  { name: 'Sunset Beach', color: '#ffd29a', x: 210, z: 322 },
  { name: 'Solaris Bay', color: 'rgba(170, 240, 255, 0.5)', x: 300, z: 425, big: true },
];

/** A smooth deterministic wobble for organic coastlines. */
function wobble(t, seed, amp) {
  return (Math.sin(t * 0.021 + seed) * 0.6 + Math.sin(t * 0.057 + seed * 2.3) * 0.3 + Math.sin(t * 0.13 + seed * 4.1) * 0.1) * amp;
}

export function createMapPainter(world) {
  const map = world.map;
  const roads = map.roads;
  const buildings = map.buildings;
  const ramps = world.props.filter((p) => p.type === 'ramp');

  /** A view maps world metres to canvas pixels around a centre point. */
  function makeView(cx, cz, scale, w, h) {
    return {
      cx, cz, scale, w, h,
      x: (wx) => w / 2 + (wx - cx) * scale,
      y: (wz) => h / 2 + (wz - cz) * scale,
      minX: cx - w / 2 / scale, maxX: cx + w / 2 / scale,
      minZ: cz - h / 2 / scale, maxZ: cz + h / 2 / scale,
    };
  }

  function rect(g, v, x, z, w, d, fill) {
    g.fillStyle = fill;
    g.fillRect(v.x(x - w / 2), v.y(z - d / 2), w * v.scale, d * v.scale);
  }

  /** The mainland outline: straight inland edges, an organic sea coast along the beach. */
  function mainlandPath(g, v, shore = 0) {
    g.beginPath();
    g.moveTo(v.x(-470 - shore), v.y(-620));
    g.lineTo(v.x(520 + shore), v.y(-620));
    for (let z = -470; z <= 300; z += 20) g.lineTo(v.x(520 + shore + Math.max(0, wobble(z, 1.2, 8))), v.y(z));
    for (let x = 520; x >= -470; x -= 12) g.lineTo(v.x(x), v.y(coastZ(x) + shore));
    for (let z = 300; z >= -470; z -= 20) g.lineTo(v.x(-470 - shore - Math.max(0, wobble(z, 2.9, 8))), v.y(z));
    g.closePath();
  }

  /** Where the sand meets the surf: a gently scalloped curve, deepest at Sunset Beach. */
  function coastZ(x) {
    return 337 + wobble(x, 0.7, 6) + Math.exp(-(((x - 220) / 180) ** 2)) * 7;
  }

  function islandPath(g, v, grow = 0) {
    const I = CITY.island;
    const cx = (I.minX + I.maxX) / 2, cz = (I.minZ + I.maxZ) / 2;
    const rx = (I.maxX - I.minX) / 2 + 6 + grow, rz = (I.maxZ - I.minZ) / 2 + 6 + grow;
    g.beginPath();
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      // A squircle hugging the island's square footprint, its coast gently scalloped.
      const k = 1 / Math.pow(Math.abs(c) ** 4 + Math.abs(sn) ** 4, 0.25);
      const r = 1 + wobble(i * 40, 5.1, 0.03);
      const x = cx + c * rx * k * r, z = cz + sn * rz * k * r;
      if (i) g.lineTo(v.x(x), v.y(z)); else g.moveTo(v.x(x), v.y(z));
    }
    g.closePath();
  }

  /** The static city: bay contours, coastline, beach, pier, island, district zones, footprints, roads. */
  function drawBase(g, v, opts = {}) {
    const ocean = g.createLinearGradient(0, v.y(330), 0, v.y(640));
    ocean.addColorStop(0, COLORS.water);
    ocean.addColorStop(1, COLORS.waterDeep);
    g.fillStyle = ocean;
    g.fillRect(0, 0, v.w, v.h);
    // Shallow-to-deep contours: turquoise bands stepping off the coast and the island.
    g.lineJoin = 'round';
    for (const [shore, alpha] of [[70, 0.07], [44, 0.1], [24, 0.14], [10, 0.2]]) {
      g.fillStyle = `rgba(64, 226, 214, ${alpha})`;
      mainlandPath(g, v, shore); g.fill();
      islandPath(g, v, shore * 0.7); g.fill();
    }
    g.strokeStyle = 'rgba(160, 250, 240, 0.12)';
    g.lineWidth = Math.max(1, v.scale * 0.8);
    for (const shore of [34, 58, 90]) { mainlandPath(g, v, shore); g.stroke(); }
    // Land.
    g.fillStyle = COLORS.land;
    mainlandPath(g, v, 0); g.fill();
    rect(g, v, 25, -400, 990, 160, COLORS.hills);
    // Hill contours.
    g.strokeStyle = 'rgba(158, 224, 106, 0.14)';
    g.lineWidth = Math.max(1, v.scale);
    for (let k = 0; k < 4; k += 1) {
      g.beginPath();
      for (let x = -470; x <= 520; x += 15) {
        const z = -455 + k * 26 + wobble(x, k * 1.7, 9);
        if (x === -470) g.moveTo(v.x(x), v.y(z)); else g.lineTo(v.x(x), v.y(z));
      }
      g.stroke();
    }
    // District zones with a glowing outline.
    for (const zone of DISTRICT_ZONES) {
      const x = v.x(zone.x0), y = v.y(zone.z0), w = (zone.x1 - zone.x0) * v.scale, h = (zone.z1 - zone.z0) * v.scale;
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, `rgba(${zone.color}, 0.16)`);
      grad.addColorStop(1, `rgba(${zone.color}, 0.07)`);
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
      g.strokeStyle = `rgba(${zone.color}, 0.35)`;
      g.lineWidth = Math.max(1, v.scale * 1.1);
      g.setLineDash([v.scale * 8, v.scale * 5]);
      g.strokeRect(x, y, w, h);
      g.setLineDash([]);
    }
    // The golden beach: dry sand, wet sand and a white surf line along the scalloped coast.
    g.beginPath();
    g.moveTo(v.x(-470), v.y(300));
    g.lineTo(v.x(520), v.y(300));
    for (let x = 520; x >= -470; x -= 12) g.lineTo(v.x(x), v.y(coastZ(x)));
    g.closePath();
    const sand = g.createLinearGradient(0, v.y(300), 0, v.y(340));
    sand.addColorStop(0, COLORS.sand);
    sand.addColorStop(0.75, '#d1ab68');
    sand.addColorStop(1, COLORS.sandWet);
    g.fillStyle = sand;
    g.fill();
    rect(g, v, 25, 295, 990, 13, '#8c6c4a');
    g.strokeStyle = COLORS.surf;
    g.lineWidth = Math.max(1.5, v.scale * 1.8);
    g.beginPath();
    for (let x = -470; x <= 520; x += 8) {
      const z = coastZ(x) + 0.5;
      if (x === -470) g.moveTo(v.x(x), v.y(z)); else g.lineTo(v.x(x), v.y(z));
    }
    g.stroke();
    // Beach umbrellas dotted along the sand.
    const umbrellas = ['#ff6f91', '#55ebff', '#ffd166', '#ff8f6b'];
    for (let x = -380, i = 0; x < 470; x += 61, i += 1) {
      g.fillStyle = umbrellas[i % 4];
      g.beginPath(); g.arc(v.x(x), v.y(318), Math.max(1.5, v.scale * 2.2), 0, Math.PI * 2); g.fill();
    }
    // Coral Pier and its neon wheel.
    rect(g, v, -166, 374, 20, 144, COLORS.pier);
    rect(g, v, -166, 430, 44, 26, COLORS.pier);
    g.strokeStyle = 'rgba(40, 24, 12, 0.6)';
    g.lineWidth = 1;
    for (let z = 306; z < 444; z += 6) { g.beginPath(); g.moveTo(v.x(-176), v.y(z)); g.lineTo(v.x(-156), v.y(z)); g.stroke(); }
    g.save();
    g.strokeStyle = '#ff6f91';
    g.shadowColor = '#ff6f91';
    g.shadowBlur = 8;
    g.lineWidth = Math.max(1.5, v.scale * 1.6);
    const wr = Math.max(5, v.scale * 11);
    g.beginPath(); g.arc(v.x(-166), v.y(432), wr, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI;
      g.beginPath(); g.moveTo(v.x(-166) - Math.cos(a) * wr, v.y(432) - Math.sin(a) * wr); g.lineTo(v.x(-166) + Math.cos(a) * wr, v.y(432) + Math.sin(a) * wr); g.stroke();
    }
    g.restore();
    // Starlight Key: a sand-ringed island with a palm park, marina slips and yachts.
    g.fillStyle = COLORS.sand;
    islandPath(g, v, 4); g.fill();
    g.fillStyle = '#1f2d33';
    islandPath(g, v, -2); g.fill();
    g.fillStyle = 'rgba(255, 224, 138, 0.10)';
    islandPath(g, v, -2); g.fill();
    g.fillStyle = 'rgba(94, 190, 110, 0.35)';
    g.beginPath(); g.arc(v.x(690), v.y(250), Math.max(4, v.scale * 22), 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 4; i += 1) {
      const z = 150 + i * 26;
      g.strokeStyle = '#b48a5e';
      g.lineWidth = Math.max(1.5, v.scale * 3);
      g.beginPath(); g.moveTo(v.x(747), v.y(z)); g.lineTo(v.x(778), v.y(z)); g.stroke();
      for (const dz of [-7, 7]) {
        g.fillStyle = '#f5f2ea';
        g.beginPath(); g.ellipse(v.x(770), v.y(z + dz), Math.max(2, v.scale * 7), Math.max(1, v.scale * 2.4), 0, 0, Math.PI * 2); g.fill();
      }
    }
    // The causeway deck with its rails.
    g.strokeStyle = 'rgba(92, 200, 255, 0.7)';
    g.lineWidth = Math.max(1, v.scale * 0.8);
    for (const dz of [-13, 13]) { g.beginPath(); g.moveTo(v.x(512), v.y(130 + dz)); g.lineTo(v.x(552), v.y(130 + dz)); g.stroke(); }
    // Building footprints, tinted toward their district, with a lit edge.
    const tint = { palm: '#4b4249', midtown: '#3f3a58', harbor: '#2f4a4c', marina: '#33495c', hills: '#34453a' };
    for (const b of buildings) {
      if (b.x + b.w / 2 < v.minX || b.x - b.w / 2 > v.maxX || b.z + b.d / 2 < v.minZ || b.z - b.d / 2 > v.maxZ) continue;
      const x = v.x(b.x - b.w / 2), y = v.y(b.z - b.d / 2), w = b.w * v.scale, h = b.d * v.scale;
      g.fillStyle = b.h > 45 ? COLORS.buildingTall : tint[b.district] ?? COLORS.building;
      g.fillRect(x, y, w, h);
      if (v.scale > 0.4) {
        g.fillStyle = 'rgba(255, 255, 255, 0.08)';
        g.fillRect(x, y, w, Math.max(1, v.scale * 1.2));
      }
    }
    // Roads: dark casing, then the asphalt, then lane dashes on the big ones.
    g.lineCap = 'butt';
    for (const pass of ['case', 'fill', 'dash']) {
      for (const r of roads) {
        const main = r.main || r.w > 26;
        const width = r.w * v.scale * 0.72;
        if (pass === 'case') { g.strokeStyle = COLORS.roadCase; g.lineWidth = width + Math.max(2, v.scale * 2.4); g.setLineDash([]); }
        if (pass === 'fill') { g.strokeStyle = r.z1 === CITY.boulevardZ && r.axis === 'x' ? COLORS.boulevard : main ? COLORS.roadMain : COLORS.road; g.lineWidth = width; g.setLineDash([]); }
        if (pass === 'dash') {
          if (!main || v.scale < 0.6) continue;
          g.strokeStyle = COLORS.dash; g.lineWidth = Math.max(1, v.scale * 0.5); g.setLineDash([v.scale * 6, v.scale * 6]);
        }
        g.beginPath(); g.moveTo(v.x(r.x1), v.y(r.z1)); g.lineTo(v.x(r.x2), v.y(r.z2)); g.stroke();
      }
    }
    g.setLineDash([]);
    if (opts.labels) drawLabels(g, v);
  }

  function drawLabels(g, v) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const font = Math.round(Math.max(11, v.scale * 14));
    const label = (text, x, y, color, size = font, plate = true) => {
      g.font = `800 ${size}px "Trebuchet MS", "DejaVu Sans", sans-serif`;
      const spaced = text.toUpperCase().split('').join(String.fromCharCode(8202));
      const w = g.measureText(spaced).width + 18;
      if (plate) {
        g.fillStyle = 'rgba(4, 8, 14, 0.72)';
        g.beginPath();
        g.roundRect(x - w / 2, y - size * 0.85, w, size * 1.7, size * 0.5);
        g.fill();
        g.strokeStyle = color;
        g.globalAlpha = 0.55;
        g.lineWidth = 1;
        g.stroke();
        g.globalAlpha = 1;
      }
      g.save();
      g.shadowColor = color;
      g.shadowBlur = plate ? 6 : 0;
      g.fillStyle = color;
      g.fillText(spaced, x, y + 1);
      g.restore();
    };
    for (const d of DISTRICTS) label(d.name, v.x(d.x), v.y(d.id === 'palm' ? 232 : d.id === 'pier' ? 462 : d.z), d.color);
    for (const p of PLACE_LABELS) label(p.name, v.x(p.x), v.y(p.z), p.color, p.big ? Math.round(font * 1.6) : font, !p.big);
  }

  /** A pin with a letter: mission gold, activities cyan, the garage mint. */
  function drawPin(g, x, y, color, letter, size) {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = size;
    g.fillStyle = '#0b1218';
    g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.lineWidth = Math.max(1.5, size * 0.22);
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = color;
    g.font = `900 ${Math.round(size * 1.05)}px "Arial Black", "DejaVu Sans", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, x, y + size * 0.06);
    g.restore();
  }

  /** A GPS route that follows the street grid: along the current road, then across. */
  function gpsRoute(px, pz, tx, tz) {
    const snap = (value, lines) => lines.reduce((best, line) => (Math.abs(line - value) < Math.abs(best - value) ? line : best), lines[0]);
    const zs = [...CITY.roadsZ, CITY.boulevardZ];
    const rz = snap(pz, zs), rx = snap(tx, CITY.roadsX);
    const startOnZ = Math.abs(pz - rz) < 16;
    if (startOnZ) return [[px, pz], [px, rz], [rx, rz], [rx, tz], [tx, tz]];
    const sx = snap(px, CITY.roadsX), tzr = snap(tz, zs);
    return [[px, pz], [sx, pz], [sx, tzr], [tx, tzr], [tx, tz]];
  }

  /** Live blips over the base map. */
  function drawLive(g, v, s) {
    const now = performance.now();
    const flash = Math.floor(now / 230) % 2;
    const pin = s.fullMap ? 11 : Math.max(7, Math.min(13, v.scale * 6));
    const inside = (x, y, pad = 0) => x > pad && y > pad && x < v.w - pad && y < v.h - pad;
    const clampToEdge = (x, y, pad) => {
      const cx = v.w / 2, cy = v.h / 2;
      const dx = x - cx, dy = y - cy;
      const t = Math.min(1, (v.w / 2 - pad) / Math.max(1e-3, Math.abs(dx)), (v.h / 2 - pad) / Math.max(1e-3, Math.abs(dy)));
      return [cx + dx * t, cy + dy * t, t < 1];
    };
    const px = s.vehicle ? s.vehicle.x : s.player.x;
    const pz = s.vehicle ? s.vehicle.z : s.player.z;

    // Stunt ramps.
    for (const r of ramps) {
      const x = v.x(r.x), y = v.y(r.z);
      if (!inside(x, y)) continue;
      g.fillStyle = '#ffc24b';
      g.beginPath(); g.moveTo(x, y - pin * 0.7); g.lineTo(x + pin * 0.7, y + pin * 0.5); g.lineTo(x - pin * 0.7, y + pin * 0.5); g.closePath(); g.fill();
    }
    // Traffic and parked cars.
    const dot = Math.max(2.5, v.scale * 2.2);
    g.fillStyle = 'rgba(236, 240, 238, 0.75)';
    for (const car of s.trafficCars ?? []) {
      const x = v.x(car.x), y = v.y(car.z);
      if (inside(x, y)) g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    g.fillStyle = 'rgba(150, 175, 182, 0.7)';
    for (const car of s.parkedCars ?? []) {
      if (car === s.vehicle) continue;
      const x = v.x(car.x), y = v.y(car.z);
      if (inside(x, y)) g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    // Activity start rings and the garage.
    for (const a of s.activityStarts ?? []) {
      const [x, y, edge] = clampToEdge(v.x(a.start[0]), v.y(a.start[1]), pin + 2);
      if (!edge || s.fullMap) drawPin(g, x, y, '#55ebff', a.kind === 'race' ? 'R' : a.kind === 'fare' ? 'T' : 'C', pin * 0.85);
    }
    {
      const [x, y, edge] = clampToEdge(v.x(SAFEHOUSE.x), v.y(SAFEHOUSE.z + 12), pin + 2);
      if (!edge || s.fullMap) drawPin(g, x, y, '#67e6b7', 'G', pin * 0.85);
    }
    // GPS route and the waypoint.
    const wp = s.waypoint;
    if (wp) {
      const color = wp.activity ? '#55ebff' : '#ffc24b';
      const route = gpsRoute(px, pz, wp.x, wp.z);
      g.save();
      g.strokeStyle = color;
      g.globalAlpha = 0.9;
      g.lineWidth = Math.max(3, v.scale * 3.2);
      g.lineJoin = 'round';
      g.shadowColor = color;
      g.shadowBlur = 8;
      g.beginPath();
      route.forEach(([x, z], i) => (i ? g.lineTo(v.x(x), v.y(z)) : g.moveTo(v.x(x), v.y(z))));
      g.stroke();
      g.restore();
      for (const cp of (s.checkpoints ?? []).slice(1, 3)) {
        const x = v.x(cp[0]), y = v.y(cp[1]);
        if (!inside(x, y)) continue;
        g.strokeStyle = 'rgba(85, 235, 255, 0.6)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, pin * 0.6, 0, Math.PI * 2); g.stroke();
      }
      const [wx, wy, pinned] = clampToEdge(v.x(wp.x), v.y(wp.z), pin + 3);
      const pulse = 0.55 + Math.sin(now * 0.005) * 0.3;
      if (!pinned) {
        g.strokeStyle = wp.activity ? `rgba(85, 235, 255, ${pulse})` : `rgba(255, 194, 75, ${pulse})`;
        g.lineWidth = 2.5;
        g.beginPath(); g.arc(wx, wy, pin * 1.7, 0, Math.PI * 2); g.stroke();
      }
      drawPin(g, wx, wy, color, wp.activity ? '◆' : '★', pin);
    }
    // Police: vision cones that pulse red and blue, then the cruiser blips.
    for (const car of s.policeCars ?? []) {
      const x = v.x(car.x), y = v.y(car.z);
      const cone = Math.max(26, v.scale * 34);
      if (inside(x, y, -cone)) {
        const dirX = Math.sin(car.heading), dirY = Math.cos(car.heading);
        const ang = Math.atan2(dirY, dirX);
        const grad = g.createRadialGradient(x, y, 0, x, y, cone);
        const tint = flash ? '255, 60, 80' : '70, 120, 255';
        grad.addColorStop(0, `rgba(${tint}, 0.55)`);
        grad.addColorStop(1, `rgba(${tint}, 0)`);
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(x, y); g.arc(x, y, cone, ang - 0.55, ang + 0.55); g.closePath(); g.fill();
      }
      const [bx, by] = clampToEdge(x, y, 8);
      g.save();
      g.shadowColor = flash ? 'rgba(255, 55, 80, 1)' : 'rgba(70, 120, 255, 1)';
      g.shadowBlur = 10;
      g.fillStyle = flash ? '#ff4657' : '#4f82ff';
      g.fillRect(bx - 4.5, by - 4.5, 9, 9);
      g.fillStyle = flash ? '#4f82ff' : '#ff4657';
      g.fillRect(bx - 4.5, by - 4.5, 9, 3);
      g.restore();
    }
    const heli = s.helicopter;
    if (heli) {
      const x = v.x(heli.spotX ?? heli.x), y = v.y(heli.spotZ ?? heli.z);
      g.fillStyle = 'rgba(255, 250, 220, 0.18)';
      g.beginPath(); g.arc(x, y, Math.max(12, v.scale * 9), 0, Math.PI * 2); g.fill();
      const [hx, hy] = clampToEdge(v.x(heli.x), v.y(heli.z), 10);
      g.save();
      g.translate(hx, hy);
      g.rotate(now * 0.02);
      g.strokeStyle = flash ? '#ff5a6a' : '#6f9bff';
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-9, 0); g.lineTo(9, 0); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
      g.restore();
      g.fillStyle = '#e8eef5';
      g.beginPath(); g.arc(hx, hy, 3.5, 0, Math.PI * 2); g.fill();
    }
    // The player arrow.
    const heading = s.vehicle ? s.vehicle.heading : s.player.heading;
    const ax = v.x(px), ay = v.y(pz);
    const size = Math.max(9, Math.min(14, pin * 1.15));
    g.save();
    g.translate(ax, ay);
    g.rotate(Math.PI - heading);
    g.shadowColor = 'rgba(0, 0, 0, 0.8)';
    g.shadowBlur = 6;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.72, size * 0.8); g.lineTo(0, size * 0.4); g.lineTo(-size * 0.72, size * 0.8); g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = s.vehicle ? '#55ebff' : '#ffc24b';
    g.beginPath(); g.moveTo(0, -size * 0.5); g.lineTo(size * 0.3, size * 0.3); g.lineTo(-size * 0.3, size * 0.3); g.closePath(); g.fill();
    g.restore();
  }

  // The static layers are painted once into offscreen canvases and blitted each frame.
  const WORLD = { x0: -720, z0: -680, x1: 940, z1: 680 };
  const caches = new Map();
  function cachedBase(scale, labels) {
    const key = `${scale.toFixed(3)}|${labels ? 1 : 0}`;
    let entry = caches.get(key);
    if (!entry) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((WORLD.x1 - WORLD.x0) * scale);
      canvas.height = Math.ceil((WORLD.z1 - WORLD.z0) * scale);
      const v = makeView((WORLD.x0 + WORLD.x1) / 2, (WORLD.z0 + WORLD.z1) / 2, scale, canvas.width, canvas.height);
      drawBase(canvas.getContext('2d'), v, { labels });
      entry = { canvas, scale };
      if (caches.size > 6) caches.clear();
      caches.set(key, entry);
    }
    return entry;
  }

  /** Blit the cached base map under view `v`. */
  function blitBase(g, v, labels) {
    const entry = cachedBase(labels ? v.scale : Math.min(2.2, v.scale * 1.0), labels);
    const k = v.scale / entry.scale;
    g.imageSmoothingEnabled = true;
    g.drawImage(entry.canvas, v.x(WORLD.x0), v.y(WORLD.z0), entry.canvas.width * k, entry.canvas.height * k);
  }

  /** The HUD minimap: a north-up window around the player, zooming out with speed. */
  function drawMinimap(canvas, s) {
    const g = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const px = s.vehicle ? s.vehicle.x : s.player.x;
    const pz = s.vehicle ? s.vehicle.z : s.player.z;
    const speed = Math.abs(s.vehicle?.speed ?? 0);
    const span = 230 + Math.min(1, speed / 50) * 90;
    const v = makeView(px, pz, w / span, w, h);
    g.clearRect(0, 0, w, h);
    g.fillStyle = COLORS.waterDeep;
    g.fillRect(0, 0, w, h);
    // One cached scale for the whole zoom range keeps the minimap a single blit per frame.
    const base = cachedBase(w / 230, false);
    const k = v.scale / base.scale;
    g.drawImage(base.canvas, v.x(WORLD.x0), v.y(WORLD.z0), base.canvas.width * k, base.canvas.height * k);
    drawLive(g, v, s);
    // Edge vignette so the window reads as glass.
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.62);
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(2, 6, 10, 0.5)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  /** The full city map for the pause menu: the whole bay, labelled, with every blip. */
  function drawCityMap(canvas, s) {
    const g = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const scale = Math.min(w / 1300, h / 1090);
    const v = makeView(156, 18, scale, w, h);
    g.clearRect(0, 0, w, h);
    g.fillStyle = COLORS.waterDeep;
    g.fillRect(0, 0, w, h);
    blitBase(g, v, true);
    drawLive(g, v, { ...s, fullMap: true });
  }

  return { drawMinimap, drawCityMap, gpsRoute };
}
