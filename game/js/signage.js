// signage.js — Solaris Bay's neon lettering. A hand-drawn stroke font (A–Z, 0–9 and a
// little punctuation on a 4×6 grid) is bent into emissive glass tubes on the facades:
// rooftop hotel marquees, vertical blade signs, storefront names and billboards. Every
// sign is real geometry in the city mesh, so it blooms at dusk and mirrors on wet asphalt.

/** Stroke glyphs: each letter is a list of polylines on a grid 4 wide and 6 tall. */
const GLYPHS = {
  A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 1], [3, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  P: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
  Q: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[2, 2], [4, 0]]],
  R: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
  X: [[[0, 6], [4, 0]], [[0, 0], [4, 6]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  0: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  1: [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  2: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  3: [[[0, 6], [4, 6], [2, 3.5], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [1, 0], [0, 1]]],
  4: [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  5: [[[4, 6], [0, 6], [0, 3.5], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [0, 0]]],
  6: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  7: [[[0, 6], [4, 6], [1, 0]]],
  8: [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  9: [[[4, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  '-': [[[1, 3], [3, 3]]],
  '.': [[[1.7, 0], [2.3, 0]]],
  '&': [[[4, 0], [1, 4], [1, 5], [2, 6], [3, 5], [3, 4], [0, 1.5], [0, 1], [1, 0], [2, 0], [4, 2]]],
  '★': [[[2, 6], [2.6, 4], [4, 4], [3, 2.6], [3.6, 0.4], [2, 1.6], [0.4, 0.4], [1, 2.6], [0, 4], [1.4, 4], [2, 6]]],
};

const GLYPH_W = 4;
const ADVANCE = 5.6;
const SPACE = 3.4;

/** Width in metres of a line of neon text at a given cap height. */
export function measureNeonText(text, height) {
  const unit = height / 6;
  let w = 0;
  for (const ch of String(text).toUpperCase()) w += (ch === ' ' ? SPACE : ADVANCE) * unit;
  return Math.max(0, w - (ADVANCE - GLYPH_W) * unit);
}

/**
 * One tube from a to b lying in the sign plane: a square-section prism whose front face
 * looks along `n`. `right` and `up` span the plane, both unit vectors.
 */
function tube(b, a, c, n, thickness, depth, color, e) {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  const d = [dx / len, dy / len, dz / len];
  // In-plane perpendicular to the stroke: n × d.
  const p = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
  const hw = thickness / 2;
  const ext = hw * 0.85;
  const A = [a[0] - d[0] * ext, a[1] - d[1] * ext, a[2] - d[2] * ext];
  const C = [c[0] + d[0] * ext, c[1] + d[1] * ext, c[2] + d[2] * ext];
  const at = (q, s, f) => [q[0] + p[0] * s * hw + n[0] * f * depth, q[1] + p[1] * s * hw + n[1] * f * depth, q[2] + p[2] * s * hw + n[2] * f * depth];
  const opts = (normal) => ({ n: normal, e });
  b.quad(at(A, -1, 1), at(C, -1, 1), at(C, 1, 1), at(A, 1, 1), color, opts(n));
  b.quad(at(A, 1, 1), at(C, 1, 1), at(C, 1, 0), at(A, 1, 0), color, opts(p));
  b.quad(at(A, -1, 0), at(C, -1, 0), at(C, -1, 1), at(A, -1, 1), color, opts([-p[0], -p[1], -p[2]]));
}

/**
 * Neon text on a vertical plane. `normal` is the facing direction [nx, nz] (the side a
 * reader stands on); `align` is 'center' or 'left'. Optional `board` draws a dark backing
 * panel, `glow(x, y, z, color, size, alpha)` adds bloom halos along the line.
 * Returns the line width in metres.
 */
export function addNeonText(b, text, opts) {
  const {
    x, y, z, height = 1, normal = [0, 1], color, align = 'center',
    emit = 1, weight = 0.11, board = null, boardPad = 0.45, glow = null, glowAlpha = 0.45,
  } = opts;
  const nl = Math.hypot(normal[0], normal[1]) || 1;
  const n = [normal[0] / nl, 0, normal[1] / nl];
  const right = [n[2], 0, -n[0]];
  const unit = height / 6;
  const width = measureNeonText(text, height);
  let cursor = align === 'center' ? -width / 2 : 0;
  const thickness = Math.max(0.05, height * weight);
  const origin = (u, v) => [x + right[0] * u, y + v, z + right[2] * u];
  if (board) {
    const bw = width + boardPad * 2, bh = height + boardPad * 2;
    const cx = align === 'center' ? 0 : width / 2;
    const c = origin(cx, height / 2);
    b.box(c[0] - n[0] * 0.12, c[1], c[2] - n[2] * 0.12, Math.abs(right[0]) * bw + Math.abs(n[0]) * 0.22, bh, Math.abs(right[2]) * bw + Math.abs(n[2]) * 0.22, board, { omitBottom: true, e: 0.05 });
  }
  for (const ch of String(text).toUpperCase()) {
    if (ch === ' ') { cursor += SPACE * unit; continue; }
    const strokes = GLYPHS[ch];
    if (strokes) {
      for (const line of strokes) {
        for (let i = 0; i < line.length - 1; i += 1) {
          const a = origin(cursor + line[i][0] * unit, line[i][1] * unit);
          const c = origin(cursor + line[i + 1][0] * unit, line[i + 1][1] * unit);
          tube(b, a, c, n, thickness, thickness * 0.6, color, emit);
        }
      }
    }
    cursor += ADVANCE * unit;
  }
  if (glow) {
    const count = Math.max(1, Math.round(width / (height * 2.2)));
    const start = align === 'center' ? -width / 2 : 0;
    for (let i = 0; i < count; i += 1) {
      const u = start + ((i + 0.5) / count) * width;
      const g = origin(u, height / 2);
      glow(g[0] + n[0] * 0.6, g[1], g[2] + n[2] * 0.6, color, height * 1.9, glowAlpha);
    }
  }
  return width;
}

/**
 * A vertical blade sign: the letters of `word` stacked top to bottom, the classic Deco
 * hotel pylon. `yTop` is the top of the first letter. Returns the stack height.
 */
export function addNeonColumn(b, word, opts) {
  const { x, yTop, z, height = 1.2, gap = 0.35, normal = [0, 1], color, glow = null, emit = 1 } = opts;
  let y = yTop - height;
  for (const ch of String(word).toUpperCase()) {
    if (ch !== ' ') addNeonText(b, ch, { x, y, z, height, normal, color, emit, weight: 0.13 });
    if (glow) glow(x + normal[0] * 0.7, y + height / 2, z + normal[1] * 0.7, color, height * 1.6, 0.4);
    y -= height + gap;
  }
  return (height + gap) * word.length - gap;
}

/** Original names for the Strip's hotels, clubs and storefronts — no real brands. */
export const HOTEL_NAMES = [
  'HOTEL MARISOL', 'SOL CLUB', 'CORAL PLAZA', 'THE PALOMA', 'AZUR GRAND',
  'CASA DEL MAR', 'LA BRISA', 'OCEANA', 'VISTA DORADA', 'HOTEL FLAMINGO', 'SEA BREEZE', 'MIRAMAR',
];
export const SHOP_NAMES = [
  'TACOS', 'SURF', 'CAFE', 'BAR', 'GELATO', 'PIZZA', 'VINYL', 'TATTOO', 'LOUNGE', 'DINER',
  'SUSHI', 'ARCADE', 'BOUTIQUE', 'JUICE', 'MOTEL', 'CASINO', 'DISCO', 'BODEGA',
];
