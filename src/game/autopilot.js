// A simple driver model: pure-pursuit steering toward the racing line and a
// speed controller that follows the line's speed profile. It drives the same
// physics as the player through the same controls object.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Autopilot {
  constructor(car, track, line, opts = {}) {
    this.car = car; this.track = track; this.line = line;
    this.pace = opts.pace ?? 1; // scales the target speed; < 1 leaves a margin
    this.throttle = 0; this.brake = 0;
  }

  update(dt) {
    const car = this.car, tr = this.track, line = this.line, n = tr.n;
    const v = Math.max(car.speed, 0);
    const i0 = car.bodyHint;
    const m = car.m;
    const fx = -m[2], fz = -m[8], rx = m[0], rz = m[6];

    // Steering: aim at a point on the line ahead of the front axle.
    const look = clamp(4.5 + 0.2 * v, 5, 24);
    const it = (i0 + Math.round(look / tr.ds)) % n;
    const ox = car.px + fx * car.spec.a, oz = car.pz + fz * car.spec.a;
    const dx = line.x[it] - ox, dz = line.z[it] - oz;
    const ahead = dx * fx + dz * fz, side = dx * rx + dz * rz;
    const alpha = Math.atan2(side, Math.max(ahead, 0.5));
    const dist = Math.hypot(ahead, side);
    car.controls.steerAngle = Math.atan((2 * car.spec.wheelbase * Math.sin(alpha)) / Math.max(dist, 1));

    // Speed: look slightly ahead so braking starts on time.
    const is = (i0 + Math.round((v * 0.12) / tr.ds)) % n;
    const target = line.speed[is] * this.pace;
    const err = target - v;
    let thr = 0, brk = 0;
    if (err < -0.4) brk = clamp(-err * 0.3, 0, 1);
    else thr = clamp(0.35 + err * 0.6, 0, 1);
    // Ease off the throttle when the front tyres are already saturated.
    const front = Math.max(car.wheels[0].slip, car.wheels[1].slip);
    if (front > 1.05) thr *= clamp(1.6 - front * 0.55, 0.2, 1);
    const k = Math.min(1, dt * 14);
    this.throttle += (thr - this.throttle) * k; this.brake += (brk - this.brake) * Math.min(1, dt * 22);
    car.controls.throttle = this.throttle; car.controls.brake = this.brake;
  }
}
