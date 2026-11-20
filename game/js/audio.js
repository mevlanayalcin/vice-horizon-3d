// audio.js — every sound is synthesised in the browser with Web Audio. Three original
// radio stations run on a look-ahead sequencer: Sunset FM 96.6 (warm synthwave arpeggios
// over a kick/snare groove), Palm Pulse 104.2 (tropical bassline, electric-piano chords,
// marimba and shaker) and Midnight Drive 88.8 (dark outrun lead over a sub-bass pulse).
// The engine climbs through five gears with the car's speed, the tyres screech on the
// handbrake, the nearest siren pans and Doppler-shifts as cruisers pass, and gunshots,
// crashes, lamppost clangs and hydrant geysers are built from oscillators and filtered
// noise. Nothing is downloaded, and no AudioContext exists until the first user gesture.

import { RADIO, clamp } from './config.js';

const BPM = { sunset: 104, palm: 112, midnight: 96 };
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

/** Four-bar chord loops per station, as MIDI notes (root first). */
const PROGRESSIONS = {
  sunset: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],      // Am F C G
  palm: [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 67]], // Dmaj7 Bm7 Gmaj7 A7
  midnight: [[52, 55, 59], [48, 52, 55], [50, 53, 57], [47, 50, 54]],    // Em C Dm Bdim
};

/** Gear ratios for the engine note: each gear spans a band of road speed (m/s). */
const GEARS = [0, 9, 17, 26, 36, 999];

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let musicFilter = null;
  let noiseBuffer = null;
  let engine = null;
  let siren = null;
  let screech = null;
  let station = 0; // 0 = off, 1..3 = RADIO entries
  let muted = false;
  let step = 0;
  let nextNote = 0;
  let ready = false;
  let lastShot = 0;
  let lastUI = 0;
  let gear = 1;

  /** Create the context. Only ever called from a click or key handler, so it starts unlocked. */
  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 16000;
    musicFilter.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.24;
    musicBus.connect(musicFilter);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    // Engine: a saw for the combustion note, a square an octave down for body and a
    // filtered noise rasp, all through a low-pass that opens with revs.
    engine = { osc: [], gain: ctx.createGain(), filter: ctx.createBiquadFilter(), rasp: ctx.createGain() };
    engine.gain.gain.value = 0;
    engine.filter.type = 'lowpass';
    engine.filter.frequency.value = 600;
    engine.filter.Q.value = 3;
    for (const [type, detune, mult] of [['sawtooth', 0, 1], ['square', -6, 0.5], ['sawtooth', 9, 1.5]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 60 * mult;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = mult === 1.5 ? 0.35 : 1;
      osc.connect(g);
      g.connect(engine.filter);
      osc.start();
      engine.osc.push({ osc, mult });
    }
    const raspSrc = ctx.createBufferSource();
    raspSrc.buffer = noiseBuffer;
    raspSrc.loop = true;
    const raspFilter = ctx.createBiquadFilter();
    raspFilter.type = 'bandpass';
    raspFilter.frequency.value = 900;
    engine.rasp.gain.value = 0;
    raspSrc.connect(raspFilter);
    raspFilter.connect(engine.rasp);
    engine.rasp.connect(engine.filter);
    raspSrc.start();
    engine.filter.connect(engine.gain);
    engine.gain.connect(sfxBus);

    // Tyre screech: a looping band of noise, faded in while the car slides.
    screech = { gain: ctx.createGain(), filter: ctx.createBiquadFilter() };
    const sSrc = ctx.createBufferSource();
    sSrc.buffer = noiseBuffer;
    sSrc.loop = true;
    screech.filter.type = 'bandpass';
    screech.filter.frequency.value = 2200;
    screech.filter.Q.value = 6;
    screech.gain.gain.value = 0;
    sSrc.connect(screech.filter);
    screech.filter.connect(screech.gain);
    screech.gain.connect(sfxBus);
    sSrc.start();

    // Siren: a two-tone wail, panned to the nearest cruiser and pitch-shifted by its
    // closing speed so it drops in pitch as the car passes.
    siren = {
      gain: ctx.createGain(), osc: ctx.createOscillator(), lfo: ctx.createOscillator(), lfoGain: ctx.createGain(),
      filter: ctx.createBiquadFilter(), pan: ctx.createStereoPanner ? ctx.createStereoPanner() : null,
    };
    siren.gain.gain.value = 0;
    siren.osc.type = 'square';
    siren.osc.frequency.value = 720;
    siren.lfo.type = 'triangle';
    siren.lfo.frequency.value = 2.4;
    siren.lfoGain.gain.value = 190;
    siren.lfo.connect(siren.lfoGain);
    siren.lfoGain.connect(siren.osc.frequency);
    siren.filter.type = 'bandpass';
    siren.filter.frequency.value = 760;
    siren.filter.Q.value = 1.6;
    siren.osc.connect(siren.filter);
    siren.filter.connect(siren.gain);
    if (siren.pan) { siren.gain.connect(siren.pan); siren.pan.connect(sfxBus); } else siren.gain.connect(sfxBus);
    siren.osc.start();
    siren.lfo.start();

    ready = true;
    nextNote = ctx.currentTime + 0.08;
    return true;
  }

  function setMuted(value) {
    muted = value;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  }

  function nextStation() {
    station = (station + 1) % (RADIO.length + 1);
    if (ctx && ctx.state === 'suspended') ctx.resume();
    step = 0;
    nextNote = ctx ? ctx.currentTime + 0.05 : 0;
    if (ready) tuneStatic();
    return station;
  }

  function currentStation() {
    return station === 0 ? null : RADIO[station - 1];
  }

  function tone(freq, duration, opts = {}) {
    if (!ready) return;
    const t0 = opts.at ?? ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + duration);
    if (opts.detune) osc.detune.value = opts.detune;
    const peak = opts.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(opts.bus ?? sfxBus);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function noise(duration, opts = {}) {
    if (!ready || !noiseBuffer) return;
    const t0 = opts.at ?? ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.freq ?? 1200, t0);
    if (opts.to) filter.frequency.exponentialRampToValueAtTime(Math.max(80, opts.to), t0 + duration);
    filter.Q.value = opts.q ?? 1.2;
    const gain = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(opts.bus ?? sfxBus);
    src.start(t0, Math.random() * 1.2, Math.min(duration + 0.05, 1.5));
  }

  /** A gunshot: a supersonic crack (bright noise snap), the body thump and a tail. */
  function playShot(kind) {
    if (!ready) return;
    const now = ctx.currentTime;
    if (now - lastShot < 0.025) return;
    lastShot = now;
    noise(0.035, { freq: 5200, filter: 'highpass', gain: kind === 'smg' ? 0.32 : 0.45, attack: 0.001 });
    if (kind === 'shotgun') {
      noise(0.32, { freq: 1100, to: 110, gain: 0.7, filter: 'lowpass' });
      tone(78, 0.26, { type: 'sine', gain: 0.5, to: 36 });
      noise(0.5, { freq: 600, to: 200, gain: 0.08, filter: 'bandpass', delay: 0.06 });
    } else if (kind === 'smg') {
      noise(0.08, { freq: 2400, to: 700, gain: 0.22 });
      tone(160, 0.06, { type: 'square', gain: 0.08, to: 70 });
    } else {
      noise(0.14, { freq: 1700, to: 380, gain: 0.36 });
      tone(115, 0.11, { type: 'triangle', gain: 0.2, to: 52 });
      noise(0.3, { freq: 900, to: 300, gain: 0.05, delay: 0.04 });
    }
  }

  function playExplosion() {
    noise(1.2, { freq: 600, to: 50, gain: 0.95, filter: 'lowpass' });
    tone(64, 0.9, { type: 'sine', gain: 0.6, to: 22 });
    noise(0.08, { freq: 3000, filter: 'highpass', gain: 0.4 });
  }

  function playCrash(strength = 1) {
    noise(0.35 * strength + 0.05, { freq: 2400, to: 300, gain: 0.34, filter: 'bandpass' });
    tone(120, 0.2, { type: 'sawtooth', gain: 0.1, to: 45 });
    noise(0.12, { freq: 5000, filter: 'highpass', gain: 0.12 * strength, delay: 0.02 });
  }

  /** A struck steel pole: inharmonic partials ringing down. */
  function playClang(strength = 1) {
    if (!ready) return;
    for (const [f, g] of [[312, 0.12], [851, 0.08], [1474, 0.05], [2203, 0.03]]) {
      tone(f, 0.9, { type: 'sine', gain: g * strength, attack: 0.002 });
    }
    noise(0.06, { freq: 4000, filter: 'highpass', gain: 0.2 * strength });
  }

  function playPickup(kind = 'cash') {
    const base = kind === 'health' ? 520 : kind === 'armor' ? 440 : 660;
    tone(base, 0.09, { type: 'square', gain: 0.09 });
    tone(base * 1.5, 0.12, { type: 'square', gain: 0.07, delay: 0.07 });
  }

  function playUI() {
    if (!ready) return;
    const now = ctx.currentTime;
    if (now - lastUI < 0.03) return;
    lastUI = now;
    tone(880, 0.05, { type: 'triangle', gain: 0.06 });
  }

  function playHorn() {
    if (!ready) return;
    tone(330, 0.28, { type: 'square', gain: 0.12 });
    tone(415, 0.28, { type: 'square', gain: 0.09, delay: 0.01 });
  }

  /** Water: a burst of white rush, then droplets pattering back down. */
  function playSplash() {
    if (!ready) return;
    noise(0.7, { freq: 1400, to: 260, gain: 0.36, filter: 'lowpass' });
    noise(1.4, { freq: 3200, gain: 0.07, filter: 'highpass', delay: 0.1 });
    for (let i = 0; i < 6; i += 1) tone(900 + Math.random() * 900, 0.06, { type: 'sine', gain: 0.03, to: 2400, delay: 0.15 + i * 0.09 });
  }

  function playStunt() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, { type: 'triangle', gain: 0.1, delay: i * 0.06 }));
  }

  function playMission() {
    [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.32, { type: 'sawtooth', gain: 0.08, delay: i * 0.1 }));
  }

  function playWanted() {
    tone(220, 0.18, { type: 'sawtooth', gain: 0.12 });
    tone(174, 0.25, { type: 'sawtooth', gain: 0.1, delay: 0.16 });
  }

  /** A short burst of tuning static between stations. */
  function tuneStatic() {
    noise(0.22, { freq: 2600, gain: 0.08, filter: 'bandpass', q: 0.6 });
  }

  // --- radio sequencer -----------------------------------------------------
  function scheduleStation(now) {
    const id = RADIO[station - 1].id;
    const bpm = BPM[id];
    const sixteenth = 60 / bpm / 4;
    const prog = PROGRESSIONS[id];
    while (nextNote < now + 0.18) {
      const when = nextNote;
      const s = step % 16;
      const bar = Math.floor(step / 16) % 4;
      const chord = prog[bar];
      if (id === 'sunset') {
        // Warm synthwave: four-on-the-floor, gated snare, rolling 16th arpeggio, pad.
        if (s % 4 === 0) drumKick(when, 0.26);
        if (s === 4 || s === 12) drumSnare(when, 0.12, true);
        if (s % 2 === 1) drumHat(when, 0.03);
        if (s % 2 === 0) bassNote(when, midi(chord[0] - 12), sixteenth * 1.7, 0.1);
        const arp = [0, 1, 2, 1, 2, 0, 2, 1];
        arpNote(when, midi(chord[arp[s % 8]] + 12 + (s >= 8 ? 12 : 0)), sixteenth * 0.9, 0.03, 'square');
        if (s === 0) padChord(when, chord.map(midi), sixteenth * 16, 0.032, 'sawtooth', 1400);
        if (s === 0 && bar === 3) leadNote(when, midi(chord[2] + 24), sixteenth * 6, 0.025);
      } else if (id === 'palm') {
        // Tropical house: offbeat bassline, syncopated electric-piano stabs, marimba, shaker.
        if (s % 4 === 0) drumKick(when, 0.22);
        if (s === 4 || s === 12) clap(when, 0.08);
        shaker(when, s % 2 ? 0.018 : 0.03);
        const bassPat = [0, null, 12, 0, null, 7, null, 12];
        const bn = bassPat[s % 8];
        if (bn !== null && s % 2 === 0) bassNote(when, midi(chord[0] - 24 + bn), sixteenth * 1.4, 0.12, 'triangle');
        if (s === 2 || s === 6 || s === 11 || s === 14) ePiano(when, chord.map((n) => midi(n)), sixteenth * 2.5, 0.05);
        if (s % 4 === 3) marimba(when, midi(chord[(s >> 2) % chord.length] + 12), 0.05);
      } else if (id === 'midnight') {
        // Dark outrun: sub-bass eighths, a slow brooding lead, half-time snare, noise riser.
        if (s === 0 || s === 10) drumKick(when, 0.3);
        if (s === 8) drumSnare(when, 0.13, true);
        if (s % 4 === 2) drumHat(when, 0.022);
        if (s % 2 === 0) subBass(when, midi(chord[0] - 24), sixteenth * 1.9, 0.18);
        if (s % 2 === 1) bassNote(when, midi(chord[0] - 12), sixteenth * 0.8, 0.05);
        if (s === 0) padChord(when, chord.map(midi), sixteenth * 16, 0.028, 'sawtooth', 700);
        const melody = [2, null, null, 1, null, null, 0, null];
        const m = melody[(step >> 1) % 8];
        if (s % 2 === 0 && m !== null) leadNote(when, midi(chord[m] + 12), sixteenth * 3.6, 0.03);
        if (s === 12 && bar === 3) noise(sixteenth * 4, { at: when, freq: 400, to: 6000, gain: 0.03, filter: 'bandpass', bus: musicBus });
      }
      step += 1;
      nextNote += sixteenth;
    }
  }

  function drumKick(when, gain) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.14);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);
    osc.connect(g); g.connect(musicBus);
    osc.start(when); osc.stop(when + 0.28);
  }

  function drumSnare(when, gain, big = false) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1100;
    const g = ctx.createGain();
    const len = big ? 0.24 : 0.13;
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(when, Math.random(), len + 0.03);
    tone(190, 0.08, { at: when, type: 'triangle', gain: gain * 0.6, to: 120, bus: musicBus });
  }

  function clap(when, gain) {
    for (let i = 0; i < 3; i += 1) noise(0.06 + i * 0.03, { at: when + i * 0.012, freq: 1500, q: 0.8, gain, bus: musicBus });
  }

  function drumHat(when, gain) {
    noise(0.05, { at: when, freq: 7000, filter: 'highpass', gain, bus: musicBus });
  }

  function shaker(when, gain) {
    noise(0.07, { at: when, freq: 5200, q: 2, gain, bus: musicBus, attack: 0.02 });
  }

  function bassNote(when, freq, duration, gain, type = 'sawtooth') {
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, when);
    f.frequency.exponentialRampToValueAtTime(260, when + duration);
    f.Q.value = 5;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(f); f.connect(g); g.connect(musicBus);
    osc.start(when); osc.stop(when + duration + 0.02);
  }

  function subBass(when, freq, duration, gain) {
    tone(freq, duration, { at: when, type: 'sine', gain, attack: 0.02, bus: musicBus });
  }

  function arpNote(when, freq, duration, gain, type = 'square') {
    tone(freq, duration, { at: when, type, gain, bus: musicBus });
  }

  /** A soft detuned lead with a slow attack and gentle vibrato. */
  function leadNote(when, freq, duration, gain) {
    const osc = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    vib.frequency.value = 5.2;
    vibGain.gain.value = freq * 0.006;
    vib.connect(vibGain); vibGain.connect(osc.frequency);
    f.type = 'lowpass';
    f.frequency.value = 2200;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.08);
    g.gain.linearRampToValueAtTime(0.0001, when + duration);
    osc.connect(f); f.connect(g); g.connect(musicBus);
    osc.start(when); vib.start(when);
    osc.stop(when + duration + 0.05); vib.stop(when + duration + 0.05);
  }

  /** Electric piano: a sine tine with a bell partial that decays faster than the body. */
  function ePiano(when, freqs, duration, gain) {
    for (const freq of freqs) {
      tone(freq, duration, { at: when, type: 'sine', gain: gain * 0.7, attack: 0.004, bus: musicBus });
      tone(freq * 4, duration * 0.35, { at: when, type: 'sine', gain: gain * 0.12, attack: 0.002, bus: musicBus });
      tone(freq * 2, duration * 0.6, { at: when, type: 'triangle', gain: gain * 0.2, attack: 0.003, bus: musicBus });
    }
  }

  function marimba(when, freq, gain) {
    tone(freq, 0.22, { at: when, type: 'sine', gain, attack: 0.002, bus: musicBus });
    tone(freq * 3.9, 0.06, { at: when, type: 'sine', gain: gain * 0.3, attack: 0.001, bus: musicBus });
  }

  function padChord(when, freqs, duration, gain, type = 'triangle', cutoff = 1800) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.connect(musicBus);
    for (const freq of freqs) {
      for (const det of [-7, 7]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = det;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(gain, when + 0.3);
        g.gain.linearRampToValueAtTime(0.0001, when + duration);
        osc.connect(g); g.connect(f);
        osc.start(when); osc.stop(when + duration + 0.05);
      }
    }
  }

  /**
   * Per-frame mix. `state`: inVehicle, throttle, drifting, handbrake, wanted, sirenDist,
   * sirenPan (-1 left..1 right), sirenClosing (m/s toward the listener).
   */
  function update(dt, state = {}) {
    if (!ready) return;
    if (ctx.state === 'suspended') return;
    const now = ctx.currentTime;
    if (station > 0) scheduleStation(now);

    // Engine: revs climb through each gear band and drop at the shift.
    const car = state.inVehicle;
    if (car) {
      const speed = Math.abs(car.speed ?? 0);
      while (gear < GEARS.length - 1 && speed > GEARS[gear]) gear += 1;
      while (gear > 1 && speed < GEARS[gear - 1] - 2) gear -= 1;
      const lo = GEARS[gear - 1], hi = Math.min(GEARS[gear], 48);
      const band = clamp((speed - lo) / Math.max(1, hi - lo), 0, 1);
      const rpm = 900 + band * 4800 + (state.throttle > 0 ? 500 : 0) + (car.boosting ? 600 : 0);
      const base = rpm / 60 * 1.1;
      for (const { osc, mult } of engine.osc) osc.frequency.setTargetAtTime(base * mult, now, 0.04);
      engine.filter.frequency.setTargetAtTime(380 + rpm * 0.32, now, 0.06);
      engine.gain.gain.setTargetAtTime(clamp(0.035 + band * 0.05 + speed * 0.0012, 0.03, 0.13), now, 0.08);
      engine.rasp.gain.setTargetAtTime(state.throttle > 0 ? 0.25 + band * 0.25 : 0.08, now, 0.1);
    } else {
      engine.gain.gain.setTargetAtTime(0, now, 0.15);
      gear = 1;
    }

    // Tyre screech: louder and higher on the handbrake.
    const slide = car ? clamp((state.drifting - 1.2) / 6, 0, 1) + (state.handbrake && Math.abs(car.speed) > 6 ? 0.55 : 0) : 0;
    screech.gain.gain.setTargetAtTime(clamp(slide, 0, 1) * 0.11, now, 0.05);
    screech.filter.frequency.setTargetAtTime(1800 + slide * 900, now, 0.08);

    // Siren: volume by distance, stereo pan by bearing, Doppler pitch by closing speed.
    if (state.sirenDist !== undefined && state.sirenDist < 180 && state.wanted > 0) {
      const proximity = 1 - clamp(state.sirenDist / 180, 0, 1);
      siren.gain.gain.setTargetAtTime(0.003 + proximity * proximity * 0.07, now, 0.1);
      siren.lfo.frequency.setTargetAtTime(1.8 + proximity * 1.6, now, 0.2);
      const doppler = 343 / (343 - clamp(state.sirenClosing ?? 0, -60, 60));
      siren.osc.detune.setTargetAtTime(1200 * Math.log2(doppler), now, 0.08);
      if (siren.pan) siren.pan.pan.setTargetAtTime(clamp(state.sirenPan ?? 0, -1, 1) * 0.8, now, 0.08);
    } else {
      siren.gain.gain.setTargetAtTime(0, now, 0.2);
    }
  }

  return {
    init,
    update,
    setMuted,
    nextStation,
    currentStation,
    setRadio(index) { station = clamp(index, 0, RADIO.length); step = 0; nextNote = ctx ? ctx.currentTime + 0.05 : 0; },
    playShot,
    playExplosion,
    playCrash,
    playClang,
    playPickup,
    playUI,
    playHorn,
    playSplash,
    playStunt,
    playMission,
    playWanted,
    get ready() { return ready; },
    get muted() { return muted; },
    get station() { return station; },
    get context() { return ctx; },
    get gear() { return gear; },
  };
}
