# Credits and licences

Project by **evilgouki**.

## Data

| What | Source | Licence | Files |
|---|---|---|---|
| Circuit centreline, widths, corner numbers | © OpenStreetMap contributors, https://www.openstreetmap.org/copyright | ODbL 1.0 | `tools/raw/osm-raceways.json`, `src/data/suzuka.json` |
| Elevation | Geospatial Information Authority of Japan, GSI tiles (DEM5A), https://maps.gsi.go.jp/development/ichiran.html | GSI content terms (credit required) | `src/data/suzuka.json`, `public/data/suzuka-terrain.bin` |

`src/data/suzuka.json` is a database derived from OpenStreetMap, so it is
shared under the ODbL as well.

## Sound

| What | Author | Source | Licence | Files |
|---|---|---|---|---|
| Engine loops, 1000-8000 rpm | CryHam | Stunt Rally 3, https://github.com/stuntrally/stuntrally3 (`data/sounds/engines/su-mid-*.wav`) | CC BY 4.0 | `public/audio/engine/` |
| Tyre squeal loop | audible-edge (Tom Haigh), submitted by qubodup | https://opengameart.org/content/car-tire-squeal-skid-loop | CC BY 3.0 | `public/audio/fx/tire-squeal.wav` |

The engine loops are unmodified. They were rendered by their author in an
engine simulator; they are not recordings of a Civic Type R.

Turbo, wind, road, kerb and impact sounds are generated in code.

## Code and libraries

- three.js, MIT licence, https://threejs.org
- Vite, MIT licence, https://vite.dev

## Models and textures

The car, cockpit, circuit scenery and all textures are generated in code by
this project. No third-party models or images are included.

## Trademarks

Honda, Civic and Type R are trademarks of Honda Motor Co., Ltd. Suzuka Circuit
is a trademark of its owner. This is an unofficial fan project with no
affiliation or endorsement.
