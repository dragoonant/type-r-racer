// The digital instrument cluster, drawn to a canvas and shown on the screen
// behind the steering wheel. Layout: a horizontal rev bar across the top, the
// gear in the centre, speed on the left, boost and lap time on the right.
import * as THREE from 'three';
import { formatTime } from '../game/timing.js';

const W = 1024, H = 384;

export class Cluster {
  constructor(spec) {
    this.spec = spec;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.acc = 1;
  }

  /** Redraw at most 30 times a second. */
  update(dt, s) {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const g = this.g, eng = this.spec.engine;
    g.fillStyle = '#050506'; g.fillRect(0, 0, W, H);

    // --- rev bar
    const x0 = 60, x1 = W - 60, y0 = 50, bh = 62, max = 8000;
    const X = (rpm) => x0 + ((x1 - x0) * rpm) / max;
    g.fillStyle = '#17181b'; g.fillRect(x0, y0, x1 - x0, bh);
    g.fillStyle = '#3a0a0e'; g.fillRect(X(eng.redline), y0, x1 - X(eng.redline), bh);
    const rpm = Math.max(0, Math.min(max, s.rpm));
    const hot = rpm > eng.redline - 300;
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, '#d8dde3'); grad.addColorStop(0.72, '#ffffff'); grad.addColorStop(0.86, '#ffb300'); grad.addColorStop(1, '#ff2a2a');
    g.fillStyle = hot ? '#ff2a2a' : grad;
    g.fillRect(x0, y0, X(rpm) - x0, bh);
    g.fillStyle = '#050506';
    for (let r = 250; r < max; r += 250) g.fillRect(X(r) - 1, y0, r % 1000 ? 1 : 3, bh);
    g.font = '600 26px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    for (let r = 0; r <= max; r += 1000) { g.fillStyle = r >= eng.redline ? '#ff4b4b' : '#9aa0a8'; g.fillText(String(r / 1000), X(r), y0 + bh + 8); }
    g.fillStyle = '#6b7078'; g.font = '500 17px "Segoe UI", Arial, sans-serif'; g.textAlign = 'left';
    g.fillText('x1000 r/min', x0, 22);

    // --- gear
    const gear = s.gear === 0 ? 'N' : s.gear < 0 ? 'R' : String(s.gear);
    g.strokeStyle = '#c8102e'; g.lineWidth = 5;
    g.beginPath(); g.roundRect(W / 2 - 78, 172, 156, 176, 18); g.stroke();
    g.fillStyle = hot ? '#ff3b3b' : '#ffffff'; g.font = '700 150px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(gear, W / 2, 266);

    // --- speed
    g.fillStyle = '#ffffff'; g.font = '700 118px "Segoe UI", Arial, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillText(String(Math.round(Math.abs(s.speedDisplay))), 372, 316);
    g.fillStyle = '#9aa0a8'; g.font = '600 30px "Segoe UI", Arial, sans-serif'; g.textAlign = 'left';
    g.fillText(s.unit, 384, 316);

    // --- boost
    g.fillStyle = '#9aa0a8'; g.font = '600 22px "Segoe UI", Arial, sans-serif'; g.textAlign = 'left';
    g.fillText('BOOST', 640, 208);
    g.fillStyle = '#17181b'; g.fillRect(640, 218, 320, 20);
    g.fillStyle = '#e7e9ec'; g.fillRect(640, 218, 320 * Math.max(0, Math.min(1, s.boost)), 20);

    // --- lap time and delta
    g.fillStyle = '#9aa0a8'; g.fillText('LAP', 640, 278);
    g.fillStyle = '#ffffff'; g.font = '600 44px "Segoe UI", Arial, sans-serif';
    g.fillText(s.lapTime != null ? formatTime(s.lapTime).slice(0, -1) : '-:--.--', 640, 324);
    if (s.delta != null) {
      g.fillStyle = s.delta <= 0 ? '#35d07f' : '#ff5959'; g.font = '600 30px "Segoe UI", Arial, sans-serif'; g.textAlign = 'right';
      g.fillText(formatTime(s.delta, true).slice(0, -1), 962, 322);
    }

    // --- tell-tales
    g.font = '700 20px "Segoe UI", Arial, sans-serif'; g.textAlign = 'left';
    const lamp = (label, x, on, colour) => { g.fillStyle = on ? colour : '#2a2c30'; g.fillText(label, x, 368); };
    lamp('ABS', 64, s.absActive, '#ffb300'); lamp('TC', 130, s.tcActive, '#ffb300');
    lamp(s.autoShift ? 'AUTO' : 'MANUAL', 184, true, '#6b7078');
    lamp('+R', 300, true, '#c8102e');
    this.texture.needsUpdate = true;
  }
}
