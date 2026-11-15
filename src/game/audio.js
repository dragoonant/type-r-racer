// Sound. The engine is a bank of steady-speed loops, one per 1000 rpm,
// cross-faded and pitch-shifted to the current revs. Throttle position opens
// and closes a low-pass filter so the note hardens under load. Turbo, wind,
// road, kerb and impact sounds are generated in code; tyre squeal is a loop.
//
// If the loops fail to load the engine falls back to a synthesised tone, so
// the game is never silent.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ENGINE_LOOPS = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ rpm: k * 1000, url: `audio/engine/su-mid-${k}.wav` }));
const SQUEAL_URL = 'audio/fx/tire-squeal.wav';

export class GameAudio {
  constructor() { this.ctx = null; this.ready = false; this.volume = 0.8; this.prevThrottle = 0; this.prevGear = 1; this.blowOffCooldown = 0; }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  async init() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);

    // Shared noise source.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    const chain = (src, ...nodes) => { let n = src; for (const x of nodes) { n.connect(x); n = x; } n.connect(master); return nodes; };
    const filter = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    // --- engine
    this.engineFilter = filter('lowpass', 1200, 0.5);
    this.engineGain = gain(0);
    this.engineFilter.connect(this.engineGain); this.engineGain.connect(master);
    this.loops = [];
    const load = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + ' ' + res.status);
      return ctx.decodeAudioData(await res.arrayBuffer());
    };
    try {
      const buffers = await Promise.all(ENGINE_LOOPS.map((l) => load(l.url)));
      buffers.forEach((buffer, i) => {
        const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
        const g = gain(0); src.connect(g); g.connect(this.engineFilter); src.start(0, Math.random() * buffer.duration * 0.5);
        this.loops.push({ rpm: ENGINE_LOOPS[i].rpm, src, gain: g });
      });
    } catch (err) {
      console.warn('Engine loops unavailable, using synthesised engine:', err.message);
      // Fallback: a harmonic stack at the firing frequency.
      const real = new Float32Array([0, 0.2, 1, 0.15, 0.6, 0.1, 0.35, 0.05, 0.22, 0.03, 0.12]);
      const wave = ctx.createPeriodicWave(real, new Float32Array(real.length));
      this.synth = ctx.createOscillator(); this.synth.setPeriodicWave(wave); this.synth.frequency.value = 20;
      const g = gain(0.5); this.synth.connect(g); g.connect(this.engineFilter); this.synth.start();
    }

    // --- turbo whistle and intake rush
    this.whistle = ctx.createOscillator(); this.whistle.type = 'sine'; this.whistle.frequency.value = 3000;
    [this.whistleGain] = chain(this.whistle, gain(0)); this.whistle.start();
    [this.rushFilter, this.rushGain] = chain(noise(), filter('bandpass', 2600, 1.2), gain(0));
    [this.bovFilter, this.bovGain] = chain(noise(), filter('bandpass', 1800, 2.5), gain(0));

    // --- wind and road
    [this.windFilter, this.windGain] = chain(noise(), filter('lowpass', 700, 0.4), gain(0));
    [this.roadFilter, this.roadGain] = chain(noise(), filter('bandpass', 170, 0.8), gain(0));
    [this.looseFilter, this.looseGain] = chain(noise(), filter('lowpass', 420, 0.6), gain(0));

    // --- kerbs: low noise chopped at the ripple frequency
    this.kerbMod = ctx.createOscillator(); this.kerbMod.type = 'square'; this.kerbMod.frequency.value = 20; this.kerbMod.start();
    this.kerbDepth = gain(0); this.kerbMod.connect(this.kerbDepth);
    [this.kerbFilter, this.kerbGain] = chain(noise(), filter('lowpass', 160, 1.2), gain(0));
    this.kerbDepth.connect(this.kerbGain.gain);

    // --- tyre squeal
    this.squealGain = gain(0); this.squealGain.connect(master);
    try {
      const buf = await load(SQUEAL_URL);
      this.squeal = ctx.createBufferSource(); this.squeal.buffer = buf; this.squeal.loop = true; this.squeal.connect(this.squealGain); this.squeal.start();
    } catch {
      [this.squealFilter] = chain(noise(), filter('bandpass', 1150, 9), this.squealGain);
    }

    // --- impacts
    [this.hitFilter, this.hitGain] = chain(noise(), filter('lowpass', 500, 0.7), gain(0));

    this.ready = true;
    await ctx.resume();
    master.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 0.6);
  }

  setPaused(paused) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(paused ? 0 : this.volume, t + 0.15);
  }

  /**
   * @param s { rpm, throttle, boost, speed, slip, loose, kerb, wallImpact, gear, interior, limiter }
   */
  update(dt, s) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, tc = 0.03;
    const set = (param, v, time = tc) => param.setTargetAtTime(v, t, time);
    const rpm = clamp(s.rpm, 600, 8200), thr = clamp(s.throttle, 0, 1);

    // Engine loops: equal-power blend between the two nearest.
    if (this.loops.length) {
      const f = rpm / 1000, lo = clamp(Math.floor(f), 1, 8), hi = clamp(lo + 1, 1, 8), k = clamp(f - lo, 0, 1);
      for (const l of this.loops) {
        const idx = l.rpm / 1000;
        let g = 0;
        if (idx === lo && idx === hi) g = 1; else if (idx === lo) g = Math.cos(k * Math.PI * 0.5); else if (idx === hi) g = Math.sin(k * Math.PI * 0.5);
        set(l.gain.gain, g, 0.02);
        if (g > 0 || Math.abs(idx - f) < 2) set(l.src.playbackRate, clamp(rpm / l.rpm, 0.5, 2), 0.02);
      }
    } else if (this.synth) set(this.synth.frequency, rpm / 60, 0.02);
    const load = clamp(thr * 0.85 + s.boost * 0.25, 0, 1);
    set(this.engineFilter.frequency, (s.interior ? 500 : 650) + rpm * 0.22 + load * (s.interior ? 5200 : 7500));
    set(this.engineGain.gain, (0.2 + 0.5 * load + 0.1 * (rpm / 7000)) * (s.interior ? 1.0 : 0.85));

    // Turbo.
    const b = clamp(s.boost, 0, 1) * thr;
    set(this.whistle.frequency, 2200 + 5200 * s.boost + rpm * 0.12);
    set(this.whistleGain.gain, b * b * 0.02);
    set(this.rushGain.gain, b * 0.05);
    set(this.rushFilter.frequency, 1800 + 2600 * s.boost);
    // Blow-off: boost was up and the throttle just snapped shut.
    this.blowOffCooldown -= dt;
    if (this.prevThrottle > 0.6 && thr < 0.15 && s.boost > 0.45 && this.blowOffCooldown <= 0) {
      this.blowOffCooldown = 0.5;
      const g = this.bovGain.gain, f = this.bovFilter.frequency;
      g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(0.16 * s.boost, t + 0.015); g.exponentialRampToValueAtTime(0.0001, t + 0.36);
      f.cancelScheduledValues(t); f.setValueAtTime(3400, t); f.exponentialRampToValueAtTime(900, t + 0.34);
    }
    this.prevThrottle = thr;

    // Wind and road.
    const v = Math.abs(s.speed), vn = clamp(v / 75, 0, 1);
    set(this.windGain.gain, vn * vn * (s.interior ? 0.3 : 0.42));
    set(this.windFilter.frequency, 350 + 1500 * vn);
    set(this.roadGain.gain, vn * 0.3);
    set(this.looseGain.gain, s.loose * clamp(v / 25, 0, 1) * 0.6);

    // Kerbs.
    const kerb = s.kerb * clamp(v / 12, 0, 1);
    set(this.kerbMod.frequency, clamp(v / 0.9, 4, 90), 0.05);
    set(this.kerbGain.gain, kerb * 0.45);
    set(this.kerbDepth.gain, kerb * 0.4);

    // Squeal: nothing until the tyres are past their peak.
    const sq = clamp((s.slip - 1.0) / 1.6, 0, 1) * clamp(v / 8, 0, 1) * (1 - s.loose);
    set(this.squealGain.gain, sq * 0.42, 0.06);
    if (this.squeal) set(this.squeal.playbackRate, 0.85 + 0.3 * sq + vn * 0.1, 0.1);

    // Impacts.
    if (s.wallImpact > 0.8) {
      const g = this.hitGain.gain, a = clamp(s.wallImpact / 12, 0.1, 1);
      g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(a * 0.9, t + 0.008); g.exponentialRampToValueAtTime(0.0001, t + 0.3);
    }
    // Gear change: a small mechanical tick.
    if (s.gear !== this.prevGear) {
      this.prevGear = s.gear;
      const g = this.hitGain.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(0.12, t + 0.004); g.exponentialRampToValueAtTime(0.0001, t + 0.07);
    }
  }
}
