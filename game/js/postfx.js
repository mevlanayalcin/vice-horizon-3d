// Solaris Bay v11 module: postfx (planar wet-road reflections & sunset bloom).
// postfx.js — SOLARIS BAY's cinematic post-processing chain, pure WebGL2.
// The world renders into a multisampled HDR target (RGBA16F where the GPU can render
// floats, RGBA8 otherwise); this module resolves it, pulls a soft-threshold bright pass,
// blurs it down and back up a six-level mip chain for neon and sun bloom, sweeps god rays
// from the sun's screen position, then grades the frame: filmic shoulder, vibrance, a warm
// highlight / cool shadow split-tone, vignette and a whisper of film grain.

const FULLSCREEN_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Soft-knee bright pass at half resolution: only neon, lamps, chrome glints and the sun survive. */
const BRIGHT_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 fragColor;
vec3 pick(vec2 uv) { return texture(uSrc, uv).rgb; }
void main() {
  vec3 c = pick(vUV + uTexel * vec2(-0.5, -0.5)) + pick(vUV + uTexel * vec2(0.5, -0.5))
         + pick(vUV + uTexel * vec2(-0.5, 0.5)) + pick(vUV + uTexel * vec2(0.5, 0.5));
  c *= 0.25;
  float m = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5;
  float soft = clamp(m - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, m - uThreshold) / max(m, 1e-4);
  fragColor = vec4(min(c * w, vec3(12.0)), 1.0);
}`;

/** Dual-filter downsample: a weighted five-tap box that keeps bloom stable in motion. */
const DOWN_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 fragColor;
void main() {
  vec3 c = texture(uSrc, vUV).rgb * 4.0;
  c += texture(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, vUV + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUV + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(uSrc, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  fragColor = vec4(c / 8.0, 1.0);
}`;

/** Dual-filter upsample: an eight-tap tent added onto the next level up. */
const UP_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 fragColor;
void main() {
  vec2 t = uTexel;
  vec3 c = texture(uSrc, vUV + vec2(-2.0, 0.0) * t).rgb;
  c += texture(uSrc, vUV + vec2(2.0, 0.0) * t).rgb;
  c += texture(uSrc, vUV + vec2(0.0, -2.0) * t).rgb;
  c += texture(uSrc, vUV + vec2(0.0, 2.0) * t).rgb;
  c += texture(uSrc, vUV + vec2(-1.0, -1.0) * t).rgb * 2.0;
  c += texture(uSrc, vUV + vec2(1.0, -1.0) * t).rgb * 2.0;
  c += texture(uSrc, vUV + vec2(-1.0, 1.0) * t).rgb * 2.0;
  c += texture(uSrc, vUV + vec2(1.0, 1.0) * t).rgb * 2.0;
  fragColor = vec4(c / 12.0 * uWeight, 1.0);
}`;

/** Final grade: scene + bloom + god rays, filmic tone, colour grade, vignette, grain. */
const COMPOSITE_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uBright;
uniform float uBloomStrength;
uniform float uInlineTone;
uniform vec3 uSunScreen;
uniform vec3 uShaftColor;
uniform float uNight;
uniform float uTime;
uniform vec2 uResolution;
out vec4 fragColor;
vec3 filmic(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  float k = 0.64;
  float s = 0.52;
  float f = m <= k ? m : k + (m - k) / (1.0 + (m - k) / s);
  return clamp(c * (f / max(m, 1e-4)), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 godRays(vec2 uv) {
  if (uSunScreen.z <= 0.001) return vec3(0.0);
  vec2 delta = (uSunScreen.xy - uv) / 28.0;
  vec2 p = uv;
  float decay = 1.0;
  vec3 sum = vec3(0.0);
  float jitter = hash12(uv * uResolution);
  p += delta * jitter;
  for (int i = 0; i < 28; i++) {
    p += delta;
    sum += texture(uBright, p).rgb * decay;
    decay *= 0.955;
  }
  float aspect = uResolution.x / uResolution.y;
  float d = length((uv - uSunScreen.xy) * vec2(aspect, 1.0));
  return sum / 28.0 * uShaftColor * uSunScreen.z * smoothstep(1.25, 0.0, d);
}
void main() {
  vec3 scene = texture(uScene, vUV).rgb;
  vec3 bloom = texture(uBloom, vUV).rgb;
  vec3 c = scene + bloom * uBloomStrength + godRays(vUV);
  c = uInlineTone > 0.5 ? min(c, vec3(1.4)) : filmic(c);
  c = clamp(c, 0.0, 1.0);
  // Grade: vibrance that spares already-saturated neon, a soft S-curve, and a split tone
  // that cools the shadows toward indigo and warms the highlights toward gold.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + 0.16 * (1.0 - sat));
  c = clamp(c, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
  vec3 shadowTint = mix(vec3(0.008, 0.014, 0.036), vec3(0.010, 0.004, 0.030), uNight);
  c += shadowTint * (1.0 - smoothstep(0.0, 0.45, l));
  c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.95), smoothstep(0.55, 1.0, l) * (1.0 - uNight));
  // Vignette and grain.
  vec2 q = (vUV - 0.5) * vec2(1.0, 0.86);
  c *= 1.0 - 0.34 * pow(clamp(length(q) * 1.32, 0.0, 1.0), 2.4);
  c += (hash12(vUV * uResolution + fract(uTime) * 91.7) - 0.5) * 0.014;
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compileProgram(gl, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('postfx shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, FULLSCREEN_VS));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('postfx link: ' + gl.getProgramInfoLog(p));
  const u = new Map();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i += 1) {
    const info = gl.getActiveUniform(p, i);
    u.set(info.name, gl.getUniformLocation(p, info.name));
  }
  return { p, u };
}

/**
 * Builds the HDR targets and the bloom / god-ray / grade passes. `hdr` is true when the
 * GPU renders half floats; otherwise surface shaders tone-map inline and post still blooms.
 */
export function createPostFX(gl) {
  const hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const internal = hdr ? gl.RGBA16F : gl.RGBA8;
  const texType = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  const samples = Math.max(0, Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0));

  const bright = compileProgram(gl, BRIGHT_FS);
  const down = compileProgram(gl, DOWN_FS);
  const up = compileProgram(gl, UP_FS);
  const composite = compileProgram(gl, COMPOSITE_FS);

  const quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  const quadVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  function colorTexture(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, texType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function textureTarget(w, h, withDepth = false) {
    const tex = colorTexture(w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let depth = null;
    if (withDepth) {
      depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    return { tex, fbo, depth, w, h };
  }

  function msaaTarget(w, h) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    return { fbo, color, depth, w, h };
  }

  function release(t) {
    if (!t) return;
    if (t.tex) gl.deleteTexture(t.tex);
    if (t.color) gl.deleteRenderbuffer(t.color);
    if (t.depth) gl.deleteRenderbuffer(t.depth);
    if (t.fbo) gl.deleteFramebuffer(t.fbo);
  }

  let width = 0, height = 0;
  let msaa = null, scene = null, reflection = null;
  let mips = [];
  let ok = true;

  function resize(w, h) {
    if (w === width && h === height) return;
    width = w; height = h;
    [msaa, scene, reflection, ...mips].forEach(release);
    msaa = msaaTarget(w, h);
    scene = textureTarget(w, h);
    reflection = textureTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), true);
    mips = [];
    let mw = w >> 1, mh = h >> 1;
    for (let i = 0; i < 6 && mw >= 4 && mh >= 4; i += 1) {
      mips.push(textureTarget(mw, mh));
      mw >>= 1; mh >>= 1;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fbo);
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Bind the half-resolution planar reflection target (wet asphalt and the bay). */
  function beginReflection() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflection.fbo);
    gl.viewport(0, 0, reflection.w, reflection.h);
  }

  /** Bind the multisampled HDR scene target. */
  function beginScene() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fbo);
    gl.viewport(0, 0, width, height);
  }

  function pass(prog, target, src, texel, extra) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : width, target ? target.h : height);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(prog.u.get('uSrc'), 0);
    if (texel) gl.uniform2f(prog.u.get('uTexel'), texel[0], texel[1]);
    if (extra) extra(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Resolve, bloom and grade onto the canvas. `look` = {bloom, threshold, sunScreen:[x,y,s],
   * shaftColor, night, time}.
   */
  function finish(look) {
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quadVAO);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.fbo);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    pass(bright, mips[0], scene.tex, [1 / width, 1 / height], (p) => gl.uniform1f(p.u.get('uThreshold'), look.threshold ?? 0.82));
    for (let i = 1; i < mips.length; i += 1) {
      pass(down, mips[i], mips[i - 1].tex, [1 / mips[i - 1].w, 1 / mips[i - 1].h]);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = mips.length - 1; i > 1; i -= 1) {
      pass(up, mips[i - 1], mips[i].tex, [0.5 / mips[i].w, 0.5 / mips[i].h], (p) => gl.uniform1f(p.u.get('uWeight'), 0.85));
    }
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(composite.p);
    const u = composite.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(u.get('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mips.length > 1 ? mips[1].tex : mips[0].tex);
    gl.uniform1i(u.get('uBloom'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, mips[0].tex);
    gl.uniform1i(u.get('uBright'), 2);
    gl.uniform1f(u.get('uBloomStrength'), look.bloom ?? 0.6);
    gl.uniform1f(u.get('uInlineTone'), hdr ? 0 : 1);
    gl.uniform3fv(u.get('uSunScreen'), look.sunScreen ?? [0, 0, 0]);
    gl.uniform3fv(u.get('uShaftColor'), look.shaftColor ?? [1, 0.7, 0.4]);
    gl.uniform1f(u.get('uNight'), look.night ?? 0);
    gl.uniform1f(u.get('uTime'), look.time ?? 0);
    gl.uniform2f(u.get('uResolution'), width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  return {
    hdr,
    get ok() { return ok; },
    get reflectionTexture() { return reflection ? reflection.tex : null; },
    resize,
    beginReflection,
    beginScene,
    finish,
  };
}
