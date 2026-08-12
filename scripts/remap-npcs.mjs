/**
 * One-shot helper: move the authored citizen positions onto a new street grid.
 *
 * The citizens in `src/city/npcData.ts` are hand-placed tile coordinates — a
 * baker outside the bakery, a police officer on the corner — and they were
 * authored against the grid the city had when it was written. Widening the
 * roads and the pavements moves every street, so this maps each authored
 * position through the old road anchors onto the new ones, keeping which
 * street a citizen stands on and which side of it they are on.
 *
 * The result is printed as the replacement `x`/`y` for each citizen. It is a
 * migration, not part of the game: run it, paste the numbers in, and the
 * authored data is authored against the new grid from then on.
 *
 *   node scripts/remap-npcs.mjs
 */

import { readFileSync } from "node:fs";

/** The grid the citizens were authored against. */
const OLD = { roadW: 4, hRoads: [8, 20, 32, 44, 56], vRoads: [8, 23, 38, 53] };
/** The grid they are moving to — keep in step with `src/city/layout.ts`. */
const NEW = { roadW: 6, hRoads: [13, 32, 51, 70, 89], vRoads: [15, 36, 57, 78], sidewalk: 3 };

/**
 * Map one axis.
 *
 * A citizen is placed relative to the street they belong to, so the mapping
 * keeps that relationship rather than scaling the whole axis: find the nearest
 * road band, work out which side of it they stand on and how deep into the
 * pavement, and rebuild that against the same road in the new grid. Anyone not
 * near a road at all (the park benches) is scaled proportionally instead.
 */
function mapAxis(value, oldRoads, newRoads, oldW, newW, sidewalk) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < oldRoads.length; i++) {
    const a = oldRoads[i];
    const b = a + oldW;
    const dist = value < a ? a - value : value > b ? value - b : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  const a = oldRoads[best];
  const b = a + oldW;
  const na = newRoads[best];
  const nb = na + newW;

  // Too far from any street to be "on" one: scale into the new grid.
  if (bestDist > oldW) {
    const span = oldRoads[oldRoads.length - 1] + oldW;
    const newSpan = newRoads[newRoads.length - 1] + newW;
    return +((value / span) * newSpan).toFixed(1);
  }
  // On the carriageway (a crossing): keep the proportion across it.
  if (value >= a && value <= b) return +(na + ((value - a) / oldW) * newW).toFixed(1);
  // On a pavement: stand in the middle of the new, wider one.
  const middle = sidewalk / 2;
  return +(value < a ? (na - middle).toFixed(1) : (nb + middle).toFixed(1));
}

const source = readFileSync(new URL("../src/city/npcData.ts", import.meta.url), "utf8");
const line = /\{ name: '([^']+)'.*?x: ([\d.]+), y: ([\d.]+),/g;

let out = "";
let match;
while ((match = line.exec(source)) !== null) {
  const [, name, xs, ys] = match;
  const x = mapAxis(+xs, OLD.vRoads, NEW.vRoads, OLD.roadW, NEW.roadW, NEW.sidewalk);
  const y = mapAxis(+ys, OLD.hRoads, NEW.hRoads, OLD.roadW, NEW.roadW, NEW.sidewalk);
  out += `${name}\tx: ${x}, y: ${y},\n`;
}
console.log(out);
