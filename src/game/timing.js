// Lap timing, sector splits, live delta to the best lap, and ghost recording.
//
// A lap counts only if the car passed every sector in order and kept at least
// one wheel on the track or its kerbs the whole way round.

import { SURFACE } from '../track/track.js';

const GHOST_DT = 0.05; // seconds between ghost samples
const GHOST_STRIDE = 8; // px py pz qx qy qz qw steer

function toBase64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(str) {
  const bin = atob(str), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

export class LapTimer {
  constructor(track, storageKey) {
    this.track = track;
    this.key = storageKey;
    this.persist = true; // set false to keep laps out of storage (autopilot runs)
    this.best = null; // { time, sectors: [], ref: Float32Array(n), ghost: Float32Array }
    this.load();
    this.reset();
  }

  reset() {
    this.running = false; // becomes true at the first crossing of the line
    this.time = 0; this.valid = true;
    this.sector = 0; this.sectorTimes = [];
    this.lastLap = null; this.lastValid = true; this.lastSectors = [];
    this.prevS = null;
    this.ref = new Float32Array(this.track.n).fill(-1); // time at each track sample, this lap
    this.rec = []; this.recNext = 0;
    this.delta = null;
    this.lapCount = 0;
    this.offTime = 0;
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.time !== 'number' || d.n !== this.track.n) return;
      this.best = { time: d.time, sectors: d.sectors || [], ref: fromBase64(d.ref), ghost: fromBase64(d.ghost) };
    } catch { this.best = null; }
  }
  save() {
    if (!this.persist) return;
    try {
      const b = this.best;
      localStorage.setItem(this.key, JSON.stringify({ time: b.time, sectors: b.sectors, n: this.track.n, ref: toBase64(b.ref), ghost: toBase64(b.ghost) }));
    } catch { /* storage unavailable: the record lasts for this session only */ }
  }
  clearBest() {
    this.best = null;
    try { localStorage.removeItem(this.key); } catch { /* ignore */ }
  }

  /** Advance by dt. Returns a list of events: {type:'start'|'sector'|'lap', ...}. */
  update(car, dt) {
    const events = [], tr = this.track, n = tr.n;
    const s = car.bodyQ.s;
    if (s === undefined) return events;
    if (this.prevS === null) { this.prevS = s; return events; }
    let ds = s - this.prevS;
    if (ds > n / 2) ds -= n; else if (ds < -n / 2) ds += n;
    const crossed = this.prevS > n - 60 && s < 60 && ds > 0;
    const crossedBack = this.prevS < 60 && s > n - 60 && ds < 0;

    if (this.running) {
      // Track limits: all four wheels beyond the kerbs.
      const off = car.wheels.every((w) => w.surface >= SURFACE.GRASS);
      if (off) { this.offTime += dt; if (this.valid) { this.valid = false; events.push({ type: 'invalid' }); } }

      if (crossed) {
        const frac = (n - this.prevS) / Math.max(ds, 1e-6);
        const lapTime = this.time + dt * Math.min(1, Math.max(0, frac));
        const complete = this.sector === tr.sectors.length - 1;
        if (complete) {
          const sectors = this.sectorTimes.concat([lapTime - this.sectorTimes.reduce((a, b) => a + b, 0)]);
          const isBest = this.valid && (!this.best || lapTime < this.best.time);
          const prevBest = this.best ? this.best.time : null;
          this.lastLap = lapTime; this.lastValid = this.valid; this.lastSectors = sectors;
          this.lapCount++;
          if (isBest) {
            this.best = { time: lapTime, sectors, ref: this.ref.slice(), ghost: Float32Array.from(this.rec) };
            this.save();
          }
          events.push({ type: 'lap', time: lapTime, valid: this.valid, best: isBest, prevBest, sectors });
        }
        this._startLap(dt * (1 - Math.min(1, Math.max(0, frac))));
        if (!complete) events.push({ type: 'start' });
      } else if (crossedBack) {
        this.running = false; this.delta = null;
      } else {
        this.time += dt;
        // Sector lines.
        const next = this.sector + 1;
        if (next < tr.sectors.length) {
          const line = tr.sectors[next];
          if (this.prevS < line && s >= line && ds > 0) {
            const frac = (line - this.prevS) / Math.max(ds, 1e-6);
            const t = this.time - dt * (1 - frac);
            const split = t - this.sectorTimes.reduce((a, b) => a + b, 0);
            this.sectorTimes.push(split);
            this.sector = next;
            const bestSplit = this.best ? this.best.sectors[next - 1] : null;
            events.push({ type: 'sector', index: next - 1, time: split, delta: bestSplit != null ? split - bestSplit : null });
          }
        }
        // Reference trace and live delta.
        const i = Math.floor(s);
        if (i >= 0 && i < n && ds > 0) {
          if (this.ref[i] < 0) this.ref[i] = this.time;
          if (this.best && this.best.ref[i] >= 0) this.delta = this.time - this.best.ref[i];
        }
        // Ghost samples.
        while (this.time >= this.recNext) {
          this.rec.push(car.px, car.py, car.pz, car.qx, car.qy, car.qz, car.qw, car.steerOut);
          this.recNext += GHOST_DT;
        }
      }
    } else if (crossed) {
      const frac = (n - this.prevS) / Math.max(ds, 1e-6);
      this._startLap(dt * (1 - Math.min(1, Math.max(0, frac))));
      events.push({ type: 'start' });
    }
    this.prevS = s;
    return events;
  }

  _startLap(carry) {
    this.running = true;
    this.time = carry; this.valid = true;
    this.sector = 0; this.sectorTimes = [];
    this.ref.fill(-1);
    this.rec = []; this.recNext = 0;
    this.delta = null;
  }

  /** Ghost pose at lap time t, written into `out`. Returns false when there is none. */
  ghostPose(t, out) {
    const g = this.best && this.best.ghost;
    if (!g || !this.running) return false;
    const f = t / GHOST_DT, i = Math.floor(f), count = g.length / GHOST_STRIDE;
    if (i + 1 >= count) return false;
    const a = i * GHOST_STRIDE, b = a + GHOST_STRIDE, k = f - i;
    const L = (o) => g[a + o] + (g[b + o] - g[a + o]) * k;
    out.px = L(0); out.py = L(1); out.pz = L(2);
    // Shortest-path quaternion blend.
    let dot = g[a + 3] * g[b + 3] + g[a + 4] * g[b + 4] + g[a + 5] * g[b + 5] + g[a + 6] * g[b + 6];
    const sgn = dot < 0 ? -1 : 1;
    let qx = g[a + 3] + (sgn * g[b + 3] - g[a + 3]) * k, qy = g[a + 4] + (sgn * g[b + 4] - g[a + 4]) * k;
    let qz = g[a + 5] + (sgn * g[b + 5] - g[a + 5]) * k, qw = g[a + 6] + (sgn * g[b + 6] - g[a + 6]) * k;
    const l = 1 / Math.hypot(qx, qy, qz, qw);
    out.qx = qx * l; out.qy = qy * l; out.qz = qz * l; out.qw = qw * l;
    out.steer = L(7);
    return true;
  }
}

export function formatTime(t, signed = false) {
  if (t == null || !Number.isFinite(t)) return '--:--.---';
  if (signed) return (t < 0 ? '-' : '+') + Math.abs(t).toFixed(3);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
