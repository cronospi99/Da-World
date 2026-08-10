import * as THREE from "three";
import { WATER_LEVEL, WORLD_SIZE, heightAt } from "../world/terrain";

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
 * The original also raycasts a `collider.bin` mesh to find the floor. We do not
 * need it: `heightAt(x, z)` is analytic, so the ground query is exact and free.
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

/** Terrain steeper than this (normal.y) is treated as a wall, not a floor. */
const FLOOR_INCLINATION = 0.55;

const _normal = new THREE.Vector3();

/** Terrain normal at a point, from finite differences of `heightAt`. */
export function groundNormal(x: number, z: number, out = _normal): THREE.Vector3 {
  const e = 0.6;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return out.set(-dx, 1, -dz).normalize();
}

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

  private accumulator = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private readonly desired = new THREE.Vector2();

  constructor(start: THREE.Vector2) {
    this.position.set(start.x, heightAt(start.x, start.y), start.y);
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
    // Steep ground is hard to walk up, but never impossible — a hard block
    // here is how characters get wedged into hillsides.
    const normal = groundNormal(this.position.x, this.position.z);
    const traction = this.grounded
      ? THREE.MathUtils.clamp((normal.y - FLOOR_INCLINATION) / (0.95 - FLOOR_INCLINATION), 0.18, 1)
      : 0.45; // less control in the air

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

    let nextX = this.position.x + this.velocity.x;
    let nextZ = this.position.z + this.velocity.z;
    const nextY = this.position.y + this.velocity.y;

    // --- horizontal collision --------------------------------------------
    const limit = WORLD_SIZE * 0.46;
    nextX = THREE.MathUtils.clamp(nextX, -limit, limit);
    nextZ = THREE.MathUtils.clamp(nextZ, -limit, limit);

    // The shoreline is the only wall in the world. Slide along it rather than
    // stopping dead, so walking into the beach at an angle still moves you.
    if (heightAt(nextX, this.position.z) < WATER_LEVEL + 0.35) {
      nextX = this.position.x;
      this.velocity.x = 0;
    }
    if (heightAt(this.position.x, nextZ) < WATER_LEVEL + 0.35) {
      nextZ = this.position.z;
      this.velocity.z = 0;
    }

    this.position.x = nextX;
    this.position.z = nextZ;

    // --- ground -----------------------------------------------------------
    const groundY = heightAt(nextX, nextZ);
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

  /** Drop the character onto the terrain at a point (used by the debug hooks). */
  teleport(x: number, z: number): void {
    this.position.set(x, heightAt(x, z), z);
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
