# Models

Everything the city is built from is a **GLB** from one of five
[Kenney](https://kenney.nl) kits, vendored whole in the folders beside this
file. They are all **CC0 1.0** (public domain) and each folder keeps the
`LICENSE.txt` it shipped with. [`docs/CITY.md`](../../docs/CITY.md) is the full
story of how they are loaded, merged and recoloured.

## The people, and the one exception

The people are not models. Every person in Da World — all thirty-two citizens,
and the player when they choose to be one — is built in code by
`src/city/character.ts`: rounded boxes for the body, a canvas-drawn face, one
accessory from a small wardrobe, and a walk cycle that hinges the hips and
shoulders. It costs no download, has no loading state and no failure mode, and
it puts the player in the same city as the citizens instead of visiting it.

The exception is **`character.glb`**: Quaternius' *RobotExpressive*, via the
three.js examples, which the player can choose to be instead (Menu → Your
character). It is a real skeleton with real clips — idle, walk, run, jump and a
wave when you stand still long enough — loaded by `src/game/characterModel.ts`.

It was the only body once, and that was the problem rather than the robot: it
stood half a metre over everybody, shaded like plastic beside a matte city, and
you waited for it before you could move. As a *choice* it is none of those. It
is scaled from its own bounding box to the same `PERSON_HEIGHT` as the crowd,
its PBR materials are rebuilt with the city's ramps so it shades like the
pavement it stands on, it is fetched only when somebody picks it, and the
procedural person keeps walking until it lands — so a slow network costs a few
seconds of looking ordinary rather than a game that will not start.

To change how people look, edit `src/city/character.ts`:

- `PERSON_HEIGHT` is how tall everybody stands, in world units. It is the
  number that decides whether the city reads as a city or as a model village —
  a shop door is a shade under two units.
- `geo` holds every part of the body; the rig is assembled in the constructor.
- `addOutfit` is the wardrobe. Adding a case there and a name to `Outfit` in
  `src/city/npcData.ts` gives the citizens something new to wear.
- `update` is the walk cycle: hips, shoulders, torso bob and the forward lean
  that makes a walk read as a walk rather than a slide.

The player's own colours are the `EXPLORER` constant in `src/game/player.ts`.
