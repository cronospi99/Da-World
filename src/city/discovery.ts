import { BUILDINGS, doorOf } from "./buildings";
import { HROADS, PARKS, ROAD_W, VROADS } from "./layout";

/**
 * Knowing where you are, and keeping count of where you have been.
 *
 * There is no card that jumps up with a place's name on it. The shops have
 * their names painted on the fascia and their street painted on the pavement,
 * so *reading* is the interaction — walking up to a door and looking at it is
 * the thing the game asks you to do, and interrupting that with a pop-up
 * teaches nothing except how to dismiss a pop-up.
 *
 * What is left is bookkeeping. Walking past a door quietly ticks the place off
 * a list the missions count, and `streetAt` answers the one question the HUD
 * does ask on your behalf: which street is this?
 *
 * Everything here is derived from the city's own tables, so nothing is written
 * twice: move a shop and its door, its street and its tally all move with it.
 */

/** How close to a door you have to walk for the place to count, in tiles. */
const DOOR_REACH = 2.3;

export interface Visit {
  id: string;
  name: string;
  emoji: string;
}

/**
 * Every place whose door the player is currently standing at, plus any park
 * they are inside. Callers add these to the found set; the sweep is cheap
 * enough to run every frame at ninety-odd footprints.
 */
export function visitsAt(x: number, z: number, found: Set<string>): Visit[] {
  const out: Visit[] = [];
  for (const b of BUILDINGS) {
    if (found.has(b.id)) continue;
    const door = doorOf(b);
    const dx = door.x - x;
    const dz = door.y - z;
    if (dx * dx + dz * dz < DOOR_REACH * DOOR_REACH) {
      out.push({ id: b.id, name: b.name, emoji: b.emoji });
    }
  }
  for (const p of PARKS) {
    if (found.has(p.id)) continue;
    if (x > p.x && x < p.x + p.w && z > p.y && z < p.y + p.h) {
      out.push({ id: p.id, name: p.name, emoji: p.emoji });
    }
  }
  return out;
}

/**
 * The street you are standing on or beside.
 *
 * Reading it off the carriageway rather than off the nearest sign is what makes
 * it true at a junction: on a crossroads you are on both, and the one named is
 * the one you are closest to the middle of.
 */
export function streetAt(x: number, z: number): string {
  let best: string | null = null;
  let bestDist = ROAD_W * 1.6;

  for (const r of HROADS) {
    const d = Math.abs(z - (r.rows[0] + ROAD_W / 2));
    if (d < bestDist) {
      bestDist = d;
      best = r.name;
    }
  }
  for (const r of VROADS) {
    const d = Math.abs(x - (r.cols[0] + ROAD_W / 2));
    if (d < bestDist) {
      bestDist = d;
      best = r.name;
    }
  }
  if (best) return best;

  for (const p of PARKS) {
    if (x > p.x && x < p.x + p.w && z > p.y && z < p.y + p.h) return p.name;
  }
  return "Somewhere in the city";
}
