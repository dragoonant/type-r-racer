// Procedural car model: body shell lofted from cross-sections, wheels, lights,
// rear wing and a cockpit interior. Everything is built from the dimensions in
// the car spec, so the visual car matches the physical one.
//
// This is a stand-in built in code because no freely redistributable model of
// the real car could be verified. buildCarModel() can be swapped for a glTF
// loader later without touching the rest of the game.
//
// Model frame = physics body frame: +x right, +y up, -z forward, origin at CG.
import * as THREE from 'three';
import { treadTexture } from './textures.js';

function table(pts) {
  return (u) => {
    if (u <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (u <= pts[i][0]) {
        const [u0, v0] = pts[i - 1], [u1, v1] = pts[i];
        const t = (u - u0) / (u1 - u0), s = t * t * (3 - 2 * t);
        return v0 + (v1 - v0) * (0.35 * s + 0.65 * t); // mostly linear, slightly eased
      }
    }
    return pts[pts.length - 1][1];
  };
}

export function buildCarModel(spec, { ghost = false } = {}) {
  const car = new THREE.Group();
  const L = spec.bodyLength, zNose = -(spec.a + spec.frontOverhang), ground = -spec.cgHeight;
  const uFront = spec.frontOverhang, uRear = spec.frontOverhang + spec.wheelbase;
  const R = spec.wheelRadius;
  const Z = (u) => zNose + u, Y = (h) => ground + h;

  // ---------------------------------------------------------------- materials
  const ghostMat = ghost ? new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.28, depthWrite: false }) : null;
  const M = (m) => ghostMat || m;
  const paint = M(new THREE.MeshPhysicalMaterial({ color: 0xf2f2ee, roughness: 0.42, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 }));
  const glass = M(new THREE.MeshPhysicalMaterial({ color: 0x06080b, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.93, envMapIntensity: 1.8 }));
  const black = M(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.55, metalness: 0.1 }));
  const trim = M(new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.8 }));
  const chrome = M(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide }));
  const lampWhite = M(new THREE.MeshStandardMaterial({ color: 0xe8eef5, emissive: 0xdfe8ff, emissiveIntensity: 0.9, roughness: 0.2 }));
  const lampRed = ghost ? ghostMat : new THREE.MeshStandardMaterial({ color: 0x5a0508, emissive: 0xff1a1a, emissiveIntensity: 0.35, roughness: 0.3 });
  const red = M(new THREE.MeshStandardMaterial({ color: 0xb30f1e, roughness: 0.6 }));
  const liner = M(new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.9, side: THREE.DoubleSide }));

  // ---------------------------------------------------------------- body shell
  // Profiles along the car, u = metres back from the nose, heights from the ground.
  const fw = table([[0, 0.6], [0.06, 0.76], [0.3, 0.88], [0.7, 0.938], [1.0, 0.945], [2.3, 0.935], [3.4, 0.945], [3.9, 0.94], [4.35, 0.9], [4.52, 0.83], [L, 0.72]]); // half width
  const fb = table([[0, 0.3], [0.1, 0.18], [0.5, 0.15], [4.0, 0.16], [4.3, 0.24], [L, 0.36]]); // underside
  const fh = table([[0, 0.6], [0.05, 0.67], [0.3, 0.765], [1.0, 0.9], [1.5, 0.985], [2.5, 1.0], [3.6, 1.04], [4.2, 1.065], [4.5, 1.05], [L, 0.99]]); // shoulder line
  const ft = table([[0, 0.62], [0.05, 0.7], [0.3, 0.81], [1.0, 0.945], [1.38, 1.0], [2.12, 1.36], [2.55, 1.405], [3.45, 1.39], [3.85, 1.33], [4.36, 1.1], [4.5, 1.075], [L, 1.0]]); // centreline top
  const fg = table([[1.38, 0.8], [2.12, 0.64], [2.55, 0.61], [3.45, 0.6], [3.85, 0.6], [4.36, 0.72]]); // roof half width
  const G0 = 1.38, G1 = 4.36; // greenhouse extent
  const SIDE = 7; // intervals up the flat body side
  const R_SIDE0 = 3, R_SHOULDER = R_SIDE0 + SIDE + 1; // ring indices
  const R_BELT = R_SHOULDER + 1, R_SILL = R_BELT + 1, R_ROOF = R_SILL + 1, R_MID = R_ROOF + 1, R_TOP = R_MID + 1;
  const ROWS = R_TOP + 1;
  const section = (u) => {
    const w = fw(u), yb = fb(u), yh = fh(u), yt = ft(u);
    const inG = u > G0 && u < G1;
    const k = inG ? Math.min(1, (u - G0) / 0.25, (G1 - u) / 0.25) : 0; // blend greenhouse in/out
    const wg = fg(u);
    const hood = (f, g) => [w * f, yh + (yt - yh) * g];
    const lerp2 = (p, q) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    const pts = [[0, yb], [0.8 * w, yb], [0.97 * w, yb + 0.06]];
    const y0 = yb + 0.16, y1 = yh - 0.1;
    for (let i = 0; i <= SIDE; i++) pts.push([w, y0 + ((y1 - y0) * i) / SIDE]);
    pts.push([0.985 * w, yh - 0.03]);
    pts.push(lerp2(hood(0.93, 0.0), [w - 0.07, yh]));
    pts.push(lerp2(hood(0.75, 0.6), [Math.min(w - 0.1, wg + 0.17), yh + 0.02]));
    pts.push(lerp2(hood(0.45, 0.9), [wg, yt - 0.05]));
    pts.push(lerp2(hood(0.2, 0.99), [wg * 0.5, yt - 0.006]));
    pts.push([0, yt]);
    return pts;
  };
  const STEP = 0.05, NS = Math.round(L / STEP);
  const rings = [];
  for (let s = 0; s <= NS; s++) rings.push(section(Math.min(L, s * STEP)));

  // Wheel arches: drop the cells inside each arch circle, then pull the
  // surrounding vertices onto the circle so the opening has a clean edge.
  const ARCH = 0.378;
  const uOf = [];
  for (let s = 0; s <= NS; s++) uOf.push(new Array(ROWS).fill(Math.min(L, s * STEP)));
  const archDist = (u, y) => Math.min(Math.hypot(u - uFront, y - R), Math.hypot(u - uRear, y - R));
  const cut = [];
  for (let s = 0; s < NS; s++) {
    cut.push([]);
    for (let r = 0; r < ROWS - 1; r++) {
      const uc = (s + 0.5) * STEP, yc = (rings[s][r][1] + rings[s][r + 1][1] + rings[s + 1][r][1] + rings[s + 1][r + 1][1]) / 4;
      cut[s].push(r >= 1 && r <= R_SHOULDER && archDist(uc, yc) < ARCH);
    }
  }
  for (let s = 0; s <= NS; s++) for (let r = 1; r <= R_SHOULDER; r++) {
    const u = uOf[s][r], y = rings[s][r][1];
    for (const ua of [uFront, uRear]) {
      const d = Math.hypot(u - ua, y - R);
      if (Math.abs(d - ARCH) < 0.055 && d > 1e-3) { uOf[s][r] = ua + ((u - ua) * ARCH) / d; rings[s][r] = [rings[s][r][0], R + ((y - R) * ARCH) / d]; }
    }
  }
  // Vertex grid mirrored across x: index(s, r, side).
  const pos = [];
  const vid = (s, r, side) => (s * ROWS + r) * 2 + (side > 0 ? 1 : 0);
  for (let s = 0; s <= NS; s++) for (let r = 0; r < ROWS; r++) for (const side of [-1, 1]) pos.push(side * rings[s][r][0], Y(rings[s][r][1]), Z(uOf[s][r]));
  const idxPaint = [], idxGlass = [], idxTrim = [];
  for (let s = 0; s < NS; s++) {
    const u = (s + 0.5) * STEP;
    for (let r = 0; r < ROWS - 1; r++) {
      if (cut[s][r]) continue;
      let list = idxPaint;
      if (r <= 1) list = idxTrim;
      else if (u > G0 + 0.1 && u < G1 - 0.08) {
        if (r === R_SILL && u > 1.64 && u < 3.7) list = idxGlass; // side windows; the rest is pillar
        else if (r >= R_ROOF && (u < 2.1 || u > 3.9)) list = idxGlass; // windscreen and rear glass
      }
      for (const side of [-1, 1]) {
        const a = vid(s, r, side), b = vid(s, r + 1, side), c = vid(s + 1, r, side), d = vid(s + 1, r + 1, side);
        if (side > 0) list.push(a, b, c, b, d, c); else list.push(a, c, b, b, c, d);
      }
    }
  }
  const shell = (indices, material, cast = true) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast && !ghost; m.receiveShadow = !ghost;
    car.add(m);
    return m;
  };
  shell(idxPaint, paint);
  shell(idxTrim, trim);
  const glassMesh = shell(idxGlass, glass, false);
  glassMesh.renderOrder = 2;
  // End caps (nose and tail) so the shell is closed.
  for (const s of [0, NS]) {
    const ring = rings[s], cap = [], ci = [];
    const zc = Z(s === 0 ? 0 : L);
    cap.push(0, Y((ring[0][1] + ring[ROWS - 1][1]) / 2), zc);
    for (let r = 0; r < ROWS; r++) cap.push(ring[r][0], Y(ring[r][1]), zc);
    for (let r = ROWS - 1; r >= 0; r--) cap.push(-ring[r][0], Y(ring[r][1]), zc);
    const cnt = ROWS * 2;
    for (let k = 1; k < cnt; k++) { if (s === 0) ci.push(0, k + 1, k); else ci.push(0, k, k + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3)); g.setIndex(ci); g.computeVertexNormals();
    const m = new THREE.Mesh(g, paint); m.castShadow = !ghost; car.add(m);
  }

  const box = (w, h, d, material, x, hy, u, parent = car) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, Y(hy), Z(u)); m.castShadow = !ghost;
    parent.add(m);
    return m;
  };
  const strut = (p0, p1, w, d, material, parent = car) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, p0.distanceTo(p1), d), material);
    m.position.copy(p0).add(p1).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
    parent.add(m);
    return m;
  };

  // ---------------------------------------------------------------- exterior details
  // Body-coloured A-pillars along the edge between windscreen and side glass.
  // They sit in their own group so the cockpit camera can hide them.
  const exteriorOnly = new THREE.Group();
  car.add(exteriorOnly);
  {
    const s0 = Math.round(1.5 / STEP), s1 = Math.round(2.12 / STEP);
    for (const sx of [-1, 1]) {
      const p0 = new THREE.Vector3(sx * rings[s0][R_ROOF][0], Y(rings[s0][R_ROOF][1] + 0.012), Z(1.47));
      const p1 = new THREE.Vector3(sx * rings[s1][R_ROOF][0], Y(rings[s1][R_ROOF][1] + 0.012), Z(2.15));
      strut(p0, p1, 0.07, 0.06, paint, exteriorOnly).castShadow = !ghost;
      const bp = box(0.02, 0.36, 0.11, black, sx * (fg(2.95) + 0.085), 1.2, 2.95, exteriorOnly); bp.rotation.z = sx * 0.38; // B-pillar
    }
  }
  box(1.24, 0.24, 0.06, black, 0, 0.34, 0.0); // lower grille
  box(0.74, 0.05, 0.05, black, 0, 0.668, 0.03); // slot between the headlights
  box(0.86, 0.07, 0.05, black, 0, 0.555, 0.005); // upper intake slot
  box(1.5, 0.03, 0.22, trim, 0, 0.165, 0.06); // front splitter
  for (const sx of [-1, 1]) {
    const hl = box(0.34, 0.06, 0.2, lampWhite, sx * 0.58, 0.67, 0.12); hl.rotation.y = -sx * 0.42; // headlights
    box(0.16, 0.14, 0.05, black, sx * 0.72, 0.36, 0.02).rotation.y = -sx * 0.5; // corner intakes
    box(0.03, 0.05, 1.75, trim, sx * 0.95, 0.19, (uFront + uRear) / 2); // side skirt
    const mirror = box(0.2, 0.11, 0.1, black, sx * 1.01, 1.03, 1.74); mirror.rotation.y = sx * 0.2; // door mirrors
    box(0.1, 0.03, 0.06, black, sx * 0.9, 1.0, 1.76);
    const stay = box(0.035, 0.22, 0.2, black, sx * 0.47, 1.19, 4.4); stay.rotation.x = 0.35; // wing stays
    box(0.02, 0.1, 0.27, black, sx * 0.78, 1.305, 4.47); // wing end plates
  }
  box(0.3, 0.012, 0.1, black, 0, ft(0.78) + 0.004, 0.78).rotation.x = Math.atan2(ft(0.9) - ft(0.66), 0.24); // bonnet vent
  box(1.56, 0.03, 0.24, black, 0, 1.305, 4.47).rotation.x = -0.07; // wing blade
  const tailLamps = [];
  for (const sx of [-1, 1]) { const t = box(0.34, 0.07, 0.07, lampRed, sx * 0.56, 0.93, L - 0.045); t.rotation.y = sx * 0.28; tailLamps.push(t); }
  tailLamps.push(box(0.5, 0.025, 0.03, lampRed, 0, 1.085, 4.49)); // high-level brake light
  box(1.3, 0.2, 0.08, trim, 0, 0.36, L - 0.03); // rear diffuser panel
  for (const [x, r] of [[-0.13, 0.042], [0, 0.058], [0.13, 0.042]]) { // triple exhaust
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 14, 1, true), chrome);
    tip.rotation.x = Math.PI / 2; tip.position.set(x, Y(0.33), Z(L + 0.01)); car.add(tip);
  }
  box(0.11, 0.07, 0.012, red, 0, 0.6, -0.012); // badge plate, nose
  box(0.11, 0.07, 0.012, red, 0, 0.99, L + 0.004); // badge plate, tail

  // ---------------------------------------------------------------- wheel arches
  for (const u of [uFront, uRear]) for (const sx of [-1, 1]) {
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.385, 0.385, 0.5, 22, 1, true, 0, Math.PI), liner);
    tub.rotation.z = Math.PI / 2; // axis across the car, arc over the top of the wheel
    tub.position.set(sx * 0.69, Y(R), Z(u));
    car.add(tub);
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.385, 22), liner); back.rotation.y = Math.PI / 2; back.position.set(sx * 0.44, Y(R), Z(u)); car.add(back);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.03, 6, 26, Math.PI), black);
    lip.rotation.y = Math.PI / 2; lip.position.set(sx * (fw(u) - 0.004), Y(R), Z(u)); car.add(lip);
  }

  // ---------------------------------------------------------------- wheels
  const tread = ghost ? null : treadTexture();
  if (tread) tread.repeat.set(10, 1);
  const tyreMat = M(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, bumpMap: tread, bumpScale: 0.6 }));
  const rimMat = M(new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }));
  const discMat = M(new THREE.MeshStandardMaterial({ color: 0x8c8f94, roughness: 0.4, metalness: 0.85 }));
  const tw = 0.265, rr = 0.245;
  const tyreGeo = new THREE.LatheGeometry([[rr, -tw / 2 + 0.008], [0.292, -tw / 2], [0.314, -tw / 2 + 0.018], [R, -tw / 2 + 0.05], [R, tw / 2 - 0.05], [0.314, tw / 2 - 0.018], [0.292, tw / 2], [rr, tw / 2 - 0.008]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
  tyreGeo.rotateZ(Math.PI / 2);
  const barrelGeo = new THREE.CylinderGeometry(rr, rr, tw - 0.03, 24, 1, true); barrelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const left = i % 2 === 0, front = i < 2, out = left ? -1 : 1;
    const hub = new THREE.Group(), spin = new THREE.Group();
    hub.add(spin);
    const tyre = new THREE.Mesh(tyreGeo, tyreMat); tyre.castShadow = !ghost; spin.add(tyre);
    spin.add(new THREE.Mesh(barrelGeo, rimMat));
    // Ten spokes in five pairs.
    for (let k = 0; k < 10; k++) {
      const a = (Math.floor(k / 2) / 5) * Math.PI * 2 + (k % 2 ? 0.2 : -0.2);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.19, 0.03), rimMat);
      spoke.position.set(out * 0.085, Math.cos(a) * 0.145, Math.sin(a) * 0.145); spoke.rotation.x = a; spin.add(spoke);
    }
    const centre = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 12), rimMat); centre.rotation.z = Math.PI / 2; centre.position.x = out * 0.085; spin.add(centre);
    const rimLip = new THREE.Mesh(new THREE.TorusGeometry(rr - 0.004, 0.008, 5, 28), red); rimLip.rotation.y = Math.PI / 2; rimLip.position.x = out * (tw / 2 - 0.012); spin.add(rimLip);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(front ? 0.175 : 0.152, front ? 0.175 : 0.152, 0.03, 20), discMat); disc.rotation.z = Math.PI / 2; disc.position.x = out * 0.03; spin.add(disc);
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, front ? 0.16 : 0.11), red); caliper.position.set(out * 0.03, 0.05, 0.15); hub.add(caliper);
    hub.position.set((left ? -0.5 : 0.5) * (front ? spec.trackFront : spec.trackRear), Y(R), front ? -spec.a : spec.b);
    car.add(hub);
    wheels.push({ hub, spin });
  }

  // ---------------------------------------------------------------- cockpit
  const interior = new THREE.Group();
  car.add(interior);
  const cabin = {};
  if (!ghost) {
    const dashM = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.9 });
    const softM = new THREE.MeshStandardMaterial({ color: 0x2e2e33, roughness: 0.95 });
    const linerM = new THREE.MeshStandardMaterial({ color: 0x3b3b41, roughness: 1, side: THREE.DoubleSide });
    const suede = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 1 });
    const seatRed = new THREE.MeshStandardMaterial({ color: 0xa30d1c, roughness: 0.95 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.9 });
    const ib = (w, h, d, material, x, hy, u) => { const m = box(w, h, d, material, x, hy, u, interior); m.castShadow = false; return m; };
    const DX = -0.37; // driver's seat centreline (left-hand drive)

    // Dashboard: a deep top pad under the windscreen and a face toward the cabin.
    // The pad stops short in front of the driver so the instruments sit in a recess.
    ib(1.62, 0.05, 0.42, dashM, 0, 0.955, 1.55).rotation.x = -0.04;
    ib(0.98, 0.05, 0.2, dashM, 0.32, 0.962, 1.855);
    ib(0.24, 0.05, 0.2, dashM, -0.69, 0.962, 1.855);
    ib(1.6, 0.29, 0.1, softM, 0, 0.785, 1.9);
    // Full-width honeycomb vent strip.
    const ventTex = (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 32; const g = c.getContext('2d');
      g.fillStyle = '#0a0a0b'; g.fillRect(0, 0, 512, 32); g.strokeStyle = '#4a4a50'; g.lineWidth = 1.2;
      for (let x = -32; x < 544; x += 9) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 32); g.moveTo(x + 16, 0); g.lineTo(x, 32); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const vent = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.06), new THREE.MeshStandardMaterial({ map: ventTex, roughness: 0.6 }));
    vent.position.set(0.1, Y(0.885), Z(1.952)); interior.add(vent);
    // Instrument binnacle and screen.
    ib(0.38, 0.03, 0.2, dashM, DX, 1.055, 1.79).rotation.x = -0.08;
    for (const sx of [-1, 1]) ib(0.02, 0.13, 0.2, dashM, DX + sx * 0.19, 0.995, 1.8);
    ib(0.38, 0.13, 0.02, new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.4 }), DX, 0.96, 1.775);
    const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1125), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    cluster.position.set(DX, Y(0.962), Z(1.8)); cluster.rotation.x = -0.14; interior.add(cluster);
    cabin.cluster = cluster;
    // Shift lights on the binnacle's trailing edge.
    cabin.shiftLights = [];
    for (let k = 0; k < 7; k++) {
      const led = new THREE.Mesh(new THREE.CircleGeometry(0.006, 10), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, toneMapped: false }));
      led.position.set(DX + (k - 3) * 0.021, Y(1.062), Z(1.893)); led.rotation.x = -0.25; interior.add(led);
      cabin.shiftLights.push(led);
    }
    // Centre screen.
    ib(0.24, 0.14, 0.02, new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.15, metalness: 0.4 }), 0.05, 1.06, 1.86).rotation.x = -0.12;
    // Steering wheel.
    const column = new THREE.Group();
    column.position.set(DX, Y(0.92), Z(2.08)); column.rotation.x = -0.38; // rim tilted away at the top
    interior.add(column);
    const wheel = new THREE.Group(); column.add(wheel);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.0155, 10, 40), suede));
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.0162, 10, 6, 0.12), seatRed); mark.rotation.z = Math.PI / 2 - 0.06; wheel.add(mark);
    for (const a of [Math.PI, 0, -Math.PI / 2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.014), dashM); sp.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, -0.012); sp.rotation.z = a; wheel.add(sp);
    }
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.04, 18), dashM); boss.rotation.x = Math.PI / 2; boss.position.z = -0.02; wheel.add(boss);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.017, 16), seatRed); badge.position.z = 0.002; wheel.add(badge);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 10), dashM); stalk.rotation.x = Math.PI / 2; stalk.position.z = -0.17; column.add(stalk);
    cabin.wheel = wheel;
    // Centre console and gear lever.
    ib(0.24, 0.2, 1.05, softM, 0.0, 0.62, 2.5);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.13, 8), alu); lever.position.set(0, Y(0.775), Z(2.33)); interior.add(lever);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.027, 14, 12), alu); knob.scale.set(1, 1.35, 1); knob.position.set(0, Y(0.85), Z(2.33)); interior.add(knob);
    cabin.knob = knob; cabin.lever = lever;
    // A-pillars, roof lining, header rail, door cards, B-pillars.
    for (const sx of [-1, 1]) {
      strut(new THREE.Vector3(sx * 0.775, Y(0.99), Z(1.48)), new THREE.Vector3(sx * 0.625, Y(1.35), Z(2.14)), 0.045, 0.06, linerM, interior);
      ib(0.07, 0.56, 1.95, softM, sx * 0.84, 0.71, 2.5); // door card
      ib(0.1, 0.04, 1.95, dashM, sx * 0.8, 1.0, 2.5); // door top
      ib(0.06, 0.4, 0.12, linerM, sx * 0.72, 1.19, 3.0).rotation.z = sx * 0.34; // B-pillar
    }
    const roofLiner = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 1.75), linerM); roofLiner.rotation.x = Math.PI / 2; roofLiner.position.set(0, Y(1.36), Z(3.0)); interior.add(roofLiner);
    ib(1.26, 0.04, 0.08, linerM, 0, 1.352, 2.14); // windscreen header
    ib(0.2, 0.055, 0.03, dashM, 0, 1.3, 2.08); // rear-view mirror
    ib(1.5, 0.04, 2.6, dashM, 0, 0.3, 2.9); // floor
    // Seats.
    for (const sx of [-1, 1]) {
      ib(0.5, 0.14, 0.5, seatRed, sx * 0.37, 0.47, 2.66);
      ib(0.5, 0.7, 0.13, seatRed, sx * 0.37, 0.85, 2.98).rotation.x = 0.2;
      ib(0.26, 0.2, 0.1, suede, sx * 0.37, 1.24, 3.06).rotation.x = 0.2;
    }
    ib(1.3, 0.5, 0.14, suede, 0, 0.75, 3.85).rotation.x = 0.25; // rear bench back
  }

  const eye = new THREE.Vector3(-0.37, Y(1.12), Z(2.58)); // driver's eye point
  return {
    group: car, wheels, interior, exteriorOnly, cabin, tailLamps, glass: glassMesh, eye, spec,
    /** Copy physics state onto the model. */
    sync(state) {
      car.position.set(state.px, state.py, state.pz);
      car.quaternion.set(state.qx, state.qy, state.qz, state.qw);
      for (let i = 0; i < 4; i++) {
        const w = state.wheels[i], v = wheels[i];
        v.hub.position.y = state.hardY - w.length;
        v.hub.rotation.y = -w.steer;
        v.spin.rotation.x = -w.angle;
      }
    },
    setBrakeLights(on) { if (!ghost) lampRed.emissiveIntensity = on ? 2.4 : 0.35; },
  };
}
