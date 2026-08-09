import * as THREE from "three";
import { WATER_LEVEL, WORLD_SIZE } from "./terrain";
import { sharedUniforms } from "./materials";

/**
 * Sky, sea and light.
 *
 * The colours here are the reference world's own: a genuinely blue sky
 * (#248fd5) with a pale horizon (#caf0fe), a bright haze band right on the
 * skyline (#d8eeff) and warm cream clouds (#ffe5c4). It looks too blue on its
 * own — the warmth comes from the grade in `core/post.ts`.
 */

export const SKY_COLOR = new THREE.Color("#248fd5");
export const HORIZON_COLOR = new THREE.Color("#caf0fe");
export const HORIZON_BAND = new THREE.Color("#d8eeff");
export const CLOUD_COLOR = new THREE.Color("#ffe5c4");
export const SEA_COLOR = new THREE.Color("#5a7aa2");

/** Short far plane + matching fog is what produces the hazy distance. */
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 190;
const FOG_NEAR = 88;
const FOG_FAR = 186;

export interface Environment {
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  update(elapsed: number, cameraPosition: THREE.Vector3): void;
}

function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(CAMERA_FAR * 0.92, 40, 24);

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uColorHorizon: { value: HORIZON_COLOR },
      uColorHorizonOverlay: { value: HORIZON_BAND },
      uColorSky: { value: SKY_COLOR },
      uColorClouds: { value: CLOUD_COLOR },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorHorizon;
      uniform vec3 uColorHorizonOverlay;
      uniform vec3 uColorSky;
      uniform vec3 uColorClouds;
      uniform float uTime;

      varying vec3 vDirection;

      float hash( vec2 p ) {
        return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
      }

      float noise( vec2 p ) {
        vec2 i = floor( p );
        vec2 f = fract( p );
        vec2 u = f * f * ( 3.0 - 2.0 * f );
        return mix(
          mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
          mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
          u.y
        );
      }

      float fbm( vec2 p ) {
        float value = 0.0;
        float amplitude = 0.5;
        for ( int i = 0; i < 5; i++ ) {
          value += noise( p ) * amplitude;
          p *= 2.03;
          amplitude *= 0.5;
        }
        return value;
      }

      // Remap a value from one range to another, clamped.
      float fit( float v, float a, float b, float c, float d ) {
        return clamp( ( v - a ) / ( b - a ), 0.0, 1.0 ) * ( d - c ) + c;
      }

      void main() {
        float h = vDirection.y;

        // Pale horizon rising into deep blue.
        float t = fit( h, -0.2, 0.35, 0.0, 1.0 );
        t = t * t * ( 3.0 - 2.0 * t );
        vec3 color = mix( uColorHorizon, uColorSky, t );

        // Drifting cloud sheet, flattened towards the horizon.
        vec2 cloudUv = vDirection.xz / max( abs( h ) + 0.18, 0.001 );
        float clouds = fbm( cloudUv * 0.55 + vec2( uTime * 0.006, uTime * 0.003 ) );
        clouds = smoothstep( 0.48, 0.86, clouds ) * smoothstep( -0.02, 0.22, h );
        color = mix( color, uColorClouds, clouds * 0.85 );

        // The bright haze band sitting exactly on the skyline.
        color = mix( color, uColorHorizonOverlay, fit( h, -0.04, 0.07, 1.0, 0.0 ) );

        gl_FragColor = vec4( color, 1.0 );
      }
    `,
  });

  const sky = new THREE.Mesh(geometry, material);
  sky.name = "sky";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  return sky;
}

function createSea(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: SEA_COLOR },
        uColorFoam: { value: new THREE.Color("#ffffff") },
        uTime: { value: 0 },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
        vWorldPos = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      uniform vec3 uColorFoam;
      uniform float uTime;
      varying vec3 vWorldPos;

      void main() {
        // Banded ripples rather than a specular highlight — same flat,
        // illustrated language as the ramp shading on land.
        float wave = sin( vWorldPos.x * 0.35 + uTime * 0.9 )
                   + sin( vWorldPos.z * 0.27 - uTime * 0.7 )
                   + sin( ( vWorldPos.x + vWorldPos.z ) * 0.13 + uTime * 0.45 );
        float foam = smoothstep( 1.9, 2.6, wave );
        vec3 color = mix( uColor, uColorFoam, foam * 0.5 );
        gl_FragColor = vec4( color, 0.88 );
        #include <fog_fragment>
      }
    `,
  });
  material.uniforms.uColor.value = SEA_COLOR;
  material.uniforms.uColorFoam.value = new THREE.Color("#ffffff");

  const sea = new THREE.Mesh(geometry, material);
  sea.position.y = WATER_LEVEL;
  sea.name = "sea";
  sea.renderOrder = -1;
  return sea;
}

export function createEnvironment(scene: THREE.Scene): Environment {
  // Fog is the horizon colour so land dissolves into the skyline.
  scene.fog = new THREE.Fog(HORIZON_COLOR.clone(), FOG_NEAR, FOG_FAR);
  scene.background = HORIZON_COLOR.clone();

  const sky = createSky();
  scene.add(sky);

  const sea = createSea();
  scene.add(sea);

  // In this shading model the *indirect* light is what colours the shadows:
  // where the sun is blocked, all that is left is this. A blue-violet sky
  // bounce and a warm ground bounce give shadows a hue instead of just making
  // them dark, which is the whole point of the reference's look.
  const hemi = new THREE.HemisphereLight("#7b8bc4", "#c9ac82", 1.15);
  scene.add(hemi);

  // White sun. All the warmth arrives via the ramps and the grade.
  const sun = new THREE.DirectionalLight("#ffffff", 2.95);
  const sunOffset = new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(100, Math.PI * 0.2, Math.PI * -1.75),
  );
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  const extent = 42;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.normalBias = 0.06;
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  // Shadows sit *over* the ambient rather than replacing it, so they stay
  // coloured and never crush to black.
  sun.shadow.intensity = 0.74;
  scene.add(sun);
  scene.add(sun.target);

  const seaMaterial = sea.material as THREE.ShaderMaterial;

  return {
    sun,
    sky,
    update(elapsed, cameraPosition) {
      // Sky and sea follow the camera so they never run out.
      sky.position.copy(cameraPosition);
      sea.position.set(cameraPosition.x, WATER_LEVEL, cameraPosition.z);
      seaMaterial.uniforms.uTime.value = elapsed;
    },
  };
}

/** Keeps the sun's shadow frustum centred on a moving target. */
export function followSun(sun: THREE.DirectionalLight, target: THREE.Vector3): void {
  const offset = new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(100, Math.PI * 0.2, Math.PI * -1.75),
  );
  sun.position.copy(target).add(offset);
  sun.target.position.copy(target);
  sun.target.updateMatrixWorld();
}
