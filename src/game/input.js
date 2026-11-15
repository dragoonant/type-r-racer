// Keyboard, gamepad and touch input, reduced to one set of driving controls.
//
// Analogue values are filtered here so the physics always sees smooth inputs:
// keys ramp instead of snapping, and the stick gets a dead zone and a curve.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const KEY_ACTIONS = {
  KeyE: 'shiftUp', KeyX: 'shiftUp', PageUp: 'shiftUp',
  KeyQ: 'shiftDown', KeyZ: 'shiftDown', PageDown: 'shiftDown',
  KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyP: 'pause',
  KeyM: 'transmission', KeyT: 'tc', KeyB: 'abs', KeyU: 'units', KeyG: 'ghost', KeyL: 'line', KeyH: 'help',
  Enter: 'confirm',
};
// Standard gamepad mapping button indices.
const PAD_ACTIONS = { 1: 'shiftUp', 2: 'shiftDown', 5: 'camera', 8: 'reset', 9: 'pause', 4: 'line' };

export class Input {
  constructor() {
    this.keys = new Set();
    this.listeners = [];
    this.device = 'keyboard';
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.lookX = 0; this.lookBack = false;
    this.padButtons = [];
    this.padIndex = -1;
    this.lastRumble = 0;
    // Raw values written by the on-screen controls (see touch.js).
    this.touch = { steer: 0, throttle: 0, brake: 0, steering: false };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this._driving(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      this.device = 'keyboard';
      const a = KEY_ACTIONS[e.code];
      if (a) this._emit(a);
      if (this._driving(e.code) || a) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this._emit('padConnected', e.gamepad.id); });
    window.addEventListener('gamepaddisconnected', () => { this.padIndex = -1; });
  }

  _driving(code) { return /^(Arrow|Key[WASD]$|Space)/.test(code); }
  on(fn) { this.listeners.push(fn); }
  _emit(action, detail) { for (const fn of this.listeners) fn(action, detail); }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }

  _pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.padIndex >= 0 && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; return p; }
    return null;
  }

  /** Call once per frame. `speed` (m/s) slows keyboard steering at pace. */
  update(dt, speed) {
    const pad = this._pad();
    let padSteer = 0, padThr = 0, padBrk = 0, padHand = 0, padLook = 0, padBack = false;
    if (pad) {
      const dz = (v, d) => (Math.abs(v) < d ? 0 : (Math.sign(v) * (Math.abs(v) - d)) / (1 - d));
      const sx = dz(pad.axes[0] || 0, 0.09);
      padSteer = Math.sign(sx) * Math.pow(Math.abs(sx), 1.55);
      padThr = pad.buttons[7] ? pad.buttons[7].value : 0;
      padBrk = pad.buttons[6] ? pad.buttons[6].value : 0;
      padHand = pad.buttons[0] && pad.buttons[0].pressed ? 1 : 0;
      padLook = dz(pad.axes[2] || 0, 0.15);
      padBack = !!(pad.buttons[3] && pad.buttons[3].pressed);
      for (let i = 0; i < pad.buttons.length; i++) {
        const pressed = pad.buttons[i].pressed;
        if (pressed && !this.padButtons[i]) { if (PAD_ACTIONS[i]) this._emit(PAD_ACTIONS[i]); if (i === 0) this._emit('confirm'); }
        this.padButtons[i] = pressed;
      }
      if (Math.abs(sx) > 0.2 || padThr > 0.2 || padBrk > 0.2) this.device = 'gamepad';
    }

    if (this.device === 'gamepad' && pad) {
      const k = Math.min(1, dt / 0.05);
      this.steer += (padSteer - this.steer) * k;
      this.throttle += (padThr - this.throttle) * Math.min(1, dt / 0.03);
      this.brake += (padBrk - this.brake) * Math.min(1, dt / 0.03);
      this.handbrake = padHand;
      this.lookX = padLook; this.lookBack = padBack;
    } else if (this.device === 'touch') {
      const t = this.touch;
      // A gentle curve gives finer control near the centre of the pad.
      const target = Math.sign(t.steer) * Math.pow(Math.abs(t.steer), 1.35);
      const rate = t.steering ? 7 : 5;
      this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
      this.throttle += clamp(t.throttle - this.throttle, -8 * dt, 5 * dt);
      this.brake += clamp(t.brake - this.brake, -9 * dt, 6 * dt);
      this.handbrake = 0; this.lookX = 0; this.lookBack = false;
    } else {
      const left = this.down('ArrowLeft', 'KeyA'), right = this.down('ArrowRight', 'KeyD');
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      // Slower hands at speed; quicker to unwind than to wind on.
      const pace = 1 / (1 + Math.max(speed, 0) / 45);
      const rate = target === 0 ? 4.5 : Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 6.5 : 2.6 * pace + 0.5;
      const d = target - this.steer;
      this.steer += clamp(d, -rate * dt, rate * dt);
      const thr = this.down('ArrowUp', 'KeyW') ? 1 : 0, brk = this.down('ArrowDown', 'KeyS') ? 1 : 0;
      this.throttle += clamp(thr - this.throttle, -7 * dt, 3.2 * dt);
      this.brake += clamp(brk - this.brake, -8 * dt, 3.6 * dt);
      this.handbrake = this.down('Space') ? 1 : 0;
      this.lookX = (this.down('Period') ? 1 : 0) - (this.down('Comma') ? 1 : 0);
      this.lookBack = this.down('KeyV');
    }
  }

  /** Controller vibration, 0..1 for the heavy and light motors. */
  rumble(strong, weak, now) {
    const pad = this._pad();
    if (!pad || !pad.vibrationActuator || this.device !== 'gamepad') return;
    if (now - this.lastRumble < 0.07) return;
    this.lastRumble = now;
    if (strong < 0.02 && weak < 0.02) return;
    try { pad.vibrationActuator.playEffect('dual-rumble', { duration: 90, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }); } catch { /* unsupported */ }
  }
}
