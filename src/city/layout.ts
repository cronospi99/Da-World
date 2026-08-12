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

/** Width of every road, in tiles. */
export const ROAD_W = 4;

/** Grid width / height in tiles. */
export const GW = 68;
export const GH = 68;

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

export const HROADS: HRoad[] = [
  { rows: span(8), name: 'Main Street', short: 'MAIN ST' },
  { rows: span(20), name: 'Oak Street', short: 'OAK ST' },
  { rows: span(32), name: 'River Road', short: 'RIVER RD' },
  { rows: span(44), name: 'Market Street', short: 'MARKET ST' },
  { rows: span(56), name: 'Sunset Boulevard', short: 'SUNSET BLVD' },
];

export const VROADS: VRoad[] = [
  { cols: span(8), name: '1st Avenue', short: '1ST AVE' },
  { cols: span(23), name: 'Victory Avenue', short: 'VICTORY AVE' },
  { cols: span(38), name: 'Llama Boulevard', short: 'LLAMA BLVD' },
  { cols: span(53), name: 'Palm Avenue', short: 'PALM AVE' },
];

export const hRowSet = new Set<number>(HROADS.flatMap((r) => r.rows));
export const vColSet = new Set<number>(VROADS.flatMap((r) => r.cols));

export const isRoad = (tx: number, ty: number): boolean => hRowSet.has(ty) || vColSet.has(tx);

export const inGrid = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < GW && ty < GH;

const isRoadN = (tx: number, ty: number): boolean => inGrid(tx, ty) && isRoad(tx, ty);

/** A tile is sidewalk when it touches a road but is not a road itself. */
export function isSidewalk(tx: number, ty: number): boolean {
  if (!inGrid(tx, ty) || isRoad(tx, ty)) return false;
  return isRoadN(tx - 1, ty) || isRoadN(tx + 1, ty) || isRoadN(tx, ty - 1) || isRoadN(tx, ty + 1);
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

/**
 * How far from an intersection centre a pedestrian may stand on the road.
 * Wide enough to cover the carriageway plus the kerb on both sides.
 */
export const CROSSING_REACH = ROAD_W / 2 + 1.0;

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
