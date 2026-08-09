import * as THREE from "three";
import { clamp, fbm, lerp, smoothstep } from "../core/noise";
import { PLACES } from "../content/places";

export const WORLD_SIZE = 240;
export const WATER_LEVEL = 0.6;

const SEGMENTS = 220;

/** Distance from point (px,pz) to segment (ax,az)-(bx,bz). */
function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Roads run from the starting meadow out to every other place. */
const ROADS: Array<[number, number, number, number]> = (() => {
  const hub = PLACES[0];
  if (!hub) return [];
  return PLACES.slice(1).map(
    (p) =>
      [hub.center[0], hub.center[1], p.center[0], p.center[1]] as [
        number,
        number,
        number,
        number,
      ],
  );
})();

const ROAD_HALF_WIDTH = 3.2;

/** Terrain height before places flatten it. */
function baseHeight(x: number, z: number): number {
  const hills = fbm(x * 0.012, z * 0.012, 4, 1) * 6.5;
  const detail = fbm(x * 0.055, z * 0.055, 3, 7) * 1.1;
  const d = Math.hypot(x, z) / (WORLD_SIZE * 0.5);
  const island = 1 - smoothstep(0.5, 0.95, d);
  return (hills + detail + 5.5) * island - 7 * (1 - island);
}

/** Plateau height each place sits on — always comfortably above the water. */
const PLATEAUS = new Map<string, number>(
  PLACES.map((p) => [
    p.id,
    Math.max(baseHeight(p.center[0], p.center[1]), WATER_LEVEL + 2.2),
  ]),
);

/**
 * Authoritative terrain height. The mesh, the player, the props and the
 * camera all read from this one function so nothing ever floats or sinks.
 */
export function heightAt(x: number, z: number): number {
  let h = baseHeight(x, z);

  // Flatten each place into a plateau.
  for (const place of PLACES) {
    const plateau = PLATEAUS.get(place.id)!;
    const d = Math.hypot(x - place.center[0], z - place.center[1]);
    const t = 1 - smoothstep(place.radius * 0.62, place.radius * 1.3, d);
    if (t > 0) h = lerp(h, plateau, t);
  }

  // Carve gentle roads between them.
  for (const [ax, az, bx, bz] of ROADS) {
    const d = distToSegment(x, z, ax, az, bx, bz);
    if (d > ROAD_HALF_WIDTH * 4) continue;
    const t = 1 - smoothstep(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH * 3.4, d);
    if (t > 0) h = lerp(h, Math.max(h, WATER_LEVEL + 1.4) - 0.25, t * 0.85);
  }

  return h;
}

/** How road-like a point is, 0..1. Used for ground colour and prop masking. */
export function roadFactor(x: number, z: number): number {
  let best = 0;
  for (const [ax, az, bx, bz] of ROADS) {
    const d = distToSegment(x, z, ax, az, bx, bz);
    best = Math.max(best, 1 - smoothstep(ROAD_HALF_WIDTH * 0.5, ROAD_HALF_WIDTH * 1.6, d));
  }
  return best;
}

/** How strongly a point belongs to a place, 0..1. */
export function placeFactor(x: number, z: number, placeIndex: number): number {
  const place = PLACES[placeIndex];
  if (!place) return 0;
  const d = Math.hypot(x - place.center[0], z - place.center[1]);
  return 1 - smoothstep(place.radius * 0.55, place.radius * 1.15, d);
}

const GRASS = new THREE.Color("#a8b566");
const GRASS_DARK = new THREE.Color("#7c8c4d");
const SAND = new THREE.Color("#e2d3a8");
const ROAD = new THREE.Color("#cbb894");

export function createTerrain(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const placeColors = PLACES.map((p) => new THREE.Color(p.palette.ground));

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = heightAt(x, z);
    position.setY(i, y);

    // Base grass, darkened in the dips.
    color.copy(GRASS).lerp(GRASS_DARK, smoothstep(9, 2, y));

    // Beaches near the waterline.
    color.lerp(SAND, smoothstep(WATER_LEVEL + 2.4, WATER_LEVEL - 0.4, y));

    // Each place tints its own ground.
    for (let p = 0; p < PLACES.length; p++) {
      const t = placeFactor(x, z, p);
      if (t > 0) color.lerp(placeColors[p]!, t * 0.75);
    }

    // Roads on top of everything.
    color.lerp(ROAD, roadFactor(x, z) * 0.85);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}
