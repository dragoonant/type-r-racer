// On-screen driving controls for phones and tablets.
//
// A steering pad sits under the left thumb and two pedals under the right.
// Both are analogue: the pad by how far the thumb is from its centre, the
// pedals by how high up they are pressed. The raw values are handed to Input,
// which smooths them the same way it smooths keys and sticks.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const $ = (id) => document.getElementById(id);

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.root = $('touch');
    this.knob = $('tc-knob');
    this.enabled = false;
    this.driving = false;
    this.manual = false;
    this.onChange = null;

    this._hold($('tc-steer'), (e, el) => {
      const r = el.getBoundingClientRect();
      const travel = Math.max(1, r.width / 2 - r.height / 2); // how far the knob centre can move
      const x = clamp((e.clientX - (r.left + r.width / 2)) / travel, -1, 1);
      input.touch.steer = x; input.touch.steering = true;
      this.knob.style.transform = `translateX(${(x * travel).toFixed(1)}px)`;
    }, () => {
      input.touch.steer = 0; input.touch.steering = false;
      this.knob.style.transform = '';
    });

    for (const [id, key] of [['tc-throttle', 'throttle'], ['tc-brake', 'brake']]) {
      const fill = $(id).querySelector('.fill');
      this._hold($(id), (e, el) => {
        const r = el.getBoundingClientRect();
        // Bottom of the pedal is a light press; the top 40% is flat out.
        const v = clamp(((r.bottom - e.clientY) / r.height) * 1.7, 0.3, 1);
        input.touch[key] = v;
        fill.style.height = `${Math.round(v * 100)}%`;
      }, () => {
        input.touch[key] = 0;
        fill.style.height = '0';
      });
    }

    for (const b of this.root.querySelectorAll('button[data-act]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.device = 'touch';
        input._emit(b.dataset.act);
      });
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    // The first touch anywhere switches the layout, so a laptop with a touch
    // screen only gets these controls when it is actually used that way.
    window.addEventListener('touchstart', () => this.setEnabled(true), { passive: true });
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) this.setEnabled(true);
  }

  /** Press-and-hold control that follows one finger until it lifts. */
  _hold(el, move, end) {
    let id = null;
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      el.classList.remove('held');
      end();
    };
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      this.input.device = 'touch';
      try { el.setPointerCapture(id); } catch { /* not capturable */ }
      el.classList.add('held');
      move(e, el);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e, el); });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    document.body.classList.toggle('touch', on);
    this._apply();
    if (this.onChange) this.onChange();
  }

  /** Show the controls only while driving; shift buttons only with the manual gearbox. */
  sync(driving, manual) {
    this.driving = driving;
    this.manual = manual;
    this._apply();
  }

  _apply() {
    const show = this.enabled && this.driving;
    this.root.hidden = !show;
    $('tc-shift').hidden = !this.manual;
    if (!show) {
      const t = this.input.touch;
      t.steer = 0; t.throttle = 0; t.brake = 0; t.steering = false;
    }
  }
}
