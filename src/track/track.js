// Analytic track model. The circuit is a closed centreline sampled every ~2 m
// with a width, elevation, banking and run-off description at each sample.
// Physics asks "what is under this point?" through query(); rendering builds
// its meshes from the same arrays, so what you see is what you drive on.
//
// Conventions: x = east, y = up, z = south. Lateral offset d is positive to
// the right of the direction of travel.

export const SURFACE = { ASPHALT: 0, KERB: 1, GRASS: 2, GRAVEL: 3 };

export const KERB_WIDTH = 1.3;
const GRASS_STRIP = 2.2; // grass between the track edge and a gravel trap

export class Track {
  constructor(data) {
    this.data = data;
    const n = (this.n = data.n);
    this.ds = data.ds;
    this.length = data.length;
    const f = (a) => Float64Array.from(a);
    this.x = f(data.x); this.y = f(data.y); this.z = f(data.z);
    this.width = f(data.width); this.bank = f(data.bank);
    this.vergeL = f(data.vergeL); this.vergeR = f(data.vergeR);
    this.skirtL = f(data.skirtL); this.skirtR = f(data.skirtR);
    this.gravelL = Uint8Array.from(data.gravelL); this.gravelR = Uint8Array.from(data.gravelR);
    this.kerb = Uint8Array.from(data.kerb); this.flag = Uint8Array.from(data.flag);
    this.corners = data.corners; this.sectors = data.sectors; this.cross = data.cross;

    // Horizontal unit tangent, grade (dy/ds) and curvature (+ = right-hander).
    this.tx = new Float64Array(n); this.tz = new Float64Array(n);
    this.grade = new Float64Array(n); this.curv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a], l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      this.grade[i] = (this.y[b] - this.y[a]) / l;
    }
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      this.curv[i] = ((this.tx[b] - this.tx[a]) * -this.tz[i] + (this.tz[b] - this.tz[a]) * this.tx[i]) / (2 * this.ds);
    }

    // Coarse grid for global lookups.
    this.cell = 32;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(this.x[i] / this.cell) + ',' + Math.floor(this.z[i] / this.cell);
      let c = this.grid.get(k);
      if (!c) this.grid.set(k, (c = []));
      c.push(i);
    }
  }

  wrap(i) { const n = this.n; return ((i % n) + n) % n; }

  /** Linear interpolation of a per-sample array at fractional index s. */
  lerp(arr, s) {
    const n = this.n, i0 = Math.floor(s), t = s - i0;
    const a = ((i0 % n) + n) % n, b = (a + 1) % n;
    return arr[a] + (arr[b] - arr[a]) * t;
  }

  /** World position and frame at fractional index s, lateral offset d. */
  pointAt(s, d = 0, out = {}) {
    const n = this.n, i0 = Math.floor(s), t = s - i0;
    const a = ((i0 % n) + n) % n, b = (a + 1) % n;
    let tx = this.tx[a] + (this.tx[b] - this.tx[a]) * t, tz = this.tz[a] + (this.tz[b] - this.tz[a]) * t;
    const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    const bank = this.bank[a] + (this.bank[b] - this.bank[a]) * t;
    out.tx = tx; out.tz = tz; out.rx = -tz; out.rz = tx;
    out.x = this.x[a] + (this.x[b] - this.x[a]) * t + -tz * d;
    out.z = this.z[a] + (this.z[b] - this.z[a]) * t + tx * d;
    out.y = this.y[a] + (this.y[b] - this.y[a]) * t + bank * d;
    out.grade = this.grade[a] + (this.grade[b] - this.grade[a]) * t;
    out.bank = bank;
    out.half = (this.width[a] + (this.width[b] - this.width[a]) * t) / 2;
    return out;
  }

  /**
   * Nearest sample to a world point, used once to seed a hint. Height is
   * considered so the two levels of the crossover are told apart.
   */
  locate(x, y, z) {
    let best = -1, bd = Infinity;
    const c0 = Math.floor(x / this.cell), r0 = Math.floor(z / this.cell);
    for (let ring = 1; ring <= 40 && best < 0; ring += 2) {
      for (let c = c0 - ring; c <= c0 + ring; c++) for (let r = r0 - ring; r <= r0 + ring; r++) {
        const cellPts = this.grid.get(c + ',' + r);
        if (!cellPts) continue;
        for (const i of cellPts) {
          const dx = x - this.x[i], dz = z - this.z[i], dy = (y - this.y[i]) * 3;
          const d = dx * dx + dz * dz + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best < 0 ? 0 : best;
  }

  /**
   * What is under world point (x, z)? `hint` is the segment index from the
   * previous query for the same object; the search stays local to it, which
   * is fast and keeps the bridge and the underpass separate.
   * Fills and returns `out`.
   */
  query(x, z, hint, out) {
    const n = this.n, X = this.x, Z = this.z;
    let bi = hint, bt = 0, bd = Infinity;
    const span = 7;
    for (let k = -span; k <= span; k++) {
      const a = (((hint + k) % n) + n) % n, b = (a + 1) % n;
      const ex = X[b] - X[a], ez = Z[b] - Z[a];
      let t = ((x - X[a]) * ex + (z - Z[a]) * ez) / (ex * ex + ez * ez);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = X[a] + ex * t - x, pz = Z[a] + ez * t - z;
      const d = px * px + pz * pz;
      if (d < bd) { bd = d; bi = a; bt = t; }
    }
    const a = bi, b = (a + 1) % n, t = bt;
    let tx = this.tx[a] + (this.tx[b] - this.tx[a]) * t, tz = this.tz[a] + (this.tz[b] - this.tz[a]) * t;
    const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;
    const cx = X[a] + (X[b] - X[a]) * t, cz = Z[a] + (Z[b] - Z[a]) * t;
    const d = (x - cx) * rx + (z - cz) * rz;
    const along = (x - cx) * tx + (z - cz) * tz; // non-zero only past a clamped segment end
    const bank = this.bank[a] + (this.bank[b] - this.bank[a]) * t;
    const grade = this.grade[a] + (this.grade[b] - this.grade[a]) * t;
    const half = (this.width[a] + (this.width[b] - this.width[a]) * t) / 2;
    const vergeL = this.vergeL[a] + (this.vergeL[b] - this.vergeL[a]) * t;
    const vergeR = this.vergeR[a] + (this.vergeR[b] - this.vergeR[a]) * t;

    let y = this.y[a] + (this.y[b] - this.y[a]) * t + bank * d + grade * along;
    const off = Math.abs(d) - half;
    let surface = SURFACE.ASPHALT;
    if (off > 0) {
      const kerb = this.kerb[a] && off <= KERB_WIDTH;
      if (kerb) {
        surface = SURFACE.KERB;
        // Saw-tooth kerb profile: a gentle ramp across, ripples along.
        const sAlong = (a + t) * this.ds;
        const ripple = (sAlong % 0.9) / 0.9;
        y += 0.02 * Math.min(1, off / 0.25) * (1 - off / (KERB_WIDTH * 1.6)) + 0.012 * (ripple < 0.5 ? ripple * 2 : 2 - ripple * 2);
      } else {
        const gravel = d < 0 ? this.gravelL[a] : this.gravelR[a];
        surface = gravel && off > GRASS_STRIP ? SURFACE.GRAVEL : SURFACE.GRASS;
        if (surface === SURFACE.GRAVEL) y -= 0.03;
      }
    }

    // Surface normal from grade and banking.
    const nxh = -(grade * tx + bank * rx), nzh = -(grade * tz + bank * rz);
    const nl = 1 / Math.sqrt(nxh * nxh + 1 + nzh * nzh);

    out.i = a; out.t = t; out.s = a + t; out.d = d;
    out.y = y; out.nx = nxh * nl; out.ny = nl; out.nz = nzh * nl;
    out.tx = tx; out.tz = tz; out.rx = rx; out.rz = rz;
    out.half = half; out.vergeL = vergeL; out.vergeR = vergeR;
    out.wallL = d + half + vergeL; // distance inside the left wall (negative = through it)
    out.wallR = half + vergeR - d;
    out.surface = surface; out.grade = grade; out.bank = bank;
    return out;
  }

  /** Distance in metres travelled forward from index a to index b around the loop. */
  distanceAhead(a, b) {
    let d = b - a;
    if (d < 0) d += this.n;
    return d * this.ds;
  }
}
