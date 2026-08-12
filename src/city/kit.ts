/**
 * Which kit model stands on which plot.
 *
 * `buildings.ts` says what a place *is* and how much room it has; this module
 * turns that into a model, a colour variation and a transform. Nothing here
 * invents a position: a shell is always fitted to the footprint the layout
 * already computed, so the pavement in front of every door survives the change
 * of art unchanged.
 *
 * The choice is derived from the same two numbers the old procedural shells
 * used — how many floors a place has and how big its plot is — so the skyline
 * still rises where it used to:
 *
 *   five storeys or more   → a commercial tower
 *   three or four          → a commercial block
 *   two, on a wide plot    → an industrial hall
 *   two, on a narrow plot  → a suburban house
 *
 * with a short table of overrides for the places whose *name* makes one kit
 * obviously right — a garden centre belongs in a shed, a church does not.
 */

import type { Building } from './buildings';
import { mulberry32 } from '../core/rng';
import { model, variationCount, type KitName, type KitModel, type KitRequest } from './kits';

/* ------------------------------------------------------------------ *
 * What gets downloaded                                                *
 * ------------------------------------------------------------------ */

const letters = (from: string, to: string, prefix: string): string[] => {
  const out: string[] = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(prefix + String.fromCharCode(c));
  return out;
};

/** Shells, tallest kit first. */
export const SHELLS = {
  tower: { kit: 'commercial' as KitName, models: letters('a', 'e', 'building-skyscraper-') },
  block: { kit: 'commercial' as KitName, models: letters('a', 'n', 'building-') },
  hall: { kit: 'industrial' as KitName, models: letters('a', 'n', 'building-') },
  house: { kit: 'suburban' as KitName, models: letters('a', 'n', 'building-type-') },
};

export const TREES = ['tree-large', 'tree-small'];
export const VEHICLES = [
  'sedan',
  'sedan-sports',
  'suv',
  'suv-luxury',
  'hatchback-sports',
  'van',
  'truck',
  'delivery',
  'taxi',
  'police',
  'ambulance',
  'firetruck',
  'garbage-truck',
];

/**
 * Every model the city downloads at boot. The kits themselves are vendored
 * whole under `public/models/` — this is the subset the streets actually use,
 * which is what keeps the download to a few megabytes instead of fifteen.
 */
export const KIT_REQUESTS: KitRequest[] = [
  {
    kit: 'commercial',
    models: [
      ...SHELLS.block.models,
      ...SHELLS.tower.models,
      'detail-parasol-a',
      'detail-parasol-b',
    ],
  },
  {
    kit: 'suburban',
    models: [...SHELLS.house.models, ...TREES, 'planter', 'fence', 'path-stones-short'],
  },
  { kit: 'industrial', models: [...SHELLS.hall.models, 'chimney-large', 'detail-tank'] },
  {
    kit: 'roads',
    models: [
      'light-curved',
      'light-curved-double',
      'construction-cone',
      'construction-barrier',
      'sign-highway',
    ],
  },
  { kit: 'cars', models: VEHICLES },
];

/* ------------------------------------------------------------------ *
 * Choosing a shell                                                    *
 * ------------------------------------------------------------------ */

type ShellKind = keyof typeof SHELLS;

/** Places whose name settles the argument before the plot gets a vote. */
const BY_TYPE: [RegExp, ShellKind][] = [
  [/gas station|car wash|recycling|hardware|garden center|farmers market|fish market|repair shop|ferry dock|bike rental|copy shop|taxi station|camping store|bus terminal|train station|airport/, 'hall'],
  [/church|school|hostel|diner|vet clinic|pottery|hair salon|barber|tea house|flower shop|pet shop|toy store|dental clinic|nail salon|photo studio|empanada|newsstand|greengrocer/, 'house'],
  [/hotel|bank|city hall|courthouse|shopping mall|cinema|concert hall|museum|art gallery|hospital|police station|library|electronics store/, 'block'],
];

/**
 * Which halls get a chimney or a tank on the roof.
 *
 * A recycling centre earns one; an airport does not, and a bus terminal with a
 * smokestack would be telling the student something untrue about the word.
 */
export const wantsRoofPlant = (b: Building): boolean =>
  /recycling|hardware|garden center|repair shop|car wash|gas station|fish market|farmers market|camping store/.test(
    b.type,
  );

function kindFor(b: Building): ShellKind {
  for (const [re, kind] of BY_TYPE) if (re.test(b.type) || re.test(b.name.toLowerCase())) return kind;
  if (b.floors >= 5) return 'tower';
  if (b.floors >= 3) return 'block';
  return b.w * b.h > 12 ? 'hall' : 'house';
}

export interface Shell {
  kit: KitName;
  model: KitModel;
  variation: number;
  /** Non-uniform: the footprint is exact, the height is only nearly so. */
  scale: { x: number; y: number; z: number };
  rotY: number;
  /** How tall the shell actually came out, in tiles. */
  height: number;
}

/**
 * Fit a model to a plot.
 *
 * Width and depth are matched exactly — the frontage is gameplay, not
 * decoration — so the only freedom left is *which* model to stretch and how far
 * to take its height. Both are scored the same way: a candidate is penalised for
 * how much its own proportions have to be bent, and the least-bent one wins.
 */
function fit(m: KitModel, b: Building): { scale: Shell['scale']; height: number; penalty: number } {
  const sx = b.w / m.size.x;
  const sz = b.h / m.size.z;
  const even = Math.sqrt(sx * sz);
  const wanted = b.height / m.size.y;
  // Stretching a facade vertically is the most visible distortion there is, so
  // the height is allowed to drift from the plan rather than the windows.
  const sy = Math.min(even * 1.25, Math.max(even * 0.8, wanted));
  const penalty = Math.abs(Math.log(sx / sz)) + Math.abs(Math.log(wanted / even));
  return { scale: { x: sx, y: sy, z: sz }, height: m.size.y * sy, penalty };
}

export function shellFor(b: Building, seed: number): Shell {
  const kind = kindFor(b);
  const { kit, models } = SHELLS[kind];
  const rand = mulberry32(seed);

  let best: Shell | null = null;
  let bestScore = Infinity;
  for (const name of models) {
    const m = model(kit, name);
    const f = fit(m, b);
    // A whisker of noise breaks ties between equally good models, so a row of
    // identical plots is not a row of identical buildings.
    const score = f.penalty + rand() * 0.08;
    if (score < bestScore) {
      bestScore = score;
      best = {
        kit,
        model: m,
        variation: 0,
        scale: f.scale,
        // The detailed facade of every kit building looks along -Z, and `face:
        // 'up'` means the door looks north, which is -z here. One is the other.
        rotY: b.face === 'up' ? 0 : Math.PI,
        height: f.height,
      };
    }
  }
  best!.variation = Math.floor(rand() * variationCount(kit));
  return best!;
}
