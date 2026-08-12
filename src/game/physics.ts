import * as THREE from "three";
import { blocked, groundHeight, resolveMove } from "../city/ground";

/**
 * Character physics, ported from the reference world's `collisionPhysics`.
 *
 * The constants below are the reference's own. Two notes on how they are used
 * here:
 *
 * 1. They are **per frame at 60 Hz**, not per second — the original integrates
 *    `position += velocity` once a frame with those raw numbers. Rather than
 *    convert them (and lose the feel to rounding), we run a fixed-timestep
 *    accumulator at exactly 60 Hz. At 60 fps this is bit-for-bit the original
 *    behaviour; at 30 or 144 fps it is identical *physically*, which a naive
 *    `value * dt` port would not be.
 *
 * 2. `positionForce` and `jumpForce` are scaled for our world. Everything that
 *    defines the *feel* — the damping, the gravity, the turn rate — is
 *    verbatim. Our island is roughly 2.5x the scale of theirs, so the two
 *    forces are scaled to match; see SCALE below.
 *
 * The original raycasts a `collider.bin` mesh to find the floor, and the island
 * this file was written for used an analytic heightfield. The city needs
 * neither: the ground is flat apart from the kerbs, and the walls are ninety-one
 * axis-aligned footprints. Both live in `city/ground.ts`, so everything below is
 * still purely simulation and knows nothing about tiles or buildings.
 */

/** Our world units per reference world unit. */
const SCALE = 2.53;

export const PHYSICS = {
  /** Horizontal acceleration per tick. Reference: 0.005. */
  positionForce: 0.005 * SCALE,
  /** Velocity retained each tick. Reference value, unscaled. */
  damp: 0.92,
  /** Downward acceleration per tick. Reference value, unscaled. */
  gravity: -0.009832,
  /**
   * Upward velocity on jump. Reference: 0.2, which gives ~2 units of height
   * against the gravity above. Tuned here for ~2.6 units — a little over our
   * character's own height, which reads right at this scale.
   */
  jumpForce: 0.225,
  /** How fast the character turns towards its heading, per tick. */
  directionLerp: 0.075,
  /** Below this speed the character does not bother turning. */
  rotVelocityMin: 0.0035,
  /** At this speed it turns at full rate. */
  rotVelocityMax: 0.02,
} as const;

/** The simulation's fixed step. The reference runs at 60 Hz. */
const TICK = 1 / 60;
/** Never simulate more than this much time in one frame (spiral-of-death guard). */
const MAX_CATCHUP = 0.25;

/** Jump still works this long after walking off an edge. */
const COYOTE_TIME = 0.1;
/** A jump pressed this long before landing still fires on touchdown. */
const JUMP_BUFFER = 0.15;

export type MotionState = "idle" | "run" | "air";

/**
 * A character that walks, falls and jumps over the terrain.
 * Purely simulation — it owns no meshes.
 */
export class CharacterBody {
  readonly position = new THREE.Vector3();
  /** Units per tick, not per second. Use `speed` for a sane number. */
  readonly velocity = new THREE.Vector3();

  grounded = true;
  facing = 0;
  /** Seconds spent off the ground, 0 while grounded. */
  airTime = 0;
  /** True for the single frame the character touches down. */
  justLanded = false;
  /** True for the single frame the character leaves the ground by jumping. */
  justJumped = false;

  /** 1 = walking, >1 = sprinting. Set from the input every frame. */
  boost = 1;

  private accumulator = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private readonly desired = new THREE.Vector2();
  private readonly move = { x: 0, z: 0, hitX: false, hitZ: false };

  constructor(start: THREE.Vector2) {
    this.position.set(start.x, groundHeight(start.x, start.y), start.y);
  }

  /** Horizontal speed in world units per second. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z) / TICK;
  }

  get state(): MotionState {
    if (!this.grounded) return "air";
    return this.speed > 0.35 ? "run" : "idle";
  }

  /**
   * @param direction Desired heading in world space, length 0..1.
   * @param jumpPressed True on the frame the jump control was pressed.
   */
  update(dt: number, direction: THREE.Vector2, jumpPressed: boolean): void {
    this.desired.copy(direction);
    if (this.desired.lengthSq() > 1) this.desired.normalize();

    if (jumpPressed) this.jumpBuffer = JUMP_BUFFER;

    this.justLanded = false;
    this.justJumped = false;

    this.accumulator = Math.min(this.accumulator + dt, MAX_CATCHUP);
    while (this.accumulator >= TICK) {
      this.tick();
      this.accumulator -= TICK;
    }
  }

  private tick(): void {
    const { positionForce, damp, gravity, jumpForce } = PHYSICS;

    // --- horizontal -------------------------------------------------------
    // Pavement everywhere, so the only thing that takes control away is being
    // in the air. Sprinting raises the acceleration, not the damping, so the
    // top speed rises with it and the character still stops on a sixpence.
    const traction = this.grounded ? this.boost : 0.45;

    this.velocity.x += this.desired.x * positionForce * traction;
    this.velocity.z += this.desired.y * positionForce * traction;
    this.velocity.x *= damp;
    this.velocity.z *= damp;

    // --- jump -------------------------------------------------------------
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - TICK);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - TICK);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = jumpForce;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.justJumped = true;
    }

    // --- vertical ---------------------------------------------------------
    this.velocity.y += gravity;

    const nextY = this.position.y + this.velocity.y;

    // --- horizontal collision --------------------------------------------
    // Walls slide rather than stop: walking into a shopfront at an angle still
    // carries you along the street, which is the difference between a city you
    // can move through and one you keep getting stuck on.
    resolveMove(
      this.position.x,
      this.position.z,
      this.position.x + this.velocity.x,
      this.position.z + this.velocity.z,
      this.move,
    );
    if (this.move.hitX) this.velocity.x = 0;
    if (this.move.hitZ) this.velocity.z = 0;
    this.position.x = this.move.x;
    this.position.z = this.move.z;

    // --- ground -----------------------------------------------------------
    const groundY = groundHeight(this.position.x, this.position.z);
    if (nextY <= groundY) {
      if (!this.grounded) this.justLanded = true;
      this.position.y = groundY;
      this.velocity.y = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.position.y = nextY;
      this.grounded = false;
      this.airTime += TICK;
    }

    // --- facing -----------------------------------------------------------
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (planarSpeed > PHYSICS.rotVelocityMin) {
      const strength =
        THREE.MathUtils.clamp(
          (planarSpeed - PHYSICS.rotVelocityMin) /
            (PHYSICS.rotVelocityMax - PHYSICS.rotVelocityMin),
          0,
          1,
        ) * PHYSICS.directionLerp;
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this.facing = angleLerp(this.facing, target, strength);
    }
  }

  /** Drop the character onto the street at a point (used by the debug hooks). */
  teleport(x: number, z: number): void {
    // Never land inside a wall, however careless the caller was.
    let px = x;
    let pz = z;
    for (let r = 0; blocked(px, pz) && r < 24; r++) {
      const a = r * 2.4;
      px = x + Math.cos(a) * (1 + r * 0.5);
      pz = z + Math.sin(a) * (1 + r * 0.5);
    }
    this.position.set(px, groundHeight(px, pz), pz);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.accumulator = 0;
  }
}

function angleLerp(current: number, target: number, t: number): number {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}
