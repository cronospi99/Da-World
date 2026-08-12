/**
 * Procedural textures.
 *
 * Every texture is drawn into a canvas at load time — nothing is downloaded.
 * They are deliberately near-white and low-contrast: the material's own colour
 * multiplies through them, so one asphalt/plaster/paving texture serves every
 * colour in the city while still breaking up the flat plastic look that pure
 * vertex colour gives you.
 *
 * UVs are baked per geometry (see `uvScaleBox` / `uvScalePlane`) so a texture
 * tiles at a constant *world* size no matter how big the surface is. That is
 * what stops a wide building from smearing its plaster across four metres.
 */

import {
  type BufferGeometry,
  CanvasTexture,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/** World size, in tiles, that one repeat of a texture covers. */
export const TILE_SIZE = 1;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  return [cv, cv.getContext('2d')!];
}

/**
 * Anisotropy applied to every ground texture.
 *
 * A city of nine long straight streets is the worst case there is for texture
 * filtering: the road recedes to the horizon at a grazing angle, which is
 * exactly where a bilinear sample turns tarmac into grey soup. The quality
 * tier sets this before any texture is built.
 */
let anisotropy = 8;
const built: CanvasTexture[] = [];

export function setTextureAnisotropy(value: number): void {
  anisotropy = value;
  for (const tex of built) tex.anisotropy = value;
}

function finish(cv: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = anisotropy;
  built.push(tex);
  return tex;
}

/** Value noise, seeded so the city looks identical on every machine. */
function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  alpha: number,
  dark: boolean,
  seed: number,
): void {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const r = 0.5 + rnd() * 2.2;
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${alpha * (0.3 + rnd() * 0.7)})`
      : `rgba(255,255,255,${alpha * (0.3 + rnd() * 0.7)})`;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A surface, as physically-based rendering wants one.
 *
 * The Kenney kits ship flat colour ramps and nothing else — no normal maps, no
 * roughness maps, nothing that tells the light what a surface is made of. The
 * procedural ground has always had a detail canvas, though, and that canvas is
 * a height field in everything but name: the dark speckles in the asphalt are
 * the gaps between the aggregate, the lines in the paving are the joints
 * between the slabs.
 *
 * So the two maps that matter are derived from it. The normal map is a Sobel
 * over the same pixels, which makes the aggregate catch the low sun and the
 * slab joints read as cut rather than drawn. The roughness map is the same
 * luminance remapped, which is what stops the whole city being uniformly matte:
 * a polished tyre line down the middle of a lane and a rough kerb beside it.
 *
 * None of it is a new asset. It is the detail already in the texture, told to
 * the lighting model instead of only to the eye.
 */
export interface Surface {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture;
  /** How deeply the derived normals are pressed in, per surface. */
  normalScale: number;
}

/** Luminance of every texel, 0..1, as the height field the maps are built on. */
function heightField(cv: HTMLCanvasElement): { data: Float32Array; size: number } {
  const size = cv.width;
  const px = cv.getContext('2d')!.getImageData(0, 0, size, size).data;
  const data = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    data[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  }
  return { data, size };
}

/** Sobel the height field into a tangent-space normal map. */
function normalFrom(cv: HTMLCanvasElement, strength: number): CanvasTexture {
  const { data, size } = heightField(cv);
  const [out, ctx] = canvas(size);
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number): number =>
    data[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      // The z term keeps the vector unit-length; a bigger strength tips the
      // normal further off the surface and deepens the relief.
      const nx = dx * strength;
      const ny = dy * strength;
      const length = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      image.data[i] = ((nx / length) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      image.data[i + 2] = ((1 / length) * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const tex = finish(out);
  // Normals are data, not colour: reading them through sRGB bends every vector.
  tex.colorSpace = LinearSRGBColorSpace;
  return tex;
}

/** Remap the height field into roughness: dark pits rough, bright peaks polished. */
function roughnessFrom(cv: HTMLCanvasElement, low: number, high: number): CanvasTexture {
  const { data, size } = heightField(cv);
  const [out, ctx] = canvas(size);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < data.length; i++) {
    const value = (low + (high - low) * (1 - data[i])) * 255;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const tex = finish(out);
  tex.colorSpace = LinearSRGBColorSpace;
  return tex;
}

let cache: Record<string, Surface> | null = null;

export function textures(): Record<string, Surface> {
  if (cache) return cache;
  const S = 256;

  /* ---- asphalt: coarse aggregate, faint tyre polish ---- */
  const [roadCv, road] = canvas(S);
  road.fillStyle = '#ffffff';
  road.fillRect(0, 0, S, S);
  speckle(road, S, 2600, 0.16, true, 7);
  speckle(road, S, 900, 0.1, false, 13);

  /* ---- paving slabs: a grid of joints with a little grain ---- */
  const [paveCv, pave] = canvas(S);
  pave.fillStyle = '#ffffff';
  pave.fillRect(0, 0, S, S);
  speckle(pave, S, 1200, 0.08, true, 21);
  pave.strokeStyle = 'rgba(0,0,0,.17)';
  pave.lineWidth = 3;
  for (const p of [0, S / 2]) {
    pave.beginPath();
    pave.moveTo(p, 0);
    pave.lineTo(p, S);
    pave.moveTo(0, p);
    pave.lineTo(S, p);
    pave.stroke();
  }
  // Offset half-joints, so it reads as slabs rather than graph paper.
  pave.strokeStyle = 'rgba(255,255,255,.35)';
  pave.lineWidth = 1.5;
  pave.strokeRect(4, 4, S / 2 - 8, S / 2 - 8);
  pave.strokeRect(S / 2 + 4, S / 2 + 4, S / 2 - 8, S / 2 - 8);

  /* ---- grass: dense speckle, slight clumping ---- */
  const [grassCv, grass] = canvas(S);
  grass.fillStyle = '#ffffff';
  grass.fillRect(0, 0, S, S);
  speckle(grass, S, 3000, 0.13, true, 33);
  speckle(grass, S, 2000, 0.12, false, 41);

  /* ---- plaster: rendered wall, faint horizontal courses ---- */
  const [wallCv, wall] = canvas(S);
  wall.fillStyle = '#ffffff';
  wall.fillRect(0, 0, S, S);
  speckle(wall, S, 1500, 0.07, true, 55);
  wall.strokeStyle = 'rgba(0,0,0,.06)';
  wall.lineWidth = 2;
  for (let y = 0; y < S; y += S / 4) {
    wall.beginPath();
    wall.moveTo(0, y);
    wall.lineTo(S, y);
    wall.stroke();
  }

  /* ---- roof: overlapping courses of tile ---- */
  const [roofCv, roof] = canvas(S);
  roof.fillStyle = '#ffffff';
  roof.fillRect(0, 0, S, S);
  speckle(roof, S, 900, 0.09, true, 67);
  for (let y = 0; y < S; y += S / 8) {
    roof.fillStyle = 'rgba(0,0,0,.10)';
    roof.fillRect(0, y, S, 2);
    roof.fillStyle = 'rgba(255,255,255,.16)';
    roof.fillRect(0, y + 2, S, 2);
  }

  /* ---- foliage: leafy dapple for tree canopies ---- */
  const [leafCv, leaf] = canvas(128);
  leaf.fillStyle = '#ffffff';
  leaf.fillRect(0, 0, 128, 128);
  speckle(leaf, 128, 700, 0.22, true, 91);
  speckle(leaf, 128, 500, 0.2, false, 97);

  /**
   * Per-surface relief and roughness range.
   *
   * Asphalt is the deepest and the roughest — it is loose stone in tar. Paving
   * is shallower but its joints are sharp. Grass gets almost no relief and no
   * gloss at all, because a lawn that glints reads as plastic. Glass and metal
   * are not here: they are kit materials, and they get their finish from the
   * numbers in `palette.ts`.
   */
  const build = (cv: HTMLCanvasElement, relief: number, low: number, high: number): Surface => ({
    map: finish(cv),
    normalMap: normalFrom(cv, relief),
    roughnessMap: roughnessFrom(cv, low, high),
    normalScale: relief > 0 ? 1 : 0,
  });

  cache = {
    asphalt: build(roadCv, 2.4, 0.72, 1.0),
    paving: build(paveCv, 1.9, 0.62, 0.94),
    grass: build(grassCv, 0.7, 0.88, 1.0),
    wall: build(wallCv, 1.1, 0.7, 0.95),
    roof: build(roofCv, 1.6, 0.66, 0.96),
    leaf: build(leafCv, 0.9, 0.8, 1.0),
  };
  return cache;
}

/* ------------------------------------------------------------------ *
 * UV baking                                                           *
 * ------------------------------------------------------------------ */

/**
 * Rescale a BoxGeometry's UVs so each face tiles at world scale.
 *
 * three.js lays box faces out as +x, −x, +y, −y, +z, −z, four vertices each.
 * Each face spans 0..1, so multiplying by (worldWidth / tile) makes the
 * texture repeat every `tile` units regardless of the box's size.
 */
export function uvScaleBox(
  geo: BufferGeometry,
  w: number,
  h: number,
  d: number,
  tile = TILE_SIZE,
): BufferGeometry {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  const faceScales: [number, number][] = [
    [d / tile, h / tile], // +x
    [d / tile, h / tile], // -x
    [w / tile, d / tile], // +y
    [w / tile, d / tile], // -y
    [w / tile, h / tile], // +z
    [w / tile, h / tile], // -z
  ];
  for (let face = 0; face < 6 && face * 4 < uv.count; face++) {
    const [su, sv] = faceScales[face];
    for (let i = face * 4; i < face * 4 + 4 && i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Uniform UV scale, for geometry whose faces are not simple quads —
 * `RoundedBoxGeometry` in particular. The texture is noise-like, so an
 * approximate world scale is indistinguishable from an exact one.
 */
export function uvScaleUniform(geo: BufferGeometry, scale: number): BufferGeometry {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * scale, uv.getY(i) * scale);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Same idea for a single quad. */
export function uvScalePlane(
  geo: BufferGeometry,
  w: number,
  h: number,
  tile = TILE_SIZE,
): BufferGeometry {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (h / tile));
  }
  uv.needsUpdate = true;
  return geo;
}
