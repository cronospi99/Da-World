import * as THREE from "three";
import type { Input } from "../core/input";
import { mat } from "../city/palette";
import { CharacterModel, TARGET_HEIGHT } from "./characterModel";
import { CharacterBody, type MotionState } from "./physics";

/**
 * The traveller.
 *
 * All movement lives in physics.ts. This file owns the visuals: a rigged GLB
 * when it has loaded, and a primitive stand-in before that (and if the model
 * ever fails to load, so a broken asset never costs you the game).
 *
 * It also owns one movement subtlety — see `directionFor` at the bottom.
 */

/**
 * How much harder the character pushes while sprinting.
 *
 * It raises the acceleration rather than the damping, so the top speed rises
 * with it and you still stop on a sixpence when you let go — which is what
 * keeps a run down a pavement from turning into an ice rink.
 */
const SPRINT_BOOST = 1.85;

/** Seconds standing still before the idle fidget plays. */
const BORED_AFTER = 9;
const BORED_LENGTH = 3.4;

/**
 * The primitive stand-in is modelled at roughly 2.2 units tall, because it was
 * drawn for the island. It is scaled to the same height as the rigged model so
 * that the moment before the GLB arrives — and the case where the GLB never
 * arrives at all — does not put a giant on the pavement.
 */
const STAND_IN_HEIGHT = 2.2;

export class Player {
  readonly object = new THREE.Group();
  readonly body: CharacterBody;

  /** Scales the primitive parts to the world; `rig` keeps its own animation. */
  private readonly standIn = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private readonly head: THREE.Mesh;
  private readonly hat = new THREE.Group();

  private model: CharacterModel | null = null;
  private stride = 0;
  private idleTime = 0;
  private boredTime = -1;
  /** Smoothed 0..1 blend into the running pose, so states do not snap. */
  private runBlend = 0;
  private airBlend = 0;
  private squash = 0;

  /**
   * The world-space heading the current input maps to. Frozen while the input
   * itself does not change, so the camera can swing around behind the player
   * without bending their path — see `directionFor`.
   */
  private readonly heldDirection = new THREE.Vector2();
  private readonly lastInput = new THREE.Vector2();
  private hasHeldDirection = false;

  constructor(start: THREE.Vector2) {
    this.body = new CharacterBody(start);

    // The stand-in is only ever on screen for the moment before the rigged
    // model arrives, so it borrows the city's own materials rather than
    // dragging a second shading model into the build.
    const skin = mat("#e8b98d");
    const shirt = mat("#d96f52");
    const trousers = mat("#4c6a86");
    const felt = mat("#f3e3bd", { roughness: 0.95 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.5, 3, 8), shirt);
    torso.position.y = 1.15;
    this.rig.add(torso);

    this.head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), skin);
    this.head.position.y = 1.82;
    this.rig.add(this.head);

    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 10), felt);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.3, 10), felt);
    brim.position.y = 0;
    crown.position.y = 0.15;
    this.hat.add(brim, crown);
    this.hat.position.y = 2.02;
    this.rig.add(this.hat);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.45, 2, 6), skin);
      arm.position.set(side * 0.44, 1.22, 0);
      this.arms.push(arm);
      this.rig.add(arm);

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 2, 6), trousers);
      leg.position.set(side * 0.18, 0.45, 0);
      this.legs.push(leg);
      this.rig.add(leg);
    }

    this.rig.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });

    this.standIn.scale.setScalar(TARGET_HEIGHT / STAND_IN_HEIGHT);
    this.standIn.add(this.rig);
    this.object.add(this.standIn);
    this.object.name = "player";
    this.object.position.copy(this.body.position);
  }

  /** Live reference to the simulated position — safe to read every frame. */
  get position(): THREE.Vector3 {
    return this.body.position;
  }

  get state(): MotionState {
    return this.body.state;
  }

  teleport(x: number, z: number): void {
    this.body.teleport(x, z);
    this.object.position.copy(this.body.position);
  }

  update(dt: number, input: Input, cameraYaw: number, cameraIsManual: boolean): void {
    const direction = this.directionFor(input, cameraYaw, cameraIsManual);

    this.body.boost = input.sprint ? SPRINT_BOOST : 1;
    this.body.update(dt, direction, input.consumeJump());
    if (this.model && this.body.justJumped) this.model.onJump();

    this.object.position.copy(this.body.position);
    this.object.rotation.y = this.body.facing;

    if (this.model) {
      this.model.update(dt, this.body.state, this.body.speed);
      this.animateFallbackOnly(dt);
    } else {
      this.animate(dt);
    }
  }

  /**
   * Maps the input to a world-space heading.
   *
   * The obvious version — recompute from the camera yaw every frame — breaks
   * as soon as the camera follows the player: holding "right" moves you right,
   * the camera rotates to sit behind you, "right" now points somewhere else,
   * and you walk in a circle. So the heading is computed once when the input
   * changes and then held, which lets the camera swing around freely while
   * your path stays straight.
   */
  private directionFor(
    input: Input,
    cameraYaw: number,
    cameraIsManual: boolean,
  ): THREE.Vector2 {
    if (!input.isMoving) {
      this.hasHeldDirection = false;
      this.lastInput.set(0, 0);
      return this.heldDirection.set(0, 0);
    }

    // Recompute when the stick/keys actually change, or while the player is
    // steering the camera by hand (then they expect the aim to follow it).
    const changed = input.move.distanceTo(this.lastInput) > 0.12;
    if (!this.hasHeldDirection || changed || cameraIsManual) {
      // The rig sits at focus + (sin(yaw), cos(yaw)) * distance, so "forward"
      // for the player is (-sin, -cos) and "right" is (cos, -sin).
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      this.heldDirection.set(
        input.move.x * cos - input.move.y * sin,
        -input.move.x * sin - input.move.y * cos,
      );
      this.lastInput.copy(input.move);
      this.hasHeldDirection = true;
    }
    return this.heldDirection;
  }

  /** With the GLB driving the pose, only the hat/squash extras still apply. */
  private animateFallbackOnly(dt: number): void {
    if (this.body.justLanded) this.squash = Math.min(1, this.body.airTime * 1.6 + 0.35);
    if (this.body.justJumped) this.squash = -0.5;
    this.squash = THREE.MathUtils.damp(this.squash, 0, 9, dt);

    if (this.body.state === "idle") {
      this.idleTime += dt;
      if (this.boredTime < 0 && this.idleTime > BORED_AFTER) {
        this.boredTime = 0;
        this.model?.onBored();
      }
    } else {
      this.idleTime = 0;
      this.boredTime = -1;
    }
    if (this.boredTime >= 0) {
      this.boredTime += dt;
      if (this.boredTime > BORED_LENGTH) {
        this.boredTime = -1;
        this.idleTime = 0;
      }
    }
  }

  /** Swap the primitive stand-in for the rigged model. */
  attachModel(model: CharacterModel): void {
    this.model = model;
    this.standIn.visible = false;
    this.object.add(model.object);
  }

  private animate(dt: number): void {
    const state = this.body.state;
    const speed = this.body.speed;

    // Landing squash, released over the next few frames.
    if (this.body.justLanded) this.squash = Math.min(1, this.body.airTime * 1.6 + 0.35);
    if (this.body.justJumped) this.squash = -0.5;
    this.squash = THREE.MathUtils.damp(this.squash, 0, 9, dt);

    // Blend between poses instead of switching, so transitions read smoothly.
    this.runBlend = THREE.MathUtils.damp(this.runBlend, state === "run" ? 1 : 0, 12, dt);
    this.airBlend = THREE.MathUtils.damp(this.airBlend, state === "air" ? 1 : 0, 10, dt);

    // --- bored timer ------------------------------------------------------
    if (state === "idle") {
      this.idleTime += dt;
      if (this.boredTime < 0 && this.idleTime > BORED_AFTER) this.boredTime = 0;
    } else {
      this.idleTime = 0;
      this.boredTime = -1;
    }
    if (this.boredTime >= 0) {
      this.boredTime += dt;
      if (this.boredTime > BORED_LENGTH) {
        this.boredTime = -1;
        this.idleTime = 0;
      }
    }

    // --- run --------------------------------------------------------------
    this.stride += speed * dt * 2.6;
    const swing = Math.sin(this.stride) * 0.62 * this.runBlend;

    // --- air --------------------------------------------------------------
    // Legs tuck up and arms lift; rising and falling read differently.
    const rising = this.body.velocity.y > 0 ? 1 : 0;
    const airLeg = THREE.MathUtils.lerp(0.5, -0.35, rising) * this.airBlend;
    const airArm = THREE.MathUtils.lerp(-0.7, -1.5, rising) * this.airBlend;

    // --- idle / bored -----------------------------------------------------
    const calm = Math.max(0, 1 - this.runBlend - this.airBlend);
    const breathe = Math.sin(performance.now() * 0.0016) * 0.02 * calm;

    let boredLean = 0;
    let boredHead = 0;
    if (this.boredTime >= 0) {
      // One slow look left, then right, then back.
      const t = this.boredTime / BORED_LENGTH;
      boredHead = Math.sin(t * Math.PI * 2) * 0.75;
      boredLean = Math.sin(t * Math.PI) * 0.06;
    }

    this.legs[0]!.rotation.x = swing + airLeg;
    this.legs[1]!.rotation.x = -swing + airLeg;
    this.arms[0]!.rotation.x = -swing * 0.7 + airArm;
    this.arms[1]!.rotation.x = swing * 0.7 + airArm;
    this.arms[0]!.rotation.z = 0.08 * this.airBlend;
    this.arms[1]!.rotation.z = -0.08 * this.airBlend;

    this.head.rotation.y = boredHead;
    this.hat.rotation.y = boredHead * 0.6;
    this.hat.rotation.z = 0.05 * this.airBlend + boredLean;

    // Vertical bob from the walk cycle, plus squash/stretch on landing.
    const bob = Math.abs(Math.sin(this.stride)) * 0.09 * this.runBlend;
    this.rig.position.y = bob - this.squash * 0.22;
    this.rig.scale.set(
      1 + this.squash * 0.14,
      1 - this.squash * 0.2 + breathe,
      1 + this.squash * 0.14,
    );
    this.rig.rotation.z = boredLean;
  }
}
