import * as THREE from "three";
import { WATER_LEVEL, WORLD_SIZE } from "./terrain";

const SKY_TOP = new THREE.Color("#8fc4d8");
const SKY_BOTTOM = new THREE.Color("#ffe9c2");
const FOG_COLOR = new THREE.Color("#f3e2c0");

export interface Environment {
  water: THREE.Mesh;
  sun: THREE.DirectionalLight;
  update(elapsed: number): void;
}

function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(WORLD_SIZE * 1.4, 32, 20);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: SKY_TOP },
      bottomColor: { value: SKY_BOTTOM },
      offset: { value: 24.0 },
      exponent: { value: 0.7 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), exponent);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.name = "sky";
  return sky;
}

function createWater(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE * 2.5, WORLD_SIZE * 2.5, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: "#5fa9bd",
    transparent: true,
    opacity: 0.82,
    roughness: 0.25,
    metalness: 0.1,
  });
  const water = new THREE.Mesh(geometry, material);
  water.position.y = WATER_LEVEL;
  water.name = "water";
  return water;
}

/** Soft low-poly clouds drifting above the island. */
function createClouds(): THREE.Group {
  const group = new THREE.Group();
  group.name = "clouds";
  const material = new THREE.MeshStandardMaterial({
    color: "#fffaf0",
    roughness: 1,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });

  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 3);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(
        new THREE.IcosahedronGeometry(4 + Math.random() * 4, 0),
        material,
      );
      puff.position.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 2.5,
        (Math.random() - 0.5) * 8,
      );
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    const angle = Math.random() * Math.PI * 2;
    const radius = 30 + Math.random() * 110;
    cloud.position.set(
      Math.cos(angle) * radius,
      42 + Math.random() * 20,
      Math.sin(angle) * radius,
    );
    group.add(cloud);
  }
  return group;
}

export function createEnvironment(scene: THREE.Scene): Environment {
  scene.fog = new THREE.Fog(FOG_COLOR, 90, 230);
  scene.background = FOG_COLOR.clone();

  scene.add(createSky());

  const water = createWater();
  scene.add(water);

  const clouds = createClouds();
  scene.add(clouds);

  const hemi = new THREE.HemisphereLight("#cfe6f2", "#a08b62", 1.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#ffe7bd", 2.1);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  const s = 90;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0009;
  scene.add(sun);
  scene.add(sun.target);

  return {
    water,
    sun,
    update(elapsed: number) {
      water.position.y = WATER_LEVEL + Math.sin(elapsed * 0.6) * 0.06;
      clouds.rotation.y = elapsed * 0.004;
    },
  };
}
