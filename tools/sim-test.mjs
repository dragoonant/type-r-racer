// Headless checks of the vehicle model against published FL5 performance
// figures, plus an autopilot lap of the circuit.
// Run: node tools/sim-test.mjs [--lap-only] [--trace]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Track } from '../src/track/track.js';
import { Car, PHYSICS_DT } from '../src/physics/car.js';
import { FL5 } from '../src/config/cars.js';
import { computeRacingLine } from '../src/game/raceline.js';
import { Autopilot } from '../src/game/autopilot.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const DT = PHYSICS_DT;
const KMH = 3.6;

function flatTrack(kind, size) {
  const ds = 2;
  let n, x = [], z = [];
  if (kind === 'straight') {
    n = Math.round(size / ds);
    for (let i = 0; i < n; i++) { x.push(0); z.push(-i * ds); }
  } else {
    n = Math.round((2 * Math.PI * size) / ds);
    // Clockwise seen from above (a right-hand circle).
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; x.push(size * Math.sin(a) - size); z.push(-size * Math.cos(a)); }
  }
  const fill = (v) => new Array(n).fill(v);
  return new Track({
    n, ds, length: n * ds, x, y: fill(0), z, width: fill(kind === 'straight' ? 40 : 16), bank: fill(0),
    vergeL: fill(30), vergeR: fill(30), skirtL: fill(0), skirtR: fill(0), gravelL: fill(0), gravelR: fill(0),
    kerb: fill(0), flag: fill(0), corners: [], sectors: [0], cross: null,
  });
}

const results = [];
function check(name, value, lo, hi, unit, ref) {
  const ok = value >= lo && value <= hi;
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${value.toFixed(2).padStart(8)} ${unit.padEnd(5)} expected ${lo}-${hi}  (${ref})`);
}

function run(car, seconds, each) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) { if (each && each(i * DT) === false) return i * DT; car.step(DT); }
  return seconds;
}

if (!args.has('--lap-only')) {
  // ---------------------------------------------------------------- statics
  {
    const car = new Car(FL5, flatTrack('straight', 4000));
    car.reset(20);
    car.controls.handbrake = 1; car.controls.brake = 1;
    run(car, 3);
    const loads = car.wheels.map((w) => w.load);
    const total = loads.reduce((a, b) => a + b, 0);
    check('static weight', total / 9.81, 1495, 1515, 'kg', 'kerb 1430 + driver');
    check('front weight share', ((loads[0] + loads[1]) / total) * 100, 60.5, 62.5, '%', 'about 61.5');
    check('CG height at rest', car.py, 0.5, 0.54, 'm', 'model 0.52');
    check('residual speed at rest', Math.abs(car.speed) * 1000, 0, 5, 'mm/s', 'should sit still');
    check('idle speed', car.rpm, 780, 920, 'rpm', '850');
  }

  // ---------------------------------------------------------------- acceleration
  {
    const car = new Car(FL5, flatTrack('straight', 14000));
    car.reset(20);
    run(car, 1.5);
    const x0 = car.pz;
    let t100 = 0, t160 = 0, t200 = 0, tq = 0, vq = 0, peakG = 0, top = 0, t = 0;
    car.controls.throttle = 1;
    const trace = [];
    run(car, 150, (time) => {
      t = time;
      const v = car.speed * KMH, d = x0 - car.pz;
      if (!t100 && v >= 100) t100 = time;
      if (!t160 && v >= 160) t160 = time;
      if (!t200 && v >= 200) t200 = time;
      if (!tq && d >= 402.34) { tq = time; vq = v; }
      peakG = Math.max(peakG, car.gLong);
      top = Math.max(top, v);
      if (args.has('--trace') && time < 14 && Math.round(time / DT) % 100 === 0) trace.push(`${time.toFixed(1)}s ${v.toFixed(0)}km/h g${car.gear} ${car.rpm.toFixed(0)}rpm boost${car.boost.toFixed(2)} tc${car.tcFactor.toFixed(2)} k${car.wheels[0].kappa.toFixed(2)} G${car.gLong.toFixed(2)}`);
      // steer straight
      car.controls.steerAngle = -car.px * 0.02 - car.vx * 0.02;
    });
    if (trace.length) console.log(trace.join('\n'));
    check('0-100 km/h', t100, 5.0, 6.1, 's', 'tests: 5.3-5.9');
    check('0-160 km/h', t160, 11.0, 13.6, 's', 'tests: about 12');
    check('quarter mile', tq, 13.3, 14.4, 's', 'tests: 13.6-14.1');
    check('quarter mile trap speed', vq, 163, 176, 'km/h', 'tests: 166-172');
    check('top speed', top, 266, 284, 'km/h', 'claimed 275');
    check('peak launch acceleration', peakG, 0.5, 0.8, 'g', 'front-drive traction limit');
  }

  // ---------------------------------------------------------------- braking
  for (const abs of [true, false]) {
    const car = new Car(FL5, flatTrack('straight', 8000));
    car.reset(20);
    car.controls.throttle = 1; car.controls.abs = abs;
    let phase = 0, x100 = 0, x200 = 0, d100 = 0, d200 = 0, peak = 0, maxYaw = 0;
    run(car, 90, () => {
      const v = car.speed * KMH;
      car.controls.steerAngle = -car.px * 0.02 - car.vx * 0.02;
      if (phase === 0 && v >= 203) { phase = 1; car.controls.throttle = 0; car.controls.brake = 1; }
      if (phase === 1) {
        if (!x200 && v <= 200) x200 = car.pz;
        if (!x100 && v <= 100) x100 = car.pz;
        peak = Math.max(peak, -car.gLong);
        maxYaw = Math.max(maxYaw, Math.abs(car.wy));
        if (v < 0.5) { d100 = x100 - car.pz; d200 = x200 - car.pz; return false; }
      }
    });
    if (abs) {
      check('100-0 km/h braking (ABS)', d100, 30.5, 36, 'm', 'tests: 32-35');
      check('200-0 km/h braking (ABS)', d200, 122, 146, 'm', 'about 4x the 100-0 figure');
      check('peak braking (ABS)', peak, 1.05, 1.35, 'g', '1.1-1.2 from tyres plus drag at 200 km/h');
    } else {
      check('100-0 km/h braking (no ABS)', d100, 33, 60, 'm', 'locked fronts, longer');
      check('yaw rate when locked', maxYaw, 0, 0.35, 'rad/s', 'fronts lock first, stays straight');
    }
  }

  // ---------------------------------------------------------------- skidpad
  {
    const R = 61; // 200 ft skidpad
    const track = flatTrack('circle', R);
    const car = new Car(FL5, track);
    car.reset(0);
    const line = { x: track.x, z: track.z, speed: new Float64Array(track.n).fill(1) };
    const ap = new Autopilot(car, track, line);
    // Speed creeps up; the result is the best lateral acceleration the car
    // held for two full seconds while staying on the circle.
    let best = 0, vBest = 0, lastGood = 0;
    const win = Math.round(2 / DT), hist = new Float32Array(win), dHist = new Float32Array(win);
    let k = 0, sum = 0;
    run(car, 220, (time) => {
      line.speed.fill(10 + time * 0.1);
      ap.update(DT);
      const q = car.bodyQ;
      if (q.d === undefined) return;
      const a = (car.speed * car.speed) / R / 9.81, slot = k % win;
      sum += a - hist[slot]; hist[slot] = a;
      const dOld = dHist[slot]; dHist[slot] = q.d; k++;
      if (k > win && Math.abs(q.d) < 1.0 && Math.abs(q.d - dOld) < 0.25) {
        if (sum / win > best) { best = sum / win; vBest = car.speed; lastGood = time; }
      }
      if (time - lastGood > 15 && time > 60) return false;
    });
    check('skidpad lateral grip', best, 0.98, 1.1, 'g', 'tests: 1.02-1.06');
    console.log(`      (held ${(vBest * KMH).toFixed(1)} km/h on a ${R} m radius)`);
  }
}

// ---------------------------------------------------------------- circuit lap
{
  const data = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'suzuka.json'), 'utf8'));
  const track = new Track(data);
  const line = computeRacingLine(track);
  console.log(`\nracing line: ${line.length.toFixed(0)} m, profile estimate ${fmt(line.estimatedLap)}`);
  for (const pace of [0.94, 0.98, 1.0]) {
    const car = new Car(FL5, track);
    car.reset(track.n - 30, 0); // just before the line
    const ap = new Autopilot(car, track, line, { pace });
    let lapStart = -1, lapTime = 0, prev = car.bodyHint, laps = 0, maxV = 0, minV = 999, offTrack = 0, walls = 0, maxOff = 0;
    const sectorsAt = [];
    const trace = [];
    run(car, 520, (time) => {
      ap.update(DT);
      const i = car.bodyHint;
      if (prev > track.n - 20 && i < 20) {
        if (lapStart >= 0) { lapTime = time - lapStart; laps++; if (laps === 2) return false; sectorsAt.length = 0; }
        lapStart = time; maxV = 0; minV = 999; offTrack = 0; walls = 0; maxOff = 0;
      }
      prev = i;
      if (lapStart >= 0) {
        maxV = Math.max(maxV, car.speed); minV = Math.min(minV, car.speed);
        const q = car.bodyQ, over = Math.abs(q.d) - q.half;
        if (over > 0) offTrack += DT;
        maxOff = Math.max(maxOff, over);
        if (car.wallImpact > 0.5) walls++;
        car.wallImpact = 0;
        for (let s = 1; s < track.sectors.length; s++) if (!sectorsAt[s] && i >= track.sectors[s]) sectorsAt[s] = time - lapStart;
        if (args.has('--trace') && pace === 1 && Math.round(time / DT) % 250 === 0) trace.push(`s=${(i * track.ds).toFixed(0).padStart(4)} v=${(car.speed * KMH).toFixed(0).padStart(3)} tgt=${(line.speed[i] * KMH).toFixed(0).padStart(3)} g${car.gear} d=${q.d.toFixed(1).padStart(5)} line=${line.offset[i].toFixed(1).padStart(5)} gLat=${car.gLat.toFixed(2)} thr=${car.controls.throttle.toFixed(2)} brk=${car.controls.brake.toFixed(2)}`);
      }
    });
    if (trace.length) console.log(trace.join('\n'));
    if (!lapTime) { console.log(`pace ${pace}: did not complete a lap (stuck at s=${(car.bodyHint * track.ds).toFixed(0)} m, speed ${(car.speed * KMH).toFixed(0)} km/h)`); results.push(false); continue; }
    console.log(`pace ${pace}: lap ${fmt(lapTime)}  sectors ${sectorsAt.slice(1).map(fmt).join(' / ')}  top ${(maxV * KMH).toFixed(0)} km/h  slowest ${(minV * KMH).toFixed(0)} km/h  off-track ${offTrack.toFixed(1)} s (max ${Math.max(0, maxOff).toFixed(1)} m)  wall hits ${walls}`);
    if (pace === 1.0) check('autopilot lap', lapTime, 140, 168, 's', 'regression check; record lap by a pro on track tyres is 2:23.1');
  }
}

function fmt(t) { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`; }

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
