/**
 * Kenney asset kits — the city's models, textures and materials.
 *
 * Five CC0 kits from kenney.nl (City Kit Commercial / Suburban / Industrial /
 * Roads, and Car Kit) live in `public/models/<kit>/` as GLB. Every model in a
 * kit shares **one** palette texture — a 512² atlas of vertical colour ramps
 * that the meshes sample per-face — which is the single fact the whole renderer
 * is built around:
 *
 *   - one material per kit (per colour variation) means every building in the
 *     city can be merged into a handful of draw calls, exactly as the old
 *     procedural city was;
 *   - swapping the atlas for one of the kit's `variation-*.png` files recolours
 *     a whole building without touching a vertex, which is how ninety shopfronts
 *     avoid looking copy-pasted;
 *   - the atlas is small enough to re-tint on a canvas at boot, which is how the
 *     windows light up at night (see `emissiveAtlas`).
 *
 * The GLB files reference `Textures/colormap.png` themselves. We never let the
 * loader fetch it: a URL modifier swaps every image request for a 1×1 blank, the
 * loaded materials are thrown away, and only the geometry survives. The real
 * atlases are loaded once per kit and shared.
 */

import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  LinearFilter,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyCutout, registerGlow, type Glow } from './palette';

export type KitName = 'commercial' | 'suburban' | 'industrial' | 'roads' | 'cars';

/** Root of the vendored kits. Relative, so a sub-folder deploy still works. */
const ROOT = `${import.meta.env.BASE_URL}models/`;

/** A 1×1 white PNG, served to the loader in place of every kit texture. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA' +
  'DUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/* ------------------------------------------------------------------ *
 * Models                                                              *
 * ------------------------------------------------------------------ */

export interface KitModel {
  name: string;
  /** Every primitive merged, node transforms baked in. */
  geometry: BufferGeometry;
  /** The same geometry split by glTF node name — wheels, bodies, chimneys. */
  parts: Map<string, BufferGeometry>;
  /** Local-space extents. */
  size: Vector3;
  min: Vector3;
  max: Vector3;
  /** Centre of the footprint, at ground level. */
  base: Vector3;
}

const kits = new Map<KitName, Map<string, KitModel>>();

/** A loaded model, or a clear error naming the kit that forgot to ask for it. */
export function model(kit: KitName, name: string): KitModel {
  const m = kits.get(kit)?.get(name);
  if (!m) throw new Error(`Model "${name}" was never loaded from the ${kit} kit`);
  return m;
}

/**
 * Keep only the attributes every kit geometry has in common. Kenney exports
 * tangents for a normal map that does not exist, and `mergeGeometries` refuses
 * to merge two geometries whose attribute sets differ.
 */
function trim(geo: BufferGeometry): BufferGeometry {
  for (const key of Object.keys(geo.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') geo.deleteAttribute(key);
  }
  geo.morphAttributes = {};
  return geo;
}

async function loadModel(loader: GLTFLoader, kit: KitName, name: string): Promise<KitModel> {
  const gltf = await loader.loadAsync(`${ROOT}${kit}/${name}.glb`);
  gltf.scene.updateMatrixWorld(true);

  const parts = new Map<string, BufferGeometry>();
  const all: BufferGeometry[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const geo = trim(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    parts.set(mesh.name || `part${parts.size}`, geo);
    all.push(geo);
    // The kit's own material is a blank stand-in, and so is the one-pixel
    // texture the URL modifier fed it. Both go; the kit atlas replaces them.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      (m as MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  });

  const geometry = all.length === 1 ? all[0].clone() : mergeGeometries(all, false)!;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new Box3();
  const size = box.getSize(new Vector3());
  return {
    name,
    geometry,
    parts,
    size,
    min: box.min.clone(),
    max: box.max.clone(),
    base: new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2),
  };
}

/* ------------------------------------------------------------------ *
 * Palette atlases                                                     *
 * ------------------------------------------------------------------ */

/** How many colour variations each kit ships, `colormap` included. */
const VARIATIONS: Record<KitName, string[]> = {
  commercial: ['colormap', 'variation-a', 'variation-b'],
  suburban: ['colormap', 'variation-a', 'variation-b', 'variation-c'],
  industrial: ['colormap', 'variation-a', 'variation-b', 'variation-c'],
  roads: ['colormap'],
  cars: ['colormap'],
};

const atlases = new Map<KitName, Texture[]>();

/** How many interchangeable colour schemes this kit was loaded with. */
export const variationCount = (kit: KitName): number => atlases.get(kit)?.length ?? 1;

function setupAtlas(tex: Texture): Texture {
  tex.colorSpace = SRGBColorSpace;
  // glTF UVs run from the top-left, so the atlas must not be flipped.
  tex.flipY = false;
  // Every face samples a few texels of a flat ramp, so mip-mapping only ever
  // bleeds one swatch into its neighbour. No mips, no bleed, no aliasing.
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

/**
 * Is this palette entry a pane of glass?
 *
 * Every kit paints its windows from the same family of ramps — a pale sky blue,
 * far bluer than anything else a building is made of — while walls, roofs and
 * concrete stay neutral (red and blue within thirty of each other) and foliage
 * is green-dominant. Two comparisons separate all three, which is what lets one
 * rule light the windows of four different kits.
 */
const isGlass = (r: number, g: number, b: number): boolean => b > r + 55 && b > g + 30;

/**
 * The night atlas: the same palette, blacked out everywhere except the glass.
 *
 * Kenney's models carry no emissive channel and no separate window material —
 * a whole building is one mesh sampling one texture — so the only place a lit
 * window can come from is the atlas itself. Re-tint every glass texel to warm
 * lamplight, take the rest to black, and hand the result to `emissiveMap`: one
 * derived texture switches on every window in the city at dusk, and the walls
 * around them stay dark.
 *
 * The warmth is modulated by where the texel sits on its ramp, so the shaded
 * side of a building lights up a little dimmer than the sunlit one and a tower
 * does not become a uniform slab of gold.
 */
function emissiveAtlas(source: CanvasImageSource, width: number, height: number): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(source, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const warm = new Color('#ffcf8a');
  for (let i = 0; i < d.length; i += 4) {
    const on = isGlass(d[i], d[i + 1], d[i + 2])
      ? 0.55 + 0.45 * Math.min(1, Math.max(0, (d[i + 2] / 255 - 0.85) / 0.13))
      : 0;
    d[i] = warm.r * 255 * on;
    d[i + 1] = warm.g * 255 * on;
    d[i + 2] = warm.b * 255 * on;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

const nightAtlases = new Map<Texture, CanvasTexture>();

function nightAtlas(tex: Texture): CanvasTexture | null {
  const cached = nightAtlases.get(tex);
  if (cached) return cached;
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width) return null;
  const made = emissiveAtlas(img, img.width, img.height);
  nightAtlases.set(tex, made);
  return made;
}

/* ------------------------------------------------------------------ *
 * Materials                                                           *
 * ------------------------------------------------------------------ */

export interface KitMatOptions {
  /** Which colour scheme of the kit to use; wraps if the kit has fewer. */
  variation?: number;
  /** Disappear where the player would otherwise be hidden behind it. */
  seeThrough?: boolean;
  /** Light the dark end of the palette after dark — windows, in practice. */
  litWindows?: boolean;
  roughness?: number;
  metalness?: number;
  /** Add this surface to a night-glow bank (used for lamp housings). */
  glow?: Glow;
}

const materials = new Map<string, MeshStandardMaterial>();

export function kitMaterial(kit: KitName, opts: KitMatOptions = {}): MeshStandardMaterial {
  const list = atlases.get(kit);
  if (!list?.length) throw new Error(`The ${kit} kit has not been loaded`);
  const variation = ((opts.variation ?? 0) % list.length + list.length) % list.length;
  const key = [
    kit,
    variation,
    opts.seeThrough ? 's' : '-',
    opts.litWindows ? 'w' : '-',
    opts.roughness ?? 0.78,
    opts.metalness ?? 0,
    opts.glow ?? '-',
  ].join('|');

  const cached = materials.get(key);
  if (cached) return cached;

  const m = new MeshStandardMaterial({
    map: list[variation],
    roughness: opts.roughness ?? 0.78,
    metalness: opts.metalness ?? 0,
  });
  if (opts.litWindows) {
    const night = nightAtlas(list[variation]);
    if (night) {
      m.emissiveMap = night;
      m.emissive = new Color('#ffffff');
      m.emissiveIntensity = 0;
      registerGlow('window', m);
    }
  }
  if (opts.glow) registerGlow(opts.glow, m);
  if (opts.seeThrough) applyCutout(m);
  materials.set(key, m);
  return m;
}

/* ------------------------------------------------------------------ *
 * Placement                                                           *
 * ------------------------------------------------------------------ */

export interface Placement {
  x: number;
  y: number;
  z: number;
  rotY?: number;
  /** Uniform scale, or per-axis. */
  scale?: number | { x: number; y: number; z: number };
  /**
   * What `x`/`z` refer to. `footprint` (the default) centres the model's
   * bounding box on the point, which is what a building on a plot wants;
   * `origin` keeps the model's own origin, which is what an L-shaped street
   * lamp wants, because its pole is at the origin and its arm hangs off to one
   * side. Either way `y` is the ground the model stands on.
   */
  anchor?: 'footprint' | 'origin';
}

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpPos = new Vector3();
const tmpScale = new Vector3();
const UP = new Vector3(0, 1, 0);

function placementMatrix(p: Placement, out = new Matrix4()): Matrix4 {
  const s = p.scale ?? 1;
  tmpPos.set(p.x, p.y, p.z);
  tmpQuat.setFromAxisAngle(UP, p.rotY ?? 0);
  if (typeof s === 'number') tmpScale.set(s, s, s);
  else tmpScale.set(s.x, s.y, s.z);
  return out.compose(tmpPos, tmpQuat, tmpScale);
}

/**
 * A copy of a kit model's geometry, transformed into the world and ready to be
 * merged with its neighbours. The model is placed by the centre of its
 * footprint, standing on `y`.
 */
export function placedGeometry(m: KitModel, p: Placement): BufferGeometry {
  return localGeometry(m, p.anchor).applyMatrix4(placementMatrix(p, tmpMatrix));
}

/**
 * A copy of the model's geometry, moved so that it stands on y = 0 around the
 * requested anchor. This is what an `InstancedMesh` wants, because it applies
 * the placement itself.
 */
export function localGeometry(m: KitModel, anchor: Placement['anchor'] = 'footprint'): BufferGeometry {
  const geo = m.geometry.clone();
  if (anchor === 'origin') geo.translate(0, -m.min.y, 0);
  else geo.translate(-m.base.x, -m.base.y, -m.base.z);
  return geo;
}

/* ------------------------------------------------------------------ *
 * Loading                                                             *
 * ------------------------------------------------------------------ */

export interface KitRequest {
  kit: KitName;
  models: string[];
}

/**
 * Fetch every model a kit is asked for, plus its palette atlases.
 *
 * The whole set is downloaded in parallel; `onProgress` reports 0 → 1 so the
 * boot screen's bar can follow a real number instead of a guess.
 */
export async function loadKits(
  requests: KitRequest[],
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const manager = new LoadingManager();
  // Never fetch the kit's own texture: one blank pixel per material, discarded
  // the moment the geometry has been taken out.
  manager.setURLModifier((url) => (/\.(png|jpe?g|webp)$/i.test(url) ? BLANK_PNG : url));
  const loader = new GLTFLoader(manager);
  const textureLoader = new TextureLoader();

  const total = requests.reduce((n, r) => n + r.models.length + VARIATIONS[r.kit].length, 0);
  let done = 0;
  const tick = (): void => onProgress?.(total ? ++done / total : 1);

  await Promise.all(
    requests.map(async (req) => {
      const [textures, models] = await Promise.all([
        Promise.all(
          VARIATIONS[req.kit].map(async (v) => {
            const tex = await textureLoader.loadAsync(`${ROOT}${req.kit}/Textures/${v}.png`);
            tick();
            return setupAtlas(tex);
          }),
        ),
        Promise.all(
          req.models.map(async (name) => {
            const m = await loadModel(loader, req.kit, name);
            tick();
            return m;
          }),
        ),
      ]);
      atlases.set(req.kit, textures);
      kits.set(req.kit, new Map(models.map((m) => [m.name, m])));
    }),
  );
}
