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

function finish(cv: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
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

let cache: Record<string, Texture> | null = null;

export function textures(): Record<string, Texture> {
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

  cache = {
    asphalt: finish(roadCv),
    paving: finish(paveCv),
    grass: finish(grassCv),
    wall: finish(wallCv),
    roof: finish(roofCv),
    leaf: finish(leafCv),
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
