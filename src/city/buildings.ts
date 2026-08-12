/**
 * The named places of the city (the parks live in `layout.ts`).
 *
 * Every entry doubles as vocabulary: `name` is the proper noun students read
 * on the sign, `type` is the countable noun phrase they must produce
 * ("a bakery", "an ice cream shop") and the slot it sits in drives the
 * preposition-of-place quests.
 *
 * Positions are **not** hand-typed coordinates any more. A place declares the
 * land band it belongs to and which slot of that band it occupies, and the
 * exact footprint is computed from `layout.ts`. Widening the roads, adding an
 * avenue or growing the grid therefore moves every shop with it, and the
 * street a place is on can never disagree with the street it actually faces.
 *
 * side: 'down' → the door and the sign look south (towards the street below)
 *       'up'   → the door and the sign look north (towards the street above)
 */

import {
  BLOCK_BOUNDS,
  HROADS,
  X_BANDS,
  Y_BANDS,
  isRoad,
  type BlockBounds,
} from './layout';
import { mulberry32 } from '../core/rng';

export type Facing = 'up' | 'down';

/**
 * Places too big to be a shop: they take a whole band cell, they get no
 * pavement furniture in front of them, and the stadium — which no kit has
 * anything like — gets a bespoke procedural shell instead of a model.
 */
export type Landmark = 'stadium' | 'airport' | 'terminal';

export interface Building {
  id: string;
  name: string;
  /** Noun phrase with its article: "a bakery", "an airport". */
  type: string;
  emoji: string;
  color: string;
  /** Tile-space footprint. */
  x: number;
  y: number;
  w: number;
  h: number;
  street: string;
  face: Facing;
  /**
   * Derived at load time. `world/kit.ts` reads both: the floor count picks
   * which kit a place is built from, and the height is the one the fitted model
   * aims at.
   */
  height: number;
  floors: number;
  landmark?: Landmark;
}

type RawBuilding = Omit<Building, 'height' | 'floors'>;

/* ------------------------------------------------------------------ *
 * Slot placement                                                      *
 * ------------------------------------------------------------------ */

/** Pavement kept clear between a building and the kerb, in tiles. */
const KERB_GAP = 1.0;
/** Gap between neighbouring shopfronts. */
const SHOP_GAP = 0.2;
/** Default depth of a shop, front to back. */
const SHOP_D = 2.4;

/**
 * Footprint of slot `i` of `n` inside band cell (`xb`, `yb`).
 *
 * The building is pushed against the street it faces and inset from the kerb
 * by exactly one tile, which is what leaves a walkable pavement in front of
 * every door — the rule the whole game is built on.
 */
function footprint(
  xb: number,
  yb: number,
  side: Facing,
  i: number,
  n: number,
  depth: number,
): { x: number; y: number; w: number; h: number } {
  const X = X_BANDS[xb];
  const Y = Y_BANDS[yb];
  // A band that ends at the map edge has no kerb on that side, so the row of
  // shops can run almost to the boundary instead of leaving a dead strip.
  const x0 = X.a + (isRoad(X.a - 1, Y.a) ? KERB_GAP : 0.3);
  const x1 = X.b + 1 - (isRoad(X.b + 1, Y.a) ? KERB_GAP : 0.3);
  const w = (x1 - x0 - SHOP_GAP * (n - 1)) / n;
  return {
    x: x0 + i * (w + SHOP_GAP),
    y: side === 'up' ? Y.a + KERB_GAP : Y.b - depth,
    w,
    h: depth,
  };
}

/** The street a slot faces, derived from the band it sits in. */
const streetOf = (yb: number, side: Facing): string =>
  side === 'down' ? HROADS[yb].name : HROADS[yb - 1].name;

function B(
  name: string,
  type: string,
  emoji: string,
  color: string,
  xb: number,
  yb: number,
  side: Facing,
  i: number,
  n: number,
  depth = SHOP_D,
  landmark?: Landmark,
): RawBuilding {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    type,
    emoji,
    color,
    ...footprint(xb, yb, side, i, n, depth),
    street: streetOf(yb, side),
    face: side,
    landmark,
  };
}

/* ------------------------------------------------------------------ *
 * The places                                                          *
 * ------------------------------------------------------------------ */

/** Depth of the deeper shops on the north side of Main Street. */
const MAIN_D = 2.6;

const RAW: RawBuilding[] = [
  /* ── North side of Main Street (face down) ── */
  B("Pepe's Bakery", 'a bakery', '🥖', '#e0a35c', 1, 0, 'down', 0, 4, MAIN_D),
  B("Doña Rosa's Café", 'a coffee shop', '☕', '#6f8fd0', 1, 0, 'down', 1, 4, MAIN_D),
  B('Bogotá Books', 'a bookstore', '📚', '#d0705f', 1, 0, 'down', 2, 4, MAIN_D),
  B("María's Pharmacy", 'a pharmacy', '💊', '#65bfae', 1, 0, 'down', 3, 4, MAIN_D),
  B('Golden Llama Hotel', 'a hotel', '🏨', '#8093d8', 2, 0, 'down', 0, 4, MAIN_D),
  B('El Dorado Restaurant', 'a restaurant', '🍽️', '#e09a5f', 2, 0, 'down', 1, 4, MAIN_D),
  B('Sweet Nails Studio', 'a nail salon', '💅', '#dc8bb4', 2, 0, 'down', 2, 4, MAIN_D),
  B('Copy Center', 'a copy shop', '🖨️', '#7f9cba', 2, 0, 'down', 3, 4, MAIN_D),
  B('Optica Visión', 'an optician', '👓', '#6fa8b8', 3, 0, 'down', 0, 4, MAIN_D),
  B('Salsa Dance Studio', 'a dance studio', '💃', '#d0709c', 3, 0, 'down', 1, 4, MAIN_D),
  B('Empanadas Doña Luz', 'an empanada shop', '🥟', '#d8a05c', 3, 0, 'down', 2, 4, MAIN_D),
  B('Foto Estudio Flash', 'a photo studio', '📸', '#8c8cba', 3, 0, 'down', 3, 4, MAIN_D),
  B('Sunrise Tea House', 'a tea house', '🍵', '#7fb89a', 4, 0, 'down', 0, 3, MAIN_D),
  B("Don Beto's Butcher", "a butcher's", '🍖', '#c76f6f', 4, 0, 'down', 1, 3, MAIN_D),
  B('Palma Newsstand', 'a newsstand', '📰', '#93a2c0', 4, 0, 'down', 2, 3, MAIN_D),

  /* ── South side of Main Street (face up) ── */
  B("Sofía's Bike Shop", 'a bike shop', '🚲', '#6fb0c0', 0, 1, 'up', 0, 2),
  B('City Tourist Office', 'a tourist office', 'ℹ️', '#5f9fd0', 0, 1, 'up', 1, 2),
  B("Lucho's Barber Shop", 'a barber shop', '💈', '#a98be8', 1, 1, 'up', 0, 2),
  B('Tolima Fruits', "a greengrocer's", '🍎', '#79bf79', 1, 1, 'up', 1, 2),
  B('Cine Estrella', 'a cinema', '🎬', '#a05fc8', 2, 1, 'up', 0, 2),
  B("Camila's Flowers", 'a flower shop', '💐', '#e08bb4', 2, 1, 'up', 1, 2),
  B('Zipa Supermarket', 'a supermarket', '🛒', '#6fbf82', 3, 1, 'up', 0, 2),
  B("Andrés' Pizza", 'a pizzeria', '🍕', '#d06a6a', 3, 1, 'up', 1, 2),
  B('Sunset Bowling', 'a bowling alley', '🎳', '#7f7fd0', 4, 1, 'up', 0, 2),
  B('Quick Fix Repairs', 'a repair shop', '🛠️', '#a08f70', 4, 1, 'up', 1, 2),

  /* ── North side of Oak Street (face down) ── */
  B('Police Station', 'a police station', '🚓', '#5d719e', 0, 1, 'down', 0, 2),
  B('City Courthouse', 'a courthouse', '⚖️', '#b4b0a0', 0, 1, 'down', 1, 2),
  B('City Bank', 'a bank', '🏦', '#b8b884', 1, 1, 'down', 0, 2),
  B('Post Office', 'a post office', '📮', '#7099c5', 1, 1, 'down', 1, 2),
  B('San José Hospital', 'a hospital', '🏥', '#e2e6ee', 2, 1, 'down', 0, 2),
  B('Happy Paws Pet Shop', 'a pet shop', '🐶', '#6fb894', 2, 1, 'down', 1, 2),
  B('Nevado Ice Cream', 'an ice cream shop', '🍦', '#e28fb4', 3, 1, 'down', 0, 2),
  B('Rojas Shoe Store', 'a shoe store', '👟', '#bb8f60', 3, 1, 'down', 1, 2),
  B('Palma Dental Clinic', 'a dental clinic', '🦷', '#8fd0d8', 4, 1, 'down', 0, 2),
  B('Andes Camping Store', 'a camping store', '⛺', '#6f9f6f', 4, 1, 'down', 1, 2),

  /* ── South side of Oak Street (face up) ── */
  B('Fire Station', 'a fire station', '🚒', '#cf5f52', 0, 2, 'up', 0, 2),
  B('Green Cycle Recycling', 'a recycling center', '♻️', '#6fbf8f', 0, 2, 'up', 1, 2),
  B('Public Library', 'a library', '📖', '#bb8f60', 1, 2, 'up', 0, 2),
  B('Music Box', 'a music store', '🎸', '#8f6fc0', 1, 2, 'up', 1, 2),
  B('Central School', 'a school', '🏫', '#d0904f', 2, 2, 'up', 0, 2),
  B('Chocolate Dreams', 'a candy store', '🍫', '#a5714f', 2, 2, 'up', 1, 2),
  B('Mundo Tech', 'an electronics store', '💻', '#6f8fb8', 3, 2, 'up', 0, 2),
  B('La Vaca Steakhouse', 'a steakhouse', '🥩', '#c07070', 3, 2, 'up', 1, 2),
  B('Palma Art Gallery', 'an art gallery', '🖼️', '#c8a0d0', 4, 2, 'up', 0, 2),
  B('Sound Wave Records', 'a record shop', '💿', '#5f8fb0', 4, 2, 'up', 1, 2),

  /* ── North side of River Road (face down) ── */
  B("Lupe's Laundry", 'a laundromat', '🧺', '#6fbcc8', 0, 2, 'down', 0, 2),
  B('Río Bike Rental', 'a bike rental', '🚴', '#e0b060', 0, 2, 'down', 1, 2),
  B("St. Mary's Church", 'a church', '⛪', '#c3b6a6', 1, 2, 'down', 0, 2),
  B('City Museum', 'a museum', '🏛️', '#9a9aae', 1, 2, 'down', 1, 2),
  B('Toy Planet', 'a toy store', '🧸', '#e0bc60', 2, 2, 'down', 0, 2),
  B('Bella Moda Clothing', 'a clothing store', '👗', '#c06fa8', 2, 2, 'down', 1, 2),
  B('Green Garden Center', 'a garden center', '🪴', '#6fb884', 3, 2, 'down', 0, 2),
  B("Don Pipe's Hardware", 'a hardware store', '🔧', '#b07c4f', 3, 2, 'down', 1, 2),
  B('Palma Aquarium', 'an aquarium', '🐠', '#5fa8c8', 4, 2, 'down', 0, 2),
  B('Cheese & Deli', 'a delicatessen', '🧀', '#e0c070', 4, 2, 'down', 1, 2),

  /* ── South side of River Road (face up) ── */
  B('Taxi Central', 'a taxi station', '🚕', '#d8bc60', 0, 3, 'up', 0, 2),
  B('River Ferry Dock', 'a ferry dock', '⛴️', '#6f9fc8', 0, 3, 'up', 1, 2),
  B('Río Sushi', 'a sushi bar', '🍣', '#d07878', 1, 3, 'up', 0, 2),
  B('Fit Zone Gym', 'a gym', '🏋️', '#6b6b8f', 1, 3, 'up', 1, 2),
  B("Karol's Hair Salon", 'a hair salon', '💇', '#d089b8', 2, 3, 'up', 0, 2),
  B('Game Over Arcade', 'an arcade', '🕹️', '#8f6fe0', 2, 3, 'up', 1, 2),
  B('Fresh Fish Market', 'a fish market', '🐟', '#6f9fb8', 3, 3, 'up', 0, 2),
  B('Vet Clinic Los Andes', 'a vet clinic', '🩺', '#6fbc9c', 3, 3, 'up', 1, 2),
  B('Sunset Observatory', 'an observatory', '🔭', '#7f7f9f', 4, 3, 'up', 0, 2),
  B('Handmade Pottery', 'a pottery studio', '🏺', '#c08f60', 4, 3, 'up', 1, 2),

  /* ── North side of Market Street (face down) ── */
  B('City Hall', 'a city hall', '🏢', '#8a97ab', 0, 3, 'down', 0, 2),
  B('Public Swimming Pool', 'a swimming pool', '🏊', '#5fb8d8', 0, 3, 'down', 1, 2),
  B('Mega Mall', 'a shopping mall', '🛍️', '#c06fa8', 1, 3, 'down', 0, 2),
  B('Burger Bros', 'a burger place', '🍔', '#dc9a5f', 1, 3, 'down', 1, 2),
  B("Lula's Juice Bar", 'a juice bar', '🥤', '#e8a05f', 2, 3, 'down', 0, 2),
  B('Paper & Pen', 'a stationery shop', '✏️', '#7f9cd8', 2, 3, 'down', 1, 2),
  B('Dream Travel Agency', 'a travel agency', '🌎', '#6f9fb8', 3, 3, 'down', 0, 2),
  B('Luna Jewelry', 'a jewelry store', '💍', '#9a80c0', 3, 3, 'down', 1, 2),
  B('Palma Farmers Market', 'a farmers market', '🥕', '#c8a85f', 4, 3, 'down', 0, 2),
  B('Watch & Clock Shop', "a watchmaker's", '⌚', '#8f9fb0', 4, 3, 'down', 1, 2),

  /* ── South side of Market Street (face up): the big landmarks ── */
  B('Gas Station', 'a gas station', '⛽', '#c07a5f', 0, 4, 'up', 0, 2, 3.0),
  B('Sparkle Car Wash', 'a car wash', '🚿', '#6fb8d0', 0, 4, 'up', 1, 2, 3.0),
  B('National Stadium', 'a stadium', '🏟️', '#6fa5b0', 1, 4, 'up', 0, 1, 6.0, 'stadium'),
  B('El Dorado Airport', 'an airport', '✈️', '#7fa5c0', 2, 4, 'up', 0, 1, 4.4, 'airport'),
  B('Bus Terminal', 'a bus terminal', '🚌', '#d0a75f', 3, 4, 'up', 0, 1, 3.6, 'terminal'),
  B('Central Train Station', 'a train station', '🚉', '#a08fb0', 4, 4, 'up', 0, 2, 3.6),
  B('Palma Concert Hall', 'a concert hall', '🎼', '#b07fa0', 4, 4, 'up', 1, 2, 3.6),

  /* ── South side of Sunset Boulevard (face up): the new district ── */
  B('Sunset Diner', 'a diner', '🍳', '#e0956f', 1, 5, 'up', 0, 3),
  B('Comic Kingdom', 'a comic shop', '🦸', '#6f8fe0', 1, 5, 'up', 1, 3),
  B('Blue Wave Surf Shop', 'a surf shop', '🏄', '#5fbfc8', 1, 5, 'up', 2, 3),
  B('Astro Planetarium', 'a planetarium', '🪐', '#7f6fb0', 2, 5, 'up', 0, 3),
  B('Sunset Ice Rink', 'an ice rink', '⛸️', '#9fd8e8', 2, 5, 'up', 1, 3),
  B('Verde Grocery', 'a grocery store', '🥬', '#7fbf6f', 2, 5, 'up', 2, 3),
  B('Andes Radio Station', 'a radio station', '📻', '#b0906f', 3, 5, 'up', 0, 3),
  B('Sunset Hostel', 'a hostel', '🛏️', '#c0a0d0', 3, 5, 'up', 1, 3),
  B('Mountain Gear Outfitters', 'an outdoor store', '🥾', '#8fa06f', 3, 5, 'up', 2, 3),
];

/** Storey heights. The ground floor is taller so a shopfront, an awning and
 *  a readable sign all fit between the pavement and the first-floor windows. */
export const GROUND_H = 2.3;
export const FLOOR_H = 1.15;

/** Landmarks stay low and wide; ordinary shops get 2–5 storeys. */
const LOW_PROFILE =
  /stadium|airport|bus terminal|gas station|car wash|hospital|church|museum|school|city hall|courthouse|train station|concert hall|planetarium|observatory|aquarium|swimming pool|farmers market|ice rink|ferry dock|recycling center|bowling alley/;

const heightOf = (floors: number): number => GROUND_H + (floors - 1) * FLOOR_H;

function deriveHeight(b: RawBuilding, rand: () => number): { height: number; floors: number } {
  const area = b.w * b.h;
  if (LOW_PROFILE.test(b.type)) {
    const floors = area > 20 ? 2 : 3;
    return { height: heightOf(floors), floors };
  }
  // Narrow Main-Street shops become the tall thin townhouses of the skyline.
  const base = b.w < 3 ? 3 : 2;
  const floors = base + Math.floor(rand() * 3);
  return { height: heightOf(floors), floors };
}

export const BUILDINGS: Building[] = (() => {
  const rand = mulberry32(20260727);
  return RAW.map((b) => ({ ...b, ...deriveHeight(b, rand) }) satisfies Building);
})();

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));

/* ---------------------------------------------------------------- *
 * Spatial relations — the grammar engine for prepositions of place. *
 * ---------------------------------------------------------------- */

export function blockOf(b: Building): BlockBounds | undefined {
  return BLOCK_BOUNDS.find((k) => b.x >= k.x0 - 0.5 && b.x + b.w <= k.x1 + 1.5);
}

export interface Relations {
  left: Building | null;
  right: Building | null;
  opp: Building | null;
  corner: string | null;
}

export function relationsOf(b: Building): Relations {
  const sameSide = BUILDINGS.filter((o) => o !== b && o.street === b.street && o.face === b.face);
  const sameBlock = sameSide.filter((o) => blockOf(o) === blockOf(b));
  const left = sameBlock.filter((o) => o.x < b.x).sort((p, q) => q.x - p.x)[0] ?? null;
  const right = sameBlock.filter((o) => o.x > b.x).sort((p, q) => p.x - q.x)[0] ?? null;
  const opp =
    BUILDINGS.find(
      (o) =>
        o !== b &&
        o.street === b.street &&
        o.face !== b.face &&
        o.x < b.x + b.w - 0.5 &&
        o.x + o.w > b.x + 0.5,
    ) ?? null;
  const blk = blockOf(b);
  let corner: string | null = null;
  if (blk) {
    if (blk.left && Math.abs(b.x - blk.x0) < 1.2) corner = blk.left;
    if (blk.right && Math.abs(b.x + b.w - (blk.x1 + 1)) < 1.2) corner = blk.right;
  }
  return { left, right, opp, corner };
}

/** Tile-space position of a building's door (where the student must stand). */
export function doorOf(b: Building): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.face === 'up' ? b.y : b.y + b.h };
}
