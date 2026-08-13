/**
 * City geometry builder.
 *
 * The buildings, the trees, the street lamps and the road furniture are Kenney
 * GLB models (`render/kits.ts`); the ground they stand on — carriageway, kerbs,
 * paving, road markings and every painted street name — stays procedural,
 * because it is *derived from the layout* and the direction quests depend on it
 * agreeing with the grid to the tile.
 *
 * Both halves obey the same rule: **merge per material**. A kit model carries
 * no material of its own worth keeping, only a UV into its kit's palette atlas,
 * so ninety buildings collapse into one mesh per kit and colour variation
 * exactly as ninety procedural shells used to collapse into one mesh per
 * colour. The whole city is still a few dozen draw calls.
 *
 * What gives the result its depth:
 *   1. modelled detail — balconies, shopfronts, dormers, roof plant — instead
 *      of boxes with a texture pretending to be them;
 *   2. procedural textures on the ground, UV-baked so they tile at a constant
 *      world size, with ambient occlusion baked into a vertex-colour attribute;
 *   3. a night atlas derived from each kit's palette, so the dark end of every
 *      colour ramp — which is where Kenney draws glass — lights up at dusk;
 *   4. emissive surfaces registered with the palette, so the day/night cycle
 *      can switch every window, lamp and sign on in one call.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  CanvasTexture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  CROSSINGS,
  FURNITURE_OFFSET,
  GH,
  GW,
  SIDEWALK_W,
  kerbLine,
  HROADS,
  INTERSECTIONS,
  PARKS,
  ROAD_OVERRUN,
  ROAD_W,
  VROADS,
  X_BANDS,
  Y_BANDS,
  hRowSet,
  isRoad,
  isSidewalk,
  vColSet,
  type Zone,
} from './layout';
import { BUILDINGS, type Building } from './buildings';
import { solid, solidRow } from './props';
import { TREES, shellFor, wantsRoofPlant } from './kit';
import {
  kitMaterial,
  localGeometry,
  model,
  placedGeometry,
  variationCount,
  type KitMatOptions,
  type KitName,
  type Placement,
} from './kits';
import { PALETTE, mat, type MatOptions } from './palette';
import { TILE_SIZE, uvScaleBox, uvScaleUniform } from './textures';
import {
  pavementNameTexture,
  shopSignTexture,
  streetBladeTexture,
  zoneSignTexture,
} from './signage';
import { mulberry32 } from '../core/rng';

/** Ground level of pavements; roads sit at y = 0. */
export const CURB = 0.16;

export { X_BANDS, Y_BANDS };

/* ------------------------------------------------------------------ *
 * Geometry batching                                                   *
 * ------------------------------------------------------------------ */

interface Bucket {
  color: string;
  opts: MatOptions;
  geos: BufferGeometry[];
}
type GeoBag = Map<string, Bucket>;

const keyOf = (color: string, opts: MatOptions): string =>
  `${color}|${opts.map ?? '-'}|${opts.flat ? 1 : 0}|${opts.vertexColors ? 1 : 0}|${
    opts.seeThrough ? 1 : 0
  }|${opts.glow ?? '-'}|${opts.roughness ?? '-'}|${opts.metalness ?? '-'}`;

function push(bags: GeoBag, color: string, opts: MatOptions, geo: BufferGeometry): void {
  const key = keyOf(color, opts);
  let bucket = bags.get(key);
  if (!bucket) bags.set(key, (bucket = { color, opts, geos: [] }));
  bucket.geos.push(geo);
}

/**
 * Bake ambient occlusion into vertex colours.
 *
 * Two cues, both cheap and both things a real renderer would spend an SSAO
 * pass on: surfaces darken as they approach the ground, and downward-facing
 * faces (the underside of a balcony, a cornice, an awning) darken further.
 */
function bakeAo(geo: BufferGeometry, groundY: number, reach = 2.2): BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) - groundY);
    let shade = 0.5 + 0.5 * Math.min(1, h / reach);
    if (nor && nor.getY(i) < -0.5) shade *= 0.62;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

/** A plain, uniformly lit colour attribute — needed so a merged batch is consistent. */
function flatColor(geo: BufferGeometry, shade = 1): BufferGeometry {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3).fill(shade);
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

interface BoxOpts extends MatOptions {
  /** Bake AO relative to this ground height. */
  ao?: number;
  /** Uniform shade instead of AO (still writes the colour attribute). */
  shade?: number;
  round?: number;
  /** Rotation about the Y axis, applied about the box's own centre. */
  rotY?: number;
}

function box(
  bags: GeoBag,
  color: string,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  opts: BoxOpts = {},
): void {
  // Everything is normalised to non-indexed geometry: `RoundedBoxGeometry` is
  // non-indexed and `BoxGeometry` is indexed, and `mergeGeometries` refuses to
  // mix the two. UVs are scaled *before* the conversion, while the box still
  // has its tidy four-vertices-per-face layout.
  let geo: BufferGeometry;
  if (opts.round !== undefined) {
    geo = new RoundedBoxGeometry(w, h, d, 1, Math.min(opts.round, w / 2.5, h / 2.5, d / 2.5));
    if (opts.map) uvScaleUniform(geo, (w + h + d) / 3 / TILE_SIZE);
  } else {
    const boxGeo = new BoxGeometry(w, h, d);
    if (opts.map) uvScaleBox(boxGeo, w, h, d);
    geo = boxGeo.toNonIndexed();
    boxGeo.dispose();
  }
  if (opts.rotY) geo.rotateY(opts.rotY);
  geo.translate(x, y, z);
  if (opts.vertexColors) {
    if (opts.ao !== undefined) bakeAo(geo, opts.ao);
    else flatColor(geo, opts.shade ?? 1);
  }
  push(bags, color, opts, geo);
}

/** A rectangular ring of four boxes — stadium tiers, parapets, planters. */
function ring(
  bags: GeoBag,
  color: string,
  cx: number,
  cz: number,
  halfW: number,
  halfD: number,
  thick: number,
  y: number,
  height: number,
  opts: BoxOpts = {},
): void {
  box(bags, color, halfW * 2, height, thick, cx, y, cz - halfD + thick / 2, opts);
  box(bags, color, halfW * 2, height, thick, cx, y, cz + halfD - thick / 2, opts);
  const inner = halfD * 2 - thick * 2;
  if (inner > 0.05) {
    box(bags, color, thick, height, inner, cx - halfW + thick / 2, y, cz, opts);
    box(bags, color, thick, height, inner, cx + halfW - thick / 2, y, cz, opts);
  }
}

/**
 * The same trick as `GeoBag`, for kit models.
 *
 * Everything a kit exports shares one texture, so the only thing that splits a
 * batch is which colour variation and which material options a piece wants.
 * Collect by that, merge once, and a thousand cones, planters, lamps and fences
 * cost a handful of draw calls.
 */
class KitBag {
  private buckets = new Map<
    string,
    { kit: KitName; opts: KitMatOptions; geos: BufferGeometry[] }
  >();

  add(kit: KitName, name: string, p: Placement, opts: KitMatOptions = {}): void {
    const key = `${kit}|${opts.variation ?? 0}|${opts.seeThrough ? 's' : '-'}|${
      opts.litWindows ? 'w' : '-'
    }|${opts.roughness ?? '-'}`;
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { kit, opts, geos: [] }));
    bucket.geos.push(placedGeometry(model(kit, name), p));
  }

  flush(parent: Group, cast = true, receive = true): void {
    for (const bucket of this.buckets.values()) {
      const merged = mergeGeometries(bucket.geos, false);
      bucket.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new Mesh(merged, kitMaterial(bucket.kit, bucket.opts));
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}

function flush(bags: GeoBag, parent: Group, cast = true, receive = true): void {
  for (const bucket of bags.values()) {
    if (!bucket.geos.length) continue;
    const merged = mergeGeometries(bucket.geos, false);
    if (!merged) continue;
    bucket.geos.forEach((g) => g.dispose());
    const mesh = new Mesh(merged, mat(bucket.color, bucket.opts));
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
  }
  bags.clear();
}

/* ------------------------------------------------------------------ *
 * Unlit decals (road paint, lettering)                                *
 * ------------------------------------------------------------------ */

/**
 * Flat markings are drawn with unlit materials so they stay crisp inside a
 * shadow — but that also means the sun can never dim them, so every one of
 * them is registered here and tinted by hand when night falls.
 */
interface Tintable {
  material: MeshBasicMaterial;
  base: Color;
  /** How dark this surface goes at midnight (0 = black, 1 = unchanged). */
  floor: number;
}

class DecalPainter {
  private tintables: Tintable[] = [];

  add(mesh: Mesh, floor = 0.42): void {
    this.addMaterial(mesh.material as MeshBasicMaterial, floor);
  }

  addMaterial(material: MeshBasicMaterial, floor = 0.42): void {
    this.tintables.push({ material, base: material.color.clone(), floor });
  }

  setNight(night: number): void {
    for (const t of this.tintables) {
      const k = 1 - (1 - t.floor) * night;
      t.material.color.setRGB(t.base.r * k, t.base.g * k, t.base.b * k);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Lamplight                                                           *
 * ------------------------------------------------------------------ */

/** A soft radial falloff, used for the pool of light under every lamp. */
let poolTexture: CanvasTexture | null = null;
function lampPoolTexture(): CanvasTexture {
  if (poolTexture) return poolTexture;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,214,150,.8)');
  g.addColorStop(0.35, 'rgba(255,198,128,.34)');
  g.addColorStop(1, 'rgba(255,188,110,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  poolTexture = new CanvasTexture(cv);
  poolTexture.colorSpace = SRGBColorSpace;
  poolTexture.wrapS = RepeatWrapping;
  poolTexture.wrapT = RepeatWrapping;
  return poolTexture;
}

/**
 * The warm circles a street lamp throws on the pavement.
 *
 * Real point lights would be the honest answer, but a hundred of them is not
 * something a classroom laptop will render. An additive decal on the ground
 * costs one draw call for the whole city and reads exactly the same from the
 * game's camera.
 */
class Lamplight {
  private mesh: Mesh | null = null;

  build(parent: Group, spots: { x: number; z: number; r: number }[]): void {
    if (!spots.length) return;
    const geos = spots.map((s) => quad(s.r * 2, s.r * 2, s.x, s.z, CURB + 0.07));
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    this.mesh = new Mesh(
      merged,
      new MeshBasicMaterial({
        map: lampPoolTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: true,
      }),
    );
    this.mesh.renderOrder = 3;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  setNight(night: number): void {
    if (!this.mesh) return;
    const opacity = Math.max(0, night - 0.15) / 0.85;
    (this.mesh.material as MeshBasicMaterial).opacity = opacity * 0.42;
    this.mesh.visible = opacity > 0.02;
  }
}

/* ------------------------------------------------------------------ *
 * Ground: roads, kerbs, paving, markings, street names                *
 * ------------------------------------------------------------------ */

/** A flat quad lying on the ground, ready to be merged. */
function quad(w: number, d: number, x: number, z: number, y: number): BufferGeometry {
  const g = new PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function buildGround(parent: Group, painter: DecalPainter): void {
  const rand = mulberry32(4242);
  const bags: GeoBag = new Map();
  const road: MatOptions = { map: 'asphalt', vertexColors: true };
  const pave: MatOptions = { map: 'paving', vertexColors: true };
  const turf: MatOptions = { map: 'grass', vertexColors: true };

  // Roads: one long slab per street (asphalt sits at y = 0). Each one runs
  // past the last block and out into the woodland, so the grid never ends on
  // a visible edge.
  const RW = GW + ROAD_OVERRUN * 2;
  const RH = GH + ROAD_OVERRUN * 2;
  for (const r of HROADS) {
    box(bags, PALETTE.asphalt, RW, 0.18, ROAD_W, GW / 2, -0.09, r.rows[0] + ROAD_W / 2, {
      ...road,
      shade: 1,
    });
  }
  for (const r of VROADS) {
    box(bags, PALETTE.asphalt, ROAD_W, 0.18, RH, r.cols[0] + ROAD_W / 2, -0.09, GH / 2, {
      ...road,
      shade: 1,
    });
  }

  // Blocks: a kerb slab, then paving, then the grass core.
  for (const xb of X_BANDS) {
    for (const yb of Y_BANDS) {
      const w = xb.b - xb.a + 1;
      const d = yb.b - yb.a + 1;
      const cx = xb.a + w / 2;
      const cz = yb.a + d / 2;
      box(bags, PALETTE.curb, w, CURB, d, cx, CURB / 2, cz, { ...pave, shade: 0.88 });
      box(bags, PALETTE.sidewalk, w - 0.08, 0.03, d - 0.08, cx, CURB, cz, { ...pave, shade: 1 });

      // Grass core = the block minus its pavement ring. The ring is as wide as
      // the pavement the pedestrian rules allow you to walk on, or the paving
      // and the walkable ground stop agreeing and the city grows lawns you can
      // stand on and paving you cannot.
      const l = isRoad(xb.a - 1, yb.a) ? SIDEWALK_W : 0;
      const r = isRoad(xb.b + 1, yb.a) ? SIDEWALK_W : 0;
      const t = isRoad(xb.a, yb.a - 1) ? SIDEWALK_W : 0;
      const b = isRoad(xb.a, yb.b + 1) ? SIDEWALK_W : 0;
      const gw = w - l - r;
      const gd = d - t - b;
      if (gw > 0.5 && gd > 0.5) {
        box(
          bags,
          rand() < 0.5 ? PALETTE.grass : PALETTE.grassDark,
          gw,
          0.04,
          gd,
          xb.a + l + gw / 2,
          CURB + 0.02,
          yb.a + t + gd / 2,
          { ...turf, shade: 1 },
        );
      }
    }
  }
  flush(bags, parent, false, true);

  /* ---- road paint ---- */
  const half = ROAD_W / 2;
  const marks: BufferGeometry[] = [];
  const solids: BufferGeometry[] = [];

  for (const r of HROADS) {
    const z = r.rows[0] + half;
    // Dashed centre line.
    for (let x = 0.8 - ROAD_OVERRUN; x < GW + ROAD_OVERRUN; x += 2.6) {
      if (vColSet.has(Math.floor(x)) || vColSet.has(Math.floor(x + 1.4))) continue;
      marks.push(quad(1.4, 0.12, x, z, 0.014));
    }
    // Solid edge lines, a hand's width in from the kerb.
    for (const off of [-half + 0.42, half - 0.42]) {
      solids.push(quad(RW, 0.1, GW / 2, z + off, 0.013));
    }
  }
  for (const r of VROADS) {
    const x = r.cols[0] + half;
    for (let z = 0.8 - ROAD_OVERRUN; z < GH + ROAD_OVERRUN; z += 2.6) {
      if (hRowSet.has(Math.floor(z)) || hRowSet.has(Math.floor(z + 1.4))) continue;
      marks.push(quad(0.12, 1.4, x, z, 0.014));
    }
    for (const off of [-half + 0.42, half - 0.42]) {
      solids.push(quad(0.1, RH, x + off, GH / 2, 0.013));
    }
  }

  // Stop lines: one on each approach to every junction, behind the crossing
  // rather than across it — cars stop before the zebra, not on it.
  const STOP_LINE = half + 2.9;
  for (const it of INTERSECTIONS) {
    for (const s of [-1, 1]) {
      solids.push(quad(half - 0.4, 0.26, it.cx + s * (half / 2 + 0.2), it.cy + s * STOP_LINE, 0.015));
      solids.push(quad(0.26, half - 0.4, it.cx - s * STOP_LINE, it.cy + s * (half / 2 + 0.2), 0.015));
    }
  }

  const dashMesh = new Mesh(
    mergeGeometries(marks, false)!,
    new MeshBasicMaterial({ color: PALETTE.laneMark }),
  );
  dashMesh.matrixAutoUpdate = false;
  parent.add(dashMesh);
  painter.add(dashMesh, 0.5);
  marks.forEach((g) => g.dispose());

  const solidMesh = new Mesh(
    mergeGeometries(solids, false)!,
    new MeshBasicMaterial({ color: '#e6dfc6' }),
  );
  solidMesh.matrixAutoUpdate = false;
  parent.add(solidMesh);
  painter.add(solidMesh, 0.5);
  solids.forEach((g) => g.dispose());

  /* ---- zebra crossings ----
     A real zebra: bars that run kerb to kerb, the way the pedestrian walks,
     repeated along the road so a driver sees a ladder across their lane.

     What was here before laid every bar at the *same* point on the road and
     spread them sideways instead, so all eight overlapped into a single long
     white stripe down the middle of the crossing — which is what you saw from
     the pavement, and it read as a lane marking rather than a crossing.

     The bars come off the `CROSSINGS` rectangles, which is also what
     `walkable()` tests, so the paint is the permission. */
  const zebra: BufferGeometry[] = [];
  /** Bar width along the road, and bar-to-bar pitch. About 50 cm of each. */
  const BAR = 0.36;
  const PITCH = 0.65;
  for (const c of CROSSINGS) {
    const bars = Math.max(2, Math.floor((c.along * 2) / PITCH));
    for (let i = 0; i < bars; i++) {
      // Centred in the band, so an even count is not lopsided.
      const o = (i - (bars - 1) / 2) * PITCH;
      zebra.push(
        c.axis === 'z'
          ? quad(BAR, c.across * 2, c.cx + o, c.cy, 0.016)
          : quad(c.across * 2, BAR, c.cx, c.cy + o, 0.016),
      );
    }
  }
  const zebraMesh = new Mesh(
    mergeGeometries(zebra, false)!,
    new MeshBasicMaterial({ color: PALETTE.crosswalk }),
  );
  zebraMesh.matrixAutoUpdate = false;
  parent.add(zebraMesh);
  painter.add(zebraMesh, 0.55);
  zebra.forEach((g) => g.dispose());
}

/* ------------------------------------------------------------------ *
 * Street names painted on the pavement                                *
 * ------------------------------------------------------------------ */

/**
 * The name of the street, painted along the kerb once per block on both
 * sides. From the game's near-overhead camera this is the *only* label a
 * student can read without walking up to a post, which is exactly why the
 * directions quests can talk about "Oak Street" and be followed.
 */
function buildPavementNames(parent: Group, painter: DecalPainter): void {
  const group = new Group();
  const cache = new Map<string, MeshBasicMaterial>();
  // Every repeat of one street's name shares a texture, so they all merge into
  // a single mesh: nine draw calls for the whole city's lettering.
  const parts = new Map<string, BufferGeometry[]>();

  const material = (name: string): MeshBasicMaterial => {
    let m = cache.get(name);
    if (!m) {
      m = new MeshBasicMaterial({
        map: pavementNameTexture(name),
        transparent: true,
        depthWrite: false,
        opacity: 0.92,
      });
      cache.set(name, m);
    }
    return m;
  };

  const decal = (name: string, x: number, z: number, len: number, vertical: boolean): void => {
    const geo = new PlaneGeometry(len, len / 6.4);
    geo.rotateX(-Math.PI / 2);
    if (vertical) geo.rotateY(-Math.PI / 2);
    geo.translate(x, CURB + 0.055, z);
    let list = parts.get(name);
    if (!list) parts.set(name, (list = []));
    list.push(geo);
  };

  for (const r of HROADS) {
    // Centred on the pavement rather than hugging the kerb: with three tiles to
    // play with, lettering pushed against the road reads as a mistake.
    const north = r.rows[0] - SIDEWALK_W / 2;
    const south = r.rows[ROAD_W - 1] + 1 + SIDEWALK_W / 2;
    for (const band of X_BANDS) {
      const w = band.b - band.a + 1;
      if (w < 6) continue;
      const cx = band.a + w / 2;
      const len = Math.min(9.5, w - 1.4);
      if (north > 0) decal(r.name, cx, north, len, false);
      if (south < GH) decal(r.name, cx, south, len, false);
    }
  }
  for (const r of VROADS) {
    const west = r.cols[0] - SIDEWALK_W / 2;
    const east = r.cols[ROAD_W - 1] + 1 + SIDEWALK_W / 2;
    for (const band of Y_BANDS) {
      const d = band.b - band.a + 1;
      if (d < 6) continue;
      const cz = band.a + d / 2;
      const len = Math.min(9.5, d - 1.4);
      if (west > 0) decal(r.name, west, cz, len, true);
      if (east < GW) decal(r.name, east, cz, len, true);
    }
  }

  for (const [name, list] of parts) {
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new Mesh(merged, material(name));
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  for (const m of cache.values()) painter.addMaterial(m, 0.34);
  parent.add(group);
}

/**
 * Enamel street blades on a post at every corner: the horizontal street on
 * one plate, the avenue on the other, crossed at right angles like the real
 * thing.
 */
function buildStreetBlades(parent: Group): void {
  const bags: GeoBag = new Map();
  const group = new Group();
  const trim: BoxOpts = { vertexColors: true, ao: CURB };
  const blades = new Map<string, MeshBasicMaterial>();
  const plates = new Map<string, BufferGeometry[]>();

  const bladeMat = (name: string, avenue: boolean): MeshBasicMaterial => {
    let m = blades.get(name);
    if (!m) {
      m = new MeshBasicMaterial({ map: streetBladeTexture(name, avenue), toneMapped: false });
      blades.set(name, m);
    }
    return m;
  };

  const half = ROAD_W / 2;
  for (const it of INTERSECTIONS) {
    // One post per junction, on the north-west corner, out of the crossing.
    const px = it.cx - half - 0.85;
    const pz = it.cy - half - 0.85;
    box(bags, PALETTE.darkMetal, 0.13, 3.5, 0.13, px, CURB + 1.75, pz, { ...trim, round: 0.05 });
    box(bags, PALETTE.darkMetal, 0.3, 0.16, 0.3, px, CURB + 3.5, pz, trim);

    const hName = HROADS[it.hi].name;
    const vName = VROADS[it.vi].name;
    for (const [name, avenue, rot] of [
      [hName, false, 0],
      [vName, true, Math.PI / 2],
    ] as const) {
      bladeMat(name, avenue);
      let list = plates.get(name);
      if (!list) plates.set(name, (list = []));
      // Front and back, so the plate is readable from either approach.
      for (const face of [rot, rot + Math.PI]) {
        const geo = new PlaneGeometry(2.5, 0.52);
        geo.rotateY(face);
        geo.translate(px, CURB + 3.16, pz);
        list.push(geo);
      }
    }
  }
  for (const [name, list] of plates) {
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (merged) group.add(new Mesh(merged, blades.get(name)!));
  }
  flush(bags, parent);
  parent.add(group);
}

/* ------------------------------------------------------------------ *
 * Buildings                                                           *
 * ------------------------------------------------------------------ */

export interface BuildingView {
  building: Building;
  /** Height of the shell that actually got built, in tiles. */
  top: number;
}

/*
 * There used to be a floating name plate over every place, shown for the two
 * nearest as you walked. It was written for a camera looking down at the
 * rooftops; from the pavement a plate is the size of a bus and it covers the
 * shopfront whose painted sign you are supposed to be reading. The signage is
 * on the buildings and on the pavement, where signage belongs, so the plates
 * are gone rather than merely hidden — a sprite and a canvas each, ninety-four
 * times over, for something nobody should see.
 */

/* --------------------------- landmark shells --------------------------- */

/**
 * The National Stadium, built as the thing it is: an oval-ish bowl of stepped
 * seating around a marked pitch, wrapped in a colonnaded facade, roofed with a
 * cantilevered canopy and lit by four floodlight towers. It used to be a box
 * with a sign on it.
 */
function buildStadium(bags: GeoBag, b: Building): void {
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;
  const base = CURB;
  const hw = b.w / 2;
  const hd = b.h / 2;
  const concrete: BoxOpts = { map: 'wall', vertexColors: true, seeThrough: true, ao: base };
  const trim: BoxOpts = { vertexColors: true, seeThrough: true, ao: base };
  const flat = (shade: number): BoxOpts => ({ vertexColors: true, seeThrough: true, shade });

  /* ---- forecourt and pitch ---- */
  box(bags, PALETTE.curb, b.w + 0.6, 0.12, b.h + 0.6, cx, base + 0.06, cz, {
    map: 'paving',
    vertexColors: true,
    shade: 0.94,
  });
  const pw = b.w - 4.4;
  const pd = b.h - 4.0;
  box(bags, PALETTE.pitch, pw, 0.06, pd, cx, base + 0.15, cz, {
    map: 'grass',
    vertexColors: true,
    shade: 1.15,
  });
  for (let i = 0; i < 6; i++) {
    if (i % 2) continue;
    box(bags, PALETTE.pitchStripe, pw / 6, 0.02, pd, cx - pw / 2 + (pw / 6) * (i + 0.5), base + 0.19, cz, flat(1.15));
  }
  box(bags, '#f6f8f4', 0.09, 0.02, pd - 0.3, cx, base + 0.21, cz, flat(1.2));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    box(bags, '#f6f8f4', 0.14, 0.02, 0.14, cx + Math.cos(a) * 0.85, base + 0.21, cz + Math.sin(a) * 0.62, flat(1.2));
  }
  for (const s of [-1, 1]) {
    box(bags, '#f6f8f4', 0.1, 0.55, 1.4, cx + s * (pw / 2 - 0.06), base + 0.42, cz, trim);
  }

  /* ---- three tiers of seating, stepping up and inward ---- */
  const seats = ['#3f6f9c', '#c9563f', '#3f6f9c'];
  for (let t = 0; t < 3; t++) {
    const inset = 0.6 + t * 0.5;
    const y = base + 0.34 + t * 0.72;
    ring(bags, PALETTE.curb, cx, cz, hw - inset + 0.26, hd - inset + 0.26, 0.52, y, 0.72, concrete);
    ring(bags, seats[t], cx, cz, hw - inset, hd - inset, 0.28, y + 0.48, 0.22, flat(1.05));
  }

  /* ---- facade: a colonnade of pilasters with banners between them ---- */
  const wallH = 3.7;
  ring(bags, b.color, cx, cz, hw, hd, 0.45, base + wallH / 2, wallH, concrete);
  // Pale liner just inside the club colour. From the street you look down into
  // this surface far more than at the pitch, so it has to read as concrete
  // catching the sun rather than as the inside of a painted box.
  ring(bags, '#e8e3d5', cx, cz, hw - 0.42, hd - 0.42, 0.16, base + wallH / 2, wallH, concrete);
  const bays = 12;
  for (let i = 0; i <= bays; i++) {
    const x = cx - hw + (b.w * i) / bays;
    for (const s of [-1, 1]) {
      box(bags, '#eee7d8', 0.3, wallH, 0.22, x, base + wallH / 2, cz + s * (hd - 0.05), trim);
    }
    if (i < bays) {
      // A club banner in every second bay, alternating with the seat colours.
      const bx = cx - hw + (b.w * (i + 0.5)) / bays;
      const colour = i % 2 ? seats[0] : seats[1];
      for (const s of [-1, 1]) {
        box(bags, colour, (b.w / bays) * 0.6, 1.5, 0.1, bx, base + 2.55, cz + s * (hd - 0.02), flat(1));
      }
    }
  }
  for (const s of [-1, 1]) {
    box(bags, '#e6ded0', b.w + 0.24, 0.34, 0.34, cx, base + wallH + 0.17, cz + s * hd, trim);
    box(bags, '#e6ded0', 0.34, 0.34, b.h + 0.24, cx + s * hw, base + wallH + 0.17, cz, trim);
  }
  // Side walls get the same colonnade, so orbiting round never finds a blank.
  const sideBays = 8;
  for (let i = 0; i <= sideBays; i++) {
    const z = cz - hd + (b.h * i) / sideBays;
    for (const s of [-1, 1]) {
      box(bags, '#eee7d8', 0.22, wallH, 0.3, cx + s * (hw - 0.05), base + wallH / 2, z, trim);
    }
  }

  /* ---- gates on the street front, with steps and a lit lintel ---- */
  const front = b.face === 'up' ? -1 : 1;
  for (const o of [-hw * 0.55, 0, hw * 0.55]) {
    box(bags, '#2f2a3f', 1.5, 2.1, 0.34, cx + o, base + 1.05, cz + front * (hd - 0.18), flat(0.72));
    box(bags, PALETTE.gold, 1.75, 0.18, 0.4, cx + o, base + 2.22, cz + front * (hd - 0.18), {
      ...trim,
      glow: 'sign',
    });
    box(bags, PALETTE.curb, 2.0, 0.09, 0.7, cx + o, base + 0.05, cz + front * (hd + 0.28), {
      map: 'paving',
      vertexColors: true,
      shade: 0.96,
    });
  }

  /* ---- cantilevered roof over the stands ---- */
  // The soffit is deliberately the brightest surface in the building. Seen
  // from the street the inside of the bowl is a deep recess, and a dark fascia
  // there turned the whole stadium into a black hole in the middle of a block.
  ring(bags, '#cfd4dc', cx, cz, hw + 0.25, hd + 0.25, 0.95, base + 4.4, 0.18, concrete);
  ring(bags, '#f8fafc', cx, cz, hw + 0.12, hd + 0.12, 0.8, base + 4.28, 0.06, flat(1.25));
  ring(bags, '#e8edf2', cx, cz, hw - 0.62, hd - 0.62, 0.14, base + 3.9, 0.72, flat(1.15));
  // Scoreboard hung from the far side, so there is something to look at when
  // the camera peers over the near wall.
  {
    const s = b.face === 'up' ? 1 : -1;
    box(bags, '#1d1a2e', 3.0, 1.15, 0.16, cx, base + 3.15, cz + s * (hd - 0.6), flat(0.8));
    box(bags, '#8ef0b0', 2.6, 0.8, 0.06, cx, base + 3.15, cz + s * (hd - 0.7), {
      vertexColors: true,
      shade: 1,
      glow: 'sign',
    });
  }

  /* ---- floodlight towers and flagpoles ---- */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = cx + sx * (hw - 0.3);
      const z = cz + sz * (hd - 0.3);
      box(bags, PALETTE.metal, 0.3, 6.0, 0.3, x, base + 3.0, z, { ...trim, round: 0.08 });
      box(bags, PALETTE.darkMetal, 1.6, 0.2, 0.65, x, base + 6.0, z, trim);
      for (let i = 0; i < 4; i++) {
        box(bags, PALETTE.windowLit, 0.32, 0.36, 0.54, x - 0.58 + i * 0.39, base + 6.24, z, {
          vertexColors: true,
          shade: 1,
          glow: 'lamp',
        });
      }
    }
  }
  for (let i = 1; i < 4; i++) {
    const x = cx - hw + (b.w * i) / 4;
    for (const s of [-1, 1]) {
      box(bags, PALETTE.metal, 0.07, 1.5, 0.07, x, base + 5.25, cz + s * (hd + 0.1), trim);
      box(bags, i % 2 ? seats[0] : seats[1], 0.5, 0.34, 0.05, x + 0.28, base + 5.8, cz + s * (hd + 0.1), flat(1.1));
    }
  }
}

/* ------------------------------ kit shells ------------------------------ */

/**
 * The shop fascia: the canvas sign a student reads to know where they are.
 *
 * The kit models come with modelled shopfronts but no words on them, and the
 * words are the whole point, so every place still gets its own painted board
 * bolted to the wall that faces the street.
 */
function addFascia(group: Group, b: Building, height: number): void {
  const width = Math.min(b.w * 0.86, 3.4);
  const sign = new Mesh(
    new PlaneGeometry(width, width / 4.36),
    new MeshBasicMaterial({ map: shopSignTexture(b.name, b.emoji, b.color), transparent: true }),
  );
  const front = b.face === 'up' ? b.y - 0.08 : b.y + b.h + 0.08;
  // Above the door but below the first-floor windows, wherever the model put
  // them: a third of the way up, never so low that a doorway swallows it.
  sign.position.set(b.x + b.w / 2, CURB + Math.min(2.3, Math.max(1.45, height * 0.3)), front);
  sign.rotation.y = b.face === 'up' ? Math.PI : 0;
  group.add(sign);
}

function buildBuildings(parent: Group): BuildingView[] {
  // The stadium is the one place in the city with no counterpart in any kit, so
  // it keeps the bespoke shell it always had and still needs a geometry bag.
  const bags: GeoBag = new Map();
  const roofPlant = new KitBag();
  const views: BuildingView[] = [];
  const signGroup = new Group();
  const rand = mulberry32(4711);

  interface ShellBatch {
    kit: KitName;
    variation: number;
    geos: BufferGeometry[];
  }
  const batches = new Map<string, ShellBatch>();

  let seed = 90210;
  for (const b of BUILDINGS) {
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    let height: number;

    if (b.landmark === 'stadium') {
      buildStadium(bags, b);
      height = 5.6;
    } else {
      const shell = shellFor(b, (seed += 977));
      const key = `${shell.kit}|${shell.variation}`;
      let batch = batches.get(key);
      if (!batch) batches.set(key, (batch = { kit: shell.kit, variation: shell.variation, geos: [] }));
      batch.geos.push(
        placedGeometry(shell.model, {
          x: cx,
          y: CURB,
          z: cz,
          rotY: shell.rotY,
          scale: shell.scale,
        }),
      );
      height = shell.height;

      // A chimney or a settling tank on the works and the depots: it is what
      // tells you at a glance that the shed is a shed and not a shop.
      if (shell.kit === 'industrial' && wantsRoofPlant(b)) {
        const ox = (rand() - 0.5) * b.w * 0.5;
        const oz = (rand() - 0.5) * b.h * 0.4;
        // Sunk a little into the roof rather than balanced on it, because a
        // kit hall's roof is rarely flat and a floating chimney reads at once.
        const roof = CURB + height * 0.86;
        if (rand() < 0.5) {
          roofPlant.add('industrial', 'chimney-large', {
            x: cx + ox,
            y: roof,
            z: cz + oz,
            scale: 0.45,
          });
        } else {
          roofPlant.add('industrial', 'detail-tank', {
            x: cx + ox,
            y: roof,
            z: cz + oz,
            rotY: rand() < 0.5 ? 0 : Math.PI / 2,
            scale: 1.1,
          });
        }
      }
    }

    addFascia(signGroup, b, height);
    views.push({ building: b, top: CURB + height });
  }

  // One mesh per kit and colour variation: eight or so draw calls for ninety
  // buildings, which is what makes a city of modelled facades affordable.
  for (const batch of batches.values()) {
    const merged = mergeGeometries(batch.geos, false);
    batch.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new Mesh(
      merged,
      kitMaterial(batch.kit, { variation: batch.variation, seeThrough: true, litWindows: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
  }

  roofPlant.flush(parent);
  flush(bags, parent);
  parent.add(signGroup);
  return views;
}

/* ------------------------------------------------------------------ *
 * Vegetation and street furniture                                     *
 * ------------------------------------------------------------------ */

const dummy = new Object3D();

interface TreeSpot {
  x: number;
  z: number;
  s: number;
  kind: number;
}

function treeSpots(): TreeSpot[] {
  const rand = mulberry32(7);
  const spots: TreeSpot[] = [];
  const blocked = (x: number, z: number) =>
    BUILDINGS.some(
      (b) => x > b.x - 0.7 && x < b.x + b.w + 0.7 && z > b.y - 0.7 && z < b.y + b.h + 0.7,
    );
  const inPark = (x: number, z: number) =>
    PARKS.find((p) => x > p.x && x < p.x + p.w && z > p.y && z < p.y + p.h);

  // Park planting: dense in Central and Riverside, sparse around the pitches.
  for (const p of PARKS) {
    const count = p.kind === 'sports' ? 16 : 46;
    for (let i = 0; i < count; i++) {
      const x = p.x + 0.8 + rand() * (p.w - 1.6);
      const z = p.y + 0.8 + rand() * (p.h - 1.6);
      // Keep the water, the lawns and the pitches clear. All of these are
      // measured from the park's own corner: the parks fill a band cell, so
      // they grow whenever the blocks do.
      if (
        p.kind === 'central' &&
        x > p.x + 0.6 &&
        x < p.x + 4.4 &&
        z > p.y + 1.1 &&
        z < p.y + 4.2
      ) {
        continue;
      }
      if (p.kind === 'riverside' && z > p.y + 2.2 && z < p.y + 6) continue;
      if (p.kind === 'sports' && x > p.x + 1.6 && x < p.x + p.w - 1.6 && z > p.y + 1.2) continue;
      // A park's outer tiles are the pavement that runs past its railings, and
      // a tree planted there is in the walking lane exactly as a street tree
      // was. Plant it a row in.
      if (isSidewalk(Math.floor(x), Math.floor(z))) continue;
      spots.push({ x, z, s: 0.9 + rand() * 0.6, kind: Math.floor(rand() * 3) });
    }
  }

  for (let i = 0; i < 900; i++) {
    const x = rand() * GW;
    const z = rand() * GH;
    if (isRoad(Math.floor(x), Math.floor(z))) continue;
    if (isSidewalk(Math.floor(x), Math.floor(z))) continue;
    if (inPark(x, z)) continue;
    if (blocked(x, z)) continue;
    spots.push({ x, z, s: 0.75 + rand() * 0.65, kind: Math.floor(rand() * 3) });
  }
  // A belt of woodland beyond the city limits. Without it the last block ends
  // at a hard line on an empty lawn; with it the city simply thins out into
  // trees and the fog takes over.
  const MARGIN = 26;
  for (let i = 0; i < 700; i++) {
    const x = -MARGIN + rand() * (GW + MARGIN * 2);
    const z = -MARGIN + rand() * (GH + MARGIN * 2);
    if (x > -1 && x < GW + 1 && z > -1 && z < GH + 1) continue;
    // Thicker the further out you look, so the edge itself stays open.
    const edge = Math.min(
      Math.max(-x, x - GW, 0) + Math.max(-z, z - GH, 0),
      MARGIN,
    );
    if (rand() > 0.25 + (edge / MARGIN) * 0.75) continue;
    spots.push({ x, z, s: 0.9 + rand() * 0.8, kind: Math.floor(rand() * 3) });
  }

  // Nothing is planted on a pavement.
  //
  // There used to be a street tree every three and a half tiles along both
  // kerbs of every street, and they looked wonderful and ruined the walking.
  // A pavement here is three tiles wide, a person is half a tile across, and a
  // trunk you have to steer around every few paces turns a walk down Main
  // Street into a slalom — worse on a phone, where the stick is a thumb and the
  // correction you meant to make is never quite the one you made.
  //
  // The street keeps its furniture: lamp posts, benches, bins and bollards are
  // placed against the kerb by `buildStreetProps`, in a line, out of the way of
  // the middle of the pavement, which is what a real street does with them and
  // what leaves a lane to walk in. The greenery moved to where you have room to
  // wander around it — the parks, the gardens behind the blocks, and the
  // woodland belt beyond the city limits.
  return spots;
}

/**
 * Every tree in the world, computed once.
 *
 * `ground.ts` reads this to keep the camera out of the foliage, which is why
 * it is a module constant rather than something `buildVegetation` keeps to
 * itself: the trees have to exist before the first frame is framed, not just
 * before it is drawn.
 */
export const TREE_SPOTS: TreeSpot[] = treeSpots();

/**
 * Trees.
 *
 * Two models from the suburban kit, in as many colour variations as the kit
 * ships, dropped into the same spots the procedural blobs used to fill. Each
 * (model, variation) pair is one `InstancedMesh`, so the whole woodland —
 * parks, kerbs, gardens and the belt beyond the city limits — is eight draw
 * calls for a couple of thousand trees.
 */
function buildVegetation(parent: Group): void {
  const rand = mulberry32(21);
  const spots = TREE_SPOTS;
  const variations = variationCount('suburban');

  const buckets = new Map<string, TreeSpot[]>();
  for (const s of spots) {
    // `kind` came from the old three-species split; two models and several
    // palettes cover the same ground.
    const key = `${s.kind % TREES.length}|${Math.floor(rand() * variations)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(s);
  }

  for (const [key, list] of buckets) {
    const [which, variation] = key.split('|').map(Number);
    const mesh = new InstancedMesh(
      localGeometry(model('suburban', TREES[which])),
      kitMaterial('suburban', { variation, roughness: 0.85 }),
      list.length,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((s, i) => {
      // The kit trees are slender next to the old blobs; 2.7 puts a street
      // tree back at roughly the height of a first-floor window.
      const scale = s.s * 2.7;
      dummy.position.set(s.x, CURB, s.z);
      dummy.scale.set(scale, scale * (0.88 + rand() * 0.4), scale);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
  }

  // Only the trunks stop anybody. The canopy is well over head height, so a
  // tree you can walk under is a tree you should be able to walk under.
  for (const s of spots) solid(s.x, s.z, s.s * 0.2);
}

/** Kit lamp posts are 0.67 units tall; the city's stand about three tiles. */
const LAMP_SCALE = 4.4;
/** How far the arm of a kit lamp reaches from its pole, once scaled. */
const LAMP_REACH = 0.2 * LAMP_SCALE;

/**
 * Point a kit street lamp's arm along (`ax`, `az`).
 *
 * Every lamp in the roads kit hangs its arm towards -Z, so the rotation that
 * puts it over the carriageway is the angle from -Z to the direction wanted.
 */
const lampRotation = (ax: number, az: number): number => Math.atan2(-ax, -az);

function buildStreetProps(parent: Group, lamplight: Lamplight): void {
  const bags: GeoBag = new Map();
  const props = new KitBag();
  const rand = mulberry32(515);
  const pools: { x: number; z: number; r: number }[] = [];
  const trim: BoxOpts = { vertexColors: true, ao: CURB };
  const lamp: BoxOpts = { vertexColors: true, shade: 1, glow: 'lamp' };
  const half = ROAD_W / 2;

  /** The lit lens under a lamp housing, plus the pool it throws on the ground. */
  const lampLight = (x: number, z: number, r: number): void => {
    box(bags, PALETTE.windowLit, 0.34, 0.09, 0.26, x, CURB + LAMP_SCALE * 0.6, z, lamp);
    pools.push({ x, z, r });
  };

  // Lamp posts on every corner of every block, arms reaching over the road.
  for (const it of INTERSECTIONS) {
    for (const [dx, dz] of [
      [-half - FURNITURE_OFFSET, -half - FURNITURE_OFFSET],
      [half + FURNITURE_OFFSET, -half - FURNITURE_OFFSET],
      [-half - FURNITURE_OFFSET, half + FURNITURE_OFFSET],
      [half + FURNITURE_OFFSET, half + FURNITURE_OFFSET],
    ] as const) {
      const x = it.cx + dx;
      const z = it.cy + dz;
      const ax = -Math.sign(dx);
      props.add('roads', 'light-curved', {
        x,
        y: CURB,
        z,
        rotY: lampRotation(ax, 0),
        scale: LAMP_SCALE,
        anchor: 'origin',
      });
      lampLight(x + ax * LAMP_REACH, z, 3.0);
      solid(x, z, 0.22);
      // There used to be a row of three bollards along each corner here. They
      // gave the crossing a nice edge from above and stood exactly where a
      // pedestrian has to walk to reach it: on a corner two tiles across, three
      // posts and a lamp leave a gap you have to aim for, and on a phone you
      // do not aim, you shove the stick and hope. The lamp stays, on the kerb
      // line with everything else; the corner is clear.
    }
  }

  // Mid-block lamps, so the long new avenues are not dark between corners. A
  // twin-headed lamp on the kerb lights both pavement and carriageway.
  for (const r of HROADS) {
    for (let x = 4; x < GW; x += 9) {
      if (vColSet.has(Math.floor(x))) continue;
      for (const z of [kerbLine(r.rows, -1), kerbLine(r.rows, 1)]) {
        const towardsRoad = z < r.rows[0] ? 1 : -1;
        props.add('roads', 'light-curved-double', {
          x,
          y: CURB,
          z,
          rotY: lampRotation(0, towardsRoad),
          scale: LAMP_SCALE,
          anchor: 'origin',
        });
        lampLight(x, z + towardsRoad * LAMP_REACH, 2.7);
        solid(x, z, 0.22);
      }
    }
  }

  // Roadworks: a cone and a barrier on one corner of a few junctions, because
  // a city with nothing out of place does not look like a city.
  for (const it of INTERSECTIONS) {
    if (rand() < 0.7) continue;
    const x = it.cx + half + 1.4;
    const z = it.cy - half - 1.4;
    props.add('roads', 'construction-barrier', { x, y: CURB, z, scale: 4, rotY: Math.PI / 2 });
    solid(x, z, 0.5);
    for (let i = 0; i < 3; i++) {
      props.add('roads', 'construction-cone', { x: x + 0.5, y: CURB, z: z + 0.5 + i * 0.6, scale: 4 });
      solid(x + 0.5, z + 0.5 + i * 0.6, 0.2);
    }
  }

  // Direction signs on the verge where each avenue leaves town, angled back at
  // the traffic coming in so the city reads as somewhere you arrive at.
  for (const r of VROADS) {
    for (const s of [-1, 1]) {
      props.add('roads', 'sign-highway', {
        x: r.cols[0] + (s < 0 ? -1.6 : ROAD_W + 1.6),
        y: 0,
        z: s < 0 ? -ROAD_OVERRUN * 0.7 : GH + ROAD_OVERRUN * 0.7,
        rotY: s < 0 ? Math.PI : 0,
        scale: 2.4,
      });
    }
  }

  // Benches, bins, hydrants and bus shelters along the busy streets.
  for (const r of [HROADS[0], HROADS[2], HROADS[4]]) {
    for (let x = 3.5; x < GW; x += 7) {
      if (vColSet.has(Math.floor(x))) continue;
      const z = kerbLine(r.rows, 1);
      box(bags, '#a5764a', 1.4, 0.1, 0.46, x, CURB + 0.45, z, { ...trim, round: 0.04 });
      box(bags, '#a5764a', 1.4, 0.46, 0.1, x, CURB + 0.68, z - 0.2, { ...trim, round: 0.04 });
      box(bags, PALETTE.darkMetal, 0.1, 0.45, 0.46, x - 0.6, CURB + 0.22, z, trim);
      box(bags, PALETTE.darkMetal, 0.1, 0.45, 0.46, x + 0.6, CURB + 0.22, z, trim);
      // The bench is a bar rather than a disc: two circles along it fit the
      // shape far better than one big one, and you can still sit at the end.
      solidRow(x - 0.5, z, 0.5, 0, 3, 0.3);
      box(bags, '#4f7f6a', 0.36, 0.55, 0.36, x + 1.7, CURB + 0.27, z, { ...trim, round: 0.05 });
      solid(x + 1.7, z, 0.26);
      if (rand() < 0.4) {
        box(bags, '#c34a3f', 0.22, 0.5, 0.22, x - 1.7, CURB + 0.25, z, { ...trim, round: 0.08 });
        box(bags, '#c34a3f', 0.42, 0.12, 0.16, x - 1.7, CURB + 0.36, z, trim);
        solid(x - 1.7, z, 0.18);
      }
    }
  }

  // Bus shelters at four stops, on the north pavement of the main streets.
  for (const r of [HROADS[0], HROADS[1], HROADS[3], HROADS[4]]) {
    const x = X_BANDS[2].a + 3.5;
    const z = kerbLine(r.rows, -1);
    box(bags, PALETTE.window, 2.6, 1.9, 0.1, x, CURB + 1.05, z - 0.5, { vertexColors: true, shade: 1, roughness: 0.12 });
    box(bags, PALETTE.darkMetal, 2.8, 0.12, 1.3, x, CURB + 2.06, z, trim);
    for (const s of [-1, 1]) {
      box(bags, PALETTE.darkMetal, 0.1, 2.1, 0.1, x + s * 1.3, CURB + 1.05, z + 0.5, trim);
      solid(x + s * 1.3, z + 0.5, 0.14);
    }
    solidRow(x - 1.1, z - 0.5, 0.55, 0, 5, 0.24);
    box(bags, '#b0784a', 2.2, 0.1, 0.38, x, CURB + 0.5, z - 0.28, trim);
    box(bags, PALETTE.windowLit, 0.7, 0.5, 0.06, x + 0.9, CURB + 1.3, z - 0.44, { vertexColors: true, shade: 1, glow: 'sign' });
  }

  // Newspaper kiosks and phone boxes scattered along the avenues.
  for (const r of VROADS) {
    for (const band of Y_BANDS) {
      if (rand() < 0.45) continue;
      const z = band.a + (band.b - band.a) * (0.3 + rand() * 0.4);
      const x = r.cols[0] - 0.9;
      box(bags, '#3f6f8f', 0.7, 1.9, 0.7, x, CURB + 0.95, z, { ...trim, round: 0.07 });
      box(bags, PALETTE.window, 0.5, 1.0, 0.06, x, CURB + 1.2, z - 0.36, { vertexColors: true, shade: 1, glow: 'window' });
      box(bags, '#2b3b4a', 0.86, 0.14, 0.86, x, CURB + 1.96, z, trim);
      solid(x, z, 0.44);
    }
  }

  // Café parasols and planters, against the shopfronts.
  //
  // They used to stand half a tile out from the wall, which put them in the
  // middle of the walking lane: a pavement is three tiles wide, the lamp posts
  // take the tile nearest the kerb, and a parasol at 0.55 out left about one
  // body-width of clear paving between the two. Squeezing a phone's thumbstick
  // through that gap, at the exact moment you are trying to reach a crossing,
  // is not street furniture — it is a slalom gate.
  //
  // So they are part of the shopfront now: flush to the wall, out of the lane,
  // in the strip where a real café puts its tables. They still sit at the ends
  // of a frontage rather than across the middle of it, because the door is in
  // the middle and a planter in front of a door is a place you cannot visit.
  const AGAINST_WALL = 0.3;
  for (const b of BUILDINGS) {
    if (b.landmark || rand() < 0.45) continue;
    const front = b.face === 'up' ? b.y - AGAINST_WALL : b.y + b.h + AGAINST_WALL;
    const facing = b.face === 'up' ? Math.PI : 0;
    if (rand() < 0.55) {
      const px = b.x + b.w * (rand() < 0.5 ? 0.16 : 0.84);
      props.add(
        'commercial',
        'detail-parasol-' + (rand() < 0.5 ? 'a' : 'b'),
        { x: px, y: CURB, z: front, rotY: rand() * Math.PI * 2, scale: 2.0 },
        { variation: Math.floor(rand() * variationCount('commercial')) },
      );
      // Only the table and its stem: a parasol's canopy is over head height,
      // and being stopped by a shadow is worse than walking through a fringe.
      solid(px, front, 0.3);
    } else {
      const px = b.x + b.w * (rand() < 0.5 ? 0.14 : 0.86);
      props.add(
        'suburban',
        'planter',
        { x: px, y: CURB, z: front, rotY: facing, scale: 2.2 },
        { variation: Math.floor(rand() * variationCount('suburban')) },
      );
      solid(px, front, 0.3);
    }
  }

  lamplight.build(parent, pools);
  props.flush(parent);
  flush(bags, parent);
}

/* ------------------------------------------------------------------ *
 * Parks                                                               *
 * ------------------------------------------------------------------ */

function buildCentralPark(bags: GeoBag, p: Zone): void {
  const turf: BoxOpts = { map: 'grass', vertexColors: true, shade: 1 };
  const stone: BoxOpts = { map: 'paving', vertexColors: true, shade: 1 };
  const trim: BoxOpts = { vertexColors: true, ao: CURB };
  const cx = p.x + p.w / 2;
  const cz = p.y + p.h / 2;

  box(bags, PALETTE.park, p.w - 0.2, 0.05, p.h - 0.2, cx, CURB + 0.035, cz, turf);

  // Paths: a cross with a circular plaza where they meet.
  box(bags, '#cfc6ae', p.w - 0.6, 0.03, 0.9, cx, CURB + 0.07, cz, stone);
  box(bags, '#cfc6ae', 0.9, 0.03, p.h - 0.6, cx, CURB + 0.07, cz, stone);
  box(bags, '#d8cfb6', 2.6, 0.04, 2.6, cx, CURB + 0.08, cz, { ...stone, round: 0.6 });

  // Fountain at the crossing.
  box(bags, PALETTE.curb, 1.9, 0.28, 1.9, cx, CURB + 0.16, cz, { ...stone, round: 0.4 });
  box(bags, PALETTE.water, 1.5, 0.1, 1.5, cx, CURB + 0.31, cz, { vertexColors: true, shade: 1, roughness: 0.1 });
  box(bags, '#e8e4dc', 0.34, 0.8, 0.34, cx, CURB + 0.7, cz, { ...trim, round: 0.08 });
  box(bags, '#dfe9ef', 0.8, 0.12, 0.8, cx, CURB + 1.14, cz, trim);

  // Pond in the north-west quarter, with a rock and reeds.
  box(bags, PALETTE.curb, 3.4, 0.12, 2.6, p.x + 2.4, CURB + 0.05, p.y + 2.6, stone);
  box(bags, PALETTE.water, 3.0, 0.09, 2.2, p.x + 2.4, CURB + 0.09, p.y + 2.6, { vertexColors: true, shade: 1, roughness: 0.12 });
  box(bags, '#9a9a94', 0.5, 0.34, 0.42, p.x + 3.4, CURB + 0.2, p.y + 1.9, { ...trim, round: 0.12 });

  // Bandstand in the south-east quarter.
  const bx = p.x + p.w - 2.2;
  const bz = p.y + p.h - 2.2;
  box(bags, PALETTE.curb, 2.4, 0.24, 2.4, bx, CURB + 0.12, bz, { ...stone, round: 0.3 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(bags, '#efe6d2', 0.14, 1.7, 0.14, bx + sx * 0.9, CURB + 1.1, bz + sz * 0.9, trim);
    }
  }
  box(bags, '#c4655a', 2.8, 0.2, 2.8, bx, CURB + 2.02, bz, { map: 'roof', vertexColors: true, ao: CURB });
  box(bags, '#a8564c', 1.7, 0.34, 1.7, bx, CURB + 2.22, bz, { map: 'roof', vertexColors: true, ao: CURB });

  // Playground: sandpit, slide, two swings.
  const gx = p.x + 1.9;
  const gz = p.y + p.h - 2.0;
  box(bags, PALETTE.sand, 3.0, 0.06, 2.2, gx, CURB + 0.06, gz, stone);
  box(bags, '#e0a03f', 0.5, 0.1, 1.5, gx - 0.7, CURB + 0.62, gz, { ...trim, rotY: 0.0 });
  box(bags, '#c98a30', 0.5, 1.0, 0.16, gx - 0.7, CURB + 0.5, gz - 0.78, trim);
  box(bags, PALETTE.metal, 0.1, 1.3, 0.1, gx + 0.8, CURB + 0.65, gz - 0.6, trim);
  box(bags, PALETTE.metal, 0.1, 1.3, 0.1, gx + 0.8, CURB + 0.65, gz + 0.6, trim);
  box(bags, PALETTE.metal, 0.1, 0.1, 1.4, gx + 0.8, CURB + 1.3, gz, trim);
  for (const s of [-1, 1]) {
    box(bags, '#3f6f9c', 0.36, 0.08, 0.22, gx + 0.8, CURB + 0.52, gz + s * 0.38, trim);
  }

}

/**
 * Kit dressing for the parks: a rail along the street edge, planters where the
 * flower beds are and a run of stepping stones off the main path.
 */
function dressCentralPark(props: KitBag, p: Zone): void {
  const rand = mulberry32(88);
  // Park railing along the north edge, in whole fence sections.
  const FENCE = 0.48 * 2.6;
  for (let x = p.x + 0.7; x < p.x + p.w - 0.7; x += FENCE) {
    props.add('suburban', 'fence', { x: x + FENCE / 2, y: CURB, z: p.y + 0.45, scale: 2.6 });
  }
  for (let i = 0; i < 4; i++) {
    props.add(
      'suburban',
      'planter',
      { x: p.x + 0.9 + i * 1.7, y: CURB, z: p.y + 1.1, scale: 2.6 },
      { variation: i % variationCount('suburban') },
    );
  }
  // Stepping stones wandering from the plaza towards the pond.
  for (let i = 0; i < 7; i++) {
    props.add('suburban', 'path-stones-short', {
      x: p.x + p.w / 2 - i * 0.42,
      y: CURB + 0.05,
      z: p.y + p.h / 2 - 0.6 - i * 0.5,
      rotY: (rand() - 0.5) * 0.6,
      scale: 2.4,
    });
  }
}

function buildRiversidePark(bags: GeoBag, p: Zone): void {
  const turf: BoxOpts = { map: 'grass', vertexColors: true, shade: 1 };
  const stone: BoxOpts = { map: 'paving', vertexColors: true, shade: 1 };
  const trim: BoxOpts = { vertexColors: true, ao: CURB };
  const cx = p.x + p.w / 2;

  box(bags, PALETTE.park, p.w - 0.2, 0.05, p.h - 0.2, cx, CURB + 0.035, p.y + p.h / 2, turf);

  // The lake, with a sandy shore and a timber boardwalk along its north side.
  const lz = p.y + 4.1;
  box(bags, PALETTE.sand, p.w - 1.0, 0.06, 4.6, cx, CURB + 0.05, lz, stone);
  box(bags, PALETTE.water, p.w - 2.0, 0.1, 3.6, cx, CURB + 0.09, lz, {
    vertexColors: true,
    shade: 1,
    roughness: 0.08,
    metalness: 0.15,
  });
  for (let i = 0; i < 9; i++) {
    box(bags, '#9b6f42', 0.7, 0.07, 1.0, p.x + 0.8 + i * 0.78, CURB + 0.1, p.y + 1.9, stone);
  }

  // A jetty reaching into the water, with two moored rowing boats.
  box(bags, '#9b6f42', 0.9, 0.1, 2.4, cx + 1.4, CURB + 0.16, lz, trim);
  for (const s of [-1, 1]) {
    box(bags, PALETTE.darkMetal, 0.1, 0.5, 0.1, cx + 1.4 + s * 0.35, CURB + 0.3, lz - 1.1, trim);
  }
  for (const [ox, oz, col] of [
    [-1.6, -0.4, '#d0705f'],
    [-2.4, 0.9, '#5f8fd0'],
  ] as const) {
    box(bags, col, 1.5, 0.28, 0.6, cx + ox, CURB + 0.22, lz + oz, { ...trim, round: 0.12 });
    box(bags, '#e8dfc8', 1.1, 0.06, 0.16, cx + ox, CURB + 0.34, lz + oz, trim);
  }

  // A picnic lawn at the south end: three tables under the trees.
  for (let i = 0; i < 3; i++) {
    const x = p.x + 1.5 + i * 2.3;
    const z = p.y + p.h - 1.6;
    box(bags, '#b0824e', 1.3, 0.1, 0.8, x, CURB + 0.55, z, { ...trim, round: 0.04 });
    box(bags, '#8f6a3f', 0.12, 0.5, 0.7, x - 0.5, CURB + 0.27, z, trim);
    box(bags, '#8f6a3f', 0.12, 0.5, 0.7, x + 0.5, CURB + 0.27, z, trim);
    for (const s of [-1, 1]) {
      box(bags, '#b0824e', 1.3, 0.08, 0.28, x, CURB + 0.34, z + s * 0.62, trim);
    }
  }
}

function buildSportsPark(bags: GeoBag, p: Zone): void {
  const turf: BoxOpts = { map: 'grass', vertexColors: true, shade: 1 };
  const stone: BoxOpts = { map: 'paving', vertexColors: true, shade: 1 };
  const trim: BoxOpts = { vertexColors: true, ao: CURB };
  const flat: BoxOpts = { vertexColors: true, shade: 1 };
  const cx = p.x + p.w / 2;
  const cz = p.y + p.h / 2;

  box(bags, PALETTE.park, p.w - 0.2, 0.05, p.h - 0.2, cx, CURB + 0.035, cz, turf);

  // Running track around the whole zone, with the infield in pitch green.
  ring(bags, PALETTE.track, cx, cz, p.w / 2 - 0.7, p.h / 2 - 0.7, 0.9, CURB + 0.07, 0.04, stone);
  const fw = p.w - 4.6;
  const fd = p.h - 4.6;
  box(bags, PALETTE.pitch, fw, 0.05, fd, cx, CURB + 0.08, cz, turf);
  box(bags, '#f2f4ee', 0.08, 0.02, fd - 0.4, cx, CURB + 0.11, cz, flat);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    box(bags, '#f2f4ee', 0.12, 0.02, 0.12, cx + Math.cos(a) * 0.8, CURB + 0.11, cz + Math.sin(a) * 0.7, flat);
  }
  // Goals at both ends.
  for (const s of [-1, 1]) {
    const x = cx + s * (fw / 2 - 0.15);
    box(bags, '#f4f6f8', 0.1, 1.0, 0.1, x, CURB + 0.55, cz - 0.9, trim);
    box(bags, '#f4f6f8', 0.1, 1.0, 0.1, x, CURB + 0.55, cz + 0.9, trim);
    box(bags, '#f4f6f8', 0.1, 0.1, 1.9, x, CURB + 1.05, cz, trim);
  }

  // Basketball court in the north corner.
  const bx = p.x + 2.6;
  const bz = p.y + 1.9;
  box(bags, PALETTE.court, 4.0, 0.05, 2.4, bx, CURB + 0.09, bz, stone);
  ring(bags, '#f2f4ee', bx, bz, 1.9, 1.1, 0.07, CURB + 0.12, 0.02, flat);
  for (const s of [-1, 1]) {
    box(bags, PALETTE.metal, 0.1, 1.7, 0.1, bx + s * 1.75, CURB + 0.9, bz, trim);
    box(bags, '#f4f6f8', 0.08, 0.6, 0.8, bx + s * 1.62, CURB + 1.72, bz, trim);
  }

  // Small bleachers facing the pitch, and four floodlights.
  for (let i = 0; i < 3; i++) {
    box(bags, PALETTE.curb, fw * 0.55, 0.3, 0.5, cx, CURB + 0.15 + i * 0.3, cz + fd / 2 + 0.5 + i * 0.5, stone);
    box(bags, '#3f6f9c', fw * 0.53, 0.1, 0.3, cx, CURB + 0.32 + i * 0.3, cz + fd / 2 + 0.5 + i * 0.5, flat);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = cx + sx * (fw / 2 + 0.6);
      const z = cz + sz * (fd / 2 + 0.6);
      box(bags, PALETTE.metal, 0.16, 4.2, 0.16, x, CURB + 2.1, z, { ...trim, round: 0.05 });
      box(bags, PALETTE.windowLit, 0.7, 0.24, 0.3, x, CURB + 4.28, z, { vertexColors: true, shade: 1, glow: 'lamp' });
    }
  }
}

function buildParks(parent: Group): void {
  const bags: GeoBag = new Map();
  const props = new KitBag();
  const signGroup = new Group();

  for (const p of PARKS) {
    if (p.kind === 'central') {
      buildCentralPark(bags, p);
      dressCentralPark(props, p);
    } else if (p.kind === 'riverside') buildRiversidePark(bags, p);
    else buildSportsPark(bags, p);

    // Timber entrance sign on two posts, facing the street the park is on.
    const sx = p.x + p.w / 2;
    const sz = p.kind === 'central' ? p.y + p.h - 0.55 : p.y + 0.55;
    const faceSouth = p.kind === 'central';
    for (const s of [-1, 1]) {
      box(bags, '#6b4826', 0.16, 1.5, 0.16, sx + s * 1.15, CURB + 0.75, sz, {
        vertexColors: true,
        ao: CURB,
      });
    }
    const board = new Mesh(
      new PlaneGeometry(2.9, 0.79),
      new MeshBasicMaterial({ map: zoneSignTexture(p.name, p.emoji), transparent: true }),
    );
    board.position.set(sx, CURB + 1.4, sz + (faceSouth ? 0.09 : -0.09));
    board.rotation.y = faceSouth ? 0 : Math.PI;
    signGroup.add(board);
  }

  props.flush(parent);
  flush(bags, parent, true, true);
  parent.add(signGroup);
}

/* ------------------------------------------------------------------ *
 * Public API                                                          *
 * ------------------------------------------------------------------ */

export class City {
  readonly group = new Group();
  readonly views: BuildingView[];
  /** Marker that pulses over the building a hint points at. */
  readonly hintMarker: Mesh;
  private painter = new DecalPainter();
  private lamplight = new Lamplight();
  /** Where the roof of each place ended up, so the hint arrow clears it. */
  private tops = new Map<string, number>();

  constructor() {
    buildGround(this.group, this.painter);
    buildPavementNames(this.group, this.painter);
    buildParks(this.group);
    this.views = buildBuildings(this.group);
    for (const v of this.views) this.tops.set(v.building.id, v.top);
    buildVegetation(this.group);
    buildStreetProps(this.group, this.lamplight);
    buildStreetBlades(this.group);

    const geo = new ConeGeometry(0.55, 1.1, 4);
    geo.rotateX(Math.PI);
    this.hintMarker = new Mesh(geo, new MeshBasicMaterial({ color: '#ffd447' }));
    this.hintMarker.visible = false;
    this.hintMarker.renderOrder = 4;
    this.group.add(this.hintMarker);

    this.group.updateMatrixWorld(true);
  }

  /** Dim the painted markings and light the lamps as the sun goes down. */
  setNight(night: number): void {
    this.painter.setNight(night);
    this.lamplight.setNight(night);
  }

  /**
   * The one thing the city draws on your behalf: a gold arrow over the roof of
   * the place a citizen's hint is pointing at.
   *
   * It is the whole navigation aid, and it only appears when you ask for a
   * hint. There is no minimap and no floating name plate, because finding a
   * shop by reading the street you are on is the exercise — the arrow says
   * *over there*, and you still have to walk it.
   */
  update(time: number, hintTarget: Building | null): void {
    if (hintTarget) {
      this.hintMarker.visible = true;
      this.hintMarker.position.set(
        hintTarget.x + hintTarget.w / 2,
        (this.tops.get(hintTarget.id) ?? CURB + hintTarget.height) +
          2.1 +
          Math.sin(time * 3) * 0.18,
        hintTarget.y + hintTarget.h / 2,
      );
      this.hintMarker.rotation.y = time * 1.4;
    } else {
      this.hintMarker.visible = false;
    }
  }
}
