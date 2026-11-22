// Solaris Bay v11 module: meshkit (procedural WebGL2 vehicle & tower geometry).
// meshkit.js — SOLARIS BAY's geometry toolkit. MeshBuilder writes interleaved
// triangles for the WebGL2 renderer (11 floats a vertex: position, normal, colour,
// emissive 0..1 and a material channel). The material channel is the palm sway weight
// when positive and the paint gloss when negative, so sleek cars, glass and wet
// stone share one vertex format. Flat helpers (box, segment, flat) build the city's
// architecture; the smooth helpers (surface, tube, ellipsoid) sculpt curved car bodies,
// tapered palm trunks, arching fronds and rounded characters with per-vertex normals.

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; };

export class MeshBuilder {
  constructor(capacity = 4096) {
    this.data = new Float32Array(capacity * 11);
    this.length = 0;
    this.bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  }

  ensure(extra) {
    if (this.length + extra * 11 <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + extra * 11) size *= 2;
    const next = new Float32Array(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  vert(x, y, z, nx, ny, nz, c, e = 0, s = 0) {
    this.ensure(1);
    const d = this.data;
    let i = this.length;
    d[i++] = x; d[i++] = y; d[i++] = z;
    d[i++] = nx; d[i++] = ny; d[i++] = nz;
    d[i++] = c[0]; d[i++] = c[1]; d[i++] = c[2];
    d[i++] = e; d[i++] = s;
    this.length = i;
    const b = this.bounds;
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (z < b.minZ) b.minZ = z;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
    if (z > b.maxZ) b.maxZ = z;
  }

  tri(a, b, c, color, opts = {}) {
    let nx = 0, ny = 0, nz = 0;
    if (opts.n) {
      nx = opts.n[0]; ny = opts.n[1]; nz = opts.n[2];
    } else {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
    }
    const e = opts.e ?? 0;
    const s = opts.s ?? 0;
    this.vert(a[0], a[1], a[2], nx, ny, nz, color, e, s);
    this.vert(b[0], b[1], b[2], nx, ny, nz, color, e, s);
    this.vert(c[0], c[1], c[2], nx, ny, nz, color, e, s);
  }

  quad(a, b, c, d, color, opts = {}) {
    this.tri(a, b, c, color, opts);
    this.tri(a, c, d, color, opts);
  }

  /**
   * Axis-aligned (optionally yaw-rotated) box. Only outward faces are added,
   * optionally skipping downward faces for speed. `top`/`bottom` recolor caps.
   */
  box(cx, cy, cz, sx, sy, sz, color, opts = {}) {
    const yaw = opts.rotY ?? 0;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const e = opts.e ?? 0;
    const s = opts.s ?? 0;
    const lx = (x, z) => cx + x * cos - z * sin;
    const lz = (x, z) => cz + x * sin + z * cos;
    const top = opts.top ?? [color[0] * 1.08, color[1] * 1.08, color[2] * 1.08];
    const bottom = opts.bottom ?? [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
    const sideShade = opts.sideShade ?? 0.86;
    const front = opts.front ?? color;
    const back = opts.back ?? [color[0] * 0.8, color[1] * 0.8, color[2] * 0.8];
    const left = opts.left ?? [color[0] * sideShade, color[1] * sideShade, color[2] * sideShade];
    const right = opts.right ?? [color[0] * sideShade * 0.95, color[1] * sideShade * 0.95, color[2] * sideShade * 0.95];

    const x0 = lx(-hx, -hz), z0 = lz(-hx, -hz);
    const x1 = lx(hx, -hz), z1 = lz(hx, -hz);
    const x2 = lx(hx, hz), z2 = lz(hx, hz);
    const x3 = lx(-hx, hz), z3 = lz(-hx, hz);
    const y0 = cy - hy, y1 = cy + hy;
    const nE = [cos, 0, sin], nW = [-cos, 0, -sin];
    const nS = [-sin, 0, cos], nN = [sin, 0, -cos];

    if (!opts.omitTop) this.quad([x0, y1, z0], [x1, y1, z1], [x2, y1, z2], [x3, y1, z3], top, { n: [0, 1, 0], e, s });
    if (opts.bottom !== null && !opts.omitBottom) this.quad([x3, y0, z3], [x2, y0, z2], [x1, y0, z1], [x0, y0, z0], bottom, { n: [0, -1, 0], e, s: 0 });
    this.quad([x1, y0, z1], [x2, y0, z2], [x2, y1, z2], [x1, y1, z1], right, { n: nE, e, s });
    this.quad([x3, y0, z3], [x0, y0, z0], [x0, y1, z0], [x3, y1, z3], left, { n: nW, e, s });
    this.quad([x2, y0, z2], [x3, y0, z3], [x3, y1, z3], [x2, y1, z2], front, { n: nS, e, s });
    this.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], back, { n: nN, e, s });
  }

  /** A thin structural beam between two points — used for crane arms, cables, limbs. */
  segment(a, b, width, height, color, opts = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 0.0001;
    const d = [dx / len, dy / len, dz / len];
    let side = cross3(d, [0, 1, 0]);
    if (Math.hypot(...side) < 0.001) side = [1, 0, 0];
    const sl = Math.hypot(...side);
    side = [side[0] / sl, side[1] / sl, side[2] / sl];
    const up = cross3(side, d);
    const hw = width / 2, hh = height / 2;
    const corner = (p, sx, sy) => [
      p[0] + side[0] * sx * hw + up[0] * sy * hh,
      p[1] + side[1] * sx * hw + up[1] * sy * hh,
      p[2] + side[2] * sx * hw + up[2] * sy * hh,
    ];
    const e = opts.e ?? 0;
    const s = opts.s ?? 0;
    const sides = [
      [[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]],
    ];
    const n0 = [side[0] * 1, side[1], side[2]];
    const n1 = [-side[0], -side[1], -side[2]];
    const n2 = [up[0], up[1], up[2]];
    const n3 = [-up[0], -up[1], -up[2]];
    const normals = [n0, n1, n2, n3];
    for (let i = 0; i < 4; i += 1) {
      const [c1, c2] = sides[i];
      this.quad(corner(a, c1[0], c1[1]), corner(b, c1[0], c1[1]), corner(b, c2[0], c2[1]), corner(a, c2[0], c2[1]), color, { n: normals[i], e, s });
    }
    this.quad(corner(a, 1, 1), corner(a, -1, 1), corner(a, -1, -1), corner(a, 1, -1), color, { n: [-d[0], -d[1], -d[2]], e, s });
    this.quad(corner(b, 1, 1), corner(b, -1, 1), corner(b, -1, -1), corner(b, 1, -1), color, { n: d, e, s });
  }

  cylinder(cx, cy, cz, radiusBottom, radiusTop, height, sides, color, opts = {}) {
    const e = opts.e ?? 0;
    const s = opts.s ?? 0;
    const cap = opts.cap ?? [color[0] * 1.05, color[1] * 1.05, color[2] * 1.05];
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0 = [cx + c0 * radiusBottom, cy, cz + s0 * radiusBottom];
      const p1 = [cx + c1 * radiusBottom, cy, cz + s1 * radiusBottom];
      const p2 = [cx + c1 * radiusTop, cy + height, cz + s1 * radiusTop];
      const p3 = [cx + c0 * radiusTop, cy + height, cz + s0 * radiusTop];
      const nx = (c0 + c1) / 2, nz = (s0 + s1) / 2;
      this.quad(p0, p1, p2, p3, color, { n: [nx, 0, nz], e, s });
      if (opts.capTop !== false) this.tri([cx, cy + height, cz], p2, p3, cap, { n: [0, 1, 0], e, s });
      if (opts.capBottom) this.tri([cx, cy, cz], p0, p1, cap, { n: [0, -1, 0], e });
    }
  }

  /** Wheel: a short cylinder lying on the X axis, at (cx,cy,cz), for a car facing -Z. */
  wheel(cx, cy, cz, radius, width, color, rimColor, opts = {}) {
    const sides = opts.sides ?? 12;
    const e = opts.e ?? 0;
    const s = opts.s ?? 0;
    const hw = width / 2;
    const yaw = opts.rotY ?? 0;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const P = (dx, y, dz) => [cx + dx * cos - dz * sin, y, cz + dx * sin + dz * cos];
    const N = (nx, ny, nz) => [nx * cos - nz * sin, ny, nx * sin + nz * cos];
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const y0 = cy + Math.cos(a0) * radius, z0 = cz + Math.sin(a0) * radius;
      const y1 = cy + Math.cos(a1) * radius, z1 = cz + Math.sin(a1) * radius;
      const ny = (Math.cos(a0) + Math.cos(a1)) / 2, nz = (Math.sin(a0) + Math.sin(a1)) / 2;
      this.quad(P(-hw, y0, z0 - cz), P(hw, y0, z0 - cz), P(hw, y1, z1 - cz), P(-hw, y1, z1 - cz), color, { n: N(0, ny, nz), e, s });
      this.tri(P(-hw, cy, 0), P(-hw, cy, z0 - cz), P(-hw, cy, z1 - cz), rimColor, { n: N(-1, 0, 0), e, s });
      this.tri(P(hw, cy, 0), P(hw, cy, z1 - cz), P(hw, cy, z0 - cz), rimColor, { n: N(1, 0, 0), e, s });
    }
  }

  sphere(cx, cy, cz, radius, color, opts = {}) {
    const seg = opts.segments ?? 8;
    const rings = opts.rings ?? 5;
    const e = opts.e ?? 0;
    const s = opts.s ?? 0;
    for (let r = 0; r < rings; r += 1) {
      const p0 = (r / rings) * Math.PI;
      const p1 = ((r + 1) / rings) * Math.PI;
      for (let i = 0; i < seg; i += 1) {
        const t0 = (i / seg) * Math.PI * 2;
        const t1 = ((i + 1) / seg) * Math.PI * 2;
        const point = (p, t) => {
          const nx = Math.sin(p) * Math.cos(t), ny = Math.cos(p), nz = Math.sin(p) * Math.sin(t);
          return { p: [cx + nx * radius, cy + ny * radius, cz + nz * radius], n: [nx, ny, nz] };
        };
        const A = point(p0, t0), B = point(p1, t0), C = point(p1, t1), D = point(p0, t1);
        this.quad(A.p, B.p, C.p, D.p, color, { n: [A.n[0] + C.n[0], A.n[1] + C.n[1], A.n[2] + C.n[2]], e, s });
      }
    }
  }

  /** A flat horizontal quad, y-up, for roads, sidewalks, plazas and beach. */
  flat(cx, cz, sx, sz, y, color, opts = {}) {
    const hx = sx / 2, hz = sz / 2;
    const e = opts.e ?? 0;
    const s = opts.s ?? 0;
    if (opts.rotY) {
      const cos = Math.cos(opts.rotY), sin = Math.sin(opts.rotY);
      const rot = (x, z) => [cx + x * cos - z * sin, cz + x * sin + z * cos];
      const p0 = rot(-hx, -hz), p1 = rot(hx, -hz), p2 = rot(hx, hz), p3 = rot(-hx, hz);
      this.quad([p0[0], y, p0[1]], [p1[0], y, p1[1]], [p2[0], y, p2[1]], [p3[0], y, p3[1]], color, { n: [0, 1, 0], e, s });
    } else {
      this.quad([cx - hx, y, cz - hz], [cx + hx, y, cz - hz], [cx + hx, y, cz + hz], [cx - hx, y, cz + hz], color, { n: [0, 1, 0], e, s });
    }
  }

  /** Invisible collider helper does not belong here; world keeps its own lists. */
  geometry() {
    const out = new Float32Array(this.length);
    out.set(this.data.subarray(0, this.length));
    return { data: out, count: this.length / 11, bounds: this.bounds };
  }

  // -------------------------------------------------------------------------
  // Smooth, curved geometry
  // -------------------------------------------------------------------------

  /** One triangle with a normal and colour per corner: the building block of every curve. */
  triSmooth(a, b, c, na, nb, nc, ca, cb, cc, e = 0, s = 0) {
    this.vert(a[0], a[1], a[2], na[0], na[1], na[2], ca, e, s);
    this.vert(b[0], b[1], b[2], nb[0], nb[1], nb[2], cb, e, s);
    this.vert(c[0], c[1], c[2], nc[0], nc[1], nc[2], cc, e, s);
  }

  /**
   * A smooth-shaded sheet through a grid of points: rows run along a path, columns
   * around or across a section (`wrap` closes the columns into a ring). Normals come from
   * central differences and are turned to face away from `axis[i]`, each row's centre,
   * when one is given. `colorAt(i, j)` paints a cell, `emitAt(i, j)` lights it.
   */
  surface(points, opts = {}) {
    const rows = points.length;
    const cols = points[0].length;
    const wrap = !!opts.wrap;
    const axis = opts.axis ?? null;
    const s = opts.s ?? 0;
    const normals = new Array(rows);
    for (let i = 0; i < rows; i += 1) {
      const row = new Array(cols);
      const ip = Math.min(i + 1, rows - 1), im = Math.max(i - 1, 0);
      for (let j = 0; j < cols; j += 1) {
        const jp = wrap ? (j + 1) % cols : Math.min(j + 1, cols - 1);
        const jm = wrap ? (j - 1 + cols) % cols : Math.max(j - 1, 0);
        const p = points[i][j];
        const du = sub3(points[ip][j], points[im][j]);
        let n = unit3(cross3(du, sub3(points[i][jp], points[i][jm])));
        if (n[0] === 0 && n[1] === 0 && n[2] === 0) {
          // A collapsed row (a rounded nose or a pointed tip): face along the path.
          n = unit3(i === 0 ? [-du[0], -du[1], -du[2]] : du);
        } else if (axis) {
          const out = sub3(p, axis[i]);
          if (dot3(n, out) < 0) n = [-n[0], -n[1], -n[2]];
        }
        if (opts.flip) n = [-n[0], -n[1], -n[2]];
        row[j] = n;
      }
      normals[i] = row;
    }
    const base = opts.color ?? [0.8, 0.8, 0.8];
    const lastJ = wrap ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i += 1) {
      for (let j = 0; j < lastJ; j += 1) {
        const j1 = (j + 1) % cols;
        const color = opts.colorAt ? opts.colorAt(i, j) : base;
        if (!color) continue;
        const e = opts.emitAt ? opts.emitAt(i, j) : (opts.e ?? 0);
        const gloss = opts.glossAt ? opts.glossAt(i, j) : s;
        const A = points[i][j], B = points[i + 1][j], C = points[i + 1][j1], D = points[i][j1];
        const nA = normals[i][j], nB = normals[i + 1][j], nC = normals[i + 1][j1], nD = normals[i][j1];
        this.triSmooth(A, B, C, nA, nB, nC, color, color, color, e, gloss);
        this.triSmooth(A, C, D, nA, nC, nD, color, color, color, e, gloss);
      }
    }
  }

  /**
   * A tapered tube along a path (palm trunks, limbs, rails). `radii` gives one radius
   * per path point (0 closes a tip), frames are parallel-transported so curved trunks
   * never twist, and `colorAt(i)` bands the rows.
   */
  tube(path, radii, sides, color, opts = {}) {
    const n = path.length;
    const tangents = path.map((p, i) => unit3(sub3(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)])));
    let ref = Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let normal = unit3(cross3(cross3(tangents[0], ref), tangents[0]));
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      const t = tangents[i];
      normal = unit3(sub3(normal, t.map((x) => x * dot3(normal, t))));
      if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) normal = unit3(cross3(t, [0.3, 0.9, 0.2]));
      const binormal = cross3(t, normal);
      const r = radii[i];
      const ring = [];
      for (let k = 0; k < sides; k += 1) {
        const a = (k / sides) * Math.PI * 2;
        const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        ring.push([path[i][0] + normal[0] * ca + binormal[0] * sa, path[i][1] + normal[1] * ca + binormal[1] * sa, path[i][2] + normal[2] * ca + binormal[2] * sa]);
      }
      rows.push(ring);
    }
    const colorAt = opts.colorAt ? (i) => opts.colorAt(i) : null;
    this.surface(rows, { wrap: true, axis: path, color, colorAt, e: opts.e ?? 0, s: opts.s ?? 0 });
    // Optional flat caps close the open ends (push-bar tubes, exhaust tips, mirror stalks).
    if (opts.capEnds) {
      const capColor = opts.capColor ?? color;
      for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
        if (radii[i] <= 0) continue;
        const t = tangents[i], ring = rows[i], c = path[i];
        const nrm = [t[0] * sign, t[1] * sign, t[2] * sign];
        for (let k = 0; k < sides; k += 1) {
          const a = ring[k], b = ring[(k + 1) % sides];
          this.tri(c, sign > 0 ? a : b, sign > 0 ? b : a, capColor, { n: nrm, e: opts.capE ?? opts.e ?? 0, s: opts.s ?? 0 });
        }
      }
    }
  }

  /**
   * A smooth ellipsoid (heads, hands, cabins, lamps), optionally yawed and cut to its
   * upper part with `top` (1 whole, 0.5 a dome) for hair, caps and domes.
   */
  ellipsoid(cx, cy, cz, rx, ry, rz, color, opts = {}) {
    const seg = opts.segments ?? 10;
    const rings = opts.rings ?? 7;
    const top = opts.top ?? 1;
    const yaw = opts.yaw ?? 0;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const rows = [];
    const axis = [];
    for (let r = 0; r <= rings; r += 1) {
      const phi = (r / rings) * Math.PI * top;
      const y = Math.cos(phi), rad = Math.sin(phi);
      const ring = [];
      for (let k = 0; k < seg; k += 1) {
        const a = (k / seg) * Math.PI * 2;
        const lx = Math.cos(a) * rad * rx, lz = Math.sin(a) * rad * rz;
        ring.push([cx + lx * cos + lz * sin, cy + y * ry, cz - lx * sin + lz * cos]);
      }
      rows.push(ring);
      axis.push([cx, cy, cz]);
    }
    this.surface(rows, { wrap: true, axis, color, colorAt: opts.colorAt, e: opts.e ?? 0, s: opts.s ?? 0 });
  }
}
