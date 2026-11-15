// On-screen display: timing panel, speed and gear, pedal bars, track map,
// corner names and short messages. Plain DOM over the 3D canvas.
import { formatTime } from './timing.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(track, spec) {
    this.track = track; this.spec = spec;
    this.el = {
      root: $('hud'), current: $('t-current'), flag: $('t-flag'), delta: $('t-delta'), last: $('t-last'), best: $('t-best'),
      sectors: [$('s-0'), $('s-1'), $('s-2')], corner: $('corner'), toast: $('toast'),
      revfill: $('revfill'), revred: $('revred'), gear: $('gear'), speed: $('speed'), unit: $('unit'),
      brake: $('p-brake'), throttle: $('p-throttle'), gearbox: $('a-gearbox'), abs: $('a-abs'), tc: $('a-tc'), cam: $('a-cam'), dash: $('dash'),
    };
    this.map = $('minimap'); this.mg = this.map.getContext('2d');
    this.cache = {};
    this.toastTimer = 0; this.cornerTimer = 0;
    this.el.revred.style.width = ((1 - spec.engine.redline / 8000) * 100).toFixed(1) + '%';
    this._buildMap();
  }

  _buildMap() {
    const tr = this.track, size = 220, pad = 14;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < tr.n; i++) { minX = Math.min(minX, tr.x[i]); maxX = Math.max(maxX, tr.x[i]); minZ = Math.min(minZ, tr.z[i]); maxZ = Math.max(maxZ, tr.z[i]); }
    const sc = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * sc) / 2 - minX * sc, oz = (size - (maxZ - minZ) * sc) / 2 - minZ * sc;
    this.mapXY = (x, z) => [x * sc + ox, z * sc + oz];
    const base = document.createElement('canvas'); base.width = base.height = size * 2;
    const g = base.getContext('2d'); g.scale(2, 2);
    const path = () => { g.beginPath(); for (let i = 0; i < tr.n; i += 2) { const [x, y] = this.mapXY(tr.x[i], tr.z[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); };
    g.lineJoin = 'round';
    path(); g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 7; g.stroke();
    path(); g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 3; g.stroke();
    // Start line and sector marks.
    tr.sectors.forEach((idx, k) => {
      const [x, y] = this.mapXY(tr.x[idx], tr.z[idx]);
      g.fillStyle = k === 0 ? '#c8102e' : '#ffd24a'; g.beginPath(); g.arc(x, y, k === 0 ? 4 : 2.6, 0, 7); g.fill();
    });
    this.mapBase = base;
  }

  show(on) { this.el.root.hidden = !on; }

  _set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop === 'class') el.className = value; else if (prop.startsWith('style.')) el.style[prop.slice(6)] = value; else el[prop] = value;
  }

  toast(text, sub = '', seconds = 2.6) {
    this.el.toast.innerHTML = '';
    this.el.toast.append(text);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; this.el.toast.append(s); }
    this.el.toast.classList.add('show');
    this.toastTimer = seconds;
  }
  cornerName(text) { this.el.corner.textContent = text; this.el.corner.classList.add('show'); this.cornerTimer = 2.4; }

  sector(index, state) { this._set('sec' + index, this.el.sectors[index], 'sec ' + state, 'class'); }
  clearSectors() { for (let i = 0; i < 3; i++) this.sector(i, ''); }

  update(dt, s) {
    const e = this.el;
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) e.toast.classList.remove('show');
    if (this.cornerTimer > 0 && (this.cornerTimer -= dt) <= 0) e.corner.classList.remove('show');

    this._set('cur', e.current, s.running ? formatTime(s.lapTime) : '-:--.---');
    this._set('flag', e.flag, s.running && !s.valid ? 'OFF TRACK' : '');
    this._set('last', e.last, formatTime(s.lastLap));
    this._set('best', e.best, formatTime(s.bestLap));
    if (s.delta != null && s.running) {
      this._set('delta', e.delta, formatTime(s.delta, true));
      this._set('deltaC', e.delta, s.delta <= 0 ? 'ahead' : 'behind', 'class');
    } else this._set('delta', e.delta, ' ');

    const hot = s.rpm > this.spec.engine.redline - 300;
    this._set('rev', e.revfill, (Math.min(1, s.rpm / 8000) * 100).toFixed(1) + '%', 'style.width');
    this._set('revC', e.revfill, hot ? 'hot' : '', 'class');
    this._set('gear', e.gear, s.gear === 0 ? 'N' : s.gear < 0 ? 'R' : String(s.gear));
    this._set('gearC', e.gear, hot ? 'hot' : '', 'class');
    this._set('speed', e.speed, String(Math.round(Math.abs(s.speedDisplay))));
    this._set('unit', e.unit, s.unit);
    this._set('thr', e.throttle, (s.throttle * 100).toFixed(0) + '%', 'style.height');
    this._set('brk', e.brake, (s.brake * 100).toFixed(0) + '%', 'style.height');
    this._set('gb', e.gearbox, s.autoShift ? 'AUTO' : 'MANUAL');
    this._set('abs', e.abs, s.absActive ? 'active' : s.absOn ? 'on' : 'off', 'class');
    this._set('tc', e.tc, s.tcActive ? 'active' : s.tcOn ? 'on' : 'off', 'class');
    this._set('cam', e.cam, s.cameraLabel);

    // Map.
    const g = this.mg;
    g.clearRect(0, 0, 220, 220);
    g.drawImage(this.mapBase, 0, 0, 220, 220);
    if (s.ghost) { const [x, y] = this.mapXY(s.ghost.px, s.ghost.pz); g.fillStyle = '#7fd4ff'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    const [cx, cy] = this.mapXY(s.px, s.pz);
    g.fillStyle = '#c8102e'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill(); g.stroke();
  }
}
