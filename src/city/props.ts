/**
 * Everything on the pavement you have to walk around.
 *
 * The city knows about ninety-one buildings and stops there, which is why you
 * used to walk straight through the bollards on every corner, through the bench
 * outside the café and through the lamp post you were standing under. A city
 * you pass through is not a place; the first thing that makes a street feel
 * solid is that the street furniture pushes back.
 *
 * Rather than re-deriving where the furniture is — which would mean two copies
 * of the same layout knowledge, drifting apart on the first change — the
 * builders in `city.ts` register each solid thing here as they place it. One
 * call, next to the geometry, at the moment its position is known.
 *
 * Everything is a circle. Street furniture is posts, bins, planters and
 * benches; nothing on a pavement is a shape a person needs a polygon to walk
 * around, and a circle is one subtraction and one comparison.
 */

/** A solid thing on the ground, as far as anything walking is concerned. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

const CELL = 8;
const key = (cx: number, cz: number): number => cx * 4096 + cz;
const grid = new Map<number, Obstacle[]>();
const all: Obstacle[] = [];

/**
 * Register a solid thing at (x, z) with radius `r`.
 *
 * Radii are deliberately a little under the model: a post you brush past reads
 * as a post you walked around, while a post with a generous margin reads as an
 * invisible wall, and on a pavement three tiles wide there is no room for
 * invisible walls.
 */
export function solid(x: number, z: number, r: number): void {
  const obstacle: Obstacle = { x, z, r };
  all.push(obstacle);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const k = key(ix, iz);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(obstacle);
    }
  }
}

/** A row of things in a line, which is most of what a pavement has on it. */
export function solidRow(
  x: number,
  z: number,
  dx: number,
  dz: number,
  count: number,
  r: number,
): void {
  for (let i = 0; i < count; i++) solid(x + dx * i, z + dz * i, r);
}

const EMPTY: Obstacle[] = [];

/** Is a body of `radius` at (x, z) inside a piece of street furniture? */
export function hitsProp(x: number, z: number, radius: number): boolean {
  const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return false;
  for (const o of list) {
    const dx = x - o.x;
    const dz = z - o.z;
    const reach = o.r + radius;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

/** Every registered obstacle. Used by the debug hooks and the tests. */
export const obstacles = (): readonly Obstacle[] => all;

export const nearbyProps = (x: number, z: number): readonly Obstacle[] =>
  grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? EMPTY;
