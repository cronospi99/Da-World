# Models

Everything the city is built from is a **GLB** from one of five
[Kenney](https://kenney.nl) kits, vendored whole in the folders beside this
file. They are all **CC0 1.0** (public domain) and each folder keeps the
`LICENSE.txt` it shipped with. [`docs/CITY.md`](../../docs/CITY.md) is the full
story of how they are loaded, merged and recoloured.

## There is no character model

The people are not models. Every person in Da World — the player and all
thirty-two citizens — is built in code by `src/city/character.ts`: rounded
boxes for the body, a canvas-drawn face, one accessory from a small wardrobe,
and a walk cycle that hinges the hips and shoulders.

This used to be a rigged GLB (Quaternius' *RobotExpressive*, via the three.js
examples) for the player only, which meant the one character you looked at
every second of the game was a robot half a metre taller than the people it was
walking past, shaded differently from all of them, and unavailable until several
megabytes had downloaded. Building the player out of the same rig as everybody
else costs no download, has no loading state and no failure mode, and puts the
player in the same city as the citizens instead of visiting it.

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
