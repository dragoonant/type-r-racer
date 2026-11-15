// Combined-slip tyre model.
//
// Longitudinal slip ratio and lateral slip angle are each normalised by the
// slip at which the tyre peaks, combined into one slip magnitude, and passed
// through a Magic Formula curve. The resulting force is shared between the
// two directions in proportion to the slips, which gives a friction ellipse:
// braking or accelerating hard reduces the cornering force available.

import { SURFACE } from '../track/track.js';

// Grip multiplier and extra rolling drag per surface.
export const SURFACE_GRIP = [1.0, 0.93, 0.5, 0.42];
export const SURFACE_DRAG = [0.0, 0.004, 0.07, 0.24];

const V_LONG_MIN = 1.6; // m/s floor for the slip-ratio denominator
const V_LAT_MIN = 1.0; // m/s floor for the slip-angle denominator

export function makeTire(p) {
  const C = p.shapeC;
  const B = Math.tan(Math.PI / (2 * C)); // puts the peak at normalised slip 1
  const { muX, muY, loadSens, nominalLoad, kappaPeak, tanAlphaPeak } = p;

  /**
   * @param out receives fx (along wheel heading), fy (to the wheel's right),
   *            kappa, alpha, slip (normalised combined slip, 1 = peak).
   */
  return function tire(fz, vLong, vLat, omega, radius, surface, out) {
    if (fz <= 0) { out.fx = 0; out.fy = 0; out.kappa = 0; out.alpha = 0; out.slip = 0; return out; }
    const av = Math.abs(vLong);
    const kappa = (omega * radius - vLong) / (av > V_LONG_MIN ? av : V_LONG_MIN);
    const tanA = vLat / (av > V_LAT_MIN ? av : V_LAT_MIN);
    const dfz = fz / nominalLoad - 1;
    let ls = 1 - loadSens * dfz;
    if (ls < 0.6) ls = 0.6; else if (ls > 1.12) ls = 1.12;
    const grip = SURFACE_GRIP[surface] * ls;
    // Loose surfaces peak at much larger slip.
    const loose = surface >= SURFACE.GRASS ? 1.9 : 1;
    const sx = kappa / (kappaPeak * loose), sy = tanA / (tanAlphaPeak * loose * (1 + 0.12 * dfz));
    const sigma = Math.sqrt(sx * sx + sy * sy);
    if (sigma < 1e-9) { out.fx = 0; out.fy = 0; out.kappa = kappa; out.alpha = 0; out.slip = 0; return out; }
    const m = Math.sin(C * Math.atan(B * sigma));
    const f = (fz * grip * m) / sigma;
    out.fx = f * muX * sx;
    out.fy = -f * muY * sy;
    out.kappa = kappa; out.alpha = Math.atan(tanA); out.slip = sigma;
    return out;
  };
}
