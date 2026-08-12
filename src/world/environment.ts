import * as THREE from "three";
import { PALETTE } from "../city/palette";
import type { SkySample } from "../city/daynight";

/**
 * Sky, light and air over the city.
 *
 * The island version of this file was one fixed golden afternoon: hand-picked
 * sky colours, a sun bolted at one angle, and a grade that turned the whole
 * thing warm. The city brings a clock with it, so every one of those numbers is
 * now a function of the hour — but the *shapes* are the island's, and they are
 * why the picture still reads as a painting rather than a simulation:
 *
 *   - a genuinely coloured sky dome with a drifting cloud sheet and a bright
 *     haze band sitting exactly on the skyline;
 *   - fog in the horizon colour, close enough that distance dissolves;
 *   - indirect light that *colours* the shadows instead of only darkening
 *     them, which is what stops a low-poly city looking like flat plastic;
 *   - and, on top of both, a pre-filtered environment map so every surface
 *     picks up sky from above and ground bounce from below.
 */

/** Far enough for the towers and the woodland belt, near enough to stay cheap. */
export const CAMERA_NEAR = 0.25;
export const CAMERA_FAR = 320;

export interface Environment {
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  /** Re-tint everything from one sample of the clock. */
  apply(sample: SkySample): void;
  /** Per-frame: keeps the dome, the stars and the shadow box on the player. */
  follow(elapsed: number, target: THREE.Vector3): void;
}

/* ------------------------------------------------------------------ *
 * Sky                                                                 *
 * ------------------------------------------------------------------ */

function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(CAMERA_FAR * 0.9, 40, 24);

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uColorHorizon: { value: new THREE.Color("#caf0fe") },
      uColorHorizonOverlay: { value: new THREE.Color("#d8eeff") },
      uColorSky: { value: new THREE.Color("#248fd5") },
      uColorClouds: { value: new THREE.Color("#ffe5c4") },
      /** Clouds thin out at night; at 0 the sheet disappears entirely. */
      uCloudAmount: { value: 0.85 },
      uTime: { value: 0 },
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
      uniform float uCloudAmount;
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

      float fit( float v, float a, float b, float c, float d ) {
        return clamp( ( v - a ) / ( b - a ), 0.0, 1.0 ) * ( d - c ) + c;
      }

      void main() {
        float h = vDirection.y;

        float t = fit( h, -0.2, 0.35, 0.0, 1.0 );
        t = t * t * ( 3.0 - 2.0 * t );
        vec3 color = mix( uColorHorizon, uColorSky, t );

        vec2 cloudUv = vDirection.xz / max( abs( h ) + 0.18, 0.001 );
        float clouds = fbm( cloudUv * 0.55 + vec2( uTime * 0.006, uTime * 0.003 ) );
        clouds = smoothstep( 0.48, 0.86, clouds ) * smoothstep( -0.02, 0.22, h );
        color = mix( color, uColorClouds, clouds * uCloudAmount );

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

/** A dome of stars, invisible by day and faded in after dusk. */
function createStars(): THREE.Points {
  const count = 1100;
  const pos = new Float32Array(count * 3);
  let seed = 20260812;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    // Upper hemisphere only — stars below the horizon are wasted vertices.
    const theta = rnd() * Math.PI * 2;
    const y = 0.05 + rnd() * 0.95;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(theta) * r * 260;
    pos[i * 3 + 1] = y * 260;
    pos[i * 3 + 2] = Math.sin(theta) * r * 260;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: "#eaf2ff",
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  stars.renderOrder = -999;
  stars.frustumCulled = false;
  stars.visible = false;
  return stars;
}

/* ------------------------------------------------------------------ *
 * Indirect light                                                      *
 * ------------------------------------------------------------------ */

/**
 * Pre-filter a miniature sky and ground into an environment map.
 *
 * One call at boot, and every surface in the city gets soft directional
 * ambient for free — blue from above, green bounce from below. Without it the
 * Kenney palette reads as flat vinyl; with it the same triangles have a
 * direction to their shading before the sun has said anything.
 */
function buildEnvironmentMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(40, 16, 10),
    new THREE.MeshBasicMaterial({ color: "#9ec8ea", side: THREE.BackSide }),
  );
  envScene.add(dome);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PALETTE.grass }),
  );
  floor.position.y = -4;
  envScene.add(floor);
  scene.environment = pmrem.fromScene(envScene, 0.04, 1, 100).texture;
  scene.environmentIntensity = 0.5;
  dome.geometry.dispose();
  floor.geometry.dispose();
  pmrem.dispose();
}

/* ------------------------------------------------------------------ *
 * The whole thing                                                     *
 * ------------------------------------------------------------------ */

/** Half-width of the sun's shadow box. Big enough for a block and its towers. */
const SHADOW_EXTENT = 44;

export function createEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): Environment {
  scene.fog = new THREE.Fog(new THREE.Color("#dbe9f3"), 26, 130);
  scene.background = new THREE.Color("#dbe9f3");

  const sky = createSky();
  scene.add(sky);
  const stars = createStars();
  scene.add(stars);

  // The city sits on an endless lawn: without it the blocks look like a model
  // on a table instead of a place that continues past the horizon.
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: PALETTE.grassDark, roughness: 1 }),
  );
  lawn.position.y = -0.09;
  lawn.name = "lawn";
  scene.add(lawn);

  // Indirect light is what *colours* the shadows: where the sun is blocked,
  // this is all that is left. Hue in the shadow rather than only darkness is
  // the difference between an illustration and a render.
  const hemi = new THREE.HemisphereLight("#dff0ff", "#86a06a", 0.32);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight("#ffffff", 0.05);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight("#fff2dc", 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.normalBias = 0.05;
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 2;
  // Shadows sit *over* the ambient rather than replacing it, so they stay
  // coloured and never crush to black.
  sun.shadow.intensity = 0.82;
  scene.add(sun, sun.target);

  buildEnvironmentMap(renderer, scene);

  const skyMaterial = sky.material as THREE.ShaderMaterial;
  const starMaterial = stars.material as THREE.PointsMaterial;
  const lawnMaterial = lawn.material as THREE.MeshStandardMaterial;
  const lawnDay = new THREE.Color(PALETTE.grassDark);
  const lawnNight = new THREE.Color("#2c3a3a");
  const cloudWarm = new THREE.Color("#fff0d4");
  const fog = scene.fog as THREE.Fog;
  const sunDirection = new THREE.Vector3(-0.55, 1, 0.42);

  return {
    sun,
    sky,

    apply(s: SkySample) {
      skyMaterial.uniforms.uColorSky.value.copy(s.top);
      skyMaterial.uniforms.uColorHorizon.value.copy(s.bottom);
      skyMaterial.uniforms.uColorHorizonOverlay.value.copy(s.fog);
      // The cloud sheet takes the horizon's colour, pulled halfway to cream so
      // it still catches the light at dawn and dusk; at night it fades out.
      skyMaterial.uniforms.uColorClouds.value.copy(s.bottom).lerp(cloudWarm, 0.5);
      skyMaterial.uniforms.uCloudAmount.value = 0.85 * (1 - s.night * 0.85);

      fog.color.copy(s.fog);
      fog.near = s.fogNear;
      // A touch further than the city's own camera used, because this one sits
      // at street level and needs to see down a boulevard.
      fog.far = s.fogFar * 1.35;
      (scene.background as THREE.Color).copy(s.fog);

      sun.color.copy(s.sun);
      sun.intensity = s.sunIntensity;
      sunDirection.set(s.dirX, s.dirY, s.dirZ).normalize();

      hemi.color.copy(s.hemiSky);
      hemi.groundColor.copy(s.hemiGround);
      hemi.intensity = s.hemiIntensity;
      ambient.intensity = s.ambient;
      scene.environmentIntensity = s.envIntensity;

      lawnMaterial.color.copy(lawnDay).lerp(lawnNight, s.night);

      starMaterial.opacity = Math.max(0, s.night - 0.25) / 0.75;
      stars.visible = starMaterial.opacity > 0.02;
    },

    follow(elapsed: number, target: THREE.Vector3) {
      skyMaterial.uniforms.uTime.value = elapsed;
      sky.position.set(target.x, 0, target.z);
      stars.position.set(target.x, 0, target.z);
      lawn.position.set(target.x, -0.09, target.z);

      // Keep the shadow frustum glued to the player, so the whole 2048² map is
      // spent on what is actually on screen.
      const d = SHADOW_EXTENT * 1.4;
      sun.position.set(
        target.x + sunDirection.x * d,
        Math.max(6, sunDirection.y * d),
        target.z + sunDirection.z * d,
      );
      sun.target.position.set(target.x, 0, target.z);
      sun.target.updateMatrixWorld();
    },
  };
}
