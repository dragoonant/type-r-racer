// Vehicle specifications. All physics is driven from these numbers, so a new
// car is a new entry here. Sources: manufacturer published figures where they
// exist (mass, dimensions, ratios, power, torque); the rest are engineering
// estimates tuned so the simulated car matches published performance tests.
//
// Body frame: +x right, +y up, -z forward, origin at the centre of gravity.

const G = 9.81;

function suspension({ cornerMass, freqHz, dampingRatio }) {
  const k = cornerMass * (2 * Math.PI * freqHz) ** 2;
  return { spring: k, damper: 2 * dampingRatio * Math.sqrt(k * cornerMass) };
}

function buildCar(spec) {
  const m = spec.mass;
  const frontMass = (m * spec.frontWeight) / 2, rearMass = (m * (1 - spec.frontWeight)) / 2;
  const a = spec.wheelbase * (1 - spec.frontWeight); // CG to front axle
  const b = spec.wheelbase - a;
  const fs = suspension({ cornerMass: frontMass, freqHz: spec.rideFreqFront, dampingRatio: spec.dampingRatio });
  const rs = suspension({ cornerMass: rearMass, freqHz: spec.rideFreqRear, dampingRatio: spec.dampingRatio });
  return { ...spec, a, b, front: fs, rear: rs, staticFront: frontMass * G, staticRear: rearMass * G };
}

export const FL5 = buildCar({
  id: 'fl5',
  // --- chassis
  mass: 1430 + 75, // kerb weight + driver, kg
  frontWeight: 0.615,
  wheelbase: 2.735,
  trackFront: 1.625,
  trackRear: 1.615,
  cgHeight: 0.52,
  inertia: { pitch: 2350, yaw: 2550, roll: 560 }, // kg m^2 about x, y, z
  bodyLength: 4.595, bodyWidth: 1.89, bodyHeight: 1.405,
  frontOverhang: 0.975, // front axle to nose

  // --- suspension (dual-axis strut front, multi-link rear)
  rideFreqFront: 2.05, rideFreqRear: 2.35, // Hz
  dampingRatio: 0.52,
  antiRollFront: 26000, antiRollRear: 34000, // N per metre of left/right travel difference
  travelBump: 0.075, travelDroop: 0.085, // m from static ride height
  bumpStopRate: 280000,
  rollCentreFront: 0.05, rollCentreRear: 0.11, // m above ground; lateral force application height

  // --- wheels and tyres (265/30 R19)
  wheelRadius: 0.321,
  wheelInertiaFront: 1.55, wheelInertiaRear: 1.45,
  tire: {
    muX: 1.18, muY: 1.1, // peak friction on dry asphalt at nominal load
    loadSens: 0.11, // friction lost per 100% load above nominal
    nominalLoad: 4200,
    kappaPeak: 0.105, // slip ratio at peak grip
    tanAlphaPeak: Math.tan((7.6 * Math.PI) / 180), // slip angle at peak grip
    shapeC: 1.4, // lower = flatter after the peak (more forgiving)
    rolling: 0.013,
  },

  // --- steering
  maxSteer: 0.6, // rad at the road wheel, full lock

  // --- brakes (Nm per wheel at full pedal)
  brakeFront: 2900, brakeRear: 560,

  // --- aerodynamics
  dragArea: 0.75, // Cd * A, m^2
  liftAreaFront: -0.05, liftAreaRear: -0.16, // negative = downforce

  // --- engine: 2.0 L turbocharged four
  engine: {
    inertia: 0.16,
    idle: 850, redline: 7000, limiter: 7050,
    // [rpm, Nm] at full boost, wide open throttle. 420 Nm from 2600-4000, ~326 PS at 6500.
    torqueFull: [[800, 150], [1000, 175], [1500, 255], [2000, 345], [2400, 405], [2600, 420], [4000, 420], [4500, 416], [5000, 406], [5500, 391], [6000, 373], [6500, 353], [7000, 318], [7400, 250]],
    // [rpm, Nm] with no boost: what you get the instant you open the throttle.
    torqueOffBoost: [[800, 120], [1500, 150], [2500, 172], [4000, 182], [5500, 172], [6500, 160], [7400, 140]],
    brakeTorqueBase: 20, brakeTorquePerRpm: 0.016, // closed-throttle engine braking
    boostBarMax: 1.6,
    spoolFast: 0.11, spoolSlow: 0.6, spoolRefRpm: 1500, spoolFalloff: 1300, // turbo lag time constant vs rpm
    spoolDown: 0.75, // s; the turbo keeps most of its speed through a gearchange
  },

  // --- driveline: 6-speed manual, front-wheel drive, helical limited-slip differential
  gears: [3.625, 2.115, 1.529, 1.125, 0.911, 0.734],
  reverse: 3.757,
  finalDrive: 3.842,
  efficiency: 0.905,
  clutchTorque: 720, // Nm capacity fully engaged
  shiftTime: 0.26, // s, clutch-in to clutch-out
  lsd: { biasRatio: 2.3, preload: 45, viscous: 140 }, // torque bias ratio, Nm, Nm per rad/s
});

export const CARS = { fl5: FL5 };
