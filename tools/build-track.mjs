// Turns the raw geodata in tools/raw/ into the game's track files:
//   src/data/suzuka.json            centreline, widths, elevation, run-off, flags
//   public/data/suzuka-terrain.bin  surrounding terrain heights (Int16 centimetres)
// Run: node tools/build-track.mjs   (after tools/fetch-track.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, 'raw');
const ROOT = join(HERE, '..');
const rad = Math.PI / 180;
const R_EARTH = 6371008.8;

// ---------------------------------------------------------------- centreline
const osm = JSON.parse(readFileSync(join(RAW, 'osm-raceways.json'), 'utf8'));
const START_WAY = 183391665; // main straight
const key = (p) => p.lat.toFixed(7) + ',' + p.lon.toFixed(7);
const ways = osm.elements.filter((e) => e.tags.sport !== 'karting');
const byStart = new Map();
for (const w of ways) {
  const k = key(w.geometry[0]);
  if (!byStart.has(k)) byStart.set(k, []);
  byStart.get(k).push(w);
}
const chain = [];
{
  let cur = ways.find((w) => w.id === START_WAY);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    chain.push(cur);
    seen.add(cur.id);
    cur = (byStart.get(key(cur.geometry.at(-1))) || [])[0];
  }
  if (!cur || cur.id !== START_WAY) throw new Error('circuit ways do not form a closed loop');
}

const LAT0 = 34.8437, LON0 = 136.5330; // local origin
const toXZ = (lat, lon) => [(lon - LON0) * rad * Math.cos(LAT0 * rad) * R_EARTH, -(lat - LAT0) * rad * R_EARTH];
const toLatLon = (x, z) => [LAT0 - z / (rad * R_EARTH), LON0 + x / (rad * Math.cos(LAT0 * rad) * R_EARTH)];

// Raw polyline with a width and tag source per vertex.
const raw = [];
for (const w of chain) {
  const width = parseFloat(w.tags.width) || 12;
  const g = w.geometry;
  for (let i = 0; i < g.length - 1; i++) {
    const [x, z] = toXZ(g[i].lat, g[i].lon);
    raw.push({ x, z, width, way: w.id, corner: w.tags['raceway:corner_number'] || null });
  }
}

// Densify to ~1 m, keeping per-sample width and way id.
const dense = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i], b = raw[(i + 1) % raw.length];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.round(len));
  for (let k = 0; k < n; k++) {
    const t = k / n;
    dense.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, width: a.width, way: a.way, corner: a.corner });
  }
}

function gaussKernel(sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  return { r, k: k.map((v) => v / sum) };
}
function smoothLoop(arr, sigma) {
  if (sigma <= 0) return Array.from(arr);
  const { r, k } = gaussKernel(sigma);
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += arr[(((i + j) % n) + n) % n] * k[j + r];
    out[i] = s;
  }
  return out;
}
function minFilterLoop(arr, r) {
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = -r; j <= r; j++) m = Math.min(m, arr[(((i + j) % n) + n) % n]);
    out[i] = m;
  }
  return out;
}
function maxFilterLoop(arr, r0, r1) {
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = -r0; j <= r1; j++) m = Math.max(m, arr[(((i + j) % n) + n) % n]);
    out[i] = m;
  }
  return out;
}

// Smooth the 1 m polyline to round off the OSM chord corners.
const SIG_XY = 4.5;
const sx = smoothLoop(dense.map((p) => p.x), SIG_XY);
const sz = smoothLoop(dense.map((p) => p.z), SIG_XY);
const sw = smoothLoop(dense.map((p) => p.width), 12);

// Resample to uniform arc length.
const cum = [0];
for (let i = 0; i < sx.length; i++) {
  const j = (i + 1) % sx.length;
  cum.push(cum[i] + Math.hypot(sx[j] - sx[i], sz[j] - sz[i]));
}
const LENGTH_RAW = cum.at(-1);
const N = Math.round(LENGTH_RAW / 2);
const DS = LENGTH_RAW / N;

// Start/finish line: 300 m along the main straight (the chain starts on it).
const SF_OFFSET = 300;
const X = new Float64Array(N), Z = new Float64Array(N), W = new Float64Array(N);
const wayAt = new Array(N), cornerAt = new Array(N);
{
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const s = (SF_OFFSET + i * DS) % LENGTH_RAW;
    if (s < cum[seg]) seg = 0;
    while (cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
    const j = (seg + 1) % sx.length;
    X[i] = sx[seg] + (sx[j] - sx[seg]) * t;
    Z[i] = sz[seg] + (sz[j] - sz[seg]) * t;
    W[i] = sw[seg] + (sw[j] - sw[seg]) * t;
    wayAt[i] = dense[seg].way;
    cornerAt[i] = dense[seg].corner;
  }
}
const wrap = (i) => ((i % N) + N) % N;
const TX = new Float64Array(N), TZ = new Float64Array(N), K = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const a = wrap(i - 1), b = wrap(i + 1);
  const dx = X[b] - X[a], dz = Z[b] - Z[a], l = Math.hypot(dx, dz);
  TX[i] = dx / l; TZ[i] = dz / l;
}
// right normal = (-tz, tx); curvature positive when turning right.
for (let i = 0; i < N; i++) {
  const a = wrap(i - 1), b = wrap(i + 1);
  K[i] = ((TX[b] - TX[a]) * -TZ[i] + (TZ[b] - TZ[a]) * TX[i]) / (2 * DS);
}

// ------------------------------------------------------------------ elevation
const demIndex = JSON.parse(readFileSync(join(RAW, 'dem', 'index.json'), 'utf8'));
const DZ = demIndex.z;
const DW = (demIndex.x1 - demIndex.x0 + 1) * 256, DH = (demIndex.y1 - demIndex.y0 + 1) * 256;
const dem = new Float32Array(DW * DH).fill(NaN);
for (let tx = demIndex.x0; tx <= demIndex.x1; tx++) {
  for (let ty = demIndex.y0; ty <= demIndex.y1; ty++) {
    const rows = readFileSync(join(RAW, 'dem', `${DZ}-${tx}-${ty}.txt`), 'utf8').trim().split('\n');
    for (let r = 0; r < 256; r++) {
      const cells = rows[r].split(',');
      for (let c = 0; c < 256; c++) {
        const v = parseFloat(cells[c]);
        dem[((ty - demIndex.y0) * 256 + r) * DW + (tx - demIndex.x0) * 256 + c] = Number.isFinite(v) ? v : NaN;
      }
    }
  }
}
// Fill no-data cells (water, gaps) by repeated neighbour averaging.
for (let pass = 0; pass < 400; pass++) {
  let holes = 0;
  const next = dem.slice();
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
    const i = y * DW + x;
    if (!Number.isNaN(dem[i])) continue;
    let s = 0, c = 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= DW || yy >= DH) continue;
      const v = dem[yy * DW + xx];
      if (!Number.isNaN(v)) { s += v; c++; }
    }
    if (c) next[i] = s / c; else holes++;
  }
  dem.set(next);
  if (!holes) break;
}
function demAt(x, z) {
  const [lat, lon] = toLatLon(x, z);
  const px = ((lon + 180) / 360) * 2 ** DZ * 256 - demIndex.x0 * 256 - 0.5;
  const r = lat * rad;
  const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** DZ * 256 - demIndex.y0 * 256 - 0.5;
  const x0 = Math.max(0, Math.min(DW - 2, Math.floor(px))), y0 = Math.max(0, Math.min(DH - 2, Math.floor(py)));
  const fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
  const a = dem[y0 * DW + x0], b = dem[y0 * DW + x0 + 1], c = dem[(y0 + 1) * DW + x0], d = dem[(y0 + 1) * DW + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

let H = new Array(N), BANK = new Array(N);
for (let i = 0; i < N; i++) {
  const rx = -TZ[i], rz = TX[i];
  const hl = demAt(X[i] - rx * 3.5, Z[i] - rz * 3.5), hc = demAt(X[i], Z[i]), hr = demAt(X[i] + rx * 3.5, Z[i] + rz * 3.5);
  H[i] = (hl + hc + hr) / 3;
  BANK[i] = (hr - hl) / 7; // dh/dd, d positive to the right
}

// The figure-eight crossover: find where the centreline crosses itself.
let cross = null;
for (let i = 0; i < N && !cross; i++) {
  const i2 = wrap(i + 1);
  for (let j = i + 60; j < N; j++) {
    if (N - j + i < 60) continue;
    const j2 = wrap(j + 1);
    const d1x = X[i2] - X[i], d1z = Z[i2] - Z[i], d2x = X[j2] - X[j], d2z = Z[j2] - Z[j];
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((X[j] - X[i]) * d2z - (Z[j] - Z[i]) * d2x) / den;
    const u = ((X[j] - X[i]) * d1z - (Z[j] - Z[i]) * d1x) / den;
    if (t >= 0 && t < 1 && u >= 0 && u < 1) { cross = { lower: i, upper: j, x: X[i] + d1x * t, z: Z[i] + d1z * t }; break; }
  }
}
if (!cross) throw new Error('crossover not found');

// The DEM cannot describe two levels at once, so bridge both tracks across the
// crossover with a smooth interpolation between the ground either side.
function bridgeSpan(arr, centre, halfLenM) {
  const h = Math.round(halfLenM / DS), m = Math.round(16 / DS);
  const avg = (c) => { let s = 0; for (let k = -m; k <= m; k++) s += arr[wrap(c + k)]; return s / (2 * m + 1); };
  const a = wrap(centre - h - m), b = wrap(centre + h + m);
  const ha = avg(a), hb = avg(b);
  const sa = (avg(a) - avg(wrap(a - 2 * m))) / (2 * m * DS), sb = (avg(wrap(b + 2 * m)) - avg(b)) / (2 * m * DS);
  const steps = 2 * h + 2 * m, span = steps * DS;
  const copy = Array.from(arr);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    copy[wrap(a + k)] = h00 * ha + h10 * span * sa + h01 * hb + h11 * span * sb;
  }
  for (let i = 0; i < N; i++) arr[i] = copy[i];
}
// The lidar DEM shows the service tunnels that pass under the circuit as narrow
// pits (and footbridges as spikes). Detect them against a running median and
// interpolate straight across.
{
  const win = Math.round(70 / DS), grow = Math.round(16 / DS);
  const bad = new Array(N).fill(false);
  for (let i = 0; i < N; i++) {
    const vals = [];
    for (let k = -win; k <= win; k++) vals.push(H[wrap(i + k)]);
    vals.sort((a, b) => a - b);
    const med = vals[vals.length >> 1];
    if (H[i] < med - 0.9 || H[i] > med + 1.6) {
      // Only narrow features are artefacts; real hills change the median too.
      bad[i] = true;
    }
  }
  const marked = bad.slice();
  for (let i = 0; i < N; i++) if (bad[i]) for (let k = -grow; k <= grow; k++) marked[wrap(i + k)] = true;
  let fixed = 0;
  for (let i = 0; i < N; i++) {
    if (!marked[i] || marked[wrap(i - 1)]) continue;
    let len = 0;
    while (marked[wrap(i + len)] && len < N) len++;
    if (len * DS > 140) continue; // too long to be a tunnel or footbridge
    const a = H[wrap(i - 1)], b = H[wrap(i + len)];
    for (let k = 0; k < len; k++) { H[wrap(i + k)] = a + ((b - a) * (k + 1)) / (len + 1); BANK[wrap(i + k)] = 0; }
    fixed++;
    console.log(`elevation artefact removed at s=${(i * DS).toFixed(0)}-${((i + len) * DS).toFixed(0)}`);
  }
  if (!fixed) console.log('no elevation artefacts found');
}
const rawLower = H[cross.lower], rawUpper = H[cross.upper];
bridgeSpan(H, cross.lower, 34);
bridgeSpan(H, cross.upper, 50);
H = smoothLoop(H, 10 / DS);
const MIN_CLEAR = 5.6;
const clearance = H[cross.upper] - H[cross.lower];
if (clearance < MIN_CLEAR) {
  // Split the shortfall: raise the bridge and dip the underpass.
  const need = MIN_CLEAR - clearance, span = Math.round(110 / DS);
  for (let k = -span; k <= span; k++) {
    const wgt = 0.5 * (1 + Math.cos((Math.PI * k) / span));
    H[wrap(cross.upper + k)] += need * 0.6 * wgt;
    H[wrap(cross.lower + k)] -= need * 0.4 * wgt;
  }
}
const finalClear = H[cross.upper] - H[cross.lower];

// Banking: gentle, DEM-derived, flattened near the crossover.
BANK = smoothLoop(BANK, 18 / DS).map((b) => Math.max(-0.045, Math.min(0.045, b)));
for (const c of [cross.lower, cross.upper]) {
  const span = Math.round(70 / DS);
  for (let k = -span; k <= span; k++) BANK[wrap(c + k)] *= 1 - 0.5 * (1 + Math.cos((Math.PI * k) / span));
}
BANK = smoothLoop(BANK, 6 / DS);

// Shift heights so the lowest track point sits at y = 0.
const H_BASE = Math.min(...H);
H = H.map((h) => h - H_BASE);

// ---------------------------------------------------------------- run-off
const CELL = 24;
const grid = new Map();
for (let i = 0; i < N; i++) {
  const k = Math.floor(X[i] / CELL) + ',' + Math.floor(Z[i] / CELL);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
}
function nearby(x, z, radius, fn) {
  const c0 = Math.floor((x - radius) / CELL), c1 = Math.floor((x + radius) / CELL);
  const r0 = Math.floor((z - radius) / CELL), r1 = Math.floor((z + radius) / CELL);
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
    const cell = grid.get(c + ',' + r);
    if (cell) for (const j of cell) fn(j);
  }
}
const loopDist = (i, j) => { const d = Math.abs(i - j); return Math.min(d, N - d) * DS; };

const Ks = smoothLoop(K, 6 / DS);
const absK = Ks.map(Math.abs);
// "Corner zone": the corner itself plus the braking area before it and the exit after it.
const zoneR = maxFilterLoop(Ks.map((k) => Math.max(0, k)), Math.round(50 / DS), Math.round(90 / DS));
const zoneL = maxFilterLoop(Ks.map((k) => Math.max(0, -k)), Math.round(50 / DS), Math.round(90 / DS));

const freeL = new Array(N), freeR = new Array(N);
for (let i = 0; i < N; i++) {
  const hw = W[i] / 2, rx = -TZ[i], rz = TX[i];
  for (const side of [-1, 1]) {
    let free = 60;
    // Inside of a bend: lateral lines converge at the centre of curvature.
    const kSide = Ks[i] * side; // > 0 when this side is the inside
    if (kSide > 1e-4) free = Math.min(free, Math.max(0, (1 / kSide - hw) * 0.7));
    for (let m = 0.5; m < free; m += 0.5) {
      const qx = X[i] + rx * side * (hw + m), qz = Z[i] + rz * side * (hw + m);
      let hit = false;
      nearby(qx, qz, 40, (j) => {
        if (hit || loopDist(i, j) < 90) return;
        if (Math.hypot(qx - X[j], qz - Z[j]) - W[j] / 2 < m) hit = true;
      });
      if (hit) { free = m; break; }
    }
    (side < 0 ? freeL : freeR)[i] = free;
  }
}

function sideArrays(free, outsideZone, insideZone) {
  const desired = new Array(N), gravel = new Array(N);
  for (let i = 0; i < N; i++) {
    // outsideZone: curvature of bends for which this side is the outside.
    const out = Math.min(1, outsideZone[i] / 0.012);
    const ins = Math.min(1, insideZone[i] / 0.012);
    desired[i] = 7 + 21 * out - 2 * ins * (1 - out);
    gravel[i] = outsideZone[i] > 0.0035 ? 1 : 0;
  }
  const limit = free.map((f) => Math.max(0.4, f - 0.6));
  let verge = desired.map((d, i) => Math.min(d, limit[i]));
  verge = smoothLoop(minFilterLoop(verge, Math.round(5 / DS)), 6 / DS).map((v, i) => Math.max(0.4, Math.min(v, limit[i])));
  let skirt = free.map((f, i) => Math.max(0, Math.min(14, f - verge[i] - 0.6)));
  skirt = smoothLoop(minFilterLoop(skirt, Math.round(5 / DS)), 6 / DS).map((v, i) => Math.max(0, Math.min(v, free[i] - verge[i] - 0.6)));
  return { verge, skirt, gravel };
}
// Left side is the outside of right-hand bends (zoneR) and the inside of left-hand bends.
const left = sideArrays(freeL, zoneR, zoneL);
const right = sideArrays(freeR, zoneL, zoneR);

// Kerbs: both edges through any real corner.
const kerbZone = maxFilterLoop(absK, Math.round(14 / DS), Math.round(22 / DS));
const KERB = kerbZone.map((k) => (k > 0.0055 ? 1 : 0));

// Bridge / underpass flags around the crossover.
const FLAG = new Array(N).fill(0); // 1 = bridge deck, 2 = underpass
for (let i = 0; i < N; i++) {
  const d = Math.hypot(X[i] - cross.x, Z[i] - cross.z);
  if (loopDist(i, cross.upper) < 60 && d < 26) FLAG[i] = 1;
  if (loopDist(i, cross.lower) < 60 && d < 15) FLAG[i] = 2;
}

// ---------------------------------------------------------------- landmarks
const corners = [];
{
  let prev = null;
  for (let i = 0; i < N; i++) {
    const c = cornerAt[i];
    if (c && c !== prev && !corners.some((k) => k.number === +c)) corners.push({ number: +c, index: i });
    prev = c;
  }
  // Put each marker at the tightest point of its tagged stretch.
  for (const c of corners) {
    let best = c.index, bk = 0;
    for (let i = c.index; +cornerAt[wrap(i)] === c.number && i < c.index + 400; i++) if (absK[wrap(i)] > bk) { bk = absK[wrap(i)]; best = wrap(i); }
    c.index = best;
  }
  corners.sort((a, b) => a.index - b.index);
}
const firstIndexOfWay = (id) => wayAt.findIndex((w, i) => w === id && wayAt[wrap(i - 1)] !== id);
// Sector 1 ends after the long left-hander before the Degner curves; sector 2 ends at the start of the back straight.
const sectors = [0, firstIndexOfWay(411295349), firstIndexOfWay(411295348)];

// ---------------------------------------------------------------- terrain
const T_CELL = 8, T_MARGIN = 520;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < N; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]); }
const T_X0 = Math.floor((minX - T_MARGIN) / T_CELL) * T_CELL, T_Z0 = Math.floor((minZ - T_MARGIN) / T_CELL) * T_CELL;
const T_NX = Math.ceil((maxX + T_MARGIN - T_X0) / T_CELL) + 1, T_NZ = Math.ceil((maxZ + T_MARGIN - T_Z0) / T_CELL) + 1;
const terrain = new Int16Array(T_NX * T_NZ);
const SUNK = 2.5, BLEND = 34, PAD = 3;
for (let iz = 0; iz < T_NZ; iz++) for (let ix = 0; ix < T_NX; ix++) {
  const x = T_X0 + ix * T_CELL, z = T_Z0 + iz * T_CELL;
  const ground = demAt(x, z) - H_BASE;
  let bestD = Infinity, bestH = 0, lowest = Infinity;
  nearby(x, z, 110, (j) => {
    const dx = x - X[j], dz = z - Z[j];
    const d = Math.hypot(dx, dz);
    const lat = dx * -TZ[j] + dz * TX[j];
    const ext = W[j] / 2 + (lat < 0 ? left.verge[j] + left.skirt[j] : right.verge[j] + right.skirt[j]);
    const D = d - ext;
    if (D < bestD) { bestD = D; bestH = H[j]; }
    if (D < PAD) lowest = Math.min(lowest, H[j]);
  });
  let h = ground;
  if (bestD < PAD) h = lowest - SUNK;
  else if (bestD < PAD + BLEND) {
    const t = (bestD - PAD) / BLEND, s = t * t * (3 - 2 * t);
    h = (bestH - SUNK) * (1 - s) + ground * s;
  }
  terrain[iz * T_NX + ix] = Math.round(Math.max(-320, Math.min(320, h)) * 100);
}
writeFileSync(join(ROOT, 'public', 'data', 'suzuka-terrain.bin'), Buffer.from(terrain.buffer));

// ---------------------------------------------------------------- output
const r3 = (a) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
const r5 = (a) => Array.from(a, (v) => Math.round(v * 1e5) / 1e5);
const out = {
  id: 'suzuka',
  source: 'Centreline (c) OpenStreetMap contributors (ODbL). Elevation: GSI Japan DEM5A tiles.',
  origin: { lat: LAT0, lon: LON0 },
  n: N, ds: DS, length: N * DS,
  x: r3(X), y: r3(H), z: r3(Z),
  width: r3(W), bank: r5(BANK),
  vergeL: r3(left.verge), vergeR: r3(right.verge),
  skirtL: r3(left.skirt), skirtR: r3(right.skirt),
  gravelL: left.gravel, gravelR: right.gravel,
  kerb: KERB, flag: FLAG,
  cross: { lower: cross.lower, upper: cross.upper, x: +cross.x.toFixed(2), z: +cross.z.toFixed(2), clearance: +finalClear.toFixed(2) },
  corners, sectors,
  terrain: { file: 'data/suzuka-terrain.bin', x0: T_X0, z0: T_Z0, nx: T_NX, nz: T_NZ, cell: T_CELL },
};
writeFileSync(join(ROOT, 'src', 'data', 'suzuka.json'), JSON.stringify(out));

// ---------------------------------------------------------------- report
const kmh = (k) => (Math.sqrt(11 / Math.max(k, 1e-4)) * 3.6).toFixed(0);
console.log(`length ${(N * DS).toFixed(1)} m (official 5807), ${N} points, ds ${DS.toFixed(3)}`);
console.log(`elevation range ${(Math.max(...H) - Math.min(...H)).toFixed(1)} m (published ~40 m)`);
console.log(`crossover: lower idx ${cross.lower} (s=${(cross.lower * DS).toFixed(0)}), upper idx ${cross.upper} (s=${(cross.upper * DS).toFixed(0)}), DEM raw lower ${(rawLower - H_BASE).toFixed(1)} upper ${(rawUpper - H_BASE).toFixed(1)}, clearance before fix ${clearance.toFixed(2)}, final ${finalClear.toFixed(2)}`);
console.log('sectors', sectors.map((i) => (i * DS).toFixed(0)).join(', '));
for (const c of corners) console.log(`T${c.number} s=${(c.index * DS).toFixed(0)} R=${(1 / absK[c.index]).toFixed(0)}m ${Ks[c.index] > 0 ? 'right' : 'left'} ~${kmh(absK[c.index])}km/h h=${H[c.index].toFixed(1)} bank=${(BANK[c.index] * 100).toFixed(1)}%`);
console.log('verge L min/max', Math.min(...left.verge).toFixed(1), Math.max(...left.verge).toFixed(1), 'R', Math.min(...right.verge).toFixed(1), Math.max(...right.verge).toFixed(1));
console.log('max grade %', (Math.max(...H.map((h, i) => Math.abs(H[wrap(i + 1)] - h) / DS)) * 100).toFixed(1));
console.log(`terrain ${T_NX}x${T_NZ} cells of ${T_CELL} m`);
console.log('profile:', Array.from({ length: Math.ceil((N * DS) / 250) }, (_, k) => `${k * 250}:${H[Math.min(N - 1, Math.round((k * 250) / DS))].toFixed(1)}`).join('  '));

// Debug SVG (plan view).
{
  const sc = 0.45, ox = -minX + 60, oz = -minZ + 60;
  const P = (x, z) => `${((x + ox) * sc).toFixed(1)},${((z + oz) * sc).toFixed(1)}`;
  const edge = (side, extra) => Array.from({ length: N }, (_, i) => {
    const e = W[i] / 2 + extra(i);
    return P(X[i] + -TZ[i] * side * e, Z[i] + TX[i] * side * e);
  }).join(' ');
  const label = (c) => { const [px, py] = P(X[c.index], Z[c.index]).split(','); return `<text x="${px}" y="${py}" fill="yellow" font-size="12">${c.number}</text>`; };
  const [sx0, sy0] = P(X[0], Z[0]).split(',');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${((maxX - minX + 120) * sc).toFixed(0)}" height="${((maxZ - minZ + 120) * sc).toFixed(0)}" style="background:#2c4a2c">
<polygon points="${edge(-1, (i) => left.verge[i] + left.skirt[i])}" fill="none" stroke="#557755" stroke-width="0.5"/>
<polygon points="${edge(1, (i) => right.verge[i] + right.skirt[i])}" fill="none" stroke="#557755" stroke-width="0.5"/>
<polygon points="${edge(-1, (i) => left.verge[i])}" fill="none" stroke="#ddd" stroke-width="0.6"/>
<polygon points="${edge(1, (i) => right.verge[i])}" fill="none" stroke="#ddd" stroke-width="0.6"/>
<polygon points="${edge(-1, () => 0)}" fill="none" stroke="#222" stroke-width="1"/>
<polygon points="${edge(1, () => 0)}" fill="none" stroke="#222" stroke-width="1"/>
${corners.map(label).join('')}
<circle cx="${sx0}" cy="${sy0}" r="4" fill="red"/>
</svg>`;
  writeFileSync(join(RAW, 'track-debug.svg'), svg);
}
