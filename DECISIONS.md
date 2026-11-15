# Decisions log

What was decided while building the first milestone, and why. Newest decisions
are at the bottom of each section. Written for the project owner (evilgouki),
who asked for the reasoning behind choices made while they were away.

## What the owner chose (2026-11-13)

| Area | Choice |
|---|---|
| Platform | Browser, Three.js |
| Controls | Gamepad and keyboard |
| Cars | FK8 and FL5; FL5 first |
| Physics | Tyres, weight transfer, limited-slip differential, turbo |
| Tracks | Real circuits, starting with Suzuka |
| Modes | Time trial with ghost, AI races, career |
| Cameras | Cockpit with gauges, chase, bonnet or bumper |
| Assets | Freely licensed, sourced by the assistant; owner offered photos of their own FL5 interior |
| Sound | Freely licensed recordings |
| Tuning | Setup tuning, no parts upgrades |
| Release | Public and free |
| First milestone | FL5, one track, timed lap with ghost |

## Decisions made during the build

### 1. Vite + plain JavaScript modules, no game engine
**Why:** the owner chose the browser. Vite gives a one-command dev server and a
static `dist/` folder that can be hosted anywhere for a free public release.
Plain modules keep the physics runnable in Node for automated tests.

### 2. The circuit is built from real survey data, not drawn by hand
- Centreline, widths and corner numbers: OpenStreetMap (ODbL licence).
- Elevation: Geospatial Information Authority of Japan 5 m lidar tiles.

**Why:** "real circuits" was the brief, and both sources allow public reuse with
credit. The result is 5,799 m long against the official 5,807 m, with 40.6 m of
elevation change against the published 40.4 m and a steepest gradient of 7.9%.

**Details worth knowing:**
- The lidar shows service tunnels under the track as pits. Four were detected
  and bridged automatically (`tools/build-track.mjs`).
- The figure-eight crossover is modelled on two levels with 6.2 m clearance.
- Kerbs, gravel traps, grass run-off and barrier positions are placed by rule
  from corner geometry. They are plausible, not surveyed.
- The pit lane is not drivable yet. Trackside buildings are approximate.

### 3. Custom physics instead of an off-the-shelf engine
A six-degree-of-freedom rigid body on four sprung wheels at 500 Hz, with a
combined-slip tyre model, turbo lag, clutch, six-speed gearbox and a
torque-biasing limited-slip differential.

**Why:** general physics engines do not give control over the tyre model, and
the tyre model is what makes a driving simulator feel right. Wheel and engine
speeds are solved implicitly each step so the car is stable at a standstill.

### 4. The car is checked against published FL5 figures, automatically
`npm test` runs the physics with no graphics and compares it with road tests.

| Check | Simulated | Real car |
|---|---|---|
| 0-100 km/h | 5.8 s | 5.3-5.9 s |
| Quarter mile | 14.1 s at 175 km/h | 13.6-14.1 s at 166-172 km/h |
| Top speed | 275 km/h | 275 km/h claimed |
| 100-0 km/h | 33.9 m | 32-35 m |
| Skidpad | 1.03 g | 1.02-1.06 g |

**Why:** the assistant cannot feel a gamepad, so numbers stand in for feel.
Trap speed is slightly high, which suggests mid-range power is a little generous.

### 5. Driver aids are on by default and can be switched off
Anti-lock brakes, traction control, automatic gearbox with automatic clutch,
launch assist and speed-sensitive steering.

**Why:** the real car has no automatic gearbox, but a 320 hp front-driver is hard
to manage on a keyboard. Manual sequential shifting is one key away (M).

### 6. A driving line and an autopilot were added beyond the brief
The racing line is the least-curvature path inside the track limits, with a
speed profile from grip limits. It draws the coloured braking line (L to toggle)
and drives the car behind the menu.

**Why:** the autopilot was needed to test a full lap without a human. The same
code is the starting point for the AI opponents the owner asked for later.

### 7. The car body and cockpit are built in code, as stand-ins
**Why:** a research pass found no FL5 or FK8 model with a licence that could be
trusted. Every "free" FL5 on Sketchfab that was inspected looked like a rip from
a commercial game or a re-upload of someone else's work. Shipping one in a
public release risks a takedown. The owner's own interior photos are the clean
route to a faithful cockpit; see `reference/interior/README.md`.

### 8. Engine sound uses simulator-rendered loops, not real recordings yet
Eight steady-speed loops (1000 to 8000 rpm) by CryHam, CC BY 4.0, from the
Stunt Rally 3 project, cross-faded by revs. Their pitch was verified by spectrum
analysis. Turbo, wind, road and kerb sounds are generated in code.

**Why:** these were the only loops found with a clear licence, a direct
download and the steady-rpm format a game needs. **Caveat:** they come from an
engine simulator modelling a flat-four, so this is not the real K20C1 note.
The owner asked for recordings; real FL5 clips exist on Wikimedia Commons under
CC BY 3.0 but need cutting into loops by ear. Recording the owner's own car at
steady revs would be the best and cleanest source.

### 9. Real names live in one file
`src/config/branding.js` holds the car, circuit and corner names.

**Why:** the release is public. Honda's and the circuit's names are trademarks
and no licence exists. Changing that one file renames everything. Sponsor names
on corners were replaced with traditional or neutral names. The menu carries an
"unofficial fan project" notice.

### 10. Speed units follow the browser language
mph for US and UK English, km/h otherwise. U switches in play.

### 11. Dev server on port 5183
**Why:** port 5173, Vite's default, was already used by another of the owner's
projects, which was left running.

### 12. Laps only count if the car stays on the track
All four wheels beyond the kerbs, or using "back to track" (R), voids the lap.
**Why:** otherwise the best lap and ghost can be set by cutting corners.

### 13. Nothing was committed to git
**Why:** the owner did not ask for a repository. A `.gitignore` is in place.

### 14. The game is published on GitHub Pages
Every push to `main` runs the physics checks, builds the site and deploys it.
**Why:** the owner asked to playtest on the web. A failed check blocks a release.

### 15. Touch controls for phones (2026-11-14)
A steering pad on the left, brake and gas pedals on the right, and Reset, View
and Pause buttons at the top. Shift buttons appear with the manual gearbox.

**Why these choices:**
- **A pad, not tilt steering.** Tilt needs a permission prompt on iPhones and
  fights the screen rotation. A thumb pad works everywhere.
- **Analogue, not on/off.** The pad reads how far the thumb is from centre and
  the pedals read how high they are pressed, so the car can be driven smoothly.
- **The HUD moves and shrinks** so the map and speed readout are not under the
  thumbs.
- **Phones in portrait are asked to turn sideways** and the game pauses until
  they do. Where the browser allows it, starting a session goes full screen.
- **Phones default to medium graphics** to keep the frame rate up.
- There is no handbrake or look-around on touch; neither is needed for a lap.

## Known gaps in this milestone

- Visuals are clean but simple. They are far from Forza or Gran Turismo.
- Handling has not been driven by a person on a gamepad yet. Expect tuning.
- The autopilot laps in about 2:39 to 2:44. The real production-car record is
  2:23.1, set by a professional. A good human lap here should beat the autopilot.
- No FK8, AI opponents, career, setup tuning screen, pit lane, damage or replays.
- Gamepad support was written to the standard mapping but not tested on hardware.
- Touch controls were tested with emulated touch only, not on a real phone.
