/**
 * Art direction for everything the city builds itself.
 *
 * The models come from the Kenney kits and bring their own palette (see
 * `kits.ts`); what is left here is the ground they stand on — asphalt, kerbs,
 * paving, grass, water, road paint — plus the two mechanisms both halves share:
 * the night-glow registry and the see-through cut-out.
 *
 * The look is low-poly geometry with softly rounded edges, a desaturated pastel
 * palette, warm sunlight with a cool sky fill, and a hazy horizon. Surfaces are
 * `MeshStandardMaterial` lit by an image-based environment, not flat Lambert:
 * that is where the depth in the shading comes from. Colours are multiplied by a
 * near-white procedural texture (see `textures.ts`) and, where the geometry
 * supports it, by a baked ambient-occlusion vertex colour.
 */

import {
  Color,
  MeshStandardMaterial,
  Vector2,
  type ColorRepresentation,
} from 'three';
import { textures } from './textures';

export const SKY = '#cfe2ef';
export const FOG = '#dbe9f3';

export const PALETTE = {
  grass: '#9cbf78',
  grassDark: '#8fb46c',
  park: '#7fb265',
  water: '#79b8d4',
  asphalt: '#84888f',
  sidewalk: '#d8d6cd',
  curb: '#c2bfb5',
  laneMark: '#f2ecd8',
  crosswalk: '#f4f2ec',
  window: '#54748f',
  windowLit: '#ffe8ad',
  metal: '#9aa3ad',
  darkMetal: '#4a4f5a',
  signInk: '#ffd447',
  signAccent: '#19d3ff',
  /* new-district surfaces */
  sand: '#e6d5ab',
  pitch: '#5aa04f',
  pitchStripe: '#63ab57',
  clay: '#c1714f',
  court: '#4f7fa8',
  track: '#b8563f',
  gold: '#e8b64c',
} as const;

/* ------------------------------------------------------------------ *
 * Night lighting                                                      *
 * ------------------------------------------------------------------ */

/**
 * Surfaces that light up after dark. A merged city cannot switch a light on
 * per object, so instead every emissive surface is drawn with a material that
 * registers itself here; `setNightGlow` then drives them all at once from the
 * day/night cycle. One number, one loop, a city that turns on at dusk.
 */
export type Glow = 'window' | 'lamp' | 'sign' | 'head' | 'tail' | 'beacon';

const GLOW_COLOR: Record<Glow, string> = {
  window: '#ffcf8a',
  lamp: '#ffdda0',
  sign: '#ffd447',
  head: '#fff4d8',
  tail: '#ff4a30',
  beacon: '#ffffff',
};

/** Peak emissive intensity at midnight. */
const GLOW_PEAK: Record<Glow, number> = {
  window: 1.25,
  lamp: 2.2,
  sign: 1.1,
  head: 2.4,
  tail: 1.6,
  beacon: 2.6,
};

const glowMats = new Map<Glow, MeshStandardMaterial[]>();

/**
 * Enrol a material in a night-glow bank.
 *
 * `mat()` does this for the procedural surfaces; the kit materials in
 * `kits.ts` call it directly, because their emissive term is a texture (the
 * window ramp of the palette atlas) rather than a flat colour.
 */
export function registerGlow(kind: Glow, m: MeshStandardMaterial): void {
  let list = glowMats.get(kind);
  if (!list) glowMats.set(kind, (list = []));
  list.push(m);
}

/** 0 = broad daylight, 1 = deep night. */
export function setNightGlow(night: number): void {
  for (const [kind, list] of glowMats) {
    const intensity = GLOW_PEAK[kind] * night;
    for (const m of list) {
      m.emissiveIntensity = intensity;
      m.needsUpdate = false;
    }
  }
}

/* ------------------------------------------------------------------ *
 * See-through cut-out                                                 *
 * ------------------------------------------------------------------ */

/**
 * At this camera pitch a five-storey block sits between the camera and the
 * player whenever they walk on the near pavement. Rather than fight the
 * geometry, building materials punch a soft dithered hole around the player's
 * screen position — the classic isometric "see through the wall" trick, done
 * in one shader patch instead of per-object transparency.
 */
const cutoutUniforms = {
  uCutCenter: { value: [0, 0] as [number, number] },
  uCutDepth: { value: 1 },
  uCutRadius: { value: 90 },
};

export function updateCutout(x: number, y: number, depth: number, radius: number): void {
  cutoutUniforms.uCutCenter.value = [x, y];
  cutoutUniforms.uCutDepth.value = depth;
  cutoutUniforms.uCutRadius.value = radius;
}

export function applyCutout(m: MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCutCenter = cutoutUniforms.uCutCenter;
    shader.uniforms.uCutDepth = cutoutUniforms.uCutDepth;
    shader.uniforms.uCutRadius = cutoutUniforms.uCutRadius;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec2 uCutCenter;
         uniform float uCutDepth;
         uniform float uCutRadius;
         float cutNoise(vec2 p) {
           return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
         }
         void main() {`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         float cutDist = distance(gl_FragCoord.xy, uCutCenter);
         if (cutDist < uCutRadius && gl_FragCoord.z < uCutDepth) {
           float t = smoothstep(uCutRadius * 0.72, uCutRadius, cutDist);
           if (cutNoise(gl_FragCoord.xy) > t) discard;
         }`,
      );
  };
  m.customProgramCacheKey = () => 'cutout';
}

/* ------------------------------------------------------------------ *
 * Materials                                                           *
 * ------------------------------------------------------------------ */

export type TextureName = 'asphalt' | 'paving' | 'grass' | 'wall' | 'roof' | 'leaf';

export interface MatOptions {
  /** Procedural texture multiplied into the base colour. */
  map?: TextureName;
  flat?: boolean;
  /** Read baked ambient occlusion from the geometry's colour attribute. */
  vertexColors?: boolean;
  /** Disappear where the player would otherwise be hidden. */
  seeThrough?: boolean;
  roughness?: number;
  metalness?: number;
  /** Light this surface up after dark. */
  glow?: Glow;
}

const cache = new Map<string, MeshStandardMaterial>();

export function mat(color: ColorRepresentation, opts: MatOptions = {}): MeshStandardMaterial {
  const key = [
    new Color(color).getHexString(),
    opts.map ?? '-',
    opts.flat ? 'f' : '-',
    opts.vertexColors ? 'v' : '-',
    opts.seeThrough ? 's' : '-',
    opts.roughness ?? 0.9,
    opts.metalness ?? 0,
    opts.glow ?? '-',
  ].join('|');

  let m = cache.get(key);
  if (m) return m;

  const surface = opts.map ? textures()[opts.map] : null;
  m = new MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    flatShading: !!opts.flat,
    vertexColors: !!opts.vertexColors,
    map: surface?.map ?? null,
  });
  // The detail canvas is a height field as well as a colour, so the same
  // pixels drive the relief and the finish. This is the whole of the city's
  // physically-based shading: no authored maps, just the texture that was
  // already there described to the lighting model properly.
  //
  // A surface that sets its own roughness explicitly — glass, chrome, water —
  // means it, so the derived map only applies where none was asked for.
  if (surface) {
    m.normalMap = surface.normalMap;
    m.normalScale = new Vector2(surface.normalScale, surface.normalScale);
    if (opts.roughness === undefined) m.roughnessMap = surface.roughnessMap;
  }
  if (opts.glow) {
    m.emissive = new Color(GLOW_COLOR[opts.glow]);
    m.emissiveIntensity = 0;
    registerGlow(opts.glow, m);
  }
  if (opts.seeThrough) applyCutout(m);
  cache.set(key, m);
  return m;
}
