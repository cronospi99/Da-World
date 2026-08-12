import * as THREE from "three";
import type { Input } from "../core/input";
import { Character, PERSON_HEIGHT, PERSON_SCALE } from "../city/character";
import { CharacterBody, type MotionState } from "./physics";

/**
 * The traveller.
 *
 * All movement lives in physics.ts. This file owns the visuals — and since the
 * city was repopulated with citizens, that means one decision worth writing
 * down: the player is a person, built from the same low-poly rig every citizen
 * in the city is built from, at the same height.
 *
 * The rigged robot GLB that used to stand here was a fine model and completely
 * wrong for this game. It was half a metre taller than the people around it, it
 * shaded differently, it cost a multi-megabyte download before the character
 * appeared at all, and in a city where the whole point is walking up to people
 * and talking to them, the player was the one thing on the pavement that was
 * not one of them. The procedural rig has no download, no loading state and no
 * failure mode, and it wears the same clothes as everybody else.
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

/** Ground speed the walk cycle is at full tilt, in units per second. */
const FULL_STRIDE_SPEED = 5.2;

/** The explorer: the one person in the city dressed like a visitor to it. */
const EXPLORER = {
  shirt: "#19b8e8",
  pants: "#3a2a5e",
  skin: "#f0c39a",
  hair: "#7a3df0",
  outfit: "backpack",
} as const;

export class Player {
  readonly object = new THREE.Group();
  readonly body: CharacterBody;

  private readonly person: Character;
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

    this.person = new Character({ ...EXPLORER }, PERSON_SCALE);
    this.object.add(this.person.group);
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

  /** How tall the player is, for anything that has to frame or clear them. */
  get height(): number {
    return PERSON_HEIGHT;
  }

  teleport(x: number, z: number): void {
    this.body.teleport(x, z);
    this.object.position.copy(this.body.position);
  }

  update(dt: number, input: Input, cameraYaw: number, cameraIsManual: boolean): void {
    const direction = this.directionFor(input, cameraYaw, cameraIsManual);

    this.body.boost = input.sprint ? SPRINT_BOOST : 1;
    this.body.update(dt, direction, input.consumeJump());

    this.object.position.copy(this.body.position);
    this.object.rotation.y = this.body.facing;

    // Landing squash, released over the next few frames. The walk cycle itself
    // lives in `Character`, so this is the only pose the player has that a
    // citizen does not.
    if (this.body.justLanded) this.squash = Math.min(1, this.body.airTime * 1.6 + 0.35);
    if (this.body.justJumped) this.squash = -0.5;
    this.squash = THREE.MathUtils.damp(this.squash, 0, 9, dt);

    const speed01 = this.body.grounded
      ? Math.min(1, this.body.speed / FULL_STRIDE_SPEED)
      : 0.25;
    this.person.update(dt, speed01);
    this.person.group.scale.set(
      PERSON_SCALE * (1 + this.squash * 0.14),
      PERSON_SCALE * (1 - this.squash * 0.2),
      PERSON_SCALE * (1 + this.squash * 0.14),
    );
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
}
