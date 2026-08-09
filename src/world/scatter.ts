import * as THREE from "three";
import { makeRandom } from "../core/noise";
import { PLACES } from "../content/places";
import { toonMaterial } from "./materials";
import { WATER_LEVEL, WORLD_SIZE, heightAt, roadFactor } from "./terrain";

/**
 * Scenery: grass patches, background trees and rocks.
 *
 * Grass is instanced crossed quads carrying a procedurally drawn blade
 * texture — the same trick the reference world uses. They sway in the wind,
 * bend away from the player and fade out with distance so the horizon stays
 * clean.
 */

const GRASS_COUNT = 5200;
const TREE_COUNT = 210;
const ROCK_COUNT = 90;
const GRASS_FADE = 58;

/** Draws a clump of blades on a transparent canvas. */
function createBladeTexture(): THREE.Texture {
  const width = 128;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);

  const random = makeRandom(7412);
  for (let i = 0; i < 16; i++) {
    const baseX = 12 + random() * (width - 24);
    const bladeHeight = height * (0.45 + random() * 0.5);
    const lean = (random() - 0.5) * 34;
    const halfWidth = 2 + random() * 2.4;
    // Blades are lighter at the tip so the clump reads as rounded.
    const shade = 0.72 + random() * 0.28;
    const g = ctx.createLinearGradient(0, height, 0, height - bladeHeight);
    g.addColorStop(0, `rgba(${Math.round(120 * shade)},${Math.round(150 * shade)},${Math.round(110 * shade)},1)`);
    g.addColorStop(1, `rgba(${Math.round(225 * shade)},${Math.round(240 * shade)},${Math.round(180 * shade)},1)`);
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(baseX - halfWidth, height);
    ctx.quadraticCurveTo(
      baseX - halfWidth * 0.5 + lean * 0.4,
      height - bladeHeight * 0.55,
      baseX + lean,
      height - bladeHeight,
    );
    ctx.quadraticCurveTo(
      baseX + halfWidth * 0.5 + lean * 0.4,
      height - bladeHeight * 0.55,
      baseX + halfWidth,
      height,
    );
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** Two quads crossed at 90°, origin at the base. */
function createGrassGeometry(): THREE.BufferGeometry {
  const plane = new THREE.PlaneGeometry(0.95, 0.5, 1, 3);
  plane.translate(0, 0.25, 0);

  const second = plane.clone();
  second.rotateY(Math.PI / 2);

  const merged = mergeGeometries([plane, second]);
  plane.dispose();
  second.dispose();
  return merged;
}

/** Minimal position/uv/normal merge — avoids pulling in the addons utility. */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  const attributes = ["position", "normal", "uv"] as const;

  for (const name of attributes) {
    const arrays: number[] = [];
    let itemSize = 3;
    for (const geometry of geometries) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      itemSize = attribute.itemSize;
      const indexed = geometry.index;
      if (!indexed) {
        arrays.push(...Array.from(attribute.array));
        continue;
      }
      for (let i = 0; i < indexed.count; i++) {
        const vertex = indexed.getX(i);
        for (let c = 0; c < itemSize; c++) {
          arrays.push(attribute.array[vertex * itemSize + c]!);
        }
      }
    }
    result.setAttribute(name, new THREE.Float32BufferAttribute(arrays, itemSize));
  }
  return result;
}

function reservedPoints(): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const place of PLACES) {
    for (const spot of place.spots) {
      points.push([place.center[0] + spot.offset[0], place.center[1] + spot.offset[1]]);
    }
  }
  return points;
}

function isBlocked(x: number, z: number, reserved: Array<[number, number]>): boolean {
  if (roadFactor(x, z) > 0.25) return true;
  for (const [rx, rz] of reserved) {
    if (Math.hypot(x - rx, z - rz) < 3.2) return true;
  }
  return false;
}

function insideAnyPlace(x: number, z: number, shrink = 1): boolean {
  return PLACES.some(
    (p) => Math.hypot(x - p.center[0], z - p.center[1]) < p.radius * shrink,
  );
}

export function createScatter(): THREE.Group {
  const group = new THREE.Group();
  group.name = "scatter";
  const random = makeRandom(20260809);
  const reserved = reservedPoints();
  const half = WORLD_SIZE * 0.45;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // --- grass patches -----------------------------------------------------
  const grass = new THREE.InstancedMesh(
    createGrassGeometry(),
    toonMaterial({
      ramp: "foliage",
      map: createBladeTexture(),
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      wind: true,
      windStrength: 0.13,
      windHeight: 0.5,
      reactToPlayer: true,
      fadeAway: GRASS_FADE,
    }),
    GRASS_COUNT,
  );
  grass.castShadow = false;
  grass.receiveShadow = true;
  grass.name = "grass";

  const tuftPale = new THREE.Color("#c3d79b");
  const tuftDeep = new THREE.Color("#7ba171");

  let placed = 0;
  for (let attempt = 0; attempt < GRASS_COUNT * 6 && placed < GRASS_COUNT; attempt++) {
    const x = (random() - 0.5) * 2 * half;
    const z = (random() - 0.5) * 2 * half;
    const y = heightAt(x, z);
    if (y < WATER_LEVEL + 1.2) continue;
    if (isBlocked(x, z, reserved)) continue;

    dummy.position.set(x, y - 0.04, z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    const s = 0.7 + random() * 0.65;
    dummy.scale.set(s, s * (0.75 + random() * 0.7), s);
    dummy.updateMatrix();
    grass.setMatrixAt(placed, dummy.matrix);
    grass.setColorAt(placed, color.copy(tuftDeep).lerp(tuftPale, random()));
    placed++;
  }
  grass.count = placed;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  group.add(grass);

  // --- background trees --------------------------------------------------
  const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 5);
  trunkGeometry.translate(0, 1.1, 0);
  const canopyGeometry = new THREE.ConeGeometry(1.7, 4.2, 6);
  canopyGeometry.translate(0, 4.1, 0);

  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    toonMaterial({ color: "#6b452c", flatShading: true }),
    TREE_COUNT,
  );
  const canopies = new THREE.InstancedMesh(
    canopyGeometry,
    toonMaterial({
      ramp: "foliage",
      flatShading: true,
      wind: true,
      windStrength: 0.12,
      windHeight: 6,
    }),
    TREE_COUNT,
  );
  trunks.castShadow = canopies.castShadow = true;
  trunks.receiveShadow = canopies.receiveShadow = true;

  const leafA = new THREE.Color("#8fb47f");
  const leafB = new THREE.Color("#5f8a63");

  let trees = 0;
  for (let attempt = 0; attempt < TREE_COUNT * 40 && trees < TREE_COUNT; attempt++) {
    const x = (random() - 0.5) * 2 * half;
    const z = (random() - 0.5) * 2 * half;
    const y = heightAt(x, z);
    if (y < WATER_LEVEL + 2.5) continue;
    if (isBlocked(x, z, reserved)) continue;
    if (insideAnyPlace(x, z, 1.05)) continue;

    dummy.position.set(x, y, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    const s = 0.8 + random() * 0.7;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    trunks.setMatrixAt(trees, dummy.matrix);
    canopies.setMatrixAt(trees, dummy.matrix);
    canopies.setColorAt(trees, color.copy(leafA).lerp(leafB, random()));
    trees++;
  }
  trunks.count = canopies.count = trees;
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  group.add(trunks, canopies);

  // --- rocks -------------------------------------------------------------
  const rockGeometry = new THREE.IcosahedronGeometry(0.8, 0);
  rockGeometry.translate(0, 0.45, 0);
  const rocks = new THREE.InstancedMesh(
    rockGeometry,
    toonMaterial({ color: "#a9a49a", ramp: "stone", flatShading: true }),
    ROCK_COUNT,
  );
  rocks.castShadow = rocks.receiveShadow = true;

  let stones = 0;
  for (let attempt = 0; attempt < ROCK_COUNT * 40 && stones < ROCK_COUNT; attempt++) {
    const x = (random() - 0.5) * 2 * half;
    const z = (random() - 0.5) * 2 * half;
    const y = heightAt(x, z);
    if (y < WATER_LEVEL - 0.5) continue;
    if (isBlocked(x, z, reserved)) continue;
    if (insideAnyPlace(x, z, 0.9)) continue;

    dummy.position.set(x, y, z);
    dummy.rotation.set(random(), random() * Math.PI * 2, random() * 0.4);
    dummy.scale.set(0.6 + random(), 0.4 + random() * 0.5, 0.6 + random());
    dummy.updateMatrix();
    rocks.setMatrixAt(stones, dummy.matrix);
    stones++;
  }
  rocks.count = stones;
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);

  return group;
}
