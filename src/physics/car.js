// Vehicle dynamics: a six-degree-of-freedom rigid body on four independently
// sprung wheels, with a combined-slip tyre model, a turbocharged engine, a
// clutch, a six-speed gearbox and a torque-biasing limited-slip differential.
//
// Body frame: +x right, +y up, -z forward, origin at the centre of gravity.
// Wheel order: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right.
//
// The step runs at a fixed 500 Hz. Wheel and engine speeds are integrated
// implicitly (a small linear solve each step) so the stiff tyre and clutch
// couplings stay stable at any speed, including standstill.

import { makeTire, SURFACE_DRAG } from './tire.js';
import { SURFACE } from '../track/track.js';

const GRAV = 9.81;
const RHO = 1.2;
export const PHYSICS_DT = 1 / 500;
const RPM = 30 / Math.PI; // rad/s -> rpm

function curve(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Solve a 3x3 linear system by Cramer's rule. m is row-major, r the right side. */
function solve3(m, r, out) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = 1 / det;
  out[0] = (r[0] * (e * i - f * h) - b * (r[1] * i - f * r[2]) + c * (r[1] * h - e * r[2])) * inv;
  out[1] = (a * (r[1] * i - f * r[2]) - r[0] * (d * i - f * g) + c * (d * r[2] - r[1] * g)) * inv;
  out[2] = (a * (e * r[2] - r[1] * h) - b * (d * r[2] - r[1] * g) + r[0] * (d * h - e * g)) * inv;
  return out;
}

function makeWheel(front, left) {
  return {
    front, left,
    omega: 0, angle: 0, steer: 0,
    hint: 0, q: {}, contact: false,
    travel: 0, // + = compressed from static ride height
    length: 0, // hardpoint to wheel centre
    load: 0, fx: 0, fy: 0, kappa: 0, alpha: 0, slip: 0, surface: 0,
    vLong: 0, vLat: 0,
    absFactor: 1,
    // scratch
    cpx: 0, cpy: 0, cpz: 0, fwx: 0, fwy: 0, fwz: 0, swx: 0, swy: 0, swz: 0,
    spring: 0, fx0: 0, slope: 0, brake: 0,
    t: {},
  };
}

export class Car {
  constructor(spec, track) {
    this.spec = spec;
    this.track = track;
    this.tire = makeTire(spec.tire);
    this.wheels = [makeWheel(true, true), makeWheel(true, false), makeWheel(false, true), makeWheel(false, false)];

    // Suspension geometry (the hardpoint height is arbitrary; only lengths matter).
    this.hardY = 0.25;
    this.staticLen = this.hardY - spec.wheelRadius + spec.cgHeight;
    this.staticCompF = spec.staticFront / spec.front.spring;
    this.staticCompR = spec.staticRear / spec.rear.spring;

    this.controls = {
      steer: 0, // -1 (left) .. +1 (right); mapped to a speed-sensitive lock
      steerAngle: null, // rad at the road wheels; when set, bypasses `steer`
      throttle: 0, brake: 0, handbrake: 0,
      autoShift: true, abs: true, tc: true,
    };
    this.shiftRequest = 0;

    // Body contact points: four underbody corners and four roof corners.
    const hw = (spec.bodyWidth / 2) * 0.94;
    const zf = -(spec.a + spec.frontOverhang) * 0.98, zr = (spec.bodyLength - spec.a - spec.frontOverhang) * 0.98;
    const yb = -(spec.cgHeight - 0.14), yt = spec.bodyHeight - spec.cgHeight;
    this.bodyPts = [
      [-hw, yb, zf], [hw, yb, zf], [-hw, yb, zr], [hw, yb, zr],
      [-hw * 0.8, yt, zf * 0.3], [hw * 0.8, yt, zf * 0.3], [-hw * 0.8, yt, zr * 0.6], [hw * 0.8, yt, zr * 0.6],
    ];

    this.m = new Float64Array(9); // body -> world rotation, row-major
    this._mat = new Float64Array(9); this._rhs = new Float64Array(3); this._sol = new Float64Array(3);
    this.bodyQ = {};
    this.acc = 0;
    this.reset(0, 0);
  }

  /** Place the car at rest on the track at fractional index s, lateral offset d. */
  reset(s, d = 0) {
    const tr = this.track, sp = this.spec;
    const pt = tr.pointAt(s, d);
    this.px = pt.x; this.pz = pt.z; this.py = pt.y + sp.cgHeight + 0.02;
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
    // Heading: body forward (-z) along the track tangent. Yaw about +y.
    const yaw = Math.atan2(-pt.tx, -pt.tz);
    this.qx = 0; this.qy = Math.sin(yaw / 2); this.qz = 0; this.qw = Math.cos(yaw / 2);
    const hint = tr.wrap(Math.floor(s));
    this.bodyHint = hint;
    for (const w of this.wheels) { w.omega = 0; w.hint = hint; w.absFactor = 1; w.slip = 0; w.kappa = 0; w.alpha = 0; w.load = 0; w.travel = 0; w.length = this.staticLen; }
    this.engineOmega = sp.engine.idle / RPM;
    this.boost = 0;
    this.gear = 1;
    this.shiftTimer = 0; this.clutchRamp = 1; this.shiftCooldown = 0; this.gearHold = 0;
    this.limiterCut = false;
    this.tcFactor = 1;
    this.reversing = false; this.reverseHold = 0; this.reverseArmed = false;
    this.rpm = sp.engine.idle; this.speed = 0; this.throttleOut = 0; this.brakeOut = 0;
    this.gLong = 0; this.gLat = 0;
    this.wallImpact = 0; this.bottomImpact = 0;
    this.clutchSlip = 0; this.steerOut = 0;
    this.time = 0; this.acc = 0;
    this.shiftRequest = 0;
    this._updateMatrix();
  }

  shiftUp() { this.shiftRequest = 1; }
  shiftDown() { this.shiftRequest = -1; }

  _updateMatrix() {
    const { qx, qy, qz, qw, m } = this;
    m[0] = 1 - 2 * (qy * qy + qz * qz); m[1] = 2 * (qx * qy - qz * qw); m[2] = 2 * (qx * qz + qy * qw);
    m[3] = 2 * (qx * qy + qz * qw); m[4] = 1 - 2 * (qx * qx + qz * qz); m[5] = 2 * (qy * qz - qx * qw);
    m[6] = 2 * (qx * qz - qy * qw); m[7] = 2 * (qy * qz + qx * qw); m[8] = 1 - 2 * (qx * qx + qy * qy);
  }

  /** Total driveline ratio for a gear number (-1 reverse, 0 neutral). */
  ratio(gear) {
    const sp = this.spec;
    if (gear > 0) return sp.gears[gear - 1] * sp.finalDrive;
    if (gear < 0) return -sp.reverse * sp.finalDrive;
    return 0;
  }

  _startShift(target) {
    if (target === this.gear || this.shiftTimer > 0) return;
    if (target > this.spec.gears.length || target < -1) return;
    this.gear = target;
    this.shiftTimer = target === 0 ? 0.05 : this.spec.shiftTime;
    this.clutchRamp = 0;
    this.shiftCooldown = 0.45;
  }

  /** Advance by a frame's worth of time using fixed sub-steps. */
  update(frameDt) {
    this.acc += Math.min(frameDt, 0.1);
    this.wallImpact = 0; this.bottomImpact = 0;
    let n = 0;
    while (this.acc >= PHYSICS_DT && n < 60) { this.step(PHYSICS_DT); this.acc -= PHYSICS_DT; n++; }
    return n;
  }

  step(dt) {
    const sp = this.spec, tr = this.track, c = this.controls, m = this.m, W = this.wheels;
    this.time += dt;

    // Body axes in world space.
    const rx = m[0], ry = m[3], rz = m[6]; // right
    const ux = m[1], uy = m[4], uz = m[7]; // up
    const fx = -m[2], fy = -m[5], fz = -m[8]; // forward
    const { px, py, pz, vx, vy, vz, wx, wy, wz } = this;
    const vFwd = vx * fx + vy * fy + vz * fz;
    const vSide = vx * rx + vy * ry + vz * rz;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

    // ------------------------------------------------------------ driver inputs
    let throttleIn = clamp(c.throttle, 0, 1), brakeIn = clamp(c.brake, 0, 1);
    if (c.autoShift) {
      // With automatic shifting, holding the brake at a standstill selects
      // reverse and the pedals swap until the throttle is pressed again.
      // The brake must be released and pressed again once stopped, so simply
      // holding the car on the brake never engages reverse.
      if (!this.reversing) {
        if (Math.abs(vFwd) > 1.2) this.reverseArmed = false;
        else if (brakeIn < 0.1) this.reverseArmed = true;
        if (this.reverseArmed && Math.abs(vFwd) < 0.6 && brakeIn > 0.5 && throttleIn < 0.05) this.reverseHold += dt; else this.reverseHold = 0;
        if (this.reverseHold > 0.45 && this.gear !== -1) { this.reversing = true; this.gear = -1; this.shiftTimer = 0.12; this.clutchRamp = 0; }
      } else {
        if (throttleIn > 0.1 && vFwd > -1.0) { this.reversing = false; this.reverseHold = 0; this.gear = 1; this.shiftTimer = 0.12; this.clutchRamp = 0; }
        else { const t = throttleIn; throttleIn = brakeIn; brakeIn = t; }
      }
    } else this.reversing = false;

    // Steering: map the stick to a lock that shrinks with speed, plus extra
    // lock in the direction of a slide so the driver can catch it.
    let delta;
    if (c.steerAngle !== null) delta = clamp(c.steerAngle, -sp.maxSteer, sp.maxSteer);
    else {
      const v2 = Math.max(vFwd * vFwd, 1);
      let lock = Math.atan((sp.wheelbase * 11.5) / v2) * 1.5 + 0.11;
      if (vFwd > 4) {
        const beta = Math.atan2(vSide, vFwd); // + = sliding to the right
        if (beta * c.steer > 0) lock += Math.min(0.45, Math.abs(beta) * 1.2);
      }
      delta = clamp(c.steer, -1, 1) * Math.min(sp.maxSteer, lock);
    }
    this.steerOut = delta;
    {
      const tn = Math.tan(delta), L = sp.wheelbase, h = (sp.trackFront / 2) * 0.6;
      W[0].steer = Math.atan((L * tn) / (L + h * tn));
      W[1].steer = Math.atan((L * tn) / (L - h * tn));
    }

    // ------------------------------------------------------------ suspension
    let Fx = 0, Fy = -sp.mass * GRAV, Fz = 0, Tx = 0, Ty = 0, Tz = 0;
    const R = sp.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const w = W[i], front = i < 2;
      const lx = (w.left ? -0.5 : 0.5) * (front ? sp.trackFront : sp.trackRear);
      const ly = this.hardY, lz = front ? -sp.a : sp.b;
      const hx = px + m[0] * lx + m[1] * ly + m[2] * lz;
      const hy = py + m[3] * lx + m[4] * ly + m[5] * lz;
      const hz = pz + m[6] * lx + m[7] * ly + m[8] * lz;
      const q = tr.query(hx, hz, w.hint, w.q);
      w.hint = q.i; w.surface = q.surface;
      const un = ux * q.nx + uy * q.ny + uz * q.nz;
      const susp = front ? sp.front : sp.rear;
      const staticComp = front ? this.staticCompF : this.staticCompR;
      w.contact = false; w.spring = 0;
      let len = this.staticLen + sp.travelDroop;
      if (un > 0.25) {
        const dist = ((hy - q.y) * q.ny) / un;
        const L = dist - R;
        const comp = this.staticLen + staticComp - L;
        if (L < len) len = L;
        if (comp > 0 && dist > -0.3) {
          const cx = hx - ux * dist, cy = hy - uy * dist, cz = hz - uz * dist;
          const ax = cx - px, ay = cy - py, az = cz - pz;
          const pvx = vx + wy * az - wz * ay, pvy = vy + wz * ax - wx * az, pvz = vz + wx * ay - wy * ax;
          const vn = pvx * q.nx + pvy * q.ny + pvz * q.nz;
          const rate = -vn / un; // + = compressing
          let f = susp.spring * comp + susp.damper * rate * (rate > 0 ? 0.8 : 1.3);
          const over = this.staticLen - sp.travelBump - L;
          if (over > 0) f += sp.bumpStopRate * over + 2500 * Math.max(0, rate);
          w.spring = f;
          w.contact = true;
          w.cpx = cx; w.cpy = cy; w.cpz = cz;
          w.pvx = pvx; w.pvy = pvy; w.pvz = pvz;
          // Tyre axes on the ground plane.
          const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
          let hxd = fx * cs + rx * sn, hyd = fy * cs + ry * sn, hzd = fz * cs + rz * sn;
          const hn = hxd * q.nx + hyd * q.ny + hzd * q.nz;
          hxd -= q.nx * hn; hyd -= q.ny * hn; hzd -= q.nz * hn;
          const hl = 1 / Math.sqrt(hxd * hxd + hyd * hyd + hzd * hzd);
          hxd *= hl; hyd *= hl; hzd *= hl;
          w.fwx = hxd; w.fwy = hyd; w.fwz = hzd;
          w.swx = hyd * q.nz - hzd * q.ny; w.swy = hzd * q.nx - hxd * q.nz; w.swz = hxd * q.ny - hyd * q.nx;
          w.vLong = pvx * hxd + pvy * hyd + pvz * hzd;
          w.vLat = pvx * w.swx + pvy * w.swy + pvz * w.swz;
        }
      }
      w.length = Math.max(len, this.staticLen - sp.travelBump - 0.03);
      w.travel = this.staticLen - w.length;
    }
    // Anti-roll bars move load from the lightly loaded wheel to the heavily loaded one.
    {
      const af = sp.antiRollFront * (W[0].travel - W[1].travel), ar = sp.antiRollRear * (W[2].travel - W[3].travel);
      W[0].load = W[0].contact ? Math.max(0, W[0].spring + af) : 0;
      W[1].load = W[1].contact ? Math.max(0, W[1].spring - af) : 0;
      W[2].load = W[2].contact ? Math.max(0, W[2].spring + ar) : 0;
      W[3].load = W[3].contact ? Math.max(0, W[3].spring - ar) : 0;
    }

    // ------------------------------------------------------------ engine
    const eng = sp.engine;
    const rpm = this.engineOmega * RPM;
    const G = this.ratio(this.gear);
    const diffOmega = 0.5 * (W[0].omega + W[1].omega);
    const shifting = this.shiftTimer > 0;
    if (shifting) this.shiftTimer -= dt;
    else if (this.clutchRamp < 1) this.clutchRamp = Math.min(1, this.clutchRamp + dt / 0.09);
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;
    if (this.gearHold > 0) this.gearHold -= dt;

    // Traction control trims the throttle when a driven wheel spins up.
    if (c.tc && !shifting) {
      // Proportional: full torque up to the slip where the tyre peaks, then
      // tapering. It settles where engine torque matches available traction.
      const dirn = this.gear < 0 ? -1 : 1, floor = Math.max(Math.abs(vFwd), 4);
      const k = Math.max((W[0].omega * R - W[0].vLong) * dirn, (W[1].omega * R - W[1].vLong) * dirn) / floor;
      const want = clamp(1 - (k - 0.1) / 0.14, 0.08, 1);
      this.tcFactor += (want - this.tcFactor) * Math.min(1, dt / (want < this.tcFactor ? 0.03 : 0.12));
    } else this.tcFactor = 1;

    if (rpm > eng.limiter) this.limiterCut = true; else if (rpm < eng.limiter - 110) this.limiterCut = false;
    let thr = this.limiterCut ? 0 : throttleIn * this.tcFactor;
    if (shifting) thr = 0;
    // Pulling away: the automatic clutch slips until road speed catches up,
    // and the revs are held in the boost range instead of running to the limiter.
    const launchLo = 1000 + 1400 * throttleIn;
    const launching = G !== 0 && !shifting && G * diffOmega < (launchLo + 700) / RPM;
    if (launching && rpm > launchLo + 800) thr *= clamp(1 - (rpm - launchLo - 800) / 500, 0, 1);
    this.throttleOut = thr;

    // Turbo: boost chases the throttle with an rpm-dependent lag.
    {
      const tau = thr > this.boost ? eng.spoolFast + eng.spoolSlow * Math.exp(-(rpm - eng.spoolRefRpm) / eng.spoolFalloff) : eng.spoolDown;
      this.boost += ((thr - this.boost) * dt) / Math.max(tau, dt);
      this.boost = clamp(this.boost, 0, 1);
    }
    const tFull = curve(eng.torqueFull, rpm), tOff = Math.min(tFull, curve(eng.torqueOffBoost, rpm));
    const tBrake = eng.brakeTorqueBase + eng.brakeTorquePerRpm * Math.max(rpm, 0);
    let engTorque = thr * (tOff + this.boost * (tFull - tOff)) - (1 - thr) * tBrake;
    engTorque += clamp((eng.idle + 40 - rpm) * 0.7, 0, 110); // idle governor
    if (shifting && G !== 0) {
      // Rev-match: drive the engine toward the speed the new gear needs.
      const target = Math.max(G * diffOmega, eng.idle / RPM);
      engTorque = clamp(((target - this.engineOmega) * eng.inertia) / (dt * 12), -1.4 * tBrake, 0.6 * tFull);
    }

    // Clutch capacity: open while shifting, rpm-governed when pulling away.
    let clutchCap = 0;
    if (G !== 0 && !shifting) {
      if (launching) {
        clutchCap = sp.clutchTorque * clamp((rpm - launchLo) / 1300, 0, 1);
        // With traction control on, feed in no more torque than the front tyres can use.
        if (c.tc) clutchCap = Math.min(clutchCap, (0.97 * sp.tire.muX * (W[0].load + W[1].load) * R) / (Math.abs(G) * sp.efficiency));
      } else clutchCap = sp.clutchTorque;
      clutchCap *= this.clutchRamp;
    }

    // ------------------------------------------------------------ brakes
    const handbrake = clamp(c.handbrake, 0, 1);
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      if (c.abs && brakeIn > 0.02 && Math.abs(w.vLong) > 2.5) {
        const k = w.vLong > 0 ? w.kappa : -w.kappa;
        if (k < -0.15) w.absFactor = Math.max(0.03, w.absFactor - dt * (10 + 60 * (-0.15 - k)));
        else w.absFactor = Math.min(1, w.absFactor + dt * 5);
      } else w.absFactor = 1;
      w.brake = brakeIn * (i < 2 ? sp.brakeFront : sp.brakeRear) * w.absFactor + (i >= 2 ? handbrake * 1900 : 0);
    }
    this.brakeOut = brakeIn;

    // ------------------------------------------------------------ tyres, first pass
    // Longitudinal force at the current wheel speed and its slope against
    // wheel speed, used to integrate the wheels implicitly.
    const tire = this.tire;
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      if (!w.contact || w.load <= 0) { w.fx0 = 0; w.slope = 0; continue; }
      tire(w.load, w.vLong, w.vLat, w.omega, R, w.surface, w.t);
      const f0 = w.t.fx;
      tire(w.load, w.vLong, w.vLat, w.omega + 0.02, R, w.surface, w.t);
      w.fx0 = f0; w.slope = Math.max(0, (w.t.fx - f0) / 0.02);
    }

    // ------------------------------------------------------------ driveline solve
    // Unknowns: new engine speed e, left and right front wheel speeds l, r.
    {
      const A = eng.inertia / dt, B = sp.wheelInertiaFront / dt, eta = sp.efficiency;
      const wl = W[0], wr = W[1];
      const dirL = wl.omega !== 0 ? Math.sign(wl.omega) : Math.sign(wl.vLong);
      const dirR = wr.omega !== 0 ? Math.sign(wr.omega) : Math.sign(wr.vLong);
      const kL = R * wl.slope, kR = R * wr.slope;
      const rhsL = B * wl.omega + kL * wl.omega - R * wl.fx0 - dirL * wl.brake;
      const rhsR = B * wr.omega + kR * wr.omega - R * wr.fx0 - dirR * wr.brake;
      const CC = 2600, CL = sp.lsd.viscous; // viscous rates used while locked
      let clutchMode = clutchCap > 0 ? 1 : 0, clutchT = 0; // 1 = locked (viscous), 2 = slipping (constant)
      let lsdMode = 1, lsdT = 0;
      const M = this._mat, r = this._rhs, s = this._sol;
      for (let pass = 0; pass < 3; pass++) {
        const cc = clutchMode === 1 ? CC : 0, cl = lsdMode === 1 ? CL : 0;
        const tc = clutchMode === 2 ? clutchT : 0, tl = lsdMode === 2 ? lsdT : 0;
        const g2 = (eta * G * G * cc) / 4;
        M[0] = A + cc; M[1] = (-cc * G) / 2; M[2] = (-cc * G) / 2;
        M[3] = (-eta * G * cc) / 2; M[4] = B + kL + g2 + cl; M[5] = g2 - cl;
        M[6] = (-eta * G * cc) / 2; M[7] = g2 - cl; M[8] = B + kR + g2 + cl;
        r[0] = A * this.engineOmega + engTorque - tc;
        r[1] = rhsL + (eta * G * tc) / 2 - tl;
        r[2] = rhsR + (eta * G * tc) / 2 + tl;
        solve3(M, r, s);
        let changed = false;
        if (clutchMode === 1) {
          const t = CC * (s[0] - (G * (s[1] + s[2])) / 2);
          if (Math.abs(t) > clutchCap) { clutchMode = 2; clutchT = Math.sign(t) * clutchCap; changed = true; }
          else clutchT = t;
        }
        if (!changed && lsdMode === 1) {
          const t = CL * (s[1] - s[2]);
          const cap = sp.lsd.preload + ((sp.lsd.biasRatio - 1) / (sp.lsd.biasRatio + 1)) * Math.abs(eta * G * clutchT);
          if (Math.abs(t) > cap) { lsdMode = 2; lsdT = Math.sign(t) * cap; changed = true; }
        }
        if (!changed) break;
      }
      this.engineOmega = Math.max(s[0], 200 / RPM);
      let nl = s[1], nr = s[2];
      if (wl.brake > 0 && nl * dirL < 0) nl = 0;
      if (wr.brake > 0 && nr * dirR < 0) nr = 0;
      wl.omega = nl; wr.omega = nr;
      this.clutchSlip = G !== 0 ? this.engineOmega - (G * (nl + nr)) / 2 : 0;
      this.driveTorque = clutchT;
    }
    // Rear wheels roll freely apart from brakes.
    for (let i = 2; i < 4; i++) {
      const w = W[i], B = sp.wheelInertiaRear / dt, k = R * w.slope;
      const dir = w.omega !== 0 ? Math.sign(w.omega) : Math.sign(w.vLong);
      let n = w.omega + (-R * w.fx0 - dir * w.brake) / (B + k);
      if (w.brake > 0 && n * dir < 0) n = 0;
      w.omega = n;
    }

    // ------------------------------------------------------------ tyres, final pass
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      w.angle += w.omega * dt;
      if (!w.contact || w.load <= 0) { w.fx = 0; w.fy = 0; w.slip *= 0.9; w.kappa = 0; continue; }
      const t = tire(w.load, w.vLong, w.vLat, w.omega, R, w.surface, w.t);
      w.fx = t.fx; w.fy = t.fy; w.kappa = t.kappa; w.alpha = t.alpha; w.slip = t.slip;
      const q = w.q, N = w.load;
      // Rolling resistance along the wheel, loose-surface drag against the motion.
      const roll = -sp.tire.rolling * N * clamp(w.vLong / 0.5, -1, 1);
      const pv = Math.hypot(w.vLong, w.vLat), drag = (SURFACE_DRAG[w.surface] * N) / Math.max(pv, 1.5);
      const fl = t.fx + roll - drag * w.vLong, fs = t.fy - drag * w.vLat;
      // Normal + longitudinal force at the contact patch.
      let ax = w.cpx - px, ay = w.cpy - py, az = w.cpz - pz;
      let gx = q.nx * N + w.fwx * fl, gy = q.ny * N + w.fwy * fl, gz = q.nz * N + w.fwz * fl;
      Fx += gx; Fy += gy; Fz += gz;
      Tx += ay * gz - az * gy; Ty += az * gx - ax * gz; Tz += ax * gy - ay * gx;
      // Lateral force at roll-centre height.
      const rc = i < 2 ? sp.rollCentreFront : sp.rollCentreRear;
      ax += ux * rc; ay += uy * rc; az += uz * rc;
      gx = w.swx * fs; gy = w.swy * fs; gz = w.swz * fs;
      Fx += gx; Fy += gy; Fz += gz;
      Tx += ay * gz - az * gy; Ty += az * gx - ax * gz; Tz += ax * gy - ay * gx;
    }

    // ------------------------------------------------------------ aerodynamics
    {
      const k = 0.5 * RHO * sp.dragArea * speed;
      Fx -= k * vx; Fy -= k * vy; Fz -= k * vz;
      const qd = 0.5 * RHO * vFwd * vFwd;
      const lf = qd * sp.liftAreaFront, lr = qd * sp.liftAreaRear; // along body up
      // Applied at the axles: torque = r x F with r = forward * a (front), -forward * b (rear).
      Fx += ux * (lf + lr); Fy += uy * (lf + lr); Fz += uz * (lf + lr);
      const arm = sp.a * lf - sp.b * lr; // moment arm along forward
      // (forward * arm) x up
      Tx += (fy * uz - fz * uy) * arm; Ty += (fz * ux - fx * uz) * arm; Tz += (fx * uy - fy * ux) * arm;
    }

    // ------------------------------------------------------------ body vs ground and walls
    {
      const q = tr.query(px, pz, this.bodyHint, this.bodyQ);
      this.bodyHint = q.i;
      const wallR = q.half + q.vergeR, wallL = -(q.half + q.vergeL);
      for (let i = 0; i < 8; i++) {
        const b = this.bodyPts[i];
        const ax = m[0] * b[0] + m[1] * b[1] + m[2] * b[2];
        const ay = m[3] * b[0] + m[4] * b[1] + m[5] * b[2];
        const az = m[6] * b[0] + m[7] * b[1] + m[8] * b[2];
        const pvx = vx + wy * az - wz * ay, pvy = vy + wz * ax - wx * az, pvz = vz + wx * ay - wy * ax;
        const lat = ax * q.rx + az * q.rz, along = ax * q.tx + az * q.tz;
        const d = q.d + lat;
        let gx = 0, gy = 0, gz = 0;
        // Ground.
        const ground = q.y + q.bank * lat + q.grade * along;
        const pen = ground - (py + ay);
        if (pen > 0) {
          const n = Math.max(0, 260000 * pen - 9000 * pvy);
          const vt = Math.hypot(pvx, pvz), fr = (0.55 * n) / (vt + 0.6);
          gx -= fr * pvx; gz -= fr * pvz; gy += n;
          if (n > this.bottomImpact) this.bottomImpact = n;
        }
        // Barriers (underbody corners only).
        if (i < 4) {
          const over = d > wallR ? d - wallR : d < wallL ? d - wallL : 0;
          if (over !== 0) {
            const sgn = Math.sign(over); // +1 = through the right-hand wall
            const vInto = (pvx * q.rx + pvz * q.rz) * sgn;
            const n = Math.max(0, 420000 * Math.abs(over) + 26000 * vInto);
            const vAlong = pvx * q.tx + pvz * q.tz, fr = (0.38 * n * vAlong) / (Math.abs(vAlong) + 1.5);
            gx += -sgn * q.rx * n - q.tx * fr; gz += -sgn * q.rz * n - q.tz * fr;
            if (vInto > this.wallImpact) this.wallImpact = vInto;
          }
        }
        if (gx !== 0 || gy !== 0 || gz !== 0) {
          Fx += gx; Fy += gy; Fz += gz;
          Tx += ay * gz - az * gy; Ty += az * gx - ax * gz; Tz += ax * gy - ay * gx;
        }
      }
    }

    // ------------------------------------------------------------ integrate
    const im = 1 / sp.mass;
    const axw = Fx * im, ayw = Fy * im, azw = Fz * im;
    this.vx += axw * dt; this.vy += ayw * dt; this.vz += azw * dt;
    this.px += this.vx * dt; this.py += this.vy * dt; this.pz += this.vz * dt;
    // Angular: work in the body frame where the inertia tensor is diagonal.
    const I = sp.inertia;
    const tbx = m[0] * Tx + m[3] * Ty + m[6] * Tz, tby = m[1] * Tx + m[4] * Ty + m[7] * Tz, tbz = m[2] * Tx + m[5] * Ty + m[8] * Tz;
    let obx = m[0] * wx + m[3] * wy + m[6] * wz, oby = m[1] * wx + m[4] * wy + m[7] * wz, obz = m[2] * wx + m[5] * wy + m[8] * wz;
    const hxb = I.pitch * obx, hyb = I.yaw * oby, hzb = I.roll * obz;
    obx += ((tbx - (oby * hzb - obz * hyb)) / I.pitch) * dt;
    oby += ((tby - (obz * hxb - obx * hzb)) / I.yaw) * dt;
    obz += ((tbz - (obx * hyb - oby * hxb)) / I.roll) * dt;
    const nwx = m[0] * obx + m[1] * oby + m[2] * obz, nwy = m[3] * obx + m[4] * oby + m[5] * obz, nwz = m[6] * obx + m[7] * oby + m[8] * obz;
    this.wx = nwx; this.wy = nwy; this.wz = nwz;
    const { qx, qy, qz, qw } = this, h = 0.5 * dt;
    let nqx = qx + h * (nwx * qw + nwy * qz - nwz * qy);
    let nqy = qy + h * (nwy * qw + nwz * qx - nwx * qz);
    let nqz = qz + h * (nwz * qw + nwx * qy - nwy * qx);
    let nqw = qw + h * (-nwx * qx - nwy * qy - nwz * qz);
    const ql = 1 / Math.sqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw);
    this.qx = nqx * ql; this.qy = nqy * ql; this.qz = nqz * ql; this.qw = nqw * ql;
    this._updateMatrix();

    // ------------------------------------------------------------ gearbox logic
    this.rpm = this.engineOmega * RPM;
    this.speed = vFwd;
    // Felt acceleration (gravity removed), low-passed for displays and camera.
    const gl = (axw * fx + (ayw + GRAV) * fy + azw * fz) / GRAV, gs = (axw * rx + (ayw + GRAV) * ry + azw * rz) / GRAV;
    this.gLong += (gl - this.gLong) * Math.min(1, dt * 12); this.gLat += (gs - this.gLat) * Math.min(1, dt * 12);

    if (this.shiftRequest !== 0) {
      const target = this.gear + this.shiftRequest;
      this.shiftRequest = 0;
      // Refuse a downshift that would over-rev the engine.
      const tooFast = target >= 1 && target < this.gear && Math.abs(this.ratio(target) * diffOmega) * RPM > eng.limiter + 300;
      const reverseWhileMoving = target === -1 && vFwd > 2;
      if (!tooFast && !reverseWhileMoving) this._startShift(target);
    } else if (c.autoShift && !this.reversing && this.shiftTimer <= 0 && this.shiftCooldown <= 0) {
      const g = this.gear;
      if (g === 0) this._startShift(1);
      else if (g >= 1) {
        const wheelRpm = Math.abs(G * diffOmega) * RPM;
        const up = 3300 + (eng.redline - 60 - 3300) * Math.pow(throttleIn, 1.3);
        const lowerRpm = g > 1 ? (wheelRpm * sp.gears[g - 2]) / sp.gears[g - 1] : Infinity;
        // Part-throttle upshifts are held back while braking, cornering hard
        // or just after a braking downshift, so the gearbox does not hunt.
        const relaxed = this.gearHold <= 0 && brakeIn < 0.1 && Math.abs(this.gLat) < 0.45;
        if (g < sp.gears.length && (wheelRpm > eng.redline - 60 || (relaxed && wheelRpm > up))) this._startShift(g + 1);
        else if (g > 1) {
          const down = 1500 + 1500 * throttleIn;
          if (brakeIn > 0.2 && lowerRpm < 6100) { this._startShift(g - 1); this.gearHold = 2.5; }
          else if (wheelRpm < down || (throttleIn > 0.92 && lowerRpm < 5500)) this._startShift(g - 1);
        }
      }
    }
  }

  /** True when the car has ended up somewhere it cannot drive away from. */
  isStuck() {
    return this.m[4] < 0.3;
  }
}
