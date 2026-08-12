import * as THREE from "three";
import { BUILDINGS } from "./buildings";
import { CURB } from "./city";
import { GH, GW, ROAD_OVERRUN, isRoad } from "./layout";

/**
 * The city as something you can stand on and bump into.
 *
 * The island this world used to be was a heightfield, so the floor was one
 * analytic function and the only wall was the shoreline. A city is the other
 * way round: the floor is flat and almost all of the interest is in the walls.
 * So this module answers two questions for the character controller —
 *
 *   how high is the ground here?      (road, or a kerb's height of pavement)
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

/** Half-width of the character, for the purposes of not clipping a wall. */
export const BODY_RADIUS = 0.42;

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
 * behaviour a player expects from a wall: walking into a shopfront at an angle
 * still carries you along it instead of stopping you dead.
 */
export function resolveMove(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  out: { x: number; z: number; hitX: boolean; hitZ: boolean },
): void {
  let x = THREE.MathUtils.clamp(toX, CITY_BOUNDS.minX, CITY_BOUNDS.maxX);
  let z = THREE.MathUtils.clamp(toZ, CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ);
  out.hitX = x !== toX;
  out.hitZ = z !== toZ;

  if (blocked(x, fromZ)) {
    x = fromX;
    out.hitX = true;
  }
  if (blocked(x, z)) {
    z = fromZ;
    out.hitZ = true;
  }
  // A corner can still trap us if both axes were legal alone but not together.
  if (blocked(x, z)) {
    x = fromX;
    out.hitX = true;
  }
  out.x = x;
  out.z = z;
}
