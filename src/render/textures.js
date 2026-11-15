// Procedural textures drawn to canvases at start-up, so the game ships with
// no image files of uncertain origin.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Small deterministic RNG so the textures look the same every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function finish(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  return t;
}

function speckle(g, w, h, r, count, colors, sizeMin, sizeMax) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(r() * colors.length) | 0];
    const s = sizeMin + r() * (sizeMax - sizeMin);
    g.fillRect(r() * w, r() * h, s, s);
  }
}

/** Asphalt across the full track width, with painted edge lines. u runs across, v along. */
export function asphaltTexture() {
  const [c, g] = canvas(1024, 1024), r = rng(7);
  g.fillStyle = '#3b3c40'; g.fillRect(0, 0, 1024, 1024);
  speckle(g, 1024, 1024, r, 90000, ['#2e2f33', '#46474c', '#35363a', '#505157', '#2a2b2e'], 1, 3);
  // The rubbered-in band where cars run is darker and smoother.
  const band = g.createLinearGradient(0, 0, 1024, 0);
  band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.3, 'rgba(0,0,0,0.16)');
  band.addColorStop(0.5, 'rgba(0,0,0,0.26)'); band.addColorStop(0.7, 'rgba(0,0,0,0.16)'); band.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = band; g.fillRect(0, 0, 1024, 1024);
  // Long faint streaks and patches of resurfacing.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.04})`;
    g.fillRect(r() * 1024, 0, 4 + r() * 30, 1024);
  }
  // Edge lines.
  g.fillStyle = '#e9e9e4';
  g.fillRect(10, 0, 14, 1024); g.fillRect(1024 - 24, 0, 14, 1024);
  speckle(g, 1024, 1024, r, 2500, ['rgba(60,60,60,0.5)'], 1, 3);
  return finish(c, { aniso: 16 });
}

export function grassTexture() {
  const [c, g] = canvas(512, 512), r = rng(21);
  g.fillStyle = '#4c7a34'; g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, r, 50000, ['#42702c', '#568638', '#3b6627', '#5f9040', '#4a7631', '#6a9a48'], 1, 4);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '20,40,10' : '150,170,80'},0.06)`; g.beginPath(); g.arc(r() * 512, r() * 512, 20 + r() * 60, 0, 7); g.fill(); }
  return finish(c);
}

export function gravelTexture() {
  const [c, g] = canvas(512, 512), r = rng(33);
  g.fillStyle = '#b3a384'; g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, r, 60000, ['#a39274', '#c2b395', '#94846a', '#cdbfa3', '#857660', '#b9aa8c'], 1, 4);
  return finish(c);
}

/** Barrier: concrete with a painted band. u along, v up. */
export function wallTexture() {
  const [c, g] = canvas(512, 128), r = rng(5);
  g.fillStyle = '#b9bcc0'; g.fillRect(0, 0, 512, 128);
  speckle(g, 512, 128, r, 9000, ['#a9acb0', '#c6c9cc', '#9fa2a6'], 1, 3);
  g.fillStyle = '#c8102e'; g.fillRect(0, 22, 256, 26);
  g.fillStyle = '#f2f2f2'; g.fillRect(256, 22, 256, 26);
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < 512; x += 128) g.fillRect(x, 0, 2, 128);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 118, 512, 10);
  return finish(c);
}

export function concreteTexture() {
  const [c, g] = canvas(256, 256), r = rng(9);
  g.fillStyle = '#8f9296'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, r, 12000, ['#85888c', '#999ca0', '#7c7f83', '#a3a6aa'], 1, 3);
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256);
  return finish(c);
}

export function checkerTexture() {
  const [c, g] = canvas(256, 64);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 32, y * 32, 32, 32); }
  return finish(c, { repeat: true });
}

/** Grandstand face: rows of seats in blocks of colour. */
export function standTexture() {
  const [c, g] = canvas(512, 256), r = rng(77);
  g.fillStyle = '#5a5f66'; g.fillRect(0, 0, 512, 256);
  const cols = ['#c8102e', '#e8e8e8', '#2456a6', '#d9b23a', '#3d8a4e', '#888'];
  for (let y = 6; y < 250; y += 6) for (let x = 2; x < 510; x += 5) { g.fillStyle = cols[(r() * cols.length) | 0]; if (r() < 0.82) g.fillRect(x, y, 3, 3); }
  g.fillStyle = 'rgba(0,0,0,0.35)'; for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 3, 256);
  return finish(c);
}

/** Building face with rows of windows. */
export function buildingTexture() {
  const [c, g] = canvas(256, 128), r = rng(3);
  g.fillStyle = '#d9dadc'; g.fillRect(0, 0, 256, 128);
  for (let y = 14; y < 120; y += 38) for (let x = 6; x < 250; x += 20) { g.fillStyle = r() < 0.2 ? '#f0e6b0' : '#27323c'; g.fillRect(x, y, 15, 22); }
  g.fillStyle = '#8b1a1a'; g.fillRect(0, 0, 256, 6);
  return finish(c);
}

/** Distance board showing a number. */
export function boardTexture(text) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#f5f5f5'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111'; g.font = 'bold 64px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  return finish(c, { repeat: false });
}

/** Soft round blob used as a fake contact shadow. */
export function blobTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return finish(c, { repeat: false, srgb: true });
}

/** Tyre sidewall/tread normal-ish detail as a simple bump map. */
export function treadTexture() {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#303030';
  for (let x = 0; x < 256; x += 16) { g.fillRect(x, 8, 5, 20); g.fillRect(x + 8, 36, 5, 20); }
  g.fillRect(0, 30, 256, 3); g.fillRect(0, 4, 256, 2); g.fillRect(0, 58, 256, 2);
  return finish(c, { srgb: false });
}
