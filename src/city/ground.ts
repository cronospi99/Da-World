import * as THREE from "three";
import { BUILDINGS } from "./buildings";
import { CURB, TREE_SPOTS } from "./city";
import { hitsProp } from "./props";
import {
  GH,
  GW,
  ROAD_OVERRUN,
  onCrossing,
  inZone,
  isRoad,
  isSidewalk,
} from "./layout";

/**
 * The city as something you can stand on and bump into.
 *
 * The island this world used to be was a heightfield, so the floor was one
 * analytic function and the only wall was the shoreline. A city is the other
 * way round: the floor is flat and almost all of the interest is in the walls.
 * So this module answers three questions for the character controller —
 *
 *   how high is the ground here?      (road, or a kerb's height of pavement)
 *   may a pedestrian stand here?      (pavement, crossing or park, and nothing else)
 *   may I move from here to there?    (not through a building, you may not)
 *
 * — and nothing else knows the city is made of tiles.
 */

/** How far past the last block you may wander before the world stops you. */
const MARGIN = ROAD_OVERRUN + 6;

export const CITY_BOUNDS = {
  minX: -MARGIN,
  maxX: GW + MARGIN,
  minZ: -MARGIN,
  maxZ: GH + MARGIN,
};

/**
 * Half-width of a person, for the purposes of not clipping a wall.
 *
 * Sized to the character rather than to the tile: at 1.2 units tall a citizen
 * is about half a tile across the shoulders, and a radius any larger used to
 * hold the camera a suspicious distance off every shopfront.
 */
export const BODY_RADIUS = 0.28;

/**
 * Ground height at a point.
 *
 * Roads sit at 0 and everything else — pavement, grass, park — sits on the
 * kerb. The step between them is blended across the tile boundary rather than
 * being a cliff, because a hard edge under a fixed-timestep controller reads as
 * a stumble every time you step off a pavement.
 */
export function groundHeight(x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (!isRoad(tx, tz)) return CURB;
  // On the carriageway, but ramp up towards a kerb we are within half a tile of.
  const fx = x - tx;
  const fz = z - tz;
  let nearest = 1;
  if (!isRoad(tx - 1, tz)) nearest = Math.min(nearest, fx);
  if (!isRoad(tx + 1, tz)) nearest = Math.min(nearest, 1 - fx);
  if (!isRoad(tx, tz - 1)) nearest = Math.min(nearest, fz);
  if (!isRoad(tx, tz + 1)) nearest = Math.min(nearest, 1 - fz);
  if (nearest >= 0.5) return 0;
  const t = 1 - nearest / 0.5;
  return CURB * t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ *
 * Pedestrian rules                                                    *
 * ------------------------------------------------------------------ */

/** How close to the edge of the map a pedestrian may get, in tiles. */
const EDGE = 0.14;
/** Clearance kept between a body and a shopfront. */
const SHOP_PAD = 0.12;
/**
 * Clearance kept between a body and a lamp post, bin, bench or bollard.
 *
 * Deliberately smaller than the shop pad. A pavement is furnished, and being
 * held half a metre off every bollard would turn a walk down a street into a
 * slalom; brushing past one is what walking past one looks like.
 */
const PROP_PAD = 0.14;

/**
 * May a pedestrian stand at this tile-space point?
 *
 * Pavements, zebra crossings and the parks — and nothing else. It is a
 * language rule as much as a road-safety one: if you can cut diagonally across
 * a block, then "go straight for two blocks and turn left" stops being the
 * only way to get anywhere, and the directions a citizen gives you stop
 * meaning anything. It is also what keeps the carriageway to the traffic,
 * which is the difference between a city and a car park.
 *
 * The test is a point test rather than a circle: the pavement is one tile
 * wide, and a body radius taken off both sides of it would leave a corridor
 * too mean to walk down.
 */
export function walkable(x: number, z: number): boolean {
  if (x < EDGE || z < EDGE || x > GW - EDGE || z > GH - EDGE) return false;
  if (blocked(x, z, SHOP_PAD)) return false;
  // Lamp posts, bollards, benches, bins, planters and tree trunks. Registered
  // by the builders in `city.ts` as they place them, so what you see on the
  // pavement and what stops you there cannot drift apart.
  if (hitsProp(x, z, PROP_PAD)) return false;
  // Parks and squares are open ground: roam them freely.
  if (inZone(x, z)) return true;

  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (isSidewalk(tx, tz)) return true;
  // On the carriageway only where the zebra stripes are painted — the same
  // rectangles the paint is built from, so what looks like a crossing is one.
  if (isRoad(tx, tz)) return onCrossing(x, z);
  return false;
}

/* ------------------------------------------------------------------ *
 * Walls                                                               *
 * ------------------------------------------------------------------ */

interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Roof height. Above this the box is not in the way of anything. */
  top: number;
}

/**
 * Every building footprint, bucketed into a coarse grid.
 *
 * Ninety-one boxes is few enough to test one by one, but the controller asks
 * twice per 60 Hz tick and the camera asks again for its occlusion probe, so a
 * grid that turns each query into "look at four or five boxes" is worth the
 * twenty lines.
 */
const CELL = 8;
const grid = new Map<number, Box[]>();
const key = (cx: number, cz: number): number => cx * 4096 + cz;

for (const b of BUILDINGS) {
  // `b.height` is the height the shell was *fitted to*; the model it chose may
  // have come out a little taller, so the roof is padded rather than exact. A
  // camera that clears a roof by a whisker and clips the parapet is worse than
  // one that stays a metre high.
  const box: Box = {
    x0: b.x,
    z0: b.y,
    x1: b.x + b.w,
    z1: b.y + b.h,
    top: CURB + b.height * 1.35 + 1,
  };
  for (let cx = Math.floor((box.x0 - 1) / CELL); cx <= Math.floor((box.x1 + 1) / CELL); cx++) {
    for (let cz = Math.floor((box.z0 - 1) / CELL); cz <= Math.floor((box.z1 + 1) / CELL); cz++) {
      const k = key(cx, cz);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(box);
    }
  }
}

const EMPTY: Box[] = [];
const boxesNear = (x: number, z: number): Box[] =>
  grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? EMPTY;

/* ------------------------------------------------------------------ *
 * Foliage                                                             *
 * ------------------------------------------------------------------ */

/**
 * Tree canopies, bucketed the same way, for the camera and nothing else.
 *
 * A person walks under a tree, so the character controller does not care about
 * them. The camera does: park a lens inside a canopy and the whole screen goes
 * green, which used to happen every time you stood at the edge of a park. So a
 * tree is a cylinder here — trunk to crown — and the camera refuses to *rest*
 * inside one. The boom is still allowed to pass through foliage on its way
 * out, because a branch crossing the shot for a moment is what a camera in a
 * park looks like, and shortening the boom for every leaf left it juddering
 * the length of a tree-lined avenue — a street tree every few metres is most
 * of what a kerb in this city has on it.
 */
interface Canopy {
  x: number;
  z: number;
  r: number;
  top: number;
}

const canopyGrid = new Map<number, Canopy[]>();

for (const spot of TREE_SPOTS) {
  // The trees are drawn at 2.7x their spot scale. The radius kept here is the
  // dense middle of the crown rather than its full spread: in a park the
  // canopies overlap, and a camera that demanded clear air of all of them
  // would have nowhere to stand under a wood at all.
  const canopy: Canopy = {
    x: spot.x,
    z: spot.z,
    r: spot.s * 0.7,
    top: CURB + spot.s * 3.1,
  };
  const cx = Math.floor(canopy.x / CELL);
  const cz = Math.floor(canopy.z / CELL);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const k = key(ix, iz);
      let list = canopyGrid.get(k);
      if (!list) canopyGrid.set(k, (list = []));
      list.push(canopy);
    }
  }
}

/**
 * Is a point inside a tree?
 *
 * Only the camera asks, and only about where its lens may come to rest: a
 * person walks under a tree, and a boom that pulled in for every branch spent
 * a walk down a tree-lined street snapping in and out.
 */
export function inFoliage(x: number, y: number, z: number, radius = 0.3): boolean {
  if (y > CURB + 6 || y < CURB + 0.5) return false;
  const list = canopyGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return false;
  for (const c of list) {
    if (y > c.top) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.r + radius;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

/**
 * Is a body of `radius` at (x, y, z) inside a building?
 *
 * The height matters to exactly one caller — the camera, which is allowed to
 * rise over a roof to get a clear shot — and to nobody else, because a person
 * on foot is never above one. `Infinity` is the answer for anything on the
 * ground: inside the footprint is inside the building.
 */
export function blockedAt(x: number, y: number, z: number, radius = BODY_RADIUS): boolean {
  for (const b of boxesNear(x, z)) {
    if (
      x > b.x0 - radius &&
      x < b.x1 + radius &&
      z > b.z0 - radius &&
      z < b.z1 + radius &&
      y < b.top
    ) {
      return true;
    }
  }
  return false;
}

/** Is a body of `radius` at (x, z) inside a building, at any height? */
export const blocked = (x: number, z: number, radius = BODY_RADIUS): boolean =>
  blockedAt(x, -Infinity, z, radius);

/**
 * Does the straight line from A to B pass through a building?
 *
 * Used by the camera to find out whether the shot is about to go through a
 * wall. Sampled rather than solved: the boxes are large and the camera boom is
 * short, so a dozen probes is both cheaper and less code than a slab test. The
 * line carries its height with it, so a boom that rises over a two-storey shop
 * is correctly reported as clear.
 */
export function lineBlocked(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius = 0.2,
): boolean {
  const steps = Math.max(4, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.6));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (
      blockedAt(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, radius)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Slide a move along whatever it runs into.
 *
 * Each axis is resolved on its own, which is the cheapest way to get the
 * behaviour a player expects from a kerb or a shopfront: walking into one at
 * an angle still carries you along the street instead of stopping you dead.
 * That matters more here than in an open world, because a pavement is a
 * corridor and every walk down one is a walk along a wall.
 */
export function resolveMove(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  out: { x: number; z: number; hitX: boolean; hitZ: boolean },
  /**
   * Anything else in the way that the city itself does not know about — the
   * other people walking around, who move. The static world is a lookup; the
   * crowd is a callback, because it is different every frame.
   */
  extra?: (x: number, z: number) => boolean,
): void {
  const free = extra
    ? (px: number, pz: number): boolean => walkable(px, pz) && !extra(px, pz)
    : walkable;

  let x = THREE.MathUtils.clamp(toX, CITY_BOUNDS.minX, CITY_BOUNDS.maxX);
  let z = THREE.MathUtils.clamp(toZ, CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ);
  out.hitX = x !== toX;
  out.hitZ = z !== toZ;

  if (!free(x, fromZ)) {
    x = fromX;
    out.hitX = true;
  }
  if (!free(x, z)) {
    z = fromZ;
    out.hitZ = true;
  }
  // A corner can still trap us if both axes were legal alone but not together.
  if (!free(x, z)) {
    x = fromX;
    z = fromZ;
    out.hitX = true;
    out.hitZ = true;
  }
  out.x = x;
  out.z = z;
}

/**
 * The nearest legal standing place to a point, searched outwards.
 *
 * Used when something drops a character into the city from outside the
 * simulation — a teleport, a fresh save, the debug console — so nobody ever
 * lands inside a wall or in the middle of the carriageway.
 */
export function nearestWalkable(x: number, z: number, radius = 8): { x: number; z: number } {
  if (walkable(x, z)) return { x, z };
  for (let r = 0.5; r <= radius; r += 0.5) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (walkable(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}
