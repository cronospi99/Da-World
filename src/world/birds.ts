import * as THREE from "three";
import { makeRandom } from "../core/noise";

/**
 * A handful of birds drifting over the island. Pure decoration, but empty sky
 * is what makes a small world feel static — the reference has them too.
 */

const BIRD_COUNT = 22;

function createBirdGeometry(): THREE.BufferGeometry {
  // A flat chevron: two triangles meeting at the body.
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    0, 0, 0.35, -0.85, 0.12, -0.3, 0, 0, -0.15,
    0, 0, 0.35, 0, 0, -0.15, 0.85, 0.12, -0.3,
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export interface Birds {
  group: THREE.Group;
  update(elapsed: number, center: THREE.Vector3): void;
}

export function createBirds(): Birds {
  const group = new THREE.Group();
  group.name = "birds";

  const material = new THREE.MeshBasicMaterial({
    color: "#dfdfdf",
    side: THREE.DoubleSide,
    fog: true,
  });

  const mesh = new THREE.InstancedMesh(createBirdGeometry(), material, BIRD_COUNT);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);

  const random = makeRandom(5150);
  const flock = Array.from({ length: BIRD_COUNT }, () => ({
    radius: 26 + random() * 55,
    height: 22 + random() * 26,
    speed: (0.06 + random() * 0.09) * (random() > 0.5 ? 1 : -1),
    phase: random() * Math.PI * 2,
    flap: 4 + random() * 3,
    drift: random() * Math.PI * 2,
  }));

  const dummy = new THREE.Object3D();

  return {
    group,
    update(elapsed, center) {
      for (let i = 0; i < flock.length; i++) {
        const bird = flock[i]!;
        const angle = bird.phase + elapsed * bird.speed;

        dummy.position.set(
          center.x + Math.cos(angle) * bird.radius,
          bird.height + Math.sin(elapsed * 0.35 + bird.drift) * 2.5,
          center.z + Math.sin(angle) * bird.radius,
        );
        // Face along the tangent of the circle it is flying.
        dummy.rotation.set(0, -angle + (bird.speed > 0 ? 0 : Math.PI), 0);
        // Flap by squashing the wingspan.
        const flap = Math.sin(elapsed * bird.flap + bird.phase);
        dummy.scale.set(1, 0.55 + flap * 0.45, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
