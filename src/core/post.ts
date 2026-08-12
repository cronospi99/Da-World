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
 *
 * The city brought a clock with it, and one fixed grade cannot serve both noon
 * and midnight: the cream gain that makes an afternoon glow turns a night
 * street the colour of weak tea. So `setMood` slides the lift and the gain
 * between a warm daytime set and a cool nocturnal one, and drops the overlay
 * wash almost to nothing after dark. It is still one pass and still the same
 * four moves — only the endpoints move.
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
  /** Rebuild the render target at a new MSAA sample count. */
  setSamples(samples: number): void;
  /** 0 = paper white, 1 = fully graded scene. */
  setTransition(value: number): void;
  /** 0 = broad daylight, 1 = deep night. */
  setMood(night: number): void;
}

/** The grade at noon and the grade at midnight; every hour is between them. */
const MOOD = {
  day: {
    lift: new THREE.Color("#3b3550"),
    gain: new THREE.Color("#fff3da"),
    overlay: 0.045,
    saturation: 1.02,
    contrast: 1.13,
    warmth: 0.05,
  },
  night: {
    lift: new THREE.Color("#131a33"),
    gain: new THREE.Color("#cddcff"),
    overlay: 0.012,
    saturation: 0.94,
    contrast: 1.2,
    warmth: -0.06,
  },
} as const;

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  samples: number,
): Post {
  // The composer renders into this target, not into the canvas, which is why
  // the renderer's own `antialias: true` never did anything: it applies to the
  // default framebuffer and every frame here goes through the grade. Asking
  // for the samples *here* is what actually anti-aliases the city.
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples,
  });

  const composer = new EffectComposer(renderer, target);
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
    setSamples(next) {
      if (target.samples === next) return;
      target.samples = next;
      target.dispose();
    },
    setTransition(value) {
      grade.uniforms.uTransition.value = value;
    },
    setMood(night) {
      const t = THREE.MathUtils.clamp(night, 0, 1);
      const u = grade.uniforms;
      (u.uLift.value as THREE.Color).copy(MOOD.day.lift).lerp(MOOD.night.lift, t);
      (u.uGain.value as THREE.Color).copy(MOOD.day.gain).lerp(MOOD.night.gain, t);
      u.uOverlayAmount.value = THREE.MathUtils.lerp(MOOD.day.overlay, MOOD.night.overlay, t);
      u.uSaturation.value = THREE.MathUtils.lerp(MOOD.day.saturation, MOOD.night.saturation, t);
      u.uContrast.value = THREE.MathUtils.lerp(MOOD.day.contrast, MOOD.night.contrast, t);
      u.uWarmth.value = THREE.MathUtils.lerp(MOOD.day.warmth, MOOD.night.warmth, t);
    },
  };
}
