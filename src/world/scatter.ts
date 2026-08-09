import * as THREE from "three";
import { makeRandom } from "../core/noise";
import { PLACES } from "../content/places";
import { WATER_LEVEL, WORLD_SIZE, heightAt, roadFactor } from "./terrain";

/**
 * Decorative vegetation. Purely instanced so a few thousand tufts of grass
 * cost one draw call each — none of this is interactive.
 */

const GRASS_COUNT = 4200;
const TREE_COUNT = 190;
const ROCK_COUNT = 90;

/** World positions that scenery must keep clear of (interactive spots). */
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
    if (Math.hypot(x - rx, z - rz) < 4) return true;
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

  // --- grass tufts -------------------------------------------------------
  const grassGeometry = new THREE.ConeGeometry(0.24, 0.55, 3);
  grassGeometry.translate(0, 0.28, 0);
  // Per-instance colour comes from `setColorAt`; the material must stay white
  // and must NOT declare `vertexColors` (there is no per-vertex colour here).
  const grass = new THREE.InstancedMesh(
    grassGeometry,
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }),
    GRASS_COUNT,
  );
  grass.castShadow = false;
  grass.receiveShadow = true;

  const tuftTop = new THREE.Color("#b9c56f");
  const tuftBottom = new THREE.Color("#7e9048");

  let placed = 0;
  for (let attempt = 0; attempt < GRASS_COUNT * 6 && placed < GRASS_COUNT; attempt++) {
    const x = (random() - 0.5) * 2 * half;
    const z = (random() - 0.5) * 2 * half;
    const y = heightAt(x, z);
    if (y < WATER_LEVEL + 1.2) continue;
    if (isBlocked(x, z, reserved)) continue;

    dummy.position.set(x, y, z);
    dummy.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.25);
    const s = 0.8 + random() * 0.9;
    dummy.scale.set(s, s * (0.7 + random() * 0.7), s);
    dummy.updateMatrix();
    grass.setMatrixAt(placed, dummy.matrix);
    grass.setColorAt(placed, color.copy(tuftBottom).lerp(tuftTop, random()));
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
    new THREE.MeshStandardMaterial({ color: "#6b452c", roughness: 1, flatShading: true }),
    TREE_COUNT,
  );
  const canopies = new THREE.InstancedMesh(
    canopyGeometry,
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }),
    TREE_COUNT,
  );
  trunks.castShadow = canopies.castShadow = true;
  trunks.receiveShadow = canopies.receiveShadow = true;

  const leafA = new THREE.Color("#6f8a46");
  const leafB = new THREE.Color("#4e6d3a");

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
    new THREE.MeshStandardMaterial({ color: "#96938a", roughness: 1, flatShading: true }),
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
