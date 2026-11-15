// Downloads the raw geodata the track builder needs and caches it in tools/raw/.
//   - Circuit centreline: OpenStreetMap (ODbL) via the Overpass API.
//   - Elevation: Geospatial Information Authority of Japan (GSI) DEM tiles.
// Uses the system `curl` (Node's built-in fetch times out on some networks).
// Run: node tools/fetch-track.mjs
import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = join(dirname(fileURLToPath(import.meta.url)), 'raw');
const BBOX = { s: 34.835, w: 136.515, n: 34.853, e: 136.548 };
const UA = 'track-data-tool/0.1';
const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curl(args) {
  return execFileSync('curl', ['-s', '--max-time', '120', '-A', UA, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

async function fetchOsm() {
  const out = join(RAW, 'osm-raceways.json');
  const q = `[out:json][timeout:60];way["highway"="raceway"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});out tags geom;`;
  const text = curl(['-H', 'Accept: application/json', '--data-urlencode', 'data=' + q, 'https://overpass-api.de/api/interpreter']);
  const n = JSON.parse(text).elements.length;
  await writeFile(out, text);
  console.log('osm:', n, 'ways');
}

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function fetchDem() {
  const z = 15;
  const x0 = Math.floor(lon2x(BBOX.w, z)), x1 = Math.floor(lon2x(BBOX.e, z));
  const y0 = Math.floor(lat2y(BBOX.n, z)), y1 = Math.floor(lat2y(BBOX.s, z));
  await mkdir(join(RAW, 'dem'), { recursive: true });
  const index = { z, x0, x1, y0, y1, tiles: {} };
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const file = join(RAW, 'dem', `${z}-${x}-${y}.txt`);
      let layer = null;
      if (!(await exists(file))) {
        for (const l of ['dem5a', 'dem5b', 'dem5c']) {
          const code = curl(['-o', file, '-w', '%{http_code}', `https://cyberjapandata.gsi.go.jp/xyz/${l}/${z}/${x}/${y}.txt`]);
          if (code.trim() === '200') { layer = l; break; }
          await sleep(300);
        }
        await sleep(300);
      } else layer = 'cached';
      index.tiles[`${x}-${y}`] = layer;
      console.log('dem', x, y, layer);
    }
  }
  await writeFile(join(RAW, 'dem', 'index.json'), JSON.stringify(index, null, 1));
}

await mkdir(RAW, { recursive: true });
await fetchOsm();
await fetchDem();
