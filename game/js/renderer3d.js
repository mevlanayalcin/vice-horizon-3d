// renderer3d.js — SOLARIS BAY's own WebGL2 renderer. No libraries, no textures, no
// network: every mesh is procedural, every shader authored here. One lit program for
// the world (golden-hour sun, hemisphere ambient, fog, emissive neon), one water
// program with animated waves and sun glitter, one procedural sky, and two tiny
// batchers for camera-facing light bloom and soft ground shadows.
//
// Geometry format (11 floats / vertex): position(3) normal(3) colour(3)
// emissive(0..1) sway(0..1). MeshBuilder builds it; nothing here touches the network.

export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
  return out;
}

export function lookAt(out, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  for (let i = 0; i < 4; i += 1) {
    const a0 = a[i], a1 = a[i + 4], a2 = a[i + 8], a3 = a[i + 12];
    out[i] = a0 * b[0] + a1 * b[1] + a2 * b[2] + a3 * b[3];
    out[i + 4] = a0 * b[4] + a1 * b[5] + a2 * b[6] + a3 * b[7];
    out[i + 8] = a0 * b[8] + a1 * b[9] + a2 * b[10] + a3 * b[11];
    out[i + 12] = a0 * b[12] + a1 * b[13] + a2 * b[14] + a3 * b[15];
  }
  return out;
}

export function invert(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return identity();
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
export function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---------------------------------------------------------------------------
// MeshBuilder — pushes flat, interleaved triangles. Face normals are computed
// for flat panels; boxes and cylinders shade their faces for readable silhouettes.
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

/** Filmic shoulder shared by every surface shader: highlights roll off, hue and
 *  saturation survive because the whole colour is scaled by its brightest channel. */
const TONEMAP_GLSL = /* glsl */`
vec3 filmic(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  float k = 0.64;
  float s = 0.52;
  float f = m <= k ? m : k + (m - k) / (1.0 + (m - k) / s);
  return clamp(c * (f / max(m, 1e-4)), 0.0, 1.0);
}`;

const MAIN_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aEmit;
layout(location = 4) in float aSway;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vEmit;
out float vSway;
void main() {
  vec3 p = aPos;
  float sway = aSway * (sin(uTime * 1.7 + p.x * 0.11 + p.z * 0.07) * 0.30
                       + sin(uTime * 3.1 + p.z * 0.19) * 0.12);
  p.x += sway * aSway;
  p.z += sway * 0.55 * aSway;
  vec4 world = uModel * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vEmit = aEmit;
  vSway = aSway;
  gl_Position = uProj * uView * world;
}`;

const MAIN_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vEmit;
in float vSway;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uNight;
uniform float uTime;
out vec4 fragColor;
${TONEMAP_GLSL}
void main() {
  vec3 N = normalize(vNormal);
  float ndl = max(dot(N, normalize(uSunDir)), 0.0);
  float wrap = max(dot(N, normalize(uSunDir)) * 0.5 + 0.5, 0.0);
  vec3 amb = mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
  vec3 base = vColor * (amb * mix(0.95, 0.84, uNight)
    + uSunColor * (ndl * 0.80 + wrap * 0.14) * mix(1.0, 0.62, uNight));
  vec3 V = normalize(uCamPos - vWorld);
  vec3 H = normalize(V + normalize(uSunDir));
  float spec = pow(max(dot(N, H), 0.0), 34.0) * 0.16;
  base += uSunColor * spec;
  float lit = vEmit > 0.85 ? 1.0 : mix(0.2, 1.0, uNight);
  vec3 emission = vColor * vEmit * lit * (vEmit > 0.85 ? 1.55 : 1.25);
  vec3 col = base * (1.0 - clamp(vEmit, 0.0, 1.0) * 0.7) + emission;
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  fog *= smoothstep(0.35, 1.0, 1.0 - vEmit * 0.55);
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.9));
  fragColor = vec4(filmic(col), 1.0);
}`;

const WATER_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
out vec3 vWorld;
vec3 wave(vec3 p) {
  float y = sin(p.x * 0.09 + uTime * 1.15) * 0.16
          + sin(p.z * 0.13 - uTime * 0.85) * 0.13
          + sin((p.x + p.z) * 0.055 + uTime * 0.55) * 0.22;
  return vec3(p.x, p.y + y, p.z);
}
void main() {
  vec3 p = wave(aPos);
  vWorld = p;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;

const WATER_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyTop;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uNight;
out vec4 fragColor;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
${TONEMAP_GLSL}
void main() {
  float e = 0.6;
  float hx = sin(vWorld.x * 0.35 + uTime * 1.9) * 0.10 + sin(vWorld.z * 0.22 - uTime * 1.3) * 0.08;
  float hz = cos(vWorld.z * 0.30 + uTime * 1.6) * 0.11 + cos(vWorld.x * 0.18 + uTime * 1.1) * 0.07;
  vec3 N = normalize(vec3(-hx, 1.0, -hz));
  vec3 V = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  float depthT = clamp((vWorld.z - 330.0) / 180.0, 0.0, 1.0);
  float eastT = clamp((vWorld.x - 500.0) / 120.0, 0.0, 1.0);
  vec3 water = mix(uShallow, uDeep, max(depthT, eastT * 0.85));
  vec3 sky = mix(uSkyHorizon, uSkyTop, 0.42);
  vec3 col = mix(water, sky, fres * 0.62);
  vec3 H = normalize(V + normalize(uSunDir));
  float spec = pow(max(dot(N, H), 0.0), 220.0);
  float sparkle = pow(max(dot(N, H), 0.0), 42.0) * (0.35 + hash(floor(vWorld.xz * 4.0 + uTime * 2.0)) * 0.65);
  col += uSunColor * (spec * 1.5 + sparkle * 0.22);
  float shore = smoothstep(7.0, 0.0, abs(vWorld.z - 337.0));
  float ripple = sin(vWorld.z * 1.1 - uTime * 2.6 + sin(vWorld.x * 0.25) * 2.0) * 0.5 + 0.5;
  col = mix(col, vec3(0.94, 0.98, 0.97), shore * (0.25 + ripple * 0.4));
  vec3 nightGlow = vec3(0.55, 0.18, 0.62) * uNight * 0.30 * (1.0 - depthT);
  col += nightGlow * (0.4 + fres);
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.9));
  fragColor = vec4(filmic(col), 1.0);
}`;

const SKY_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() {
  vNdc = aPos;
  gl_Position = vec4(aPos, 0.999, 1.0);
}`;

const SKY_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCityGlow;
uniform vec3 uFogColor;
uniform float uNight;
uniform float uStars;
uniform float uSunSize;
uniform float uTime;
uniform vec2 uResolution;
out vec4 fragColor;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(13.7, 7.1);
    a *= 0.5;
  }
  return v;
}
${TONEMAP_GLSL}
void main() {
  vec4 far = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  float up = clamp(dir.y, -0.2, 1.0);
  float t = pow(clamp(up, 0.0, 1.0), 0.52);
  vec3 col = mix(uSkyHorizon, uSkyTop, t);
  // Keep the band just above the horizon chromatic: orange melts into magenta,
  // and only the zenith goes deep indigo, so the sky never reads as grey.
  vec3 mid = mix(uSkyHorizon, uCityGlow, 0.55) * 1.02;
  col = mix(mix(uSkyHorizon, mid, smoothstep(0.0, 0.30, t)), col, smoothstep(0.22, 1.0, t));
  col *= mix(1.0, 0.86, smoothstep(0.3, 1.0, t));
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  float glow = pow(sd, 8.0) * 0.16 + pow(sd, 64.0) * 0.26 + pow(sd, 400.0) * 0.85;
  col += uSunColor * glow;
  float horizon = exp(-max(dir.y, 0.0) * 9.0);
  col += uCityGlow * horizon * (0.12 + uNight * 0.20);
  vec2 cuv = dir.xz / max(dir.y + 0.16, 0.09) * 0.55 + vec2(uTime * 0.0025, 0.0);
  float cloud = fbm(cuv * 1.2);
  cloud = smoothstep(0.52, 0.82, cloud) * smoothstep(0.015, 0.18, dir.y);
  vec3 cloudColor = mix(uSkyHorizon * 0.9, uSunColor, clamp(pow(sd, 2.0) * 0.9 + 0.18, 0.0, 1.0));
  col = mix(col, cloudColor, cloud * 0.62);
  vec3 cell = floor(dir * 330.0);
  float starSeed = hash(cell.xz + cell.y * 17.3);
  float star = smoothstep(0.9975, 1.0, starSeed) * smoothstep(0.02, 0.35, dir.y);
  col += vec3(0.85, 0.9, 1.0) * star * uStars * 1.3;
  float disc = smoothstep(uSunSize - 0.00022, uSunSize + 0.00022, sd);
  col += uSunColor * disc * 1.6 * (1.0 - cloud * 0.6);
  fragColor = vec4(filmic(col), 1.0);
}`;

const GLOW_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aAlpha;
layout(location = 3) in vec2 aUV;
uniform mat4 uProj;
uniform mat4 uView;
out vec3 vColor;
out float vAlpha;
out vec2 vUV;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vUV = aUV;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const GLOW_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
in vec2 vUV;
out vec4 fragColor;
void main() {
  float d = length(vUV);
  if (d > 1.0) discard;
  float falloff = pow(1.0 - d, 2.1);
  fragColor = vec4(vColor * falloff, vAlpha * falloff);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('shader compile failed: ' + log);
  }
  return shader;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
  const uniforms = new Map();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i += 1) {
    const info = gl.getActiveUniform(p, i);
    uniforms.set(info.name, gl.getUniformLocation(p, info.name));
  }
  return { p, u: uniforms };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser');

  const main = program(gl, MAIN_VS, MAIN_FS);
  const water = program(gl, WATER_VS, WATER_FS);
  const sky = program(gl, SKY_VS, SKY_FS);
  const glow = program(gl, GLOW_VS, GLOW_FS);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.06, 0.08, 0.13, 1);

  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const vp = new Float32Array(16);
  const invVP = new Float32Array(16);
  const planes = new Float32Array(24);

  function extractPlanes(m) {
    const rows = (i) => [m[i], m[i + 4], m[i + 8], m[i + 12]];
    const r0 = rows(0), r1 = rows(1), r2 = rows(2), r3 = rows(3);
    const set = (i, a, b, sign) => {
      let x = b[0] + a[0] * sign, y = b[1] + a[1] * sign, z = b[2] + a[2] * sign, w = b[3] + a[3] * sign;
      const len = Math.hypot(x, y, z) || 1;
      planes[i * 4] = x / len; planes[i * 4 + 1] = y / len; planes[i * 4 + 2] = z / len; planes[i * 4 + 3] = w / len;
    };
    set(0, r0, r3, 1); set(1, r0, r3, -1);
    set(2, r1, r3, 1); set(3, r1, r3, -1);
    set(4, r2, r3, 1); set(5, r2, r3, -1);
  }

  function inFrustum(b) {
    for (let i = 0; i < 6; i += 1) {
      const x = planes[i * 4], y = planes[i * 4 + 1], z = planes[i * 4 + 2], w = planes[i * 4 + 3];
      if (x * b.cx + y * b.cy + z * b.cz + w < -b.radius) return false;
    }
    return true;
  }

  function createMesh(geometry) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.data, gl.STATIC_DRAW);
    const stride = 11 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 40);
    gl.bindVertexArray(null);
    const bounds = geometry.bounds;
    let meshBounds = null;
    if (Number.isFinite(bounds.minX)) {
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const cz = (bounds.minZ + bounds.maxZ) / 2;
      meshBounds = { cx, cy, cz, radius: Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2 + 1 };
    }
    return { vao, vbo, count: geometry.count, bounds: meshBounds, capacity: geometry.count };
  }

  // Dynamic world mesh (cars, people, pickups), rebuilt on the CPU each frame.
  const dynamic = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0, capacity: 0 };
  gl.bindVertexArray(dynamic.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, dynamic.vbo);
  const stride = 11 * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 40);
  gl.bindVertexArray(null);

  // Camera-facing light bloom.
  const glowBatch = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0, data: new Float32Array(0), capacity: 0 };
  gl.bindVertexArray(glowBatch.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, glowBatch.vbo);
  const glowStride = 9 * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, glowStride, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, glowStride, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, glowStride, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, glowStride, 28);
  gl.bindVertexArray(null);

  // Sky triangles (fullscreen).
  const skyVAO = gl.createVertexArray();
  const skyVBO = gl.createBuffer();
  gl.bindVertexArray(skyVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Water: a big tessellated plane with wave displacement in the vertex shader.
  const waterGeo = (() => {
    const positions = [];
    const size = 2900;
    const seg = 96;
    const z0 = -1500, z1 = 2100, x0 = -1600, x1 = 1600;
    for (let iz = 0; iz < seg; iz += 1) {
      for (let ix = 0; ix < seg; ix += 1) {
        const ax = x0 + ((x1 - x0) * ix) / seg;
        const bx = x0 + ((x1 - x0) * (ix + 1)) / seg;
        const az = z0 + ((z1 - z0) * iz) / seg;
        const bz = z0 + ((z1 - z0) * (iz + 1)) / seg;
        positions.push(ax, -0.86, az, bx, -0.86, az, bx, -0.86, bz);
        positions.push(ax, -0.86, az, bx, -0.86, bz, ax, -0.86, bz);
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, count: positions.length / 3 };
  })();

  let env = null;
  let time = 0;
  let width = 1, height = 1;
  let camera = null;
  let frameStats = { statics: 0, drawn: 0, triangles: 0 };

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(canvas.clientWidth * ratio));
    const h = Math.max(240, Math.round(canvas.clientHeight * ratio));
    if (w === width && h === height) return;
    width = w; height = h;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  function setDynamic(geometry) {
    if (geometry.count === 0) { dynamic.count = 0; return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, dynamic.vbo);
    if (geometry.count > dynamic.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, geometry.data, gl.DYNAMIC_DRAW);
      dynamic.capacity = geometry.count;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.data);
    }
    dynamic.count = geometry.count;
  }

  /** points: [{x,y,z,r,color:[3],alpha}] — quads billboarded toward the camera. */
  function setGlow(points) {
    if (!points.length) { glowBatch.count = 0; return; }
    const need = points.length * 6 * 9;
    if (!glowBatch.data || glowBatch.data.length < need) glowBatch.data = new Float32Array(need * 2);
    const d = glowBatch.data;
    let i = 0;
    const right = camera.right, up = camera.up;
    for (const pt of points) {
      const r = pt.r, g = pt.g ?? pt.color[1], b = pt.b ?? pt.color[2];
      const cr = pt.color[0], cg = g, cb = b;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [u, v] of corners) {
        d[i++] = pt.x + (right[0] * u + up[0] * v) * r;
        d[i++] = pt.y + (right[1] * u + up[1] * v) * r;
        d[i++] = pt.z + (right[2] * u + up[2] * v) * r;
        d[i++] = cr; d[i++] = cg; d[i++] = cb;
        d[i++] = pt.alpha;
        d[i++] = u; d[i++] = v;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, glowBatch.vbo);
    const floats = i;
    if (floats > glowBatch.capacity * 9) {
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, floats), gl.DYNAMIC_DRAW);
      glowBatch.capacity = floats / 9;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, floats));
    }
    glowBatch.count = floats / 9;
  }

  /** shadows: [{x,z,y,rx,rz,alpha}] — flat radial darkening on the ground. */
  function setShadows(shadows) {
    if (!shadows.length) return;
    const need = shadows.length * 6 * 9;
    if (!glowBatch.data || glowBatch.data.length < need) glowBatch.data = new Float32Array(need * 2);
    const d = glowBatch.data;
    let i = 0;
    for (const s of shadows) {
      const y = s.y ?? 0.02;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [u, v] of corners) {
        d[i++] = s.x + u * s.rx;
        d[i++] = y;
        d[i++] = s.z + v * s.rz;
        d[i++] = 0.02; d[i++] = 0.02; d[i++] = 0.05;
        d[i++] = s.alpha;
        d[i++] = u; d[i++] = v;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, glowBatch.vbo);
    const floats = i;
    if (floats > glowBatch.capacity * 9) {
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, floats), gl.DYNAMIC_DRAW);
      glowBatch.capacity = floats / 9;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, floats));
    }
    glowBatch.count = floats / 9;
  }

  function drawSky() {
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.p);
    gl.uniformMatrix4fv(sky.u.get('uInvVP'), false, invVP);
    gl.uniform3fv(sky.u.get('uCamPos'), camera.pos);
    gl.uniform3fv(sky.u.get('uSkyTop'), env.skyTop);
    gl.uniform3fv(sky.u.get('uSkyHorizon'), env.skyHorizon);
    gl.uniform3fv(sky.u.get('uSunColor'), env.sunGlow);
    gl.uniform3fv(sky.u.get('uSunDir'), env.sunDir);
    gl.uniform3fv(sky.u.get('uCityGlow'), env.cityGlow);
    gl.uniform3fv(sky.u.get('uFogColor'), env.fogColor);
    gl.uniform1f(sky.u.get('uNight'), env.night);
    gl.uniform1f(sky.u.get('uStars'), env.stars);
    gl.uniform1f(sky.u.get('uSunSize'), env.sunSize);
    gl.uniform1f(sky.u.get('uTime'), time);
    gl.uniform2f(sky.u.get('uResolution'), width, height);
    gl.bindVertexArray(skyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  function drawWater() {
    gl.useProgram(water.p);
    gl.uniformMatrix4fv(water.u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(water.u.get('uView'), false, view);
    gl.uniform3fv(water.u.get('uCamPos'), camera.pos);
    gl.uniform3fv(water.u.get('uSunDir'), env.sunDir);
    gl.uniform3fv(water.u.get('uSunColor'), env.sunColor);
    gl.uniform3fv(water.u.get('uSkyHorizon'), env.skyHorizon);
    gl.uniform3fv(water.u.get('uSkyTop'), env.skyTop);
    gl.uniform3fv(water.u.get('uDeep'), env.deepWater);
    gl.uniform3fv(water.u.get('uShallow'), env.shallowWater);
    gl.uniform3fv(water.u.get('uFogColor'), env.fogColor);
    gl.uniform1f(water.u.get('uFogDensity'), env.fogDensity);
    gl.uniform1f(water.u.get('uTime'), time);
    gl.uniform1f(water.u.get('uNight'), env.night);
    gl.bindVertexArray(waterGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, waterGeo.count);
  }

  function applyMainUniforms(withModel) {
    gl.useProgram(main.p);
    gl.uniformMatrix4fv(main.u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(main.u.get('uView'), false, view);
    if (withModel) gl.uniformMatrix4fv(main.u.get('uModel'), false, identity());
    gl.uniform3fv(main.u.get('uSunDir'), env.sunDir);
    gl.uniform3fv(main.u.get('uSunColor'), env.sunColor);
    gl.uniform3fv(main.u.get('uSkyAmb'), env.ambientSky);
    gl.uniform3fv(main.u.get('uGroundAmb'), env.ambientGround);
    gl.uniform3fv(main.u.get('uFogColor'), env.fogColor);
    gl.uniform3fv(main.u.get('uCamPos'), camera.pos);
    gl.uniform1f(main.u.get('uFogDensity'), env.fogDensity);
    gl.uniform1f(main.u.get('uNight'), env.night);
    gl.uniform1f(main.u.get('uTime'), time);
  }

  function drawGlowBatch() {
    if (!glowBatch.count) return;
    gl.useProgram(glow.p);
    gl.uniformMatrix4fv(glow.u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(glow.u.get('uView'), false, view);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.bindVertexArray(glowBatch.vao);
    gl.drawArrays(gl.TRIANGLES, 0, glowBatch.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawShadows() {
    if (!glowBatch.count) return;
    gl.useProgram(glow.p);
    gl.uniformMatrix4fv(glow.u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(glow.u.get('uView'), false, view);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(glowBatch.vao);
    gl.drawArrays(gl.TRIANGLES, 0, glowBatch.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function renderFrame(frame) {
    camera = frame.camera;
    env = frame.env;
    time = frame.time;
    frameStats = { statics: 0, drawn: 0, triangles: 0 };

    const aspect = width / height;
    perspective(proj, (camera.fov * Math.PI) / 180, aspect, 0.25, 1600);
    lookAt(view, camera.pos, camera.target, camera.up ?? [0, 1, 0]);
    multiply(vp, proj, view);
    invert(invVP, vp);
    extractPlanes(vp);

    // Camera basis for camera-facing bloom.
    const fwd = normalize3([camera.target[0] - camera.pos[0], camera.target[1] - camera.pos[1], camera.target[2] - camera.pos[2]]);
    const right = normalize3(cross3(fwd, [0, 1, 0]));
    camera.forward = fwd;
    camera.right = right;
    camera.up = cross3(right, fwd);

    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    drawSky();
    drawWater();

    if (frame.shadows && frame.shadows.length) {
      setShadows(frame.shadows);
      drawShadows();
    }
    applyMainUniforms(true);
    for (const mesh of frame.statics) {
      frameStats.statics += 1;
      if (mesh.bounds && !inFrustum(mesh.bounds)) continue;
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      frameStats.drawn += 1;
      frameStats.triangles += mesh.count / 3;
    }
    if (frame.dynamic && frame.dynamic.count) {
      setDynamic(frame.dynamic);
      gl.bindVertexArray(dynamic.vao);
      gl.drawArrays(gl.TRIANGLES, 0, dynamic.count);
      frameStats.triangles += dynamic.count / 3;
    }
    if (frame.glow && frame.glow.length) {
      setGlow(frame.glow);
      drawGlowBatch();
    }
    return frameStats;
  }

  resize();
  return {
    gl,
    resize,
    createMesh,
    renderFrame,
    stats: () => ({ ...frameStats, width, height }),
  };
}

export const ENV_KEYS = ['sunDir', 'sunColor', 'skyTop', 'skyHorizon', 'fogColor', 'ambientSky', 'ambientGround', 'sunGlow', 'cityGlow', 'night', 'stars', 'sunSize', 'fogDensity'];
