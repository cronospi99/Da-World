import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mat } from "../city/palette";
import { PERSON_HEIGHT } from "../city/character";
import type { MotionState } from "./physics";

/**
 * The robot: a rigged GLB with a real skeleton and real clips.
 *
 * It was here first, then taken out, and both were right at the time. Taken out
 * because it was the *only* body: half a metre taller than the citizens, shaded
 * like plastic beside a matte city, and several megabytes you had to wait for
 * before the character you steer appeared at all. Back now because none of that
 * is true of a body you *choose*:
 *
 * - it is scaled from its own bounding box to `PERSON_HEIGHT`, so it stands eye
 *   to eye with the people it walks past;
 * - its PBR materials are rebuilt with the city's ramps, so it shades like the
 *   pavement it is standing on;
 * - it is fetched only when somebody picks it, and the procedural person keeps
 *   walking until it lands, so a slow network costs a few seconds of looking
 *   like everybody else rather than a game that will not start.
 *
 * Nothing here is specific to the model in the repo — `TARGET_HEIGHT`, `CLIPS`
 * and `FACING_OFFSET` are what a different rig would need changed.
 */

// Served straight out of `public/`, so this resolves correctly both on the dev
// server and under the /Da-World/ subpath on Pages.
const MODEL_URL = `${import.meta.env.BASE_URL}models/character.glb`;

/**
 * The robot is scaled to stand exactly as tall as everybody else.
 *
 * This is the number the first version got wrong, and it is worth being
 * explicit about why it is not a free choice: one tile of the city is about a
 * metre and a half and a shop door is a shade under two units, so a character
 * much over 1.2 starts ducking through doorways and the street turns into a
 * model village with a giant walking down it.
 */
export const TARGET_HEIGHT = PERSON_HEIGHT;

/**
 * Rotate the model if its bind pose does not face +Z. The bundled robot
 * already does, so this is 0 — but a model exported facing the other way needs
 * `Math.PI` here, or the character walks backwards.
 */
const FACING_OFFSET = 0;

/**
 * How tall the model actually draws, measured through its skin.
 *
 * The obvious `new Box3().setFromObject(model)` is wrong for a rigged model,
 * and wrong in a way that is easy to ship: three.js measures a `SkinnedMesh`
 * through its bind matrices, and before the model's world matrices are current
 * it answers in the *skeleton's* space. This rig's armature carries a scale of
 * 100, so the box came back about 150 units tall instead of four and a half —
 * and dividing a 1.2-unit target by that scaled the robot down to three
 * centimetres. It was there, animating, at the player's feet, far too small to
 * see. Somebody picked the robot and got an invisible character.
 *
 * So the vertices are asked directly, through `getVertexPosition`, which
 * applies the skinning the way the renderer does. Every fifth vertex is plenty
 * for a height, and it happens once per character.
 */
function renderedHeight(model: THREE.Object3D): { min: number; max: number } {
  model.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  let min = Infinity;
  let max = -Infinity;
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const count = mesh.geometry.attributes.position.count;
    for (let i = 0; i < count; i += 5) {
      mesh.getVertexPosition(i, vertex);
      vertex.applyMatrix4(mesh.matrixWorld);
      if (vertex.y < min) min = vertex.y;
      if (vertex.y > max) max = vertex.y;
    }
  });
  return Number.isFinite(min) && max > min ? { min, max } : { min: 0, max: TARGET_HEIGHT };
}

/** Game state -> clip name in the GLB. */
const CLIPS = {
  idle: "Idle",
  walk: "Walking",
  run: "Running",
  air: "Jump",
  bored: "Wave",
} as const;

/**
 * Above this speed (units/s) the walk blends into the run.
 *
 * The reference speeds are the ones the clips were authored at, scaled to the
 * character's height: a stride is a fraction of a leg, so a shorter character
 * takes more of them per metre or the feet skate. They moved down with the
 * walking speed itself — see WALK_SPEED in physics.ts.
 */
const RUN_THRESHOLD = 2.4;
const RUN_REFERENCE_SPEED = 3.4;
const WALK_REFERENCE_SPEED = 1.6;

const FADE = 0.22;

/** The material carrying the robot's colour, as named in the GLB. */
const PANEL_MATERIAL = "Main";

export class CharacterModel {
  readonly object: THREE.Group;

  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = "";
  /** Set while a one-shot clip (jump, wave) owns the character. */
  private oneShotUntil = 0;
  private clock = 0;

  private constructor(
    gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] },
    panel: string,
  ) {
    const model = gltf.scene;

    // --- scale to the world ----------------------------------------------
    // Measured at scale 1 because the scale set from it *replaces* whatever
    // the file authored on its root node — measure at the authored scale and
    // the two are in different units, which is its own way to end up with a
    // speck or a giant.
    model.scale.setScalar(1);
    model.position.set(0, 0, 0);
    const bounds = renderedHeight(model);
    const scale = TARGET_HEIGHT / (bounds.max - bounds.min);
    model.scale.setScalar(scale);
    // Drop it so its feet sit on the group's origin.
    model.position.y = -bounds.min * scale;

    // The wrapper carries the facing offset so `object.rotation.y` stays the
    // character's true heading for everything else in the game.
    this.object = new THREE.Group();
    this.object.name = "character";
    const facing = new THREE.Group();
    facing.rotation.y = FACING_OFFSET;
    facing.add(model);
    this.object.add(facing);

    // --- materials --------------------------------------------------------
    // Keep each source material's base colour, but shade it with our ramps —
    // except the one the model calls "Main", which is the painted panelling and
    // is where the colour picked in the customiser goes.
    const converted = new Map<THREE.Material, THREE.Material>();
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Skinned meshes deform far outside their bind-pose bounds, and a limb
      // that vanishes when the elbow leaves the box is worse than a limb drawn
      // one frame too long.
      mesh.frustumCulled = false;

      const source = mesh.material as THREE.MeshStandardMaterial;
      if (!converted.has(source)) {
        const colour =
          source.name === PANEL_MATERIAL ? panel : source.color?.getHex() ?? 0xffffff;
        converted.set(source, mat(colour, { roughness: 0.62, metalness: 0.1 }));
      }
      mesh.material = converted.get(source)!;
    });

    // --- animation --------------------------------------------------------
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
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

  /**
   * The file, fetched at most once per session.
   *
   * A class of twelve can have twelve robots in it, and downloading the same
   * half-megabyte twelve times over a school wifi is the sort of thing that
   * makes a lesson start with a wait. It is loaded once and cloned per
   * character — with `SkeletonUtils`, because a skinned mesh shares its
   * skeleton with the original under a plain `clone()`, and twelve robots
   * sharing one skeleton walk in perfect, useless unison.
   */
  private static file: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null =
    null;

  static async load(panel: string): Promise<CharacterModel> {
    CharacterModel.file ??= new GLTFLoader().loadAsync(MODEL_URL) as unknown as Promise<{
      scene: THREE.Group;
      animations: THREE.AnimationClip[];
    }>;
    const gltf = await CharacterModel.file;
    return new CharacterModel(
      { scene: cloneSkinned(gltf.scene) as THREE.Group, animations: gltf.animations },
      panel,
    );
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
    if (this.current && fade > 0) next.crossFadeFrom(this.current, fade, false);
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

  /**
   * Stop animating and let this instance go.
   *
   * Deliberately does *not* dispose any geometry: every robot is a clone
   * sharing the one file's buffers, so disposing them when a classmate walks
   * out of the lesson would empty the model for everybody still in it.
   */
  dispose(): void {
    this.mixer.stopAllAction();
    this.actions.clear();
  }
}
