import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Colour grading.
 *
 * The reference world ships a baked 3D LUT and applies it as a fullscreen
 * pass, which is what turns a fairly blue, ordinary render into that warm
 * late-afternoon photograph. We do not have their `.CUBE` file, so this pass
 * reproduces the same moves analytically: lift the shadows towards violet,
 * push the highlights towards cream, pull a little saturation out of the
 * midtones, then wash the whole frame with the same #FFF9EE overlay.
 *
 * Everything upstream of this pass should stay "honest" — a plain blue sky and
 * plain green grass. The grade is what makes it summer.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLift: { value: new THREE.Color("#3b3550") },
    uGain: { value: new THREE.Color("#fff3da") },
    uOverlayColor: { value: new THREE.Color("#fff9ee") },
    uOverlayAmount: { value: 0.045 },
    uLiftAmount: { value: 0.04 },
    uSaturation: { value: 1.02 },
    uContrast: { value: 1.13 },
    uWarmth: { value: 0.05 },
    /** Rises to 1 during the intro so the world fades up out of paper white. */
    uTransition: { value: 1 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform vec3 uOverlayColor;
    uniform float uOverlayAmount;
    uniform float uLiftAmount;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    uniform float uTransition;

    varying vec2 vUv;

    const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

    void main() {
      vec3 color = texture2D( tDiffuse, vUv ).rgb;

      // Shadows drift towards a cool violet, highlights towards warm cream.
      float luminance = dot( color, LUMA );
      color = mix( color + uLift * uLiftAmount, color, smoothstep( 0.0, 0.55, luminance ) );
      color *= mix( vec3( 1.0 ), uGain, smoothstep( 0.35, 1.0, luminance ) );

      // Gentle S-curve around the midtones.
      color = ( color - 0.5 ) * uContrast + 0.5;

      // Take the edge off the saturation, the way film does.
      color = mix( vec3( dot( color, LUMA ) ), color, uSaturation );

      // Overall warmth: red up, blue down.
      color *= vec3( 1.0 + uWarmth, 1.0 + uWarmth * 0.25, 1.0 - uWarmth * 0.9 );

      // The paper-white wash that ties the UI and the world together.
      color = mix( color, uOverlayColor, uOverlayAmount );

      // Intro fade from paper white.
      color = mix( uOverlayColor, color, uTransition );

      gl_FragColor = vec4( clamp( color, 0.0, 1.0 ), 1.0 );
    }
  `,
};

export interface Post {
  composer: EffectComposer;
  grade: ShaderPass;
  setSize(width: number, height: number): void;
  /** 0 = paper white, 1 = fully graded scene. */
  setTransition(value: number): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Post {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  composer.addPass(new RenderPass(scene, camera));
  // Tone mapping and sRGB conversion first, so the grade works in display
  // space exactly like a LUT would.
  composer.addPass(new OutputPass());

  const grade = new ShaderPass(GradeShader);
  grade.renderToScreen = true;
  composer.addPass(grade);

  return {
    composer,
    grade,
    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    setTransition(value) {
      grade.uniforms.uTransition.value = value;
    },
  };
}
