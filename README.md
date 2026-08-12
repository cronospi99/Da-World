# Da World

A whole 3D city you walk around in third person. Ninety-one named places on nine
streets, traffic that stops at red lights, people on the pavement and a sun that
goes down — and every shop, park and landmark tells you what it is and which
street it is on, in English, out loud.

**Live:** https://cronospi99.github.io/Da-World/

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve the built output on :4173
npm run smoke    # boots the build in headless Chromium and screenshots it
```

## Controls

| | |
| --- | --- |
| Move | `W A S D` / arrow keys, or the left half of a touch screen |
| Sprint | `Shift` |
| Jump | `Space`, or a quick tap on the right half |
| Look | Click once to take the mouse, then move it. `Esc` gives it back |
| Zoom | Scroll, or pinch |
| Look at a place | Walk to its door and press `E` |
| Re-centre the camera | `R` |

## Where the city came from

The island this game started on has been replaced by the world from
[City Explorer](https://github.com/cronospi99/CityExplorer): its street grid, its
ninety-one places, its buildings, road markings, painted street names, parks,
traffic and day/night cycle, all built from CC0 [Kenney](https://kenney.nl) GLB
kits (see `docs/CITY.md`). Those modules live under `src/city/` and are a
straight port — the rule they obey is that the world is the source of truth and
everything else is derived from it, so a place's street, its door and the
sentence you hear all come from the same table.

What is left of the original island is the part worth keeping, and it is what
turns a city model into a game you can walk around:

- **`core/engine.ts`** — renderer, loop, and the composer the grade hangs off.
- **`core/post.ts`** — the colour grade. The reference ships a baked LUT; this
  reproduces the same moves analytically (violet lift, cream gain, a small
  S-curve, a `#FFF9EE` wash). It now takes a `night` factor and slides between a
  warm daytime set and a cool nocturnal one, because one fixed grade cannot
  serve both noon and midnight.
- **`world/environment.ts`** — the sky dome with its drifting cloud sheet and
  the bright haze band on the skyline, now driven hour by hour off the city's
  clock, plus a pre-filtered environment map so every surface picks up sky from
  above and ground bounce from below.
- **`game/physics.ts`** — the reference world's `collisionPhysics`, constants
  and all, retargeted from a heightfield island to a flat city with walls.
- **`game/characterModel.ts`** — the rigged GLB, its clips driven from the
  physics state and time-scaled by ground speed so the feet do not skate.

## How walking around a city differs from walking around an island

Three things had to change, and they are the interesting part of this port.

**The floor is flat and the walls are everywhere.** The island was a
heightfield: one analytic function gave you the floor, and the only wall was the
shoreline. `src/city/ground.ts` answers the same two questions for a city —
ground height (road, or a kerb's worth of pavement, blended across the tile edge
so stepping off a kerb is not a stumble) and *may I move from here to there*,
resolved per axis against ninety-one footprints in a coarse grid, so walking
into a shopfront at an angle carries you along it instead of stopping you dead.

**The mouse is the camera.** The island's camera drifted, sat far back and eased
around behind you on its own. At street level that is disorienting: with the
pointer locked, aiming is absolute and the rig never swings by itself. Drag and
touch keep the old auto-follow, because there is no other way to steer with a
thumb.

**The wall wins.** `game/cameraRig.ts` traces the boom against the building
boxes every frame and shortens it, and when shortening is not enough — stand
with your back to a shop and there is no distance behind you that is not inside
it — it searches a small ladder of (distance, pitch) pairs for a shot in open
air, preferring to stay far, then to stay level. The last rung is a tight
look-down over the character's shoulder, which always exists. Being inside a
wall for even one frame shows the player the inside of a building, and that is
the one thing not to allow.

## Finding places

There are no markers floating over the city. The shops have their names painted
on them, so walking up to a door *is* the interaction: stand in front of one and
press `E`, and a card tells you what the place is and which street it is on, and
reads the sentence aloud with your device voice. All 94 places (91 buildings and
3 parks) are worth finding, and the count is saved in your browser.

Pronunciation uses the browser's built-in speech synthesis. There are no audio
files.

## Licence

The 3D models under `public/models/` are by [Kenney](https://kenney.nl) and
[Quaternius](https://www.patreon.com/quaternius) (the character, via the three.js
examples) and are **CC0 1.0** — public domain, attribution not required, though
both deserve it. Each kit folder keeps the `LICENSE.txt` it shipped with.
