// audio.js — every sound is synthesised in the browser with Web Audio. Three original
// radio stations (Miami synthwave, sunset lo-fi, bass chase) run on a look-ahead
// sequencer; engine pitch, tyre screech, police siren, gunshots, crashes and UI
// blips are generated from oscillators and filtered noise. Nothing is downloaded.

import { RADIO, clamp } from './config.js';

const BPM = { sunset: 104, coral: 72, neon: 122 };

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let noiseBuffer = null;
  let engine = null;
  let siren = null;
  let station = 0; // 0 = off, 1..3 = RADIO entries
  let muted = false;
  let step = 0;
  let nextNote = 0;
  let ready = false;
  let lastShot = 0;
  let lastUI = 0;

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
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.22;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }

    // Engine: two detuned saws through a low-pass, silent unless driving.
    engine = { osc: [], gain: ctx.createGain(), filter: ctx.createBiquadFilter() };
    engine.gain.gain.value = 0;
    engine.filter.type = 'lowpass';
    engine.filter.frequency.value = 600;
    engine.filter.Q.value = 2;
    for (const [type, detune, mult] of [['sawtooth', 0, 1], ['square', 7, 0.5]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 60 * mult;
      osc.detune.value = detune;
      osc.connect(engine.filter);
      osc.start();
      engine.osc.push({ osc, mult });
    }
    engine.filter.connect(engine.gain);
    engine.gain.connect(sfxBus);

    // Siren: a two-tone wail that fades in with proximity.
    siren = { gain: ctx.createGain(), osc: ctx.createOscillator(), lfo: ctx.createOscillator(), lfoGain: ctx.createGain(), filter: ctx.createBiquadFilter() };
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
    siren.gain.connect(sfxBus);
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
    return station;
  }

  function currentStation() {
    return station === 0 ? null : RADIO[station - 1];
  }

  function tone(freq, duration, opts = {}) {
    if (!ready) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + duration);
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
    const t0 = ctx.currentTime + (opts.delay ?? 0);
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
    src.start(t0, Math.random() * 1.2, Math.min(duration + 0.05, 1.2));
  }

  function playShot(kind) {
    if (!ready) return;
    const now = ctx.currentTime;
    if (now - lastShot < 0.025) return;
    lastShot = now;
    if (kind === 'shotgun') {
      noise(0.22, { freq: 900, to: 120, gain: 0.6, filter: 'lowpass' });
      tone(80, 0.22, { type: 'sine', gain: 0.4, to: 40 });
    } else if (kind === 'smg') {
      noise(0.07, { freq: 2200, to: 700, gain: 0.18 });
      tone(150, 0.06, { type: 'square', gain: 0.08, to: 70 });
    } else {
      noise(0.12, { freq: 1600, to: 400, gain: 0.32 });
      tone(110, 0.1, { type: 'triangle', gain: 0.16, to: 55 });
    }
  }

  function playExplosion() {
    noise(0.9, { freq: 500, to: 60, gain: 0.9, filter: 'lowpass' });
    tone(70, 0.8, { type: 'sine', gain: 0.5, to: 24 });
  }

  function playCrash(strength = 1) {
    noise(0.35 * strength, { freq: 2400, to: 300, gain: 0.32, filter: 'bandpass' });
    tone(120, 0.2, { type: 'sawtooth', gain: 0.1, to: 45 });
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

  function playSplash() {
    noise(0.5, { freq: 900, to: 180, gain: 0.35, filter: 'lowpass' });
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

  // --- radio sequencer -----------------------------------------------------
  function scheduleStation(now) {
    const id = RADIO[station - 1].id;
    const bpm = BPM[id];
    const sixteenth = 60 / bpm / 4;
    while (nextNote < now + 0.18) {
      const when = nextNote;
      const s = step % 16;
      if (id === 'sunset') {
        if (s % 4 === 0) drumKick(when, 0.24, musicBus);
        if (s === 4 || s === 12) drumSnare(when, 0.1, musicBus);
        if (s % 2 === 1) drumHat(when, 0.035, musicBus);
        const notes = [220, 261.63, 329.63, 392, 261.63, 329.63, 440, 392];
        if (s % 2 === 0) bassNote(when, notes[(s / 2) % 8] / 2, sixteenth * 1.8, 0.09, musicBus);
        arpNote(when, notes[s % 8] * 2, sixteenth * 0.9, 0.035, musicBus);
        if (s === 0 || s === 8) padChord(when, [220, 261.63, 329.63], sixteenth * 8, 0.035, musicBus);
      } else if (id === 'coral') {
        if (s % 8 === 0) drumKick(when, 0.16, musicBus);
        if (s === 6) drumSnare(when, 0.05, musicBus);
        if (s % 4 === 2) drumHat(when, 0.02, musicBus);
        const chords = [[196, 233.08, 293.66], [174.61, 220, 261.63]];
        if (s % 8 === 0) padChord(when, chords[(step / 8) % 2], sixteenth * 7, 0.05, musicBus, 'triangle');
        if (s === 3 || s === 11) arpNote(when, 587.33, sixteenth * 2, 0.022, musicBus);
        if (s === 7) arpNote(when, 493.88, sixteenth * 2, 0.02, musicBus);
        if (s === 0) vinyl(when, sixteenth * 16);
      } else if (id === 'neon') {
        if (s % 4 === 0) drumKick(when, 0.26, musicBus);
        if (s % 4 === 2) drumSnare(when, 0.08, musicBus);
        if (s % 2 === 0) drumHat(when, 0.03, musicBus);
        const bassline = [110, 110, 130.81, 110, 98, 98, 146.83, 130.81];
        bassNote(when, bassline[s % 8], sixteenth * 0.9, 0.11, musicBus);
        arpNote(when, [440, 523.25, 659.25, 523.25][s % 4] * (s > 7 ? 1.5 : 1), sixteenth * 0.5, 0.025, musicBus);
        if (s === 0) padChord(when, [220, 261.63, 329.63], sixteenth * 16, 0.025, musicBus, 'sawtooth');
      }
      step += 1;
      nextNote += sixteenth;
    }
  }

  function drumKick(when, gain, bus) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.16);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    osc.connect(g); g.connect(bus);
    osc.start(when); osc.stop(when + 0.24);
  }

  function drumSnare(when, gain, bus) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(when, 0.2, 0.16);
  }

  function drumHat(when, gain, bus) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(when, Math.random(), 0.06);
  }

  function bassNote(when, freq, duration, gain, bus) {
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, when);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(420, when);
    f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(f); f.connect(g); g.connect(bus);
    osc.start(when); osc.stop(when + duration + 0.02);
  }

  function arpNote(when, freq, duration, gain, bus) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(g); g.connect(bus);
    osc.start(when); osc.stop(when + duration + 0.02);
  }

  function padChord(when, freqs, duration, gain, bus, type = 'triangle') {
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = Math.random() * 8 - 4;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(gain, when + 0.18);
      g.gain.linearRampToValueAtTime(0.0001, when + duration);
      osc.connect(g); g.connect(bus);
      osc.start(when); osc.stop(when + duration + 0.05);
    }
  }

  function vinyl(when, duration) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.012, when);
    g.gain.linearRampToValueAtTime(0.004, when + duration);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(when, Math.random(), Math.min(duration, 1.5));
  }

  function update(dt, state = {}) {
    if (!ready) return;
    if (ctx.state === 'suspended') return;
    const now = ctx.currentTime;
    if (station > 0) scheduleStation(now);

    // Engine sound.
    const car = state.inVehicle;
    if (car) {
      const speed = Math.abs(car.speed ?? 0);
      const rpm = 58 + speed * 7.5 + (state.throttle > 0 ? 24 : 0);
      for (const { osc, mult } of engine.osc) {
        osc.frequency.setTargetAtTime(rpm * mult, now, 0.05);
      }
      engine.filter.frequency.setTargetAtTime(420 + speed * 22, now, 0.08);
      engine.gain.gain.setTargetAtTime(clamp(0.03 + speed * 0.0026, 0.02, 0.12), now, 0.1);
    } else {
      engine.gain.gain.setTargetAtTime(0, now, 0.15);
    }

    // Tyre screech while drifting.
    if (state.drifting > 0.6 && car) {
      if (!scratch || now - scratch.last > 0.38) {
        scratch = { last: now };
        noise(0.28, { freq: 1600, to: 900, gain: clamp(state.drifting * 0.09, 0.02, 0.1), filter: 'bandpass' });
      }
    }

    // Siren volume by proximity.
    if (state.sirenDist !== undefined && state.sirenDist < 160 && state.wanted > 0) {
      const proximity = 1 - clamp(state.sirenDist / 160, 0, 1);
      siren.gain.gain.setTargetAtTime(0.002 + proximity * 0.055, now, 0.12);
      siren.lfo.frequency.setTargetAtTime(1.8 + proximity * 1.6, now, 0.2);
    } else {
      siren.gain.gain.setTargetAtTime(0, now, 0.2);
    }
  }

  let scratch = null;

  return {
    init,
    update,
    setMuted,
    nextStation,
    currentStation,
    setRadio(index) { station = clamp(index, 0, RADIO.length); nextNote = ctx ? ctx.currentTime + 0.05 : 0; },
    playShot,
    playExplosion,
    playCrash,
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
  };
}
