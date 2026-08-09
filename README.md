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
  core/        engine (renderer + loop), input, noise/PRNG helpers
  world/       terrain + roads, sky/water/light, prop builders, scenery scatter
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
