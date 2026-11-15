// Racing line and speed profile.
//
// The line is the path of least curvature that fits inside the track limits,
// found by relaxing each point toward the position that minimises the bending
// between its neighbours. The speed profile then finds, for every point, the
// highest speed that keeps the car inside its grip limit while still being
// able to brake for what comes next.
//
// Used by the autopilot (testing, and later AI opponents) and available for a
// driving-line assist.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function computeRacingLine(track, opts = {}) {
  const n = track.n;
  const margin = opts.margin ?? 1.25; // metres kept between the car's centre and the track edge
  const latG = opts.latG ?? 1.03, brakeG = opts.brakeG ?? 0.98;
  const power = opts.power ?? 225000, mass = opts.mass ?? 1505, dragArea = opts.dragArea ?? 0.76;
  const vTop = opts.vTop ?? 77;

  const cx = track.x, cz = track.z;
  const rx = new Float64Array(n), rz = new Float64Array(n), lim = new Float64Array(n);
  for (let i = 0; i < n; i++) { rx[i] = -track.tz[i]; rz[i] = track.tx[i]; lim[i] = Math.max(0, track.width[i] / 2 - margin); }
  const off = new Float64Array(n);
  const wrap = (i) => ((i % n) + n) % n;

  // Coarse-to-fine relaxation.
  const X = (i) => cx[i] + rx[i] * off[i], Z = (i) => cz[i] + rz[i] * off[i];
  let prevStride = 0;
  for (const [stride, iters] of [[16, 700], [8, 500], [4, 350], [2, 200], [1, 120]]) {
    if (prevStride) {
      // Fill the points between the previous level's nodes by interpolation.
      for (let i = 0; i < n; i += prevStride) {
        const j = wrap(i + prevStride);
        const span = i + prevStride > n ? n - i : prevStride;
        for (let k = 1; k < span; k++) off[i + k] = clamp(off[i] + ((off[j] - off[i]) * k) / span, -lim[i + k], lim[i + k]);
      }
    }
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i += stride) {
        const a2 = wrap(i - 2 * stride), a1 = wrap(i - stride), b1 = wrap(i + stride), b2 = wrap(i + 2 * stride);
        const tx = (-X(a2) + 4 * X(a1) + 4 * X(b1) - X(b2)) / 6, tz = (-Z(a2) + 4 * Z(a1) + 4 * Z(b1) - Z(b2)) / 6;
        const o = (tx - cx[i]) * rx[i] + (tz - cz[i]) * rz[i];
        off[i] = clamp(off[i] + (o - off[i]) * 0.9, -lim[i], lim[i]);
      }
    }
    prevStride = stride;
  }

  // Geometry of the finished line.
  const lx = new Float64Array(n), lz = new Float64Array(n), ds = new Float64Array(n), curv = new Float64Array(n);
  for (let i = 0; i < n; i++) { lx[i] = X(i); lz[i] = Z(i); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; ds[i] = Math.hypot(lx[j] - lx[i], lz[j] - lz[i]); }
  for (let i = 0; i < n; i++) {
    const a = wrap(i - 2), b = wrap(i + 2);
    const ax = lx[i] - lx[a], az = lz[i] - lz[a], bx = lx[b] - lx[i], bz = lz[b] - lz[i];
    const cr = ax * bz - az * bx; // + = turning right (x east, z south)
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(lx[b] - lx[a], lz[b] - lz[a]);
    curv[i] = (2 * cr) / (la * lb * lc);
  }
  // Light smoothing of curvature.
  const cs = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += curv[wrap(i + k)]; cs[i] = s / 7; }

  // Speed profile.
  const g = 9.81, ay = latG * g, ab = brakeG * g;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Banking and crests/dips change the available grip a little.
    const bankHelp = -track.bank[i] * Math.sign(cs[i]) * g; // banked into the corner adds lateral capacity
    const a = Math.max(4, ay + bankHelp);
    v[i] = Math.min(vTop, Math.sqrt(a / Math.max(Math.abs(cs[i]), 1e-5)));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n * 2; k >= 0; k--) {
      const i = k % n, j = (i + 1) % n;
      // The braking available depends on how much grip cornering is using at
      // the speed being solved for, so iterate to a consistent answer.
      let vi = v[i];
      for (let it = 0; it < 6; it++) {
        const latUse = clamp((vi * vi * Math.abs(cs[i])) / ay, 0, 1);
        const a = ab * Math.sqrt(1 - latUse * latUse) + 0.25 + g * track.grade[i];
        const vmax = Math.sqrt(v[j] * v[j] + 2 * Math.max(a, 0.2) * ds[i]);
        vi = 0.5 * vi + 0.5 * Math.min(v[i], vmax);
      }
      if (v[i] > vi) v[i] = vi;
    }
    for (let k = 0; k < n * 2; k++) {
      const i = k % n, j = (i + 1) % n;
      const latUse = clamp((v[i] * v[i] * Math.abs(cs[i])) / ay, 0, 1);
      const traction = 5.6 * Math.sqrt(1 - latUse * latUse);
      const a = Math.min(traction, power / (mass * Math.max(v[i], 5))) - (0.5 * 1.2 * dragArea * v[i] * v[i]) / mass - 0.15 - g * track.grade[i];
      const vmax = Math.sqrt(Math.max(v[i] * v[i] + 2 * a * ds[i], 1));
      if (v[j] > vmax) v[j] = vmax;
    }
  }

  let length = 0, time = 0;
  for (let i = 0; i < n; i++) { length += ds[i]; time += ds[i] / Math.max(v[i], 1); }
  return { n, offset: off, x: lx, z: lz, curv: cs, speed: v, length, estimatedLap: time };
}
