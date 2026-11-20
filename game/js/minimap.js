// minimap.js — the vector cartography of Solaris Bay. One painter draws the city from
// world.map (ocean, coastline, beach, pier, district tints, building footprints, roads
// with casings and lane dashes) at any zoom, then layers the live blips: GPS route,
// mission and activity markers, safehouse garage, traffic, pulsing police vision cones,
// the helicopter's searchlight and the player arrow. It feeds both the HUD minimap and
// the full-screen city map in the pause menu.

import { DISTRICTS, SAFEHOUSE, CITY } from './config.js';

const COLORS = {
  water: '#0f3f4f',
  waterDeep: '#0a2a3a',
  land: '#1f2b33',
  hills: '#22332c',
  sand: '#b89a62',
  surf: 'rgba(120, 236, 230, 0.55)',
  pier: '#7a5a3a',
  building: '#33434d',
  buildingTall: '#43596a',
  roadCase: '#0b1115',
  road: '#7d8d94',
  roadMain: '#a9b6ba',
  boulevard: '#cfc6b2',
  dash: 'rgba(255, 214, 120, 0.85)',
};

const DISTRICT_TINTS = [
  { x: 0, z: 262, w: 960, d: 44, color: 'rgba(255, 178, 87, 0.14)' },
  { x: -10, z: -60, w: 420, d: 300, color: 'rgba(197, 108, 255, 0.10)' },
  { x: -350, z: -210, w: 230, d: 320, color: 'rgba(87, 216, 208, 0.09)' },
  { x: 345, z: 170, w: 330, d: 240, color: 'rgba(92, 200, 255, 0.09)' },
  { x: 60, z: -400, w: 960, d: 120, color: 'rgba(158, 224, 106, 0.08)' },
];

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

  /** The static city: water, land, beach, pier, district tints, footprints and roads. */
  function drawBase(g, v, opts = {}) {
    const ocean = g.createLinearGradient(0, v.y(300), 0, v.y(520));
    ocean.addColorStop(0, COLORS.water);
    ocean.addColorStop(1, COLORS.waterDeep);
    g.fillStyle = ocean;
    g.fillRect(0, 0, v.w, v.h);
    // Ripples on the bay.
    g.strokeStyle = 'rgba(110, 220, 225, 0.07)';
    g.lineWidth = Math.max(1, v.scale * 0.8);
    for (let z = 320; z < 620; z += 26) {
      g.beginPath(); g.moveTo(v.x(-600), v.y(z)); g.lineTo(v.x(900), v.y(z)); g.stroke();
    }
    // Land masses.
    rect(g, v, 40, -84 - 40, 960, 852, COLORS.land);
    rect(g, v, 40, -400, 960, 110, COLORS.hills);
    rect(g, v, 654, 185, 212, 230, COLORS.land);
    for (const t of DISTRICT_TINTS) rect(g, v, t.x, t.z, t.w, t.d, t.color);
    // Beach, surf line and pier.
    rect(g, v, 25, 319, 990, 34, COLORS.sand);
    rect(g, v, 25, 295, 990, 13, '#8c6c4a');
    g.strokeStyle = COLORS.surf;
    g.lineWidth = Math.max(1.5, v.scale * 1.6);
    g.beginPath(); g.moveTo(v.x(-470), v.y(337)); g.lineTo(v.x(520), v.y(337)); g.stroke();
    rect(g, v, -166, 374, 20, 144, COLORS.pier);
    rect(g, v, -166, 430, 44, 26, COLORS.pier);
    rect(g, v, 760, 190, 26, 90, '#6a5a44');
    // Building footprints with a lit edge.
    for (const b of buildings) {
      if (b.x + b.w / 2 < v.minX || b.x - b.w / 2 > v.maxX || b.z + b.d / 2 < v.minZ || b.z - b.d / 2 > v.maxZ) continue;
      const x = v.x(b.x - b.w / 2), y = v.y(b.z - b.d / 2), w = b.w * v.scale, h = b.d * v.scale;
      g.fillStyle = b.h > 45 ? COLORS.buildingTall : COLORS.building;
      g.fillRect(x, y, w, h);
      if (v.scale > 0.9) {
        g.fillStyle = 'rgba(255, 255, 255, 0.07)';
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
    const font = Math.round(Math.max(11, v.scale * 13));
    g.font = `800 ${font}px "Trebuchet MS", "DejaVu Sans", sans-serif`;
    for (const d of DISTRICTS) {
      const x = v.x(d.x), y = v.y(d.id === 'palm' ? 240 : d.z);
      g.fillStyle = 'rgba(4, 8, 12, 0.6)';
      const w = g.measureText(d.name.toUpperCase()).width + 14;
      g.fillRect(x - w / 2, y - font * 0.8, w, font * 1.6);
      g.fillStyle = d.color;
      g.fillText(d.name.toUpperCase(), x, y + 1);
    }
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
    drawBase(g, v);
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
    const scale = Math.min(w / 1290, h / 1000);
    const v = makeView(150, -28, scale, w, h);
    g.clearRect(0, 0, w, h);
    drawBase(g, v, { labels: true });
    drawLive(g, v, { ...s, fullMap: true });
  }

  return { drawMinimap, drawCityMap, gpsRoute };
}
