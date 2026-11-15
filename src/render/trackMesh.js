// Builds every piece of circuit geometry from the same Track arrays the
// physics uses: road, kerbs, grass and gravel run-off, barriers, the bridge
// at the crossover, the surrounding terrain, trees and trackside buildings.
import * as THREE from 'three';
import { KERB_WIDTH } from '../track/track.js';
import * as TX from './textures.js';

const GRASS_STRIP = 2.2;

/** Triangle strip along the track between two lateral offsets. */
function strip(track, { a, b, ya = () => 0, yb = () => 0, seg = () => true, uScale = 0, vScale = 8 }) {
  const n = track.n, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
  for (let i = 0; i < n; i++) {
    const rx = -track.tz[i], rz = track.tx[i], da = a(i), db = b(i);
    pos[i * 6] = track.x[i] + rx * da; pos[i * 6 + 1] = track.y[i] + track.bank[i] * da + ya(i); pos[i * 6 + 2] = track.z[i] + rz * da;
    pos[i * 6 + 3] = track.x[i] + rx * db; pos[i * 6 + 4] = track.y[i] + track.bank[i] * db + yb(i); pos[i * 6 + 5] = track.z[i] + rz * db;
    const v = (i * track.ds) / vScale;
    uv[i * 4] = uScale ? da / uScale : 0; uv[i * 4 + 1] = v; uv[i * 4 + 2] = uScale ? db / uScale : 1; uv[i * 4 + 3] = v;
  }
  for (let i = 0; i < n; i++) {
    if (!seg(i)) continue;
    const j = (i + 1) % n;
    if (j === 0) continue; // the UV seam is closed with duplicated vertices below
    idx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
  }
  // Close the loop with a duplicate of sample 0 carrying the next v coordinate.
  let P = pos, U = uv;
  if (seg(n - 1)) {
    P = new Float32Array(n * 6 + 6); P.set(pos); P.set(pos.subarray(0, 6), n * 6);
    U = new Float32Array(n * 4 + 4); U.set(uv); const v = (n * track.ds) / vScale;
    U[n * 4] = uv[0]; U[n * 4 + 1] = v; U[n * 4 + 2] = uv[2]; U[n * 4 + 3] = v;
    const i = n - 1, j = n;
    idx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mesh(geometry, material, { receive = true, cast = false, order = 0 } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.receiveShadow = receive; m.castShadow = cast; m.renderOrder = order;
  m.matrixAutoUpdate = false;
  return m;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildTrack(track, terrainBuffer, line) {
  const group = new THREE.Group();
  const n = track.n, half = (i) => track.width[i] / 2;
  const mats = {
    road: new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: 0.88, metalness: 0 }),
    grass: new THREE.MeshStandardMaterial({ map: TX.grassTexture(), roughness: 1, metalness: 0 }),
    gravel: new THREE.MeshStandardMaterial({ map: TX.gravelTexture(), roughness: 1, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ map: TX.wallTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    concrete: new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    kerb: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
  };

  // ---- road
  group.add(mesh(strip(track, { a: (i) => -half(i), b: (i) => half(i), vScale: 12 }), mats.road));

  // ---- kerbs: alternating red and white blocks, one per sample
  {
    const pos = [], col = [];
    const red = [0.72, 0.05, 0.07], white = [0.93, 0.93, 0.9];
    const P = (i, d, y) => [track.x[i] - track.tz[i] * d, track.y[i] + track.bank[i] * d + y, track.z[i] + track.tx[i] * d];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!track.kerb[i] && !track.kerb[j]) continue;
      const c = i % 2 ? red : white;
      // A kerb tapers to nothing over the segment where it starts or ends.
      const wi = track.kerb[i] ? KERB_WIDTH : 0, wj = track.kerb[j] ? KERB_WIDTH : 0;
      for (const side of [-1, 1]) {
        const a0 = P(i, side * half(i), 0.012), b0 = P(i, side * (half(i) + wi), 0.03);
        const a1 = P(j, side * half(j), 0.012), b1 = P(j, side * (half(j) + wj), 0.03);
        const quad = side < 0 ? [b0, a0, b1, a0, a1, b1] : [a0, b0, a1, b0, b1, a1];
        for (const p of quad) { pos.push(...p); col.push(...c); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    group.add(mesh(g, mats.kerb));
  }

  // ---- run-off: a grass strip, then gravel where the corner calls for it
  for (const side of [-1, 1]) {
    const verge = side < 0 ? track.vergeL : track.vergeR, gravel = side < 0 ? track.gravelL : track.gravelR;
    const split = (i) => (gravel[i] && verge[i] > GRASS_STRIP + 0.5 ? GRASS_STRIP : verge[i]);
    const inner = (i) => side * (half(i) + (track.kerb[i] ? Math.min(KERB_WIDTH, split(i)) : 0)), mid = (i) => side * (half(i) + split(i)), outer = (i) => side * (half(i) + verge[i]);
    const order = (f, g2) => (side < 0 ? { a: g2, b: f } : { a: f, b: g2 });
    group.add(mesh(strip(track, { ...order(inner, mid), uScale: 5, vScale: 5 }), mats.grass));
    group.add(mesh(strip(track, { ...order(mid, outer), ya: () => -0.03, yb: () => -0.03, uScale: 4, vScale: 4, seg: (i) => gravel[i] && gravel[(i + 1) % n] && verge[i] > GRASS_STRIP + 0.5 }), mats.gravel));

    // Barrier.
    const tall = (i) => (track.flag[i] === 2 ? 5.3 : 1.05);
    const wallGeo = strip(track, { a: outer, b: outer, ya: () => -0.3, yb: tall, vScale: 6 });
    // u = 0 at the base and 1 at the top would stretch on tall walls; scale v instead.
    group.add(mesh(wallGeo, mats.wall, { cast: true }));

    // Ground falling away behind the barrier (not on the bridge deck).
    const skirt = side < 0 ? track.skirtL : track.skirtR;
    const far = (i) => side * (half(i) + verge[i] + Math.max(skirt[i], 0.01));
    group.add(mesh(strip(track, { ...order(outer, far), ...(side < 0 ? { ya: () => -3.2 } : { yb: () => -3.2 }), uScale: 5, vScale: 5, seg: (i) => track.flag[i] !== 1 && skirt[i] > 0.3 }), mats.grass));

    // Bridge fascia.
    group.add(mesh(strip(track, { a: outer, b: outer, ya: () => -1.1, yb: () => 0, vScale: 6, seg: (i) => track.flag[i] === 1 }), mats.concrete, { cast: true }));
  }
  // Bridge deck underside.
  group.add(mesh(strip(track, {
    a: (i) => -(half(i) + track.vergeL[i]), b: (i) => half(i) + track.vergeR[i], ya: () => -1.1, yb: () => -1.1, uScale: 6, vScale: 6,
    seg: (i) => track.flag[i] === 1,
  }), mats.concrete, { cast: true }));

  // ---- start/finish line and grid boxes
  {
    const painted = new THREE.MeshStandardMaterial({ map: TX.checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const quad = (s0, s1, d0, d1, material, uRep = 1) => {
      const a = track.pointAt(s0, d0), b = track.pointAt(s0, d1), c = track.pointAt(s1, d0), d = track.pointAt(s1, d1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y + 0.01, a.z, b.x, b.y + 0.01, b.z, c.x, c.y + 0.01, c.z, d.x, d.y + 0.01, d.z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, uRep, 0, 0, 1, uRep, 1], 2));
      g.setIndex([0, 1, 2, 1, 3, 2]);
      g.computeVertexNormals();
      group.add(mesh(g, material, { order: 1 }));
    };
    const h0 = half(0) - 0.5;
    quad(-0.3, 0.3, -h0, h0, painted, Math.round((2 * h0) / 1.2));
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (let k = 0; k < 10; k++) {
      const s = n - 6 - k * 4, d = k % 2 ? 3 : -3; // staggered grid
      quad(s - 0.08, s + 0.08, d - 1.3, d + 1.3, white);
      quad(s - 1.4, s, d - 1.3, d - 1.15, white); quad(s - 1.4, s, d + 1.15, d + 1.3, white);
    }
  }

  // ---- terrain
  const T = track.data.terrain;
  let heights = null;
  if (terrainBuffer && T) {
    heights = new Int16Array(terrainBuffer);
    const { nx, nz, x0, z0, cell } = T;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
    const r = rng(11);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const k = iz * nx + ix;
      pos[k * 3] = x0 + ix * cell; pos[k * 3 + 1] = heights[k] / 100; pos[k * 3 + 2] = z0 + iz * cell;
      uv[k * 2] = (ix * cell) / 7; uv[k * 2 + 1] = (iz * cell) / 7;
      const shade = 0.72 + 0.22 * Math.sin(ix * 0.11 + Math.sin(iz * 0.07) * 2) * Math.cos(iz * 0.13) + r() * 0.12;
      col[k * 3] = shade * 0.92; col[k * 3 + 1] = shade; col[k * 3 + 2] = shade * 0.85;
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let iz = 0; iz < nz - 1; iz++) for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const tm = mats.grass.clone(); tm.vertexColors = true;
    group.add(mesh(g, tm));
    // A distant apron so the horizon is never empty.
    const apron = new THREE.Mesh(new THREE.CircleGeometry(9000, 48), new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2; apron.position.set(x0 + (nx * cell) / 2, -8, z0 + (nz * cell) / 2);
    apron.renderOrder = -1;
    group.add(apron);
  }
  const terrainHeight = (x, z) => {
    if (!heights) return 0;
    const fx = (x - T.x0) / T.cell, fz = (z - T.z0) / T.cell;
    const ix = Math.max(0, Math.min(T.nx - 2, Math.floor(fx))), iz = Math.max(0, Math.min(T.nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix)), tz = Math.max(0, Math.min(1, fz - iz));
    const h = (a, b) => heights[b * T.nx + a] / 100;
    return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
  };
  // Distance from a point to the edge of the drivable corridor (negative = inside).
  const corridorDistance = (x, z) => {
    let best = Infinity;
    const c0 = Math.floor(x / track.cell), r0 = Math.floor(z / track.cell);
    for (let c = c0 - 3; c <= c0 + 3; c++) for (let r = r0 - 3; r <= r0 + 3; r++) {
      const cellPts = track.grid.get(c + ',' + r);
      if (!cellPts) continue;
      for (const i of cellPts) {
        const dx = x - track.x[i], dz = z - track.z[i];
        const lat = dx * -track.tz[i] + dz * track.tx[i];
        const ext = half(i) + (lat < 0 ? track.vergeL[i] + track.skirtL[i] : track.vergeR[i] + track.skirtR[i]);
        best = Math.min(best, Math.hypot(dx, dz) - ext);
      }
    }
    return best;
  };

  // ---- trackside structures (kept clear of when planting trees)
  const footprints = [];
  buildStructures(track, group, mats, footprints, terrainHeight, line);

  // ---- trees
  if (heights) {
    const r = rng(1234);
    const trunk = new THREE.CylinderGeometry(0.22, 0.32, 1, 5); trunk.translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
    const blob = new THREE.IcosahedronGeometry(1, 1);
    const leafA = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const barkM = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    const spots = [];
    const { nx, nz, x0, z0, cell } = T;
    const step = 13;
    for (let z = z0 + 20; z < z0 + nz * cell - 20; z += step) for (let x = x0 + 20; x < x0 + nx * cell - 20; x += step) {
      const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
      const clump = Math.sin(px * 0.011) * Math.cos(pz * 0.013) + Math.sin(px * 0.031 + pz * 0.027) * 0.5;
      const d = corridorDistance(px, pz);
      if (d < 7) continue;
      // Dense near the circuit (a screen of trees), patchier further out.
      const p = d < 60 ? 0.55 : clump > 0.1 ? 0.5 : 0.08;
      if (r() > p) continue;
      if (footprints.some((f) => Math.hypot(px - f.x, pz - f.z) < f.r)) continue;
      spots.push([px, terrainHeight(px, pz), pz, 0.75 + r() * 0.8, r(), r() < 0.45]);
    }
    const mk = (geo, mat, list, place) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
      list.forEach((t, i) => { place(t, v, s, c); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t[4] * 6.28); m4.compose(v, q, s); im.setMatrixAt(i, m4); im.setColorAt(i, c); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = false;
      group.add(im);
    };
    const conifers = spots.filter((t) => t[5]), broad = spots.filter((t) => !t[5]);
    mk(trunk, barkM, spots, (t, v, s, c) => { v.set(t[0], t[1] - 0.3, t[2]); s.set(t[3], t[3] * (t[5] ? 3 : 3.6), t[3]); c.setRGB(1, 1, 1); });
    mk(cone, leafA, conifers, (t, v, s, c) => { v.set(t[0], t[1] + t[3] * 1.6, t[2]); s.set(t[3] * 2.3, t[3] * 9, t[3] * 2.3); c.setHSL(0.33 + t[4] * 0.04, 0.42, 0.14 + t[4] * 0.07); });
    mk(blob, leafA, broad, (t, v, s, c) => { v.set(t[0], t[1] + t[3] * 5.2, t[2]); s.set(t[3] * 3.4, t[3] * 3.0, t[3] * 3.4); c.setHSL(0.27 + t[4] * 0.07, 0.48, 0.2 + t[4] * 0.1); });
  }

  group.traverse((o) => { if (o.isMesh && !o.matrixAutoUpdate) o.updateMatrix(); });
  return { group, materials: mats, terrainHeight };
}

function buildStructures(track, group, mats, footprints, terrainHeight, line) {
  const n = track.n;
  const frameAt = (s, d) => {
    const p = track.pointAt(s, d);
    return { pos: new THREE.Vector3(p.x, p.y, p.z), yaw: Math.atan2(-p.tx, -p.tz), p };
  };
  const place = (obj, s, d, yOff = 0) => {
    const f = frameAt(s, d);
    obj.position.copy(f.pos); obj.position.y += yOff;
    obj.rotation.y = f.yaw;
    group.add(obj);
    return f;
  };

  // ---- start gantry
  {
    const g = new THREE.Group();
    const w = track.width[0] + track.vergeL[0] + track.vergeR[0] + 1;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.6 });
    const off = (track.vergeR[0] - track.vergeL[0]) / 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.9), steel); beam.position.set(off, 7.2, 0); g.add(beam);
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.6, 0.5), steel); post.position.set(off + (sx * w) / 2, 3.6, 0); g.add(post); }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })); panel.position.set(0, 6.2, 0.2); g.add(panel);
    for (let k = 0; k < 5; k++) { const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x550000 })); lamp.position.set(-2 + k, 6.2, 0.36); g.add(lamp); }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    place(g, 0, 0);
  }

  // ---- main grandstand (left) and pit building (right) along the start straight
  const along = (sFrom, sTo, side, gap, depth, build) => {
    const sMid = (sFrom + sTo) / 2, len = (sTo - sFrom) * track.ds;
    const i = track.wrap(Math.round(sMid));
    const edge = track.width[i] / 2 + (side < 0 ? track.vergeL[i] + track.skirtL[i] : track.vergeR[i] + track.skirtR[i]);
    const d = side * (edge + gap + depth / 2);
    const obj = build(len, depth);
    const f = place(obj, sMid, d);
    obj.position.y = Math.min(f.pos.y, terrainHeight(f.pos.x, f.pos.z) + 0.5) - 0.5;
    for (let s = sFrom; s <= sTo; s += 8) { const q = track.pointAt(s, d); footprints.push({ x: q.x, z: q.z, r: depth * 0.75 + 6 }); }
    return obj;
  };
  const standMat = new THREE.MeshStandardMaterial({ map: TX.standTexture(), roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe6e7ea, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x555a61, roughness: 0.7, metalness: 0.4 });
  const makeStand = (len, depth, height, facing) => {
    // Wedge profile: low at the front (track side), high at the back.
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(depth, 0); shape.lineTo(depth, height); shape.lineTo(depth - 1.5, height); shape.lineTo(0, 2); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    // Extrusion runs along +z with the profile in x/y: centre it and turn it to run along the track.
    geo.translate(-depth / 2, 0, -len / 2);
    const m = new THREE.Mesh(geo, standMat); m.castShadow = true; m.receiveShadow = true;
    // The seating slope must face the track: local +x is to the right of travel.
    m.rotation.y = facing < 0 ? Math.PI : 0;
    g.add(m);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(depth * 0.9, 0.35, len), roofMat); roof.position.set((facing < 0 ? -1 : 1) * depth * 0.12, height + 4.2, 0); roof.rotation.z = (facing < 0 ? -1 : 1) * 0.07; roof.castShadow = true; g.add(roof);
    for (let z = -len / 2 + 2; z <= len / 2 - 2; z += 14) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.4, 0.4), steelMat); post.position.set((facing < 0 ? -1 : 1) * (depth / 2 - 0.6), height + 2, z); g.add(post); }
    return g;
  };
  // uv tiling for the stand texture
  standMat.map.repeat.set(0.05, 0.08);
  along(n - 150, 110, -1, 6, 20, (len, depth) => makeStand(len, depth, 15, -1));
  along(170, 250, -1, 6, 14, (len, depth) => makeStand(len, depth, 9, -1)); // first-corner stand
  const pitMat = new THREE.MeshStandardMaterial({ map: TX.buildingTexture(), roughness: 0.7 });
  pitMat.map.repeat.set(1, 1);
  along(n - 130, 120, 1, 14, 16, (len, depth) => {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(depth, 9, len);
    // Tile the window texture along the length.
    const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * Math.max(1, Math.round(len / 24)));
    const b = new THREE.Mesh(geo, pitMat); b.position.y = 4.5; b.castShadow = true; g.add(b);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(depth + 5, 0.4, len + 2), roofMat); roof.position.set(-2, 9.3, 0); roof.castShadow = true; g.add(roof);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 22, 12), pitMat); tower.position.set(2, 11, -len / 2 + 30); tower.castShadow = true; g.add(tower);
    return g;
  });
  // Pit apron: asphalt between the right-hand barrier and the pit building.
  {
    const s0 = n - 130, s1 = 120;
    const pos = [], idx = [];
    let k = 0;
    for (let s = s0; s <= s1; s += 4) {
      const i = track.wrap(s), e = track.width[i] / 2 + track.vergeR[i];
      const a = track.pointAt(s, e + 0.4), b = track.pointAt(s, e + track.skirtR[i] + 14);
      pos.push(a.x, a.y - 0.05, a.z, b.x, a.y - 0.05, b.z);
      if (k) idx.push(k * 2 - 2, k * 2 - 1, k * 2, k * 2 - 1, k * 2 + 1, k * 2);
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a4b50, roughness: 0.9 })); m.receiveShadow = true; group.add(m);
  }

  // ---- observation wheel beside the last chicane
  {
    const g = new THREE.Group();
    const R = 26, white = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5, metalness: 0.3 });
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 6, 48), white));
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.86, 0.2, 6, 48), white));
    const cols = [0xc8102e, 0x2456a6, 0xd9b23a, 0x3d8a4e, 0xe07a1f, 0x7a3fa0];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, R, 4), white); spoke.position.set((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, 0); spoke.rotation.z = a - Math.PI / 2; wheel.add(spoke);
      const pod = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: cols[k % cols.length], roughness: 0.5 })); pod.position.set(Math.cos(a) * R, Math.sin(a) * R - 1.6, 0); wheel.add(pod);
    }
    wheel.position.y = R + 5; g.add(wheel);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, R + 7, 6), white); leg.position.set(sx * 7, (R + 5) / 2, sz * 3); leg.rotation.z = -sx * 0.23; g.add(leg); }
    const f = place(g, n - 300, -150);
    g.position.y = terrainHeight(f.pos.x, f.pos.z);
    g.rotation.y += 0.5;
    footprints.push({ x: f.pos.x, z: f.pos.z, r: 34 });
    g.userData.spin = wheel;
    group.userData.wheel = wheel;
  }

  // ---- braking distance boards before the heavy stops
  if (line) {
    const post = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.8 });
    const boards = { 150: TX.boardTexture('150'), 100: TX.boardTexture('100'), 50: TX.boardTexture('50') };
    const v = line.speed;
    for (let i = 0; i < n; i++) {
      // A local minimum of the speed profile that is well below the speed 200 m earlier.
      const a = v[track.wrap(i - 1)], b = v[i], c = v[track.wrap(i + 1)];
      if (!(b <= a && b < c)) continue;
      const before = v[track.wrap(i - Math.round(200 / track.ds))];
      if (before - b < 14) continue;
      // Turn-in: walk back from the apex to where the line is still nearly straight.
      let t = i;
      for (let k = 0; k < 150; k++) { t = track.wrap(i - k); if (Math.abs(line.curv[t]) < 0.0035) break; }
      const outside = line.curv[i] > 0 ? -1 : 1; // boards on the outside of the bend
      for (const dist of [150, 100, 50]) {
        const s = t - dist / track.ds, j = track.wrap(Math.round(s));
        const d = outside * (track.width[j] / 2 + Math.min(outside < 0 ? track.vergeL[j] : track.vergeR[j], 3.2) - 0.4);
        const g = new THREE.Group();
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshStandardMaterial({ map: boards[dist], roughness: 0.7, side: THREE.DoubleSide }));
        face.position.y = 1.5; face.rotation.y = Math.PI; g.add(face);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), post); leg.position.y = 0.5; g.add(leg);
        place(g, s, d);
      }
      i += 60;
    }
  }
}
