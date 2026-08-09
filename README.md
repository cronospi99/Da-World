# Da World

An explorable little 3D world where every place teaches you English. You walk
around an island, wander into a harbour or a market, touch the things you see,
and collect the English word for each one — with pronunciation, a translation,
an example sentence, and a quick quiz once you have seen everything in a place.

Inspired by the feel of *Summer Afternoon*-style WebGL worlds: warm colours,
soft low-poly shapes, paper cards that pop up when you interact.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve the built output
```

There are **no binary assets**. The terrain, the props and the character are all
generated from primitives at load time, so the whole game is the JS bundle.
Pronunciation uses the browser's built-in speech synthesis.

## How the look works

The art direction is reverse-engineered from the reference bundle rather than
guessed at. Four things do almost all of the work, and they are worth
understanding before changing any of them:

**1. Ramp shading, not PBR** (`src/world/materials.ts`). No surface in the game
is lit physically. Each one looks up a hand-authored gradient with
`dot(N, L)` remapped to `0..1`, so shadow is a different *hue* — cool violet,
deep teal for foliage — rather than a darker version of the lit colour. This is
exactly what the reference does with its `ramps.png` atlas. `MeshToonMaterial`
already samples a gradient this way, but stock three.js keeps only the red
channel; a two-line patch to `getGradientIrradiance` gives full RGB ramps and
lets each material pick its own row. Rows live in `RAMP_STOPS` — edit those and
the entire world changes mood at once.

**2. The grade** (`src/core/post.ts`). The reference ships a baked 3D LUT and
applies it fullscreen; that single pass is what turns an ordinary render into a
warm afternoon. We reproduce the same moves analytically: violet lift in the
shadows, cream gain in the highlights, a small S-curve, and the same `#FFF9EE`
overlay wash. **Everything upstream stays honest** — the sky really is blue
(`#248fd5`), the grass really is green. Do not pre-warm the source colours;
that is the grade's job, and doing it twice is what turns the ground to mud.

**3. Haze** (`src/world/environment.ts`). A short far plane (190) with fog in
the horizon colour, plus a bright band sitting exactly on the skyline. Distance
is meant to dissolve, not stay legible.

**4. Motion everywhere.** Wind sway and drifting cloud shadows are injected into
every material; grass bends away from you as you walk through it; the camera
has a slow hand-held drift; birds circle overhead.

A note on exposure: because ramp shading multiplies rather than replaces, total
light above `1.0` clips toward white and desaturates everything to beige. If
the world starts looking washed out, the fix is almost always to lower the sun
intensity or `toneMappingExposure`, not to add more saturation in the grade.

## Controls

| Action  | Desktop                    | Touch                      |
| ------- | -------------------------- | -------------------------- |
| Move    | `W A S D` / arrow keys     | left half of the screen    |
| Look    | drag                       | drag on the right half     |
| Zoom    | scroll wheel               | pinch                      |
| Learn   | `E` (or click the marker)  | tap the marker             |
| Close   | `Esc`                      | tap the ✕ or the backdrop  |

## Adding your own places and words

Everything the player sees and learns lives in **`src/content/places.ts`**.
The engine reads that array — you should not need to touch anything else to add
a location or a word.

```ts
{
  id: "airport",                 // save key; renaming resets its progress
  name: "The Airport",
  nameEs: "El Aeropuerto",
  intro: "Announcements everywhere. Listen carefully.",
  center: [0, -70],              // where it sits on the terrain
  radius: 22,                    // terrain is flattened inside this
  palette: { ground: "#c9c3b0", accent: "#6d8fa8", prop: "#4d6376" },
  spots: [
    {
      id: "airport.gate",
      offset: [4, -6],           // relative to `center`
      prop: "sign",              // one of the PropKind values
      vocab: {
        en: "the gate",
        es: "la puerta de embarque",
        sentence: "Your flight leaves from gate twelve.",
        sentenceEs: "Tu vuelo sale de la puerta doce.",
        wordClass: "noun",
        level: "A2",
        emoji: "🛫",
      },
    },
  ],
}
```

Guidelines that keep the world tidy:

- Keep `offset` within roughly `0.8 * radius` so props stay on flat ground.
- Keep places at least `radiusA + radiusB + 10` apart so their plateaus do not
  fight each other. Roads are drawn automatically from the **first** place in
  the array to every other one, so the first entry is the hub.
- `id`s are the save keys in `localStorage`. Renaming one resets that word.

### Available props

`tree`, `palm`, `rock`, `crate`, `barrel`, `boat`, `lamp`, `bench`, `sign`,
`tent`, `well`, `stall`, `house`, `flag`, `campfire`, `clock`.

To add a new one, write a builder in `src/world/props.ts` (a function returning
a `THREE.Group` whose origin sits on the ground) and give it a marker height in
`src/game/placesBuilder.ts`. Children named `cloth`, `flame` or `hands` get
free idle animation.

## Layout

```
src/
  core/        engine (renderer + loop), post-processing grade, input, noise
  world/       ramp materials, terrain + roads, sky/sea/light, props,
               scenery scatter, birds
  game/        player controller, camera rig, content → scene instantiation
  learn/       progress (localStorage), speech synthesis
  ui/          markers, lesson card, quiz, HUD — plain DOM, no framework
  content/     places.ts + types.ts  ← the game is authored here
```

A few things worth knowing:

- `world/terrain.ts` exports `heightAt(x, z)`, and it is the single source of
  truth. The mesh, the player, the props and the camera all read from it, so
  nothing ever floats or sinks.
- Markers are DOM elements projected from 3D anchors each frame, not sprites —
  the text stays crisp and screen readers can reach it.
- `window.__world` is exposed for authoring: `__world.goTo("market")` teleports,
  `__world.progress.reset()` clears saved words.

## Ideas this is built to absorb

The scaffolding deliberately leaves room for the obvious next steps: NPCs with
dialogue trees, listening exercises ("walk to the thing I say"), spaced
repetition on top of `Progress`, per-place grammar drills, and a day/night cycle
driving vocabulary about time. None of those need engine changes beyond a new
module plus content.
