import * as THREE from "three";
import type { Input } from "../core/input";
import { Character, PERSON_HEIGHT, PERSON_SCALE } from "../city/character";
import { CharacterModel } from "./characterModel";
import { CharacterBody, SPRINT_BOOST, WALK_SPEED, type MotionState } from "./physics";
import type { Appearance } from "./appearance";

/**
 * The traveller.
 *
 * All movement lives in physics.ts. This file owns the visuals, and there are
 * two of them: the low-poly person every citizen is built from, and the rigged
 * robot. Which one you are is picked before you start (see `ui/character.ts`)
 * and can be changed at any time from the menu, so this class has to be able to
 * swap bodies underneath a character that is already walking.
 *
 * It does that by keeping the person *always*: it is free, it is already built,
 * and it is what stands in while the robot's several megabytes are still on
 * their way. Whichever body is not being worn is simply not in the scene.
 *
 * It also owns one movement subtlety — see `directionFor` at the bottom.
 */

/** Ground speed the walk cycle is at full tilt, in units per second. */
const FULL_STRIDE_SPEED = WALK_SPEED;

/** Idle this long and the character finds something to do with itself. */
const BORED_AFTER = 9;

export class Player {
  readonly object = new THREE.Group();
  readonly body: CharacterBody;

  private person: Character;
  private robot: CharacterModel | null = null;
  /** The robot load in flight, so a double tap does not fetch it twice. */
  private robotLoading: Promise<CharacterModel | null> | null = null;
  private appearance: Appearance;
  private squash = 0;
  private idleFor = 0;

  /**
   * The world-space heading the current input maps to. Frozen while the input
   * itself does not change, so the camera can swing around behind the player
   * without bending their path — see `directionFor`.
   */
  private readonly heldDirection = new THREE.Vector2();
  private readonly lastInput = new THREE.Vector2();
  private hasHeldDirection = false;

  constructor(start: THREE.Vector2, appearance: Appearance) {
    this.body = new CharacterBody(start);
    this.appearance = appearance;

    this.person = new Character({ ...appearance }, PERSON_SCALE);
    this.object.add(this.person.group);
    this.object.name = "player";
    this.object.position.copy(this.body.position);

    if (appearance.kind === "robot") void this.wearRobot();
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

  /**
   * Become somebody else.
   *
   * Called from the customiser while the game is running, so it must never
   * interrupt the walk: the body swaps, the physics does not know it happened,
   * and a robot that has not downloaded yet leaves the person on screen until
   * it has.
   */
  setAppearance(appearance: Appearance): void {
    const wasRobot = this.appearance.kind === "robot";
    this.appearance = appearance;

    // The person is rebuilt whichever body is worn: it is the stand-in for a
    // robot that has not arrived, and the colours may have changed too. There
    // is nothing to dispose — every geometry and material in the rig is shared
    // with the thirty-two citizens and outlives any one of them.
    this.object.remove(this.person.group);
    this.person = new Character({ ...appearance }, PERSON_SCALE);

    if (appearance.kind === "robot") {
      if (this.robot) this.object.add(this.robot.object);
      else {
        this.object.add(this.person.group);
        void this.wearRobot();
      }
      return;
    }

    if (wasRobot && this.robot) this.object.remove(this.robot.object);
    this.object.add(this.person.group);
  }

  /**
   * Fetch the robot and put it on, unless the player has changed their mind by
   * the time it lands. A failed download is not an error worth stopping for:
   * the person is already on screen and the game carries on with it.
   */
  private async wearRobot(): Promise<void> {
    if (!this.robotLoading) {
      this.robotLoading = CharacterModel.load(this.appearance.shirt).catch((error) => {
        console.warn("[da-world] the robot would not load; staying human.", error);
        return null;
      });
    }
    const robot = await this.robotLoading;
    if (!robot) return;
    this.robot = robot;
    if (this.appearance.kind !== "robot") return;
    this.object.remove(this.person.group);
    this.object.add(robot.object);
  }

  update(dt: number, input: Input, cameraYaw: number, cameraIsManual: boolean): void {
    const direction = this.directionFor(input, cameraYaw, cameraIsManual);

    this.body.boost = input.sprint ? SPRINT_BOOST : 1;
    this.body.update(dt, direction, input.consumeJump());

    this.object.position.copy(this.body.position);
    this.object.rotation.y = this.body.facing;

    const wearingRobot = this.robot !== null && this.appearance.kind === "robot";
    const speed01 = this.body.grounded ? Math.min(1, this.body.speed / FULL_STRIDE_SPEED) : 0.25;

    if (wearingRobot) {
      const robot = this.robot!;
      if (this.body.justJumped) robot.onJump();
      // Standing still long enough, the robot waves — the one bit of character
      // in the game that happens without the player doing anything.
      this.idleFor = this.body.state === "idle" ? this.idleFor + dt : 0;
      if (this.idleFor > BORED_AFTER) {
        this.idleFor = 0;
        robot.onBored();
      }
      robot.update(dt, this.body.state, this.body.speed);
      return;
    }

    // Landing squash, released over the next few frames. The walk cycle itself
    // lives in `Character`, so this is the only pose the player has that a
    // citizen does not. The robot has its own skeleton and wants none of it.
    if (this.body.justLanded) this.squash = Math.min(1, this.body.airTime * 1.6 + 0.35);
    if (this.body.justJumped) this.squash = -0.5;
    this.squash = THREE.MathUtils.damp(this.squash, 0, 9, dt);

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
   *
   * The threshold below is what decides how small a correction counts as a
   * change of mind. It is deliberately small: on a thumbstick almost every
   * adjustment is a small one, and at a quarter of a stick's travel the
   * character used to ignore you until you shoved it.
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

    const changed = input.move.distanceTo(this.lastInput) > 0.045;
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
