import * as THREE from "three";
import type { Input } from "../core/input";
import { toonMaterial } from "../world/materials";
import { CharacterBody, type MotionState } from "./physics";

/**
 * The traveller: a low-poly body driven by `CharacterBody`.
 *
 * All movement lives in physics.ts. This file only builds the meshes and poses
 * them, with the reference's four states — idle, run, air and bored.
 */

/** Seconds standing still before the idle fidget plays. */
const BORED_AFTER = 9;
const BORED_LENGTH = 3.4;

export class Player {
  readonly object = new THREE.Group();
  readonly body: CharacterBody;

  private readonly rig = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private readonly head: THREE.Mesh;
  private readonly hat = new THREE.Group();

  private stride = 0;
  private idleTime = 0;
  private boredTime = -1;
  /** Smoothed 0..1 blend into the running pose, so states do not snap. */
  private runBlend = 0;
  private airBlend = 0;
  private squash = 0;

  constructor(start: THREE.Vector2) {
    this.body = new CharacterBody(start);

    const skin = toonMaterial({ color: "#e8b98d", ramp: "skin" });
    const shirt = toonMaterial({ color: "#d96f52" });
    const trousers = toonMaterial({ color: "#4c6a86" });
    const felt = toonMaterial({ color: "#f3e3bd", ramp: "soft" });

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

    this.object.add(this.rig);
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

  update(dt: number, input: Input, cameraYaw: number): void {
    // Desired direction in world space, relative to where the camera looks.
    // The rig sits at focus + (sin(yaw), cos(yaw)) * distance, so "forward"
    // for the player is (-sin, -cos) and "right" is (cos, -sin).
    const direction = new THREE.Vector2();
    if (input.isMoving) {
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      direction.set(
        input.move.x * cos - input.move.y * sin,
        -input.move.x * sin - input.move.y * cos,
      );
    }

    this.body.update(dt, direction, input.consumeJump());

    this.object.position.copy(this.body.position);
    this.object.rotation.y = this.body.facing;

    this.animate(dt);
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
