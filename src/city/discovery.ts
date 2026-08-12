import { BUILDINGS, doorOf, type Building } from "./buildings";
import { HROADS, PARKS, ROAD_W, VROADS, type Zone } from "./layout";

/**
 * Finding your way around.
 *
 * The island's learning loop was a marker over an object and a card of
 * vocabulary. A city does not need markers: the shops have their names painted
 * on them, so walking up to a door *is* the interaction. Every one of the 91
 * places and 3 parks is discovered by standing in front of it, and the card
 * that pops up tells you what it is and which street it is on — the two facts
 * every direction in English is built out of.
 *
 * Everything here is derived from the city's own tables, so nothing is written
 * twice: move a shop and its door, its street and its card all move with it.
 */

const STORAGE_KEY = "da-world:found";

export interface Discovery {
  id: string;
  name: string;
  /** Noun phrase with its article: "a bakery", "an airport". */
  type: string;
  emoji: string;
  street: string;
  /** The sentence the card reads out — plain, and true of the geometry. */
  sentence: string;
}

const fromBuilding = (b: Building): Discovery => ({
  id: b.id,
  name: b.name,
  type: b.type,
  emoji: b.emoji,
  street: b.street,
  sentence: `${b.name} is ${b.type} on ${b.street}.`,
});

const fromZone = (z: Zone): Discovery => ({
  id: z.id,
  name: z.name,
  type: z.type,
  emoji: z.emoji,
  street: z.street,
  sentence: `${z.name} is ${z.type} on ${z.street}.`,
});

/** Everything there is to find, in no particular order. */
export const PLACES: Discovery[] = [...BUILDINGS.map(fromBuilding), ...PARKS.map(fromZone)];

/** How close to a door you have to stand, in tiles. */
const DOOR_REACH = 2.6;

export class Explorer {
  readonly found = new Set<string>();
  private readonly listeners: Array<() => void> = [];

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.found.add(id);
    } catch {
      // A corrupt or unavailable store is not a reason to refuse to play.
    }
  }

  get total(): number {
    return PLACES.length;
  }

  subscribe(fn: () => void): void {
    this.listeners.push(fn);
  }

  reset(): void {
    this.found.clear();
    this.save();
  }

  /**
   * The place you are standing in front of, or null.
   *
   * Doors win over parks, because a shop on the edge of Central Park should
   * announce itself as the shop you are looking at rather than the park you
   * happen to be standing in.
   */
  nearest(x: number, z: number): Discovery | null {
    let best: Building | null = null;
    let bestDist = DOOR_REACH * DOOR_REACH;
    for (const b of BUILDINGS) {
      const door = doorOf(b);
      const dx = door.x - x;
      const dz = door.y - z;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    if (best) return fromBuilding(best);

    for (const p of PARKS) {
      if (x > p.x && x < p.x + p.w && z > p.y && z < p.y + p.h) return fromZone(p);
    }
    return null;
  }

  /** Record a place as found. Returns false if it already was. */
  discover(place: Discovery): boolean {
    if (this.found.has(place.id)) return false;
    this.found.add(place.id);
    this.save();
    for (const fn of this.listeners) fn();
    return true;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.found]));
    } catch {
      // Private browsing: play on, just do not remember.
    }
  }
}

/* ------------------------------------------------------------------ *
 * Where am I?                                                         *
 * ------------------------------------------------------------------ */

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
