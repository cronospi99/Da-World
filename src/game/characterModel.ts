import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mat } from "../city/palette";
import type { MotionState } from "./physics";

/**
 * The rigged character.
 *
 * Loads `public/models/character.glb`, rescales it to the world, swaps its
 * materials for the city's so it shades like the street it is standing on, and
 * drives its animation clips from the physics state.
 *
 * Nothing here is specific to the model that ships with the repo — see
 * `public/models/README.md` for how to swap in your own.
 */

// Served straight out of `public/`, so this resolves correctly both on the dev
// server and under the /Da-World/ subpath on Pages.
const MODEL_URL = `${import.meta.env.BASE_URL}models/character.glb`;

/**
 * The character is scaled so it stands this tall in world units.
 *
 * One tile of the city is about a metre and a half — a shop is two tiles wide
 * and its ground floor is 2.3 tall — so a person is a shade over one. Getting
 * this wrong is the fastest way to make a city look like a toy: at the island's
 * old 2.3 the character was taller than a shopfront.
 */
const TARGET_HEIGHT = 1.75;

/**
 * Rotate the model if its bind pose does not face +Z. The bundled robot
 * already does, so this is 0 — but a model exported facing the other way needs
 * `Math.PI` here, or the character walks backwards.
 */
const FACING_OFFSET = 0;

/** Game state -> clip name in the GLB. */
const CLIPS = {
  idle: "Idle",
  walk: "Walking",
  run: "Running",
  air: "Jump",
  bored: "Wave",
} as const;

/** Above this speed (units/s) the walk blends into the run. */
const RUN_THRESHOLD = 4.5;
/** Speed the run clip was authored at, used to keep the feet roughly planted. */
const RUN_REFERENCE_SPEED = 7.5;
const WALK_REFERENCE_SPEED = 3.2;

const FADE = 0.22;

export class CharacterModel {
  readonly object: THREE.Group;

  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = "";
  /** Set while a one-shot clip (jump, wave) owns the character. */
  private oneShotUntil = 0;
  private clock = 0;

  private constructor(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
    const model = gltf.scene;

    // --- scale to the world ----------------------------------------------
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y;
    const scale = height > 0 ? TARGET_HEIGHT / height : 1;
    model.scale.setScalar(scale);
    // Drop it so its feet sit on the group's origin.
    model.position.y = -box.min.y * scale;

    // The wrapper carries the facing offset so `object.rotation.y` stays the
    // character's true heading for everything else in the game.
    this.object = new THREE.Group();
    this.object.name = "character";
    const facing = new THREE.Group();
    facing.rotation.y = FACING_OFFSET;
    facing.add(model);
    this.object.add(facing);

    // --- materials --------------------------------------------------------
    // Keep each source material's base colour, but shade it with our ramps.
    const converted = new Map<THREE.Material, THREE.Material>();
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;

      // The model ships glossy PBR materials that read as plastic beside the
      // matte city. Its colours are kept; only the finish is replaced, and by
      // going through the city's cache the whole character costs a handful of
      // materials shared with everything else.
      const source = mesh.material as THREE.MeshStandardMaterial;
      if (!converted.has(source)) {
        converted.set(
          source,
          mat(source.color?.getHex() ?? 0xffffff, { roughness: 0.85, metalness: 0 }),
        );
      }
      mesh.material = converted.get(source)!;
    });

    // --- animation --------------------------------------------------------
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }

    for (const name of [CLIPS.air, CLIPS.bored]) {
      const action = this.actions.get(name);
      if (action) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
    }

    this.play(CLIPS.idle, 0);
  }

  static async load(): Promise<CharacterModel> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);
    return new CharacterModel(gltf as unknown as {
      scene: THREE.Group;
      animations: THREE.AnimationClip[];
    });
  }

  /** Available clip names — handy when swapping models. */
  get clipNames(): string[] {
    return [...this.actions.keys()];
  }

  private play(name: string, fade = FADE): void {
    if (this.currentName === name) return;
    const next = this.actions.get(name);
    if (!next) return;

    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && fade > 0) {
      next.crossFadeFrom(this.current, fade, false);
    }
    next.play();

    this.current = next;
    this.currentName = name;
  }

  /** Restart a one-shot clip and hold it for its duration. */
  private trigger(name: string): void {
    const action = this.actions.get(name);
    if (!action) return;
    this.currentName = "";
    this.play(name, 0.12);
    this.oneShotUntil = this.clock + action.getClip().duration;
  }

  onJump(): void {
    this.trigger(CLIPS.air);
  }

  onBored(): void {
    this.trigger(CLIPS.bored);
  }

  update(dt: number, state: MotionState, speed: number): void {
    this.clock += dt;

    // A one-shot clip keeps the character until it finishes, unless the
    // character has landed and started moving again.
    const oneShotBusy = this.clock < this.oneShotUntil;
    if (!oneShotBusy || (state === "run" && this.currentName === CLIPS.bored)) {
      this.oneShotUntil = 0;

      if (state === "air") {
        this.play(CLIPS.air);
      } else if (state === "run") {
        const running = speed > RUN_THRESHOLD;
        this.play(running ? CLIPS.run : CLIPS.walk);
        // Match the cycle to the ground speed so the feet do not skate.
        const reference = running ? RUN_REFERENCE_SPEED : WALK_REFERENCE_SPEED;
        if (this.current) {
          this.current.timeScale = THREE.MathUtils.clamp(speed / reference, 0.55, 1.8);
        }
      } else {
        this.play(CLIPS.idle);
        if (this.current) this.current.timeScale = 1;
      }
    }

    this.mixer.update(dt);
  }
}
