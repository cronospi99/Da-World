# Da World

A whole 3D city you walk around in third person, helping the people who live in
it. Ninety-one named places on nine streets, traffic that stops at red lights,
a sun that goes down — and thirty-two citizens standing on the pavement with a
❓ over their head, each one wanting something you can only give them by
knowing where you are: directions to somewhere across town, the name of the
shop next to the bakery, the word that finishes a sentence.

**Live:** https://cronospi99.github.io/Da-World/

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve the built output on :4173
npm run smoke    # boots the build in headless Chromium and screenshots it
```

Class mode needs a server; the rest of the game does not. See
[`server/README.md`](server/README.md).

## Modes

| | |
| --- | --- |
| **Vocabulary** | There is / there are, some / any / no, much / many / a lot of, prepositions of place, and the words for a city |
| **Directions** | Go straight on, turn left, count the blocks, name the street |
| **Class** | Up to twelve students and one teacher in the same city |

A mode is not a different city. It is the same ninety-one places and the same
thirty-two citizens asking a different kind of question, so a class working on
prepositions and a class working on directions walk the same streets and read
the same signs. Switching keeps your progress.

The **teacher panel** (👩‍🏫 on the menu) sets the mission the whole room is
working towards, shows first-try accuracy per language point, and exports it as
CSV. Its passphrase is a classroom lock rather than security — the real one
lives on the class server, which never sends it to a student's browser.

## Controls

| | |
| --- | --- |
| Move | `W A S D` / arrow keys, or the left half of a touch screen |
| Sprint | `Shift` |
| Jump | `Space`, or a quick tap on the right half |
| Look | Click once to take the mouse, then move it. `Esc` gives it back |
| Zoom | Scroll, or pinch |
| Talk to somebody | Walk up to them and press `E` |
| Missions | `M` |
| Re-centre the camera | `R` |

On a phone the controls are drawn on the screen: a stick that appears under
your left thumb wherever you put it, a 💬 button that lights up when somebody
is in range, and a jump button. Aiming is a drag anywhere else. Held upright,
the HUD stacks and the cards become sheets you can reach.

You may only walk on the pavements, the crossings and the parks. That is a
language rule before it is a road-safety one: if you could cut diagonally across
a block, "go straight for two blocks and turn left" would stop being the only
way to get anywhere, and the directions a citizen gives you would stop meaning
anything.

## The game

Thirty-two citizens, each with one question generated from the city itself:

- **Directions.** A lost tourist wants to get to the aquarium. The route is a
  breadth-first search over the real junctions, read out as "go straight on Oak
  Street for two blocks, turn left onto Palm Avenue, the aquarium is on your
  right, next to Zipa Supermarket". The three wrong answers are the true one
  with exactly one thing flipped — a turn mirrored, a block miscounted, the
  final side swapped — so a wrong answer is always plausible and always says
  something about what you misread.
- **Prepositions of place.** Where is the bakery? The answer comes from its real
  neighbours: *between* two shops, *opposite* another, *on the corner of* two
  streets.
- **Grammar.** Thirty-nine items across seven language points, every sentence
  about a street, a shop or a park that really exists, so if you are unsure you
  can walk there and look. Grammar citizens never run out: answer one and they
  deal the next from the bank.

A wrong answer never ends the turn — the option locks, the explanation appears,
and you try again. **Walk and look** puts the card down as a pill so you can go
and read the shop signs and come back to the *same* question, which is the whole
point: the answer is out there in the city, not in the card.

Fifteen missions run down the left of the screen, one at a time, from "walk past
25 places" through "guide 5 lost citizens" to mastering each language point.
Correct answers are the only source of XP, XP is the only source of levels, and
everything is saved in your browser.

## Where the city came from

The island this game started on has been replaced by the world from
[City Explorer](https://github.com/cronospi99/CityExplorer): its street grid, its
ninety-one places, its buildings, road markings, painted street names, parks,
traffic and day/night cycle, all built from CC0 [Kenney](https://kenney.nl) GLB
kits (see `docs/CITY.md`). Those modules live under `src/city/` and are a
straight port, and so is the teaching layer in `src/game/` — the quest
generator, the grammar bank, the missions and the save file. The rule they all
obey is that the world is the source of truth and everything else is derived
from it, so a place's street, its door, the route to it and the sentence a
citizen says about it all come from the same table.

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
  physics state and time-scaled by ground speed so the feet do not skate. It
  stands 1.2 units tall, which is the number that decides whether the city
  reads as a city: a tile is about a metre and a half and a shop door is a
  shade under two, so a character any taller starts ducking under doorways and
  the whole street turns into a model village.

## How walking around a city differs from walking around an island

Three things had to change, and they are the interesting part of this port.

**The floor is flat and the walls are everywhere.** The island was a
heightfield: one analytic function gave you the floor, and the only wall was the
shoreline. `src/city/ground.ts` answers three questions for a city — ground
height (road, or a kerb's worth of pavement, blended across the tile edge so
stepping off a kerb is not a stumble), *may a pedestrian stand here* (pavement,
crossing or park, and nothing else) and *may I move from here to there*,
resolved per axis so walking into a shopfront at an angle carries you along it
instead of stopping you dead.

**The mouse is the camera.** The island's camera drifted, sat far back and eased
around behind you on its own. At street level that is disorienting: with the
pointer locked, aiming is absolute and the rig never swings by itself. Drag and
touch keep the old auto-follow, because there is no other way to steer with a
thumb.

**The wall wins.** `game/cameraRig.ts` traces the boom against the building
boxes every frame and shortens it. Being inside a wall for even one frame shows
the player the inside of a building, and that is the one thing not to allow —
but a pavement is one tile wide, so the rules that get there are all about
having somewhere else to go: the shoulder offset swaps sides rather than push
the boom's own origin into a shopfront, the escape ladder only climbs a little
(a ladder that answered a wall with "look straight down at their head" spent
the whole game up there), and when nothing is clear the camera comes in close
instead. Tree canopies are obstacles too, but only for where the lens comes to
*rest*: a branch crossing the shot is what a camera under a tree looks like,
while a lens inside a crown is a screen full of green.

## Reading the city

There are no name plates floating over the buildings and there is no minimap.
The shops have their names painted on the fascia and the streets have their
names painted along the kerb, so *reading* is the interaction — and a card that
jumped up with a place's name every time you walked past a door taught nothing
except how to dismiss a card. Walking past a door quietly ticks the place off
the list the missions count, and says nothing.

The one navigation aid is the gold arrow that appears over a building's roof
when you ask a citizen for a hint. It says *over there*; you still have to walk
it.

Pronunciation uses the browser's built-in speech synthesis — every question can
be read aloud with the speaker button. There are no audio files.

## Licence

The 3D models under `public/models/` are by [Kenney](https://kenney.nl) and
[Quaternius](https://www.patreon.com/quaternius) (the character, via the three.js
examples) and are **CC0 1.0** — public domain, attribution not required, though
both deserve it. Each kit folder keeps the `LICENSE.txt` it shipped with.
