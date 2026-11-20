// renderer3d.js — SOLARIS BAY's own WebGL2 renderer. No libraries, no textures, no
// network: every mesh is procedural, every shader authored here. Each frame renders a
// half-resolution planar reflection of the city (mirrored under the street plane) for
// wet asphalt and the bay, then the scene into a multisampled HDR target: an analytic
// sky dome, the bay's water, soft contact shadows, the lit world (golden-hour sun,
// hemisphere ambient, rim light, glossy paint and glass, wet streets, neon, fog) and
// additive light halos. postfx.js then blooms, sweeps god rays and grades the frame.
//
// Geometry format (11 floats / vertex): position(3) normal(3) colour(3) emissive(0..1)
// material (palm sway when positive, paint gloss when negative), built by meshkit.js.

import { createPostFX } from './postfx.js';

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
// Shaders
// ---------------------------------------------------------------------------

/** Filmic shoulder: highlights roll off while hue and saturation survive, because the
 *  whole colour is scaled by its brightest channel. With an HDR target the shoulder runs
 *  once in postfx.js; on an 8-bit target each surface shader applies it inline. */
const TONEMAP_GLSL = /* glsl */`
uniform float uInlineTone;
vec3 filmic(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  float k = 0.64;
  float s = 0.52;
  float f = m <= k ? m : k + (m - k) / (1.0 + (m - k) / s);
  return clamp(c * (f / max(m, 1e-4)), 0.0, 1.0);
}
vec3 outputTone(vec3 c) { return uInlineTone > 0.5 ? filmic(c) : max(c, vec3(0.0)); }`;

/** Smooth value noise shared by the ground, water and sky shaders. */
const NOISE_GLSL = /* glsl */`
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
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
out float vMaterial;
void main() {
  vec3 p = aPos;
  float swayW = max(aSway, 0.0);
  float sway = swayW * (sin(uTime * 1.7 + p.x * 0.11 + p.z * 0.07) * 0.30
                       + sin(uTime * 3.1 + p.z * 0.19) * 0.12);
  p.x += sway * swayW;
  p.z += sway * 0.55 * swayW;
  vec4 world = uModel * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vEmit = aEmit;
  vMaterial = aSway;
  gl_Position = uProj * uView * world;
}`;

/**
 * The world's surface shader: golden-hour sun with wrap and skylight fill, procedural
 * stone / asphalt / facade detail, glossy car paint and glass that mirror the sky, wet
 * asphalt that samples the planar reflection, neon spill, emissive neon and fog.
 */
const MAIN_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vEmit;
in float vMaterial;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uCityGlow;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uNight;
uniform float uTime;
uniform float uWet;
uniform float uClipY;
uniform float uReflOn;
uniform vec2 uViewport;
uniform sampler2D uRefl;
out vec4 fragColor;
${TONEMAP_GLSL}
${NOISE_GLSL}
vec3 skyReflection(vec3 R) {
  float up = clamp(R.y, -1.0, 1.0);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(up, 0.0, 1.0), 0.55));
  sky += uCityGlow * exp(-max(up, 0.0) * 6.0) * (0.12 + uNight * 0.4);
  sky = mix(uGroundAmb * 0.28, sky, smoothstep(-0.16, 0.05, up));
  float sd = max(dot(R, normalize(uSunDir)), 0.0);
  sky += uSunColor * (pow(sd, 420.0) * 7.0 + pow(sd, 28.0) * 0.45) * (1.0 - uNight * 0.75);
  return sky;
}
void main() {
  if (vWorld.y < uClipY) discard;
  vec3 N = normalize(vNormal);
  vec3 sun = normalize(uSunDir);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(N, V) < 0.0 && vMaterial < 0.0) N = -N;
  float ndl = max(dot(N, sun), 0.0);
  float wrap = max(dot(N, sun) * 0.5 + 0.5, 0.0);
  vec3 amb = mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
  vec3 base = vColor * (amb * mix(0.95, 0.84, uNight)
    + uSunColor * (ndl * 0.80 + wrap * 0.14) * mix(1.0, 0.62, uNight));
  // Skylight fill on faces turned away from the sun, so characters and facades
  // keep their colour in shadow instead of crushing to black.
  base += vColor * uSkyAmb * (1.0 - ndl) * (1.0 - abs(N.y)) * 0.30;
  // Warm rim light from the low sun behind silhouettes.
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0) * smoothstep(-0.2, 0.6, dot(-V, sun));
  base += uSunColor * rim * 0.22 * (1.0 - uNight) * (1.0 - abs(N.y) * 0.6);

  // --- procedural surface detail: stable world-space patterns, no textures.
  float horizontal = smoothstep(0.72, 0.97, abs(N.y));
  float vertical = 1.0 - smoothstep(0.18, 0.6, abs(N.y));
  float grain = hash21(floor(vWorld.xz * 7.0)) - 0.5;
  float patches = vnoise(vWorld.xz * 0.12) * 0.65 + vnoise(vWorld.xz * 0.55) * 0.35 - 0.5;
  base *= 1.0 + horizontal * (grain * 0.06 + patches * 0.16);
  float floorBand = smoothstep(0.82, 1.0, fract(vWorld.y / 3.55));
  float bandFade = smoothstep(2.5, 7.0, vWorld.y) * (1.0 - smoothstep(70.0, 140.0, vWorld.y));
  float matte = step(-0.01, vMaterial);
  base *= 1.0 - vertical * floorBand * bandFade * 0.16 * matte;
  float mullion = smoothstep(0.44, 0.5, abs(fract(vWorld.x * 0.22 + vWorld.z * 0.22) - 0.5));
  base *= 1.0 + vertical * mullion * smoothstep(4.0, 12.0, vWorld.y) * 0.07 * matte;
  // Street-level ambient occlusion under towers and awnings.
  float groundAO = mix(0.74, 1.0, smoothstep(0.0, 11.0, vWorld.y));
  base *= mix(1.0, groundAO, vertical * (1.0 - clamp(vEmit, 0.0, 1.0)) * matte);

  vec3 H = normalize(V + sun);
  float spec = pow(max(dot(N, H), 0.0), 34.0) * 0.16;
  base += uSunColor * spec;
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - NdV, 5.0);

  // Glossy materials: negative material = gloss (car paint), -1 = tinted glass.
  float gloss = clamp(-vMaterial, 0.0, 1.0);
  if (gloss > 0.0) {
    vec3 R = reflect(-V, N);
    vec3 env = skyReflection(R);
    float glass = step(0.97, gloss);
    float k = mix((0.05 + 0.95 * fres) * gloss * 0.9 + 0.06, 0.16 + 0.84 * fres, glass);
    base = mix(base, env, clamp(k, 0.0, 0.92));
    base += uSunColor * pow(max(dot(N, H), 0.0), 260.0) * 3.2 * gloss * (1.0 - uNight * 0.6);
  }

  // Wet streets: the planar reflection of the city on rain-washed asphalt and stone.
  float ground = horizontal * (1.0 - smoothstep(0.35, 0.6, vWorld.y)) * matte * step(vEmit, 0.3);
  if (uWet > 0.0 && ground > 0.0) {
    float puddle = smoothstep(0.38, 0.72, vnoise(vWorld.xz * 0.075 + 3.1) * 0.7 + vnoise(vWorld.xz * 0.31) * 0.3);
    float wet = uWet * mix(0.5, 1.0, puddle) * ground;
    vec2 uv = gl_FragCoord.xy / uViewport;
    uv.x += (vnoise(vWorld.xz * 2.3) - 0.5) * 0.006 * (1.0 - puddle);
    uv.y += (vnoise(vWorld.zx * 1.7) - 0.5) * 0.004;
    vec3 refl = uReflOn > 0.5 ? texture(uRefl, uv).rgb : skyReflection(reflect(-V, N));
    float k = (0.10 + 0.90 * fres) * mix(0.75, 1.0, puddle);
    base = base * (1.0 - wet * 0.42) + refl * wet * k;
  }
  // Neon light spilled on the pavement: a warm/cool wash at street level.
  float spill = smoothstep(9.0, 0.0, vWorld.y) * horizontal * uNight;
  base += vec3(0.20, 0.08, 0.26) * spill * (0.30 + patches * 0.45);

  float lit = vEmit > 0.85 ? 1.0 : mix(0.2, 1.0, uNight);
  vec3 emission = vColor * vEmit * lit * (vEmit > 0.85 ? 2.1 : 1.5);
  vec3 col = base * (1.0 - clamp(vEmit, 0.0, 1.0) * 0.7) + emission;
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  fog *= smoothstep(0.35, 1.0, 1.0 - vEmit * 0.55);
  // Atmospheric depth: haze glows gold toward the sun and cools to rose-violet away from it.
  float toSun = pow(max(dot(-V, sun), 0.0), 5.0);
  vec3 fogCol = mix(uFogColor * mix(vec3(0.90, 0.80, 1.02), vec3(1.0), uNight), uSunColor * 1.05, toSun * 0.65 * (1.0 - uNight));
  col = mix(col, fogCol, clamp(fog, 0.0, 0.9));
  fragColor = vec4(outputTone(col), 1.0);
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

/** The bay: turquoise shallows to deep blue, the city mirrored in the swell, sun path and surf. */
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
uniform float uReflOn;
uniform vec2 uViewport;
uniform sampler2D uRefl;
out vec4 fragColor;
${TONEMAP_GLSL}
${NOISE_GLSL}
float waveH(vec2 p) {
  return sin(p.x * 0.09 + uTime * 1.15) * 0.16
       + sin(p.y * 0.13 - uTime * 0.85) * 0.13
       + sin((p.x + p.y) * 0.055 + uTime * 0.55) * 0.22;
}
void main() {
  vec2 p = vWorld.xz;
  float hx = sin(p.x * 0.35 + uTime * 1.9) * 0.10 + sin(p.y * 0.22 - uTime * 1.3) * 0.08 + (vnoise(p * 0.9 + uTime * 0.6) - 0.5) * 0.10;
  float hz = cos(p.y * 0.30 + uTime * 1.6) * 0.11 + cos(p.x * 0.18 + uTime * 1.1) * 0.07 + (vnoise(p.yx * 0.8 - uTime * 0.5) - 0.5) * 0.10;
  vec3 N = normalize(vec3(-hx, 1.0, -hz));
  vec3 V = normalize(uCamPos - vWorld);
  vec3 sun = normalize(uSunDir);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  float depthT = clamp((vWorld.z - 330.0) / 180.0, 0.0, 1.0);
  float eastT = clamp((vWorld.x - 500.0) / 120.0, 0.0, 1.0);
  vec3 water = mix(uShallow * vec3(0.86, 1.14, 1.05), uDeep, max(depthT, eastT * 0.85));
  vec3 sky = mix(uSkyHorizon, uSkyTop, 0.42);
  if (uReflOn > 0.5) {
    vec2 uv = gl_FragCoord.xy / uViewport + N.xz * vec2(0.035, 0.05);
    sky = texture(uRefl, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  }
  vec3 col = mix(water, sky, clamp(fres * 0.62 + 0.05, 0.0, 0.72));
  // Sun glitter: a broad path toward the sun plus fine animated sparkle on top.
  vec3 H = normalize(V + sun);
  float spec = pow(max(dot(N, H), 0.0), 180.0);
  float path = pow(max(dot(N, H), 0.0), 20.0);
  float sparkle = pow(max(dot(N, H), 0.0), 46.0) * (0.32 + hash21(floor(p * 4.0 + uTime * 2.0)) * 0.68);
  col += uSunColor * (spec * 2.6 + path * 0.22 + sparkle * 0.45) * (1.0 - uNight * 0.6);
  // Turquoise shore band, surf foam and long rolling crests.
  float shore = smoothstep(9.0, 0.0, abs(vWorld.z - 337.0));
  float ripple = sin(vWorld.z * 1.15 - uTime * 2.6 + sin(vWorld.x * 0.22) * 2.0) * 0.5 + 0.5;
  float foamNoise = vnoise(p * vec2(1.2, 3.0) + vec2(0.0, uTime * 1.4));
  col = mix(col, vec3(0.96, 0.99, 0.98), shore * (0.18 + ripple * 0.42 + foamNoise * 0.2));
  float crest = smoothstep(0.10, 0.26, waveH(p)) * smoothstep(70.0, 22.0, abs(vWorld.z - 320.0));
  col += vec3(0.75, 0.93, 0.94) * crest * 0.16;
  // Magenta / cyan neon shimmer on the night water.
  vec3 nightGlow = vec3(0.58, 0.18, 0.66) * uNight * 0.30 * (1.0 - depthT);
  nightGlow += vec3(0.10, 0.42, 0.55) * uNight * 0.16 * (0.4 + fres);
  col += nightGlow * (0.4 + fres);
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.9));
  fragColor = vec4(outputTone(col), 1.0);
}`;

const SKY_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() {
  vNdc = aPos;
  gl_Position = vec4(aPos, 0.999, 1.0);
}`;

/** Analytic sky dome: horizon-to-zenith gradient, sun disc and corona, drifting clouds, stars. */
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
${TONEMAP_GLSL}
${NOISE_GLSL}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(13.7, 7.1);
    a *= 0.5;
  }
  return v;
}
// The far shore across the bay: a backlit skyline of towers and hills on the horizon.
float skylineHeight(float az) {
  float cell = floor(az * 210.0);
  float h = hash21(vec2(cell, 3.7));
  float tower = h > 0.55 ? 0.006 + pow(hash21(vec2(cell, 9.1)), 2.0) * 0.030 : 0.003 + h * 0.006;
  float cluster = smoothstep(0.25, 0.75, vnoise(vec2(az * 9.0, 1.3)));
  float hills = 0.004 + vnoise(vec2(az * 22.0, 5.2)) * 0.008;
  return max(hills, tower * cluster);
}
void main() {
  vec4 far = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  vec3 sunN = normalize(uSunDir);
  float up = clamp(dir.y, -0.2, 1.0);
  float t = pow(clamp(up, 0.0, 1.0), 0.52);
  vec3 col = mix(uSkyHorizon, uSkyTop, t);
  vec3 mid = mix(uSkyHorizon, uCityGlow, 0.55) * 1.02;
  col = mix(mix(uSkyHorizon, mid, smoothstep(0.0, 0.30, t)), col, smoothstep(0.22, 1.0, t));
  col *= mix(1.0, 0.86, smoothstep(0.3, 1.0, t));
  // Tropical sunset layering: molten gold on the horizon under the sun, coral, rose,
  // magenta and violet climbing to indigo, weighted by how low the sun hangs.
  float sunset = (1.0 - smoothstep(0.55, 0.95, uNight)) * (1.0 - smoothstep(0.18, 0.62, sunN.y));
  vec2 dxz = normalize(dir.xz + vec2(1e-5));
  float facing = dot(dxz, normalize(sunN.xz + vec2(1e-5))) * 0.5 + 0.5;
  float e = clamp(up, 0.0, 1.0);
  vec3 gold = mix(vec3(1.0, 0.50, 0.34), vec3(1.0, 0.70, 0.30), facing);
  vec3 coral = mix(vec3(0.92, 0.36, 0.44), vec3(1.0, 0.46, 0.30), facing);
  vec3 rose = mix(vec3(0.62, 0.22, 0.52), vec3(0.90, 0.30, 0.46), facing);
  vec3 violet = vec3(0.30, 0.16, 0.46);
  vec3 indigo = vec3(0.07, 0.07, 0.24);
  vec3 band = mix(gold, coral, smoothstep(0.0, 0.07, e));
  band = mix(band, rose, smoothstep(0.05, 0.20, e));
  band = mix(band, violet, smoothstep(0.17, 0.42, e));
  band = mix(band, indigo, smoothstep(0.38, 0.95, e));
  col = mix(col, band, sunset * 0.92);
  float sd = max(dot(dir, sunN), 0.0);
  float glow = pow(sd, 8.0) * 0.22 + pow(sd, 64.0) * 0.42 + pow(sd, 400.0) * 2.2 + pow(sd, 2400.0) * 2.5;
  col += uSunColor * glow;
  float horizon = exp(-max(dir.y, 0.0) * 8.0);
  col += uCityGlow * horizon * (0.16 + uNight * 0.16);
  float pollution = exp(-max(dir.y, 0.0) * 7.0) * uNight;
  col += vec3(0.42, 0.10, 0.46) * pollution * 0.18;
  col *= mix(1.0, 0.72, uNight * smoothstep(0.05, 0.5, dir.y));
  col += vec3(0.06, 0.26, 0.34) * pow(max(sd, 0.0), 3.0) * uNight * 0.28;
  vec2 cuv = dir.xz / max(dir.y + 0.16, 0.09) * 0.55 + vec2(uTime * 0.0025, 0.0);
  float cloud = fbm(cuv * 1.2);
  cloud = smoothstep(0.50, 0.80, cloud) * smoothstep(0.015, 0.18, dir.y);
  vec3 cloudColor = mix(uSkyHorizon * 0.9, uSunColor * 1.15, clamp(pow(sd, 2.0) * 0.9 + 0.18, 0.0, 1.0));
  cloudColor = mix(cloudColor, mix(uCityGlow, vec3(0.95, 0.55, 0.75), 0.4), uNight * 0.5);
  col = mix(col, cloudColor, cloud * 0.68 * (1.0 - sunset * 0.55));
  // Long stratus bands over the sea, underlit gold toward the sun and magenta away from it,
  // with a hot silver lining where they cross the sun's corona.
  float az = atan(dir.z, dir.x);
  // atan jumps at due west: blend each azimuth noise with its 2pi twin across the seam.
  float azB = az - sign(az) * 6.2832;
  float seam = smoothstep(2.4, 3.1416, abs(az)) * 0.5;
  float bandY = e * 30.0 + mix(vnoise(vec2(az * 3.0, 0.5)), vnoise(vec2(azB * 3.0, 0.5)), seam) * 2.2;
  float streak = mix(fbm(vec2(az * 2.6 + uTime * 0.002, bandY)), fbm(vec2(azB * 2.6 + uTime * 0.002, bandY)), seam);
  streak = smoothstep(0.44, 0.66, streak) * smoothstep(0.012, 0.05, e) * (1.0 - smoothstep(0.16, 0.34, e));
  float puff = smoothstep(0.48, 0.74, mix(fbm(vec2(az * 5.0, e * 12.0) + 4.0), fbm(vec2(azB * 5.0, e * 12.0) + 4.0), seam)) * smoothstep(0.08, 0.16, e) * (1.0 - smoothstep(0.30, 0.5, e));
  float strat = clamp(streak + puff * 0.7, 0.0, 1.0) * sunset;
  // Backlit plum near the sun with molten rims; sunlit rose-pink across the rest of the sky.
  vec3 underlit = mix(vec3(1.05, 0.52, 0.62), vec3(0.42, 0.13, 0.26), pow(facing, 1.6));
  underlit = mix(underlit, vec3(0.30, 0.12, 0.36), smoothstep(0.12, 0.30, e) * (1.0 - facing * 0.4));
  float edge = clamp(strat * (1.0 - strat) * 4.0, 0.0, 1.0);
  float lining = pow(sd, 10.0) * 2.0 + pow(sd, 3.0) * 0.35;
  vec3 rimCol = vec3(1.0, 0.70, 0.34) * (0.25 + lining) * edge * 0.9;
  col = mix(col, underlit + rimCol * pow(facing, 2.0), clamp(strat * 1.25, 0.0, 0.92));
  // Soft crepuscular rays fanning up from the sun through the gaps.
  vec3 sideA = normalize(cross(sunN, vec3(0.0, 1.0, 0.0)));
  vec3 sideB = cross(sideA, sunN);
  float ang = atan(dot(dir, sideB), dot(dir, sideA));
  float angB = ang - sign(ang) * 6.2832;
  float angSeam = smoothstep(2.4, 3.1416, abs(ang)) * 0.5;
  float rayN = mix(vnoise(vec2(ang * 9.0, 0.0)) * 0.6 + vnoise(vec2(ang * 23.0, 7.0)) * 0.4,
                   vnoise(vec2(angB * 9.0, 0.0)) * 0.6 + vnoise(vec2(angB * 23.0, 7.0)) * 0.4, angSeam);
  float rays = smoothstep(0.35, 0.95, rayN);
  col += uSunColor * rays * pow(sd, 6.0) * 0.20 * sunset * (1.0 - strat * 0.7) * step(0.0, dir.y);
  vec3 cell = floor(dir * 330.0);
  float starSeed = hash21(cell.xz + cell.y * 17.3);
  float star = smoothstep(0.9975, 1.0, starSeed) * smoothstep(0.02, 0.35, dir.y);
  col += vec3(0.85, 0.9, 1.0) * star * uStars * 1.6;
  float disc = smoothstep(uSunSize - 0.00022, uSunSize + 0.00022, sd);
  float limb = 0.75 + 0.25 * smoothstep(uSunSize, 1.0, sd);
  col += mix(uSunColor, vec3(1.0, 0.86, 0.55), 0.5) * disc * limb * 3.6 * (1.0 - cloud * 0.6) * (1.0 - strat * 0.55) * (1.0 - uNight * 0.8);
  // The far shore across the bay: a backlit skyline silhouette with a few lit windows.
  float shore = smoothstep(0.15, 0.55, dxz.y);
  float hgt = skylineHeight(az);
  if (dir.y > -0.004 && dir.y < hgt && shore > 0.0) {
    vec3 sil = mix(vec3(0.20, 0.10, 0.24), uFogColor * 0.55, 0.45) * mix(1.0, 0.45, uNight);
    sil += uSunColor * pow(facing, 4.0) * 0.06 * (1.0 - uNight);
    float win = step(0.86, hash21(floor(vec2(az * 1400.0, dir.y * 1400.0)))) * smoothstep(0.003, 0.006, hgt - dir.y + 0.003);
    sil += vec3(1.0, 0.78, 0.48) * win * (0.25 + uNight * 0.9);
    col = mix(col, sil, shore * 0.92);
  }
  fragColor = vec4(outputTone(col), 1.0);
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

/** Additive light halos (neon, lamps, sirens, muzzle flashes) and soft contact shadows. */
const GLOW_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
in vec2 vUV;
uniform float uGain;
out vec4 fragColor;
void main() {
  float d = length(vUV);
  if (d > 1.0) discard;
  float falloff = pow(1.0 - d, 2.1);
  float core = pow(max(1.0 - d * 2.6, 0.0), 2.0);
  fragColor = vec4(vColor * (falloff + core * 1.4) * uGain, vAlpha * falloff);
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

/** A dynamic vertex batch for billboards and decals: position, colour, alpha, uv (9 floats). */
function createSpriteBatch(gl) {
  const batch = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0, data: new Float32Array(0), capacity: 0 };
  gl.bindVertexArray(batch.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, batch.vbo);
  const stride = 9 * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 28);
  gl.bindVertexArray(null);
  return batch;
}

function uploadSprites(gl, batch, floats) {
  gl.bindBuffer(gl.ARRAY_BUFFER, batch.vbo);
  if (floats > batch.capacity * 9) {
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, floats), gl.DYNAMIC_DRAW);
    batch.capacity = floats / 9;
  } else {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, floats));
  }
  batch.count = floats / 9;
}

const QUAD_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
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
  const post = createPostFX(gl);
  let inlineTone = post.hdr ? 0 : 1;

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.06, 0.08, 0.13, 1);

  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const viewMirror = new Float32Array(16);
  const vp = new Float32Array(16);
  const invVP = new Float32Array(16);
  const planes = new Float32Array(24);
  const MIRROR_Y = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const IDENTITY = new Float32Array(identity());

  function extractPlanes(m) {
    const rows = (i) => [m[i], m[i + 4], m[i + 8], m[i + 12]];
    const r0 = rows(0), r1 = rows(1), r2 = rows(2), r3 = rows(3);
    const set = (i, a, b, sign) => {
      const x = b[0] + a[0] * sign, y = b[1] + a[1] * sign, z = b[2] + a[2] * sign, w = b[3] + a[3] * sign;
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

  function bindWorldLayout() {
    const stride = 11 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 40);
  }

  function createMesh(geometry, key = '') {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.data, gl.STATIC_DRAW);
    bindWorldLayout();
    gl.bindVertexArray(null);
    const bounds = geometry.bounds;
    let meshBounds = null;
    if (Number.isFinite(bounds.minX)) {
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const cz = (bounds.minZ + bounds.maxZ) / 2;
      meshBounds = { cx, cy, cz, radius: Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2 + 1 };
    }
    // Flat ground plates never rise above the reflection clip, so the mirror pass skips them.
    const reflects = key !== 'ground';
    return { vao, vbo, count: geometry.count, bounds: meshBounds, capacity: geometry.count, key, reflects };
  }

  // Dynamic world mesh (cars, people, pickups), rebuilt on the CPU each frame.
  const dynamic = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0, capacity: 0 };
  gl.bindVertexArray(dynamic.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, dynamic.vbo);
  bindWorldLayout();
  gl.bindVertexArray(null);

  const glowBatch = createSpriteBatch(gl);
  const shadowBatch = createSpriteBatch(gl);

  // Sky triangle (fullscreen).
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
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(320, Math.round(canvas.clientWidth * ratio));
    const h = Math.max(240, Math.round(canvas.clientHeight * ratio));
    if (w === width && h === height) return;
    width = w; height = h;
    canvas.width = w; canvas.height = h;
    post.resize(w, h);
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

  /**
   * points: [{x,y,z,r,color:[3],alpha,flat,sx,sz,rot}] — camera-facing halos, or with `flat` a
   * horizontal light pool on the road (headlight wash, siren pools, searchlight spot).
   */
  function setGlow(points) {
    const need = points.length * 6 * 9;
    if (glowBatch.data.length < need) glowBatch.data = new Float32Array(need * 2);
    const d = glowBatch.data;
    let i = 0;
    const right = camera.right, up = camera.up;
    const fwd = camera.forward;
    for (const pt of points) {
      const r = pt.r;
      const cr = pt.color[0], cg = pt.color[1], cb = pt.color[2];
      if (pt.beam) {
        // A soft light shaft: a ribbon from source to target, turned to face the camera.
        const ax = pt.x2 - pt.x, ay = pt.y2 - pt.y, az = pt.z2 - pt.z;
        let sx = ay * fwd[2] - az * fwd[1], sy = az * fwd[0] - ax * fwd[2], sz = ax * fwd[1] - ay * fwd[0];
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        for (const [u, v] of QUAD_CORNERS) {
          const end = v > 0;
          const w = end ? pt.r2 : r;
          d[i++] = (end ? pt.x2 : pt.x) + sx * u * w;
          d[i++] = (end ? pt.y2 : pt.y) + sy * u * w;
          d[i++] = (end ? pt.z2 : pt.z) + sz * u * w;
          d[i++] = cr; d[i++] = cg; d[i++] = cb;
          d[i++] = pt.alpha;
          d[i++] = u; d[i++] = end ? 0.45 : 0.0;
        }
        continue;
      }
      for (const [u, v] of QUAD_CORNERS) {
        if (pt.flat) {
          const lx = u * r * (pt.sx ?? 1), lz = v * r * (pt.sz ?? 1);
          const c = Math.cos(pt.rot ?? 0), s = Math.sin(pt.rot ?? 0);
          d[i++] = pt.x + lx * c + lz * s;
          d[i++] = pt.y;
          d[i++] = pt.z - lx * s + lz * c;
        } else {
          d[i++] = pt.x + (right[0] * u + up[0] * v) * r;
          d[i++] = pt.y + (right[1] * u + up[1] * v) * r;
          d[i++] = pt.z + (right[2] * u + up[2] * v) * r;
        }
        d[i++] = cr; d[i++] = cg; d[i++] = cb;
        d[i++] = pt.alpha;
        d[i++] = u; d[i++] = v;
      }
    }
    uploadSprites(gl, glowBatch, i);
  }

  /** shadows: [{x,z,y,rx,rz,alpha,rot}] — soft contact shadows, yawed with their car. */
  function setShadows(shadows) {
    const need = shadows.length * 6 * 9;
    if (shadowBatch.data.length < need) shadowBatch.data = new Float32Array(need * 2);
    const d = shadowBatch.data;
    let i = 0;
    for (const s of shadows) {
      const y = s.y ?? 0.02;
      const c = Math.cos(s.rot ?? 0), sn = Math.sin(s.rot ?? 0);
      for (const [u, v] of QUAD_CORNERS) {
        const lx = u * s.rx, lz = v * s.rz;
        d[i++] = s.x + lx * c + lz * sn;
        d[i++] = y;
        d[i++] = s.z - lx * sn + lz * c;
        d[i++] = 0.0; d[i++] = 0.0; d[i++] = 0.0;
        d[i++] = s.alpha;
        d[i++] = u; d[i++] = v;
      }
    }
    uploadSprites(gl, shadowBatch, i);
  }

  function drawSky(viewProjInverse, camPos) {
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.p);
    gl.uniformMatrix4fv(sky.u.get('uInvVP'), false, viewProjInverse);
    gl.uniform3fv(sky.u.get('uCamPos'), camPos);
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
    gl.uniform1f(sky.u.get('uInlineTone'), inlineTone);
    gl.uniform2f(sky.u.get('uResolution'), width, height);
    gl.bindVertexArray(skyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  function drawWater(reflOn) {
    gl.useProgram(water.p);
    const u = water.u;
    gl.uniformMatrix4fv(u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(u.get('uView'), false, view);
    gl.uniform3fv(u.get('uCamPos'), camera.pos);
    gl.uniform3fv(u.get('uSunDir'), env.sunDir);
    gl.uniform3fv(u.get('uSunColor'), env.sunColor);
    gl.uniform3fv(u.get('uSkyHorizon'), env.skyHorizon);
    gl.uniform3fv(u.get('uSkyTop'), env.skyTop);
    gl.uniform3fv(u.get('uDeep'), env.deepWater);
    gl.uniform3fv(u.get('uShallow'), env.shallowWater);
    gl.uniform3fv(u.get('uFogColor'), env.fogColor);
    gl.uniform1f(u.get('uFogDensity'), env.fogDensity);
    gl.uniform1f(u.get('uTime'), time);
    gl.uniform1f(u.get('uNight'), env.night);
    gl.uniform1f(u.get('uInlineTone'), inlineTone);
    gl.uniform1f(u.get('uReflOn'), reflOn ? 1 : 0);
    gl.uniform2f(u.get('uViewport'), width, height);
    gl.uniform1i(u.get('uRefl'), 3);
    gl.bindVertexArray(waterGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, waterGeo.count);
  }

  function applyMainUniforms(viewMatrix, camPos, pass) {
    gl.useProgram(main.p);
    const u = main.u;
    gl.uniformMatrix4fv(u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(u.get('uView'), false, viewMatrix);
    gl.uniformMatrix4fv(u.get('uModel'), false, IDENTITY);
    gl.uniform3fv(u.get('uSunDir'), env.sunDir);
    gl.uniform3fv(u.get('uSunColor'), env.sunColor);
    gl.uniform3fv(u.get('uSkyAmb'), env.ambientSky);
    gl.uniform3fv(u.get('uGroundAmb'), env.ambientGround);
    gl.uniform3fv(u.get('uSkyTop'), env.skyTop);
    gl.uniform3fv(u.get('uSkyHorizon'), env.skyHorizon);
    gl.uniform3fv(u.get('uCityGlow'), env.cityGlow);
    gl.uniform3fv(u.get('uFogColor'), env.fogColor);
    gl.uniform3fv(u.get('uCamPos'), camPos);
    gl.uniform1f(u.get('uFogDensity'), env.fogDensity);
    gl.uniform1f(u.get('uNight'), env.night);
    gl.uniform1f(u.get('uTime'), time);
    gl.uniform1f(u.get('uInlineTone'), inlineTone);
    gl.uniform1f(u.get('uWet'), pass.wet);
    gl.uniform1f(u.get('uClipY'), pass.clipY);
    gl.uniform1f(u.get('uReflOn'), pass.reflOn ? 1 : 0);
    gl.uniform2f(u.get('uViewport'), width, height);
    gl.uniform1i(u.get('uRefl'), 3);
  }

  function drawGlowBatch(viewMatrix, gain) {
    if (!glowBatch.count) return;
    gl.useProgram(glow.p);
    gl.uniformMatrix4fv(glow.u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(glow.u.get('uView'), false, viewMatrix);
    gl.uniform1f(glow.u.get('uGain'), gain);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.bindVertexArray(glowBatch.vao);
    gl.drawArrays(gl.TRIANGLES, 0, glowBatch.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawShadows() {
    if (!shadowBatch.count) return;
    gl.useProgram(glow.p);
    gl.uniformMatrix4fv(glow.u.get('uProj'), false, proj);
    gl.uniformMatrix4fv(glow.u.get('uView'), false, view);
    gl.uniform1f(glow.u.get('uGain'), 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(shadowBatch.vao);
    gl.drawArrays(gl.TRIANGLES, 0, shadowBatch.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawWorld(statics, mirror) {
    for (const mesh of statics) {
      if (mirror && !mesh.reflects) continue;
      if (!mirror) frameStats.statics += 1;
      if (mesh.bounds && !inFrustum(mesh.bounds)) continue;
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      if (!mirror) {
        frameStats.drawn += 1;
        frameStats.triangles += mesh.count / 3;
      }
    }
    if (dynamic.count) {
      gl.bindVertexArray(dynamic.vao);
      gl.drawArrays(gl.TRIANGLES, 0, dynamic.count);
      if (!mirror) frameStats.triangles += dynamic.count / 3;
    }
  }

  /** Where the sun sits on screen (uv) and how strongly its shafts should show. */
  function sunScreen() {
    const s = env.sunDir;
    const p = [camera.pos[0] + s[0] * 1000, camera.pos[1] + s[1] * 1000, camera.pos[2] + s[2] * 1000, 1];
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (w <= 0) return [0, 0, 0];
    const sx = (x / w) * 0.5 + 0.5, sy = (y / w) * 0.5 + 0.5;
    const onScreen = Math.max(0, 1 - Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) * 1.1);
    const low = 1 - Math.min(1, Math.max(0, (s[1] - 0.12) / 0.5));
    return [sx, sy, onScreen * low * (1 - env.night * 0.85)];
  }

  function renderFrame(frame) {
    camera = frame.camera;
    env = frame.env;
    time = frame.time;
    frameStats = { statics: 0, drawn: 0, triangles: 0 };

    const aspect = width / height;
    perspective(proj, (camera.fov * Math.PI) / 180, aspect, 0.25, 1600);
    lookAt(view, camera.pos, camera.target, [0, 1, 0]);

    // Camera basis for camera-facing bloom.
    const fwd = normalize3([camera.target[0] - camera.pos[0], camera.target[1] - camera.pos[1], camera.target[2] - camera.pos[2]]);
    const right = normalize3(cross3(fwd, [0, 1, 0]));
    camera.forward = fwd;
    camera.right = right;
    camera.up = cross3(right, fwd);

    setDynamic(frame.dynamic ?? { count: 0 });
    setGlow(frame.glow ?? []);
    setShadows(frame.shadows ?? []);

    // Rain-washed streets after dark, a sunset sheen by day.
    const wet = env.wetness ?? (0.08 + env.night * 0.7);
    const reflOn = post.ok && wet > 0.02;
    inlineTone = post.hdr && post.ok ? 0 : 1;

    // 1. Planar reflection: the world mirrored under the street plane, at half resolution.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    if (reflOn) {
      multiply(viewMirror, view, MIRROR_Y);
      multiply(vp, proj, viewMirror);
      invert(invVP, vp);
      extractPlanes(vp);
      const mirrorPos = [camera.pos[0], -camera.pos[1], camera.pos[2]];
      post.beginReflection();
      gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawSky(invVP, mirrorPos);
      applyMainUniforms(viewMirror, mirrorPos, { wet: 0, clipY: 0.12, reflOn: false });
      drawWorld(frame.statics, true);
      drawGlowBatch(viewMirror, 0.85);
    }

    // 2. The scene, into the multisampled HDR target.
    multiply(vp, proj, view);
    invert(invVP, vp);
    extractPlanes(vp);
    if (post.ok) post.beginScene();
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height); }
    if (reflOn) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, post.reflectionTexture);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawSky(invVP, camera.pos);
    drawWater(reflOn);
    drawShadows();
    applyMainUniforms(view, camera.pos, { wet: reflOn ? wet : wet * 0.5, clipY: -1e6, reflOn });
    drawWorld(frame.statics, false);
    drawGlowBatch(view, 1);

    // 3. Bloom, god rays and the grade, onto the canvas.
    if (post.ok) {
      post.finish({
        bloom: 0.30 + env.night * 0.28,
        threshold: 1.02 - env.night * 0.16,
        sunScreen: sunScreen(),
        shaftColor: env.sunGlow.map((c) => c * 0.9),
        night: env.night,
        time,
      });
    }
    return frameStats;
  }

  resize();
  return {
    gl,
    resize,
    createMesh,
    renderFrame,
    hdr: post.hdr,
    stats: () => ({ ...frameStats, width, height, hdr: post.hdr }),
  };
}

export const ENV_KEYS = ['sunDir', 'sunColor', 'skyTop', 'skyHorizon', 'fogColor', 'ambientSky', 'ambientGround', 'sunGlow', 'cityGlow', 'night', 'stars', 'sunSize', 'fogDensity'];
