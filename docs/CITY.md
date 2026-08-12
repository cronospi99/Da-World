# The city and its 3D assets

The city in this game is the world from
[City Explorer](https://github.com/cronospi99/CityExplorer), ported into
`src/city/`. What follows describes the art it is built from; the port itself is
described in the README.

## The kits

Everything you can walk past is a model from one of five
[Kenney](https://kenney.nl) asset kits, vendored whole under `public/models/`
in **GLB** form.

| Folder | Kit | Version | What it supplies |
| --- | --- | --- | --- |
| `public/models/commercial` | City Kit Commercial | 2.1 | shop blocks, towers, café parasols |
| `public/models/suburban` | City Kit Suburban | 2.0 | houses, trees, fences, planters, paths |
| `public/models/industrial` | City Kit Industrial | 1.0 | halls, sheds, chimneys, tanks |
| `public/models/roads` | City Kit Roads | 2.0 | street lamps, signs, cones, barriers |
| `public/models/cars` | Car Kit | 3.1 | every vehicle on the road |

All five are **CC0 1.0** (public domain): free for personal, educational and
commercial use, with no attribution required — though this project credits
Kenney anyway, because it should. Each folder keeps the kit's own `LICENSE.txt`
exactly as it was shipped.

## How a kit is put together

A kit is a pile of `.glb` files plus a `Textures/` folder holding **one 512²
palette atlas**: a grid of vertical colour ramps that every mesh in the kit
samples with a couple of texels per face. No model carries a texture of its
own, no model carries a second material, and nothing needs a UV unwrap.

That single fact is what the renderer is built on:

- **One material per kit** means ninety buildings merge into one mesh. The city
  is still drawn in a few dozen calls, exactly as the old procedural one was.
- **Swapping the atlas recolours a model.** The kits ship `variation-a.png`,
  `variation-b.png` and sometimes `-c`: the same grid with different hues. Each
  place picks one, so a row of shops is never a row of clones — for the cost of
  one extra draw call per variation, not one per building.
- **The atlas can be re-tinted at boot.** `city/kits.ts` derives a night
  version of each atlas on a canvas: every texel that is glass — the pale blue
  ramps, which no wall, roof or leaf in any kit comes near — becomes warm
  lamplight and everything else goes black. Hung on `emissiveMap`, that one
  texture switches on every window in the city at dusk.

## What is loaded, and what is only vendored

The repository holds **all 228 models** of the five kits (16 MB), so anything can
be reached for without a new download from kenney.nl. The city itself asks for
74 of them — the list is `KIT_REQUESTS` in
[`src/city/kit.ts`](../src/city/kit.ts) — which is about 9 MB, fetched in
parallel behind the loading bar and then cached by the browser.

If that matters for your classroom, the commercial kit also ships
`low-detail-building-*` variants at a fraction of the size, and trimming the
shell pools in `SHELLS` is a one-line change: fewer models means a smaller
download and a more repetitive street, and where to sit on that line is a
judgement about your network, not about the code.

To use a model that is vendored but not loaded, add its name to `KIT_REQUESTS`
and then place it. `npm run smoke` boots the built game and fails on any console
error, so a name with no file behind it is caught before anyone plays it.

## How a model gets onto a plot

`city/buildings.ts` still owns *where* every place is: its band, its slot, its
footprint, the pavement in front of its door. `city/kit.ts` only decides
*what stands there*, and it may not move anything:

1. the kind of shell comes from the data the old procedural city used — floors
   and plot area — with a short table of overrides for places whose name makes
   one kit obviously right (a garden centre belongs in a shed);
2. every model in that kit is scored on how much its own proportions would have
   to bend to fit the plot, and the least-bent one wins;
3. width and depth are then matched **exactly**, because the frontage is
   gameplay. Only the height is allowed to drift, and only within a quarter of
   the model's natural proportion, because a stretched facade is the most
   visible distortion there is.

The one exception in the whole city is the National Stadium, which no kit has
anything like, and which keeps the bespoke procedural shell it always had.

## The ground is not a model

Carriageway, kerbs, paving, lane markings, zebra crossings, stop lines and every
painted street name stay procedural. They are *derived from `layout.ts`* — the
same table that decides where a crossing is walkable and what "two blocks" means
to the route generator in `src/game/quests.ts` — so a tile of drift between the
paint and the grid would put a shop on the wrong street in a direction the game
had just given. The roads kit is used for what stands beside the road instead:
lamps, signs, cones and barriers.

The painted signage is also the *only* signage. There are no name plates
floating over the buildings: a plate written for a camera looking down at the
rooftops is the size of a bus from the pavement, and it covers the shopfront it
is naming. What a place is called is on its fascia and what street it is on is
under your feet, which is where a city puts them.
