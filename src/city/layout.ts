/**
 * City layout — the single source of truth for the street grid.
 *
 * Coordinates are expressed in TILES. The 3D world maps them directly:
 *   world.x = tile.x   world.z = tile.y   world.y = up
 * so one tile is one world unit and every gameplay rule from the original
 * 2D prototype (sidewalk-only walking, crosswalks, block counting for the
 * "give me directions" quests) survives the port unchanged.
 *
 * Roads are ROAD_W tiles wide: two generous traffic lanes plus the margin a
 * real street has. Widening them here is safe — intersections, crossings, lane
 * centres, block bounds, building slots and the minimap are all *derived* from
 * these tables, never hard-coded. The same is true of the grid size: adding a
 * street or an avenue below extends the city and everything follows.
 */

/**
 * Width of every road, in tiles.
 *
 * Six tiles is two generous lanes plus the margin a real street has. It is also
 * what makes a crossing feel like a crossing: at four the zebra was two strides
 * and the traffic was on top of you before you had read the light.
 */
export const ROAD_W = 6;

/**
 * Width of the pavement either side of a road, in tiles.
 *
 * The whole street furniture budget comes out of this number. At one tile the
 * pavement was a corridor with a lamp post planted in the middle of it, and
 * walking down a street meant threading between the kerb and a bin; at three
 * there is a strip to walk on, a strip for the lamps, trees, benches and
 * planters, and room to stand at a shop door without being in anybody's way.
 */
export const SIDEWALK_W = 3;

/** Grid width / height in tiles. */
export const GW = 99;
export const GH = 108;

export interface HRoad {
  /** Tile rows covered by the carriageway, north to south. */
  rows: number[];
  name: string;
  /** Short form painted on the pavement. */
  short: string;
}
export interface VRoad {
  /** Tile columns covered by the carriageway, west to east. */
  cols: number[];
  name: string;
  short: string;
}

const span = (start: number): number[] => Array.from({ length: ROAD_W }, (_, i) => start + i);

/**
 * The streets, north to south and west to east.
 *
 * The spacing is not decoration: a block has to hold a pavement, a row of
 * shops, the back of the row facing the other way and its pavement, so the
 * land between two streets is 13 tiles and the land between two avenues is 15.
 * Widen a pavement or deepen a shop and these are the numbers that have to
 * grow with them — everything else in the city is derived.
 */
export const HROADS: HRoad[] = [
  { rows: span(13), name: 'Main Street', short: 'MAIN ST' },
  { rows: span(32), name: 'Oak Street', short: 'OAK ST' },
  { rows: span(51), name: 'River Road', short: 'RIVER RD' },
  { rows: span(70), name: 'Market Street', short: 'MARKET ST' },
  { rows: span(89), name: 'Sunset Boulevard', short: 'SUNSET BLVD' },
];

export const VROADS: VRoad[] = [
  { cols: span(15), name: '1st Avenue', short: '1ST AVE' },
  { cols: span(36), name: 'Victory Avenue', short: 'VICTORY AVE' },
  { cols: span(57), name: 'Llama Boulevard', short: 'LLAMA BLVD' },
  { cols: span(78), name: 'Palm Avenue', short: 'PALM AVE' },
];

export const hRowSet = new Set<number>(HROADS.flatMap((r) => r.rows));
export const vColSet = new Set<number>(VROADS.flatMap((r) => r.cols));

export const isRoad = (tx: number, ty: number): boolean => hRowSet.has(ty) || vColSet.has(tx);

export const inGrid = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < GW && ty < GH;

/**
 * A tile is pavement when it is within `SIDEWALK_W` of a road and is not road
 * itself.
 *
 * Precomputed per row and per column rather than probed per tile: the roads are
 * bands, so "near a road" is a property of the row or the column alone, and the
 * character controller asks this question twice a tick.
 */
const nearBand = (size: number, roadSet: Set<number>): boolean[] => {
  const near = new Array<boolean>(size).fill(false);
  for (const line of roadSet) {
    for (let d = -SIDEWALK_W; d <= SIDEWALK_W; d++) {
      const i = line + d;
      if (i >= 0 && i < size) near[i] = true;
    }
  }
  return near;
};

const nearHRoad = nearBand(GH, hRowSet);
const nearVRoad = nearBand(GW, vColSet);

export function isSidewalk(tx: number, ty: number): boolean {
  if (!inGrid(tx, ty) || isRoad(tx, ty)) return false;
  return nearHRoad[ty] || nearVRoad[tx];
}

/** Centre line of a road band, in tiles. */
export const roadCentreX = (vi: number): number => VROADS[vi].cols[0] + ROAD_W / 2;
export const roadCentreY = (hi: number): number => HROADS[hi].rows[0] + ROAD_W / 2;

/**
 * Lane centres. Traffic drives on the right, so on a horizontal street the
 * northern lane runs west and the southern lane runs east.
 */
export const laneOffsets = [ROAD_W * 0.28, ROAD_W * 0.72] as const;

export interface Intersection {
  vi: number;
  hi: number;
  /** Centre of the crossing, in tiles. */
  cx: number;
  cy: number;
}

export const INTERSECTIONS: Intersection[] = [];
for (let vi = 0; vi < VROADS.length; vi++) {
  for (let hi = 0; hi < HROADS.length; hi++) {
    INTERSECTIONS.push({ vi, hi, cx: roadCentreX(vi), cy: roadCentreY(hi) });
  }
}

/**
 * How far the carriageway runs past the edge of the map, in tiles.
 *
 * The city has to end somewhere, but its *streets* should not: they carry on
 * into the woodland and fade out in the fog, which is the difference between
 * a world and a diorama on a table.
 */
export const ROAD_OVERRUN = 16;

/* ------------------------------------------------------------------ *
 * Zebra crossings                                                      *
 * ------------------------------------------------------------------ */

/**
 * The crossings, as rectangles rather than as a radius.
 *
 * This used to be one number — "a pedestrian may stand within four tiles of a
 * junction centre" — which made the walkable area a *square* over the whole
 * junction. Two things were wrong with that. You could walk diagonally across
 * the middle of a crossroads, which is the one thing the pavement rule exists
 * to stop; and the paint had no idea where that square was, so the white
 * stripes and the place you were allowed to walk were two independent guesses
 * that never quite lined up.
 *
 * So the crossing is a thing now, defined once, and both the paint in `city.ts`
 * and `walkable()` in `ground.ts` are derived from it. Where the stripes are is
 * where you may walk, by construction.
 */
export interface Crossing {
  cx: number;
  cy: number;
  /** Which way the pedestrian walks: 'z' crosses an east–west carriageway. */
  axis: 'x' | 'z';
  /** Half-depth, along the traffic direction — the striped band. */
  along: number;
  /** Half-width, across the carriageway, kerb to kerb. */
  across: number;
}

/** Half the depth of the striped band, along the road. */
const CROSSING_ALONG = 1.3;
/** Half the width, across the carriageway. A shade over the kerb, so the
 *  painted band meets the pavement rather than stopping short of it. */
const CROSSING_ACROSS = ROAD_W / 2 + 0.3;
/** Distance from the junction centre to the middle of the striped band. */
const CROSSING_SETBACK = ROAD_W / 2 + CROSSING_ALONG;

export const CROSSINGS: Crossing[] = INTERSECTIONS.flatMap((it) => [
  // Across the east–west carriageway, on the west and east arms.
  { cx: it.cx - CROSSING_SETBACK, cy: it.cy, axis: 'z' as const, along: CROSSING_ALONG, across: CROSSING_ACROSS },
  { cx: it.cx + CROSSING_SETBACK, cy: it.cy, axis: 'z' as const, along: CROSSING_ALONG, across: CROSSING_ACROSS },
  // Across the north–south carriageway, on the north and south arms.
  { cx: it.cx, cy: it.cy - CROSSING_SETBACK, axis: 'x' as const, along: CROSSING_ALONG, across: CROSSING_ACROSS },
  { cx: it.cx, cy: it.cy + CROSSING_SETBACK, axis: 'x' as const, along: CROSSING_ALONG, across: CROSSING_ACROSS },
]);

/** Is (x, z) on the paint? The only place a pedestrian may leave the kerb. */
export function onCrossing(x: number, z: number): boolean {
  for (const c of CROSSINGS) {
    // `along` is measured on the traffic axis, which is the one the pedestrian
    // is *not* walking down.
    const dAlong = c.axis === 'z' ? Math.abs(x - c.cx) : Math.abs(z - c.cy);
    if (dAlong > c.along) continue;
    const dAcross = c.axis === 'z' ? Math.abs(z - c.cy) : Math.abs(x - c.cx);
    if (dAcross <= c.across) return true;
  }
  return false;
}

/**
 * How far from the kerb street furniture is planted, in tiles.
 *
 * Lamps, trees, benches, bins and signs all line up on this, which is what
 * turns a wide pavement into a street rather than an apron of empty paving:
 * a furnished strip along the kerb and a clear strip to walk on behind it.
 * It is also why nothing on the pavement has to be dodged — see the obstacle
 * registry in `city/props.ts`.
 */
export const FURNITURE_OFFSET = 0.9;

/** Tile-space position of the furniture line on each side of a road band. */
export const kerbLine = (band: number[], side: -1 | 1): number =>
  side < 0 ? band[0] - FURNITURE_OFFSET : band[ROAD_W - 1] + 1 + FURNITURE_OFFSET;

/* ------------------------------------------------------------------ *
 * Land bands: the strips of ground between the roads                  *
 * ------------------------------------------------------------------ */

export interface Band {
  a: number;
  b: number;
}

function bands(size: number, roadSet: Set<number>): Band[] {
  const out: Band[] = [];
  let start: number | null = null;
  for (let i = 0; i < size; i++) {
    const road = roadSet.has(i);
    if (!road && start === null) start = i;
    if ((road || i === size - 1) && start !== null) {
      out.push({ a: start, b: road ? i - 1 : i });
      start = null;
    }
  }
  return out;
}

/** Columns of land, west to east. */
export const X_BANDS = bands(GW, vColSet);
/** Rows of land, north to south. */
export const Y_BANDS = bands(GH, hRowSet);

/**
 * A city block, used to phrase "on the corner of X and Y" answers. One entry
 * per column of land: the avenue on its left and the avenue on its right.
 */
export interface BlockBounds {
  x0: number;
  x1: number;
  left: string | null;
  right: string | null;
}
export const BLOCK_BOUNDS: BlockBounds[] = X_BANDS.map((band, i) => ({
  x0: band.a,
  x1: band.b,
  left: i > 0 ? VROADS[i - 1].name : null,
  right: i < VROADS.length ? VROADS[i].name : null,
}));

/* ------------------------------------------------------------------ *
 * Open-air zones: parks and squares                                   *
 * ------------------------------------------------------------------ */

export type ZoneKind = 'central' | 'riverside' | 'sports';

export interface Zone {
  id: string;
  name: string;
  /** Noun phrase with its article, exactly like a building's. */
  type: string;
  emoji: string;
  x: number;
  y: number;
  w: number;
  h: number;
  street: string;
  kind: ZoneKind;
}

/**
 * Green zones fill a whole band cell each, so they read as real districts
 * rather than as a gap between two shops. Every one of them is walkable and
 * discoverable, and each has its own furniture in `city.ts`.
 */
export const PARKS: Zone[] = [
  {
    id: 'central-park',
    name: 'Central Park',
    type: 'a park',
    emoji: '🌳',
    x: X_BANDS[0].a,
    y: Y_BANDS[0].a,
    w: X_BANDS[0].b - X_BANDS[0].a + 1,
    h: Y_BANDS[0].b - Y_BANDS[0].a + 1,
    street: 'Main Street',
    kind: 'central',
  },
  {
    id: 'riverside-park',
    name: 'Riverside Park',
    type: 'a park',
    emoji: '🏞️',
    x: X_BANDS[0].a,
    y: Y_BANDS[5].a,
    w: X_BANDS[0].b - X_BANDS[0].a + 1,
    h: Y_BANDS[5].b - Y_BANDS[5].a + 1,
    street: 'Sunset Boulevard',
    kind: 'riverside',
  },
  {
    id: 'sunset-sports-park',
    name: 'Sunset Sports Park',
    type: 'a sports park',
    emoji: '⚽',
    x: X_BANDS[4].a,
    y: Y_BANDS[5].a,
    w: X_BANDS[4].b - X_BANDS[4].a + 1,
    h: Y_BANDS[5].b - Y_BANDS[5].a + 1,
    street: 'Sunset Boulevard',
    kind: 'sports',
  },
];

/** Kept for readability at call sites that only care about the main park. */
export const PARK = PARKS[0];

/** Is this tile-space point inside one of the open-air zones? */
export function inZone(x: number, y: number): Zone | null {
  for (const p of PARKS) {
    if (x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h) return p;
  }
  return null;
}
