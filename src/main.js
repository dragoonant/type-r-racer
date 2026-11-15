// Entry point: builds the scene, runs the loop and ties the systems together.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import trackData from './data/suzuka.json';
import { Track, SURFACE } from './track/track.js';
import { Car } from './physics/car.js';
import { FL5 } from './config/cars.js';
import { BRAND } from './config/branding.js';
import { computeRacingLine } from './game/raceline.js';
import { Autopilot } from './game/autopilot.js';
import { Input } from './game/input.js';
import { LapTimer, formatTime } from './game/timing.js';
import { Hud } from './game/hud.js';
import { GameAudio } from './game/audio.js';
import { buildTrack } from './render/trackMesh.js';
import { buildCarModel } from './render/carModel.js';
import { Cluster } from './render/gauges.js';
import { CameraRig, CAMERA_LABELS } from './render/cameras.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'trr.settings.v1';
const settings = {
  gearbox: 'auto', abs: true, tc: true, line: true, ghost: true,
  units: /^en-(US|GB)/.test(navigator.language || '') ? 'mph' : 'kmh',
  quality: 'high', camera: 'cockpit',
};
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* defaults */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

const carBrand = BRAND.cars.fl5, trackBrand = BRAND.tracks.suzuka;
document.title = BRAND.gameTitle;
$('load-title').textContent = BRAND.gameTitle;
$('m-title').textContent = BRAND.gameTitle;
$('m-kicker').textContent = BRAND.tagline;
$('m-sub').textContent = `${trackBrand.name}, ${trackBrand.layout} · ${carBrand.year} ${carBrand.maker} ${carBrand.model} (${carBrand.code})`;
$('m-credits').textContent = 'Circuit layout © OpenStreetMap contributors (ODbL). Elevation: Geospatial Information Authority of Japan. Engine loops by CryHam (CC BY 4.0). Tyre squeal by audible-edge (CC BY 3.0). An unofficial fan project, not affiliated with or endorsed by any car maker or circuit.';

boot().catch((err) => {
  console.error(err);
  $('load-text').textContent = 'Could not start: ' + err.message;
});

async function boot() {
  // ---------------------------------------------------------------- renderer
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);

  // ---------------------------------------------------------------- sky and light
  const sunDir = new THREE.Vector3(-0.52, 0.6, 0.61).normalize();
  const sky = new Sky();
  sky.scale.setScalar(9000);
  Object.assign(sky.material.uniforms.turbidity, { value: 3.2 });
  Object.assign(sky.material.uniforms.rayleigh, { value: 2.0 });
  Object.assign(sky.material.uniforms.mieCoefficient, { value: 0.004 });
  Object.assign(sky.material.uniforms.mieDirectionalG, { value: 0.82 });
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  scene.add(sky);
  {
    // Reflections: prefilter the sky once.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = sky.clone(); envScene.add(envSky);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }
  scene.fog = new THREE.FogExp2(0xb4c8dc, 0.00032);
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x55603f, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 3.1);
  sun.castShadow = true;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
  const SH = 42;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  function applyQuality() {
    const q = settings.quality;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.25 : 1));
    renderer.shadowMap.enabled = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    resize();
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------- world
  $('load-text').textContent = 'Building the circuit…';
  const track = new Track(trackData);
  const terrainBuf = await fetch(trackData.terrain.file).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  const line = computeRacingLine(track);
  const world = buildTrack(track, terrainBuf, line);
  scene.add(world.group);

  const spec = FL5;
  const car = new Car(spec, track);
  const model = buildCarModel(spec);
  scene.add(model.group);
  const ghostModel = buildCarModel(spec, { ghost: true });
  ghostModel.group.visible = false;
  scene.add(ghostModel.group);
  const cluster = new Cluster(spec);
  model.cabin.cluster.material.map = cluster.texture;
  model.cabin.cluster.material.needsUpdate = true;

  // Driving line: a ribbon on the racing line, coloured by how hard to brake.
  const ribbon = (() => {
    const n = track.n, pos = new Float32Array(n * 6), col = new Float32Array(n * 6), idx = new Uint32Array(n * 12);
    const q = {};
    for (let i = 0; i < n; i++) {
      const rx = -track.tz[i], rz = track.tx[i];
      for (const [k, w] of [[0, -0.28], [1, 0.28]]) {
        const d = line.offset[i] + w;
        pos[i * 6 + k * 3] = track.x[i] + rx * d; pos[i * 6 + k * 3 + 1] = track.y[i] + track.bank[i] * d + 0.035; pos[i * 6 + k * 3 + 2] = track.z[i] + rz * d;
      }
    }
    for (let k = 0; k < n * 2; k++) {
      const i = k % n, j = (k + 1) % n, o = k * 6;
      idx[o] = i * 2; idx[o + 1] = i * 2 + 1; idx[o + 2] = j * 2; idx[o + 3] = i * 2 + 1; idx[o + 4] = j * 2 + 1; idx[o + 5] = j * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }));
    m.frustumCulled = false; m.renderOrder = 3;
    scene.add(m);
    const WINDOW = 150;
    return {
      mesh: m,
      update(i0, v) {
        const start = (i0 + 5) % n;
        for (let k = 0; k <= WINDOW; k++) {
          const i = (start + k) % n, dist = (5 + k) * track.ds, vt = line.speed[i];
          const need = v > vt ? (v * v - vt * vt) / (2 * dist) : 0;
          let r, gg, b;
          if (need > 6.5) { r = 1; gg = 0.12; b = 0.1; } else if (need > 2.5) { const t = (need - 2.5) / 4; r = 1; gg = 0.85 - 0.7 * t; b = 0.1; } else { r = 0.15; gg = 0.62; b = 1; }
          const fade = Math.min(1, k / 6, (WINDOW - k) / 30);
          for (let c = 0; c < 2; c++) { const o = i * 6 + c * 3; col[o] = r * fade; col[o + 1] = gg * fade; col[o + 2] = b * fade; }
        }
        g.attributes.color.needsUpdate = true;
        g.setDrawRange(start * 6, WINDOW * 6);
      },
    };
  })();

  const hud = new Hud(track, spec);
  const input = new Input();
  const audio = new GameAudio();
  const timer = new LapTimer(track, `trr.best.${trackData.id}.${spec.id}.v1`);
  if (params.has('autopilot')) { timer.persist = false; timer.best = null; } // test runs never touch the saved record
  const rig = new CameraRig(camera, model);
  const autopilot = new Autopilot(car, track, line, { pace: 0.9 });
  const START_S = track.n - 13; // on the grid, 26 m before the line

  // ---------------------------------------------------------------- state
  let state = 'menu'; // menu | drive | pause
  let demo = true; // the autopilot drives behind the menu
  let lastCorner = -1, clock = 0, steerVis = 0;
  const hs = { ghost: null };
  const ghostPose = {};

  function placeCar(s, d = 0) {
    car.reset(s, d);
    timer.prevS = null;
    rig.snap = true;
  }
  function startSession() {
    demo = false;
    placeCar(START_S, 0);
    timer.reset();
    hud.clearSectors();
    lastCorner = -1;
    rig.set(settings.camera);
    state = 'drive';
    $('menu').hidden = true; $('pause').hidden = true;
    hud.show(!params.has('nohud'));
    audio.init().then(() => audio.setPaused(false));
    hud.toast(trackBrand.name, 'Cross the line to start your first timed lap', 3.5);
  }
  function showMenu() {
    state = 'menu';
    syncMenu();
    $('menu').hidden = false; $('pause').hidden = true;
    hud.show(false);
    audio.setPaused(true);
  }
  function setPaused(p) {
    if (state !== 'drive' && state !== 'pause') return;
    state = p ? 'pause' : 'drive';
    $('pause').hidden = !p;
    audio.setPaused(p);
  }
  function syncMenu() {
    $('o-gearbox').value = settings.gearbox; $('o-abs').checked = settings.abs; $('o-tc').checked = settings.tc;
    $('o-line').checked = settings.line; $('o-ghost').checked = settings.ghost; $('o-units').value = settings.units; $('o-quality').value = settings.quality;
    $('m-best').textContent = timer.best ? formatTime(timer.best.time) : 'none yet';
    $('m-clear').hidden = !timer.best;
    $('m-start').textContent = demo ? 'Start driving' : 'Back to the car';
  }
  for (const [id, key, kind] of [['o-gearbox', 'gearbox', 'value'], ['o-abs', 'abs', 'checked'], ['o-tc', 'tc', 'checked'], ['o-line', 'line', 'checked'], ['o-ghost', 'ghost', 'checked'], ['o-units', 'units', 'value'], ['o-quality', 'quality', 'value']]) {
    $(id).addEventListener('change', (e) => { settings[key] = e.target[kind]; saveSettings(); if (key === 'quality') applyQuality(); });
  }
  $('m-start').addEventListener('click', () => { if (demo) startSession(); else { $('menu').hidden = true; hud.show(!params.has('nohud')); setPaused(false); state = 'drive'; audio.setPaused(false); } });
  $('m-clear').addEventListener('click', () => { timer.clearBest(); syncMenu(); });
  $('p-resume').addEventListener('click', () => setPaused(false));
  $('p-restart').addEventListener('click', () => startSession());
  $('p-menu').addEventListener('click', () => showMenu());
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'drive') setPaused(true); });

  input.on((action) => {
    if (state === 'menu') { if (action === 'confirm') $('m-start').click(); return; }
    if (action === 'pause') { setPaused(state === 'drive'); return; }
    if (state !== 'drive') { if (action === 'confirm') setPaused(false); return; }
    switch (action) {
      case 'shiftUp': if (settings.gearbox === 'manual') car.shiftUp(); break;
      case 'shiftDown': if (settings.gearbox === 'manual') car.shiftDown(); break;
      case 'camera': settings.camera = rig.next(); saveSettings(); break;
      case 'reset': {
        // Back onto the track where the car is, stationary. The lap no longer counts.
        const s = car.bodyQ.s ?? START_S;
        placeCar(s, 0);
        timer.prevS = s;
        if (timer.running) timer.valid = false;
        hud.toast('Back on track', timer.running ? 'This lap will not count' : '');
        break;
      }
      case 'transmission': settings.gearbox = settings.gearbox === 'auto' ? 'manual' : 'auto'; saveSettings(); hud.toast(settings.gearbox === 'auto' ? 'Automatic gearbox' : 'Manual gearbox', settings.gearbox === 'manual' ? 'E / Q or B / X to shift' : ''); break;
      case 'abs': settings.abs = !settings.abs; saveSettings(); hud.toast('Anti-lock brakes ' + (settings.abs ? 'on' : 'off')); break;
      case 'tc': settings.tc = !settings.tc; saveSettings(); hud.toast('Traction control ' + (settings.tc ? 'on' : 'off')); break;
      case 'units': settings.units = settings.units === 'kmh' ? 'mph' : 'kmh'; saveSettings(); break;
      case 'ghost': settings.ghost = !settings.ghost; saveSettings(); hud.toast('Ghost ' + (settings.ghost ? 'on' : 'off')); break;
      case 'line': settings.line = !settings.line; saveSettings(); hud.toast('Driving line ' + (settings.line ? 'on' : 'off')); break;
      default:
    }
  });

  // ---------------------------------------------------------------- loop
  applyQuality();
  placeCar(params.has('s') ? +params.get('s') / track.ds : 300, 0);
  if (params.has('cam')) rig.set(params.get('cam')); else rig.set('chase');
  $('loading').hidden = true;
  showMenu();
  if (params.has('drive')) startSession();

  let last = performance.now(), frames = 0, fpsTime = 0, fps = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frames++; fpsTime += dt;
    if (fpsTime >= 1) { fps = frames / fpsTime; frames = 0; fpsTime = 0; }
    if (state !== 'pause') step(dt);
    renderer.render(scene, camera);
  }

  function step(dt) {
    clock += dt;
    const driving = state === 'drive';
    input.update(dt, car.speed);
    const c = car.controls;
    if (driving && !params.has('autopilot')) {
      c.steerAngle = null; c.steer = input.steer; c.throttle = input.throttle; c.brake = input.brake; c.handbrake = input.handbrake;
      c.autoShift = settings.gearbox === 'auto'; c.abs = settings.abs; c.tc = settings.tc;
    } else {
      c.autoShift = true; c.abs = true; c.tc = true; c.handbrake = 0;
      autopilot.pace = driving ? 1 : 0.9;
      autopilot.update(dt);
    }
    car.update(dt);
    if (car.isStuck() && Math.abs(car.speed) < 1) placeCar(car.bodyQ.s ?? START_S, 0);

    // --- timing
    if (driving) {
      for (const ev of timer.update(car, dt)) {
        if (ev.type === 'start') { hud.clearSectors(); hud.toast('Timed lap', 'Go'); }
        else if (ev.type === 'invalid') hud.toast('Off track', 'This lap will not count', 2);
        else if (ev.type === 'sector') {
          hud.sector(ev.index, ev.delta == null ? 'done' : ev.delta <= 0 ? 'ahead' : 'behind');
          if (ev.delta != null) hud.toast(`Sector ${ev.index + 1}  ${formatTime(ev.delta, true)}`, '', 1.8);
        } else if (ev.type === 'lap') {
          hud.clearSectors();
          const d = ev.prevBest != null ? '  (' + formatTime(ev.time - ev.prevBest, true) + ')' : '';
          if (!ev.valid) hud.toast(formatTime(ev.time), 'Not counted: the car left the track', 3.5);
          else if (ev.best) hud.toast(formatTime(ev.time) + d, ev.prevBest != null ? 'New best lap' : 'First lap on the board', 4);
          else hud.toast(formatTime(ev.time) + d, 'Lap complete', 3.5);
        }
      }
      // Corner names on approach.
      const s = car.bodyQ.s ?? 0;
      for (const k of track.corners) {
        const ahead = track.distanceAhead(Math.floor(s), k.index);
        if (ahead < 70 && ahead > 40 && lastCorner !== k.number) {
          lastCorner = k.number;
          const name = trackBrand.corners[k.number];
          if (name && name !== hud.el.corner.textContent) hud.cornerName(name); else if (name) hud.cornerTimer = 2.4, hud.el.corner.classList.add('show');
        }
      }
    }

    // --- visuals
    model.sync(car);
    model.setBrakeLights(car.brakeOut > 0.04);
    steerVis += (car.steerOut * 12.5 - steerVis) * Math.min(1, dt * 14);
    if (model.cabin.wheel) model.cabin.wheel.rotation.z = -steerVis;
    const rpm = car.rpm, red = spec.engine.redline;
    if (model.cabin.shiftLights) {
      const flash = rpm > red - 120 && Math.floor(clock * 14) % 2 === 0;
      model.cabin.shiftLights.forEach((led, k) => {
        const on = rpm > 5150 + k * 250;
        led.material.color.setHex(flash ? 0xff2020 : on ? (k < 3 ? 0xffd000 : k < 5 ? 0xff7a00 : 0xff2020) : 0x1a1a1a);
      });
    }
    const interior = rig.mode === 'cockpit';
    const unit = settings.units === 'mph' ? 'mph' : 'km/h', speedDisplay = car.speed * (settings.units === 'mph' ? 2.23694 : 3.6);
    const absActive = car.wheels.some((w) => w.absFactor < 0.92), tcActive = car.tcFactor < 0.9;
    let ghostOn = false;
    if (driving && settings.ghost && timer.ghostPose(timer.time, ghostPose)) {
      ghostOn = true;
      ghostModel.group.position.set(ghostPose.px, ghostPose.py, ghostPose.pz);
      ghostModel.group.quaternion.set(ghostPose.qx, ghostPose.qy, ghostPose.qz, ghostPose.qw);
      // Hide the ghost when it is on top of the player, so it never blocks the view.
      const dist = Math.hypot(ghostPose.px - car.px, ghostPose.pz - car.pz);
      ghostModel.group.visible = dist > 3.2;
    } else ghostModel.group.visible = false;
    cluster.update(dt, { rpm, gear: car.gear, speedDisplay, unit, boost: car.boost * car.throttleOut, lapTime: timer.running ? timer.time : null, delta: timer.running ? timer.delta : null, absActive, tcActive, autoShift: c.autoShift });
    ribbon.mesh.visible = driving && settings.line;
    if (ribbon.mesh.visible) ribbon.update(car.bodyHint, Math.max(car.speed, 0));

    rig.update(dt, car, driving ? input : null);
    // Shadow frustum follows the car.
    sun.target.position.set(car.px, car.py, car.pz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 150);
    if (world.group.userData.wheel) world.group.userData.wheel.rotation.z += dt * 0.05;

    // --- sound and feel
    let slip = 0, loose = 0, kerb = 0;
    for (const w of car.wheels) {
      if (!w.contact) continue;
      slip = Math.max(slip, w.slip);
      if (w.surface >= SURFACE.GRASS) loose += 0.25; else if (w.surface === SURFACE.KERB) kerb += 0.5;
    }
    kerb = Math.min(1, kerb);
    audio.update(dt, { rpm, throttle: car.throttleOut, boost: car.boost, speed: car.speed, slip, loose, kerb, wallImpact: car.wallImpact, gear: car.gear, interior });
    if (driving) {
      const v = clamp(Math.abs(car.speed) / 30, 0, 1);
      input.rumble(Math.max(kerb * 0.7 * v, loose * 0.6 * v, clamp(car.wallImpact / 8, 0, 1)), Math.max(clamp((slip - 1) * 0.5, 0, 0.7) * v, absActive ? 0.5 : 0), clock);
    }

    // --- HUD
    if (driving) {
      hs.running = timer.running; hs.lapTime = timer.time; hs.valid = timer.valid; hs.lastLap = timer.lastLap; hs.bestLap = timer.best ? timer.best.time : null;
      hs.delta = timer.delta; hs.rpm = rpm; hs.gear = car.gear; hs.speedDisplay = speedDisplay; hs.unit = unit;
      hs.throttle = input.throttle; hs.brake = input.brake; hs.autoShift = c.autoShift; hs.absOn = settings.abs; hs.tcOn = settings.tc;
      hs.absActive = absActive; hs.tcActive = tcActive; hs.cameraLabel = CAMERA_LABELS[rig.mode]; hs.px = car.px; hs.pz = car.pz;
      hs.ghost = ghostOn ? ghostPose : null;
      hud.update(dt, hs);
      hud.el.dash.style.opacity = interior ? '0.55' : '1';
    }
  }

  // Handles for debugging from the browser console.
  window.__game = { car, track, line, timer, rig, settings, scene, camera, renderer, model, world, input, audio, hud, autopilot, startSession, placeCar, get fps() { return fps; }, get state() { return state; },
    /** Advance and draw one frame by hand (used by automated checks when the tab is not animating). */
    tick(dt = 1 / 60) { if (state !== 'pause') step(dt); renderer.render(scene, camera); } };
  requestAnimationFrame(frame);
}
