import * as THREE from "three";
import type { Input } from "../core/input";
import { blockedAt, groundHeight, inFoliage, lineBlocked } from "../city/ground";

/**
 * The third-person street camera.
 *
 * The island wanted a distant, drifting, hands-off camera that framed the
 * horizon. A city at street level wants the opposite: close behind the
 * shoulder, aimed with the mouse, and above all never inside a wall. The rules
 * that follow are all consequences of that:
 *
 * **The mouse is the camera.** With the pointer locked, aiming is absolute and
 * the rig never swings on its own — a camera that re-centres itself while you
 * are looking somewhere else is the single most disorienting thing a
 * third-person game can do. Without pointer lock (touch, or before the first
 * click) it falls back to drag-to-look and *does* ease around behind you when
 * you walk, because there is no other way to steer with a thumb.
 *
 * **The wall wins.** Every frame the boom is traced against the building
 * footprints and shortened until it is clear. It snaps in when a wall arrives
 * and springs back out slowly, because the reverse feels like the camera is
 * being dragged through the building.
 *
 * **Speed is felt, not read.** The field of view opens a few degrees when you
 * sprint and the boom lengthens slightly, which is most of why running feels
 * faster than the number says it is.
 */

const MIN_DISTANCE = 1.9;
const MAX_DISTANCE = 8.0;
const START_DISTANCE = 3.8;

const MIN_PITCH = -0.55; // looking up at the towers
const MAX_PITCH = 1.15; // almost straight down
const START_PITCH = 0.40;

/**
 * Height above the character's feet that the camera aims at.
 *
 * Just over the shoulder of a 1.2-tall character, which is what puts them in
 * the lower third of the frame and leaves the street they are walking into
 * filling the rest of it. It moves with the character's height: aim at the old
 * 1.38 and a smaller character sinks out of the bottom of the shot.
 */
const EYE_HEIGHT = 1.0;
/** Sideways offset of the boom, so the character does not block the middle. */
const SHOULDER = 0.4;

/** Radians per pixel of mouse movement while the pointer is locked. */
const MOUSE_SENSITIVITY = 0.0026;
/** Radians per pixel while dragging — a drag covers less screen, so it is faster. */
const DRAG_SENSITIVITY = 0.005;

const BASE_FOV = 58;
const SPRINT_FOV = 65;

/**
 * The escape ladder when the boom has nowhere to go, tried in this order.
 *
 * Distances are fractions of the boom the trace already allowed; pitches are
 * radians added to whatever the player has aimed. Staying far and level is
 * always preferred — and the ladder only climbs a little, because on a
 * one-tile pavement your back is against a shopfront most of the time, and a
 * ladder that answered that with "look straight down at their head" spent the
 * whole game up there.
 */
const DISTANCE_STEPS = [1, 0.78, 0.58, 0.42, 0.28] as const;
const PITCH_STEPS = [0, 0.16, 0.34] as const;
/**
 * The shots of last resort, in absolute units rather than fractions.
 *
 * Reached when the first pass finds nowhere with clear air — most often inside
 * a park, where every point in the world is inside somebody's canopy. The
 * answer there is to come in close: a camera a metre behind the shoulder with
 * trunks sliding past it reads as walking through a wood, where the same
 * camera three metres back reads as a screen full of leaves with the character
 * lost somewhere behind them.
 */
const TIGHT_STEPS: readonly number[] = [0.95, 0.75, 0.58, 0.42];

/** How hard the fallback camera swings back behind the player, per second. */
const FOLLOW_RATE = 2.4;
/** After a manual drag, the fallback camera stops chasing for this long. */
const MANUAL_HOLD = 1.6;

export class CameraRig {
  /** Camera sits at focus + (sin(yaw), cos(yaw)) * distance: yaw 0 looks -Z. */
  yaw = Math.PI;
  private pitch = START_PITCH;
  /** What the boom wants to be, before walls get a say. */
  private distance = START_DISTANCE;
  /** What it actually is this frame. */
  private currentDistance = START_DISTANCE;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private manualHold = 0;
  private started = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
  }

  /**
   * True when the player is aiming the camera themselves — which, with the
   * pointer locked, is always. The player controller reads this to decide
   * whether "forward" should be recomputed from the camera every frame.
   */
  get isManual(): boolean {
    return this.pointerLocked || this.manualHold > 0;
  }

  private get pointerLocked(): boolean {
    return document.pointerLockElement !== null;
  }

  update(
    dt: number,
    input: Input,
    target: THREE.Vector3,
    playerFacing: number,
    playerMoving: boolean,
    sprinting: boolean,
  ): void {
    const locked = this.pointerLocked;
    const sensitivity = locked ? MOUSE_SENSITIVITY : DRAG_SENSITIVITY;

    this.yaw -= input.look.x * sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + input.look.y * sensitivity * 0.8,
      MIN_PITCH,
      MAX_PITCH,
    );
    this.distance = THREE.MathUtils.clamp(
      this.distance + input.zoom * 0.4,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );

    if (locked) {
      this.manualHold = 0;
    } else {
      if (input.look.x !== 0 || input.look.y !== 0) this.manualHold = MANUAL_HOLD;
      else this.manualHold = Math.max(0, this.manualHold - dt);
      // Only the touch/drag camera chases; see the note at the top of the file.
      if (playerMoving && this.manualHold === 0) {
        this.yaw = angleLerp(this.yaw, playerFacing + Math.PI, Math.min(1, FOLLOW_RATE * dt));
      }
    }

    // Follow a point at the character's eyeline. Horizontal tracking is snappy,
    // vertical is deliberately lazy — a camera that matches a jump one-for-one
    // makes the jump invisible and the picture queasy.
    this.desired.set(target.x, target.y + EYE_HEIGHT, target.z);
    if (!this.started) {
      this.focus.copy(this.desired);
      this.started = true;
    }
    const planar = Math.min(1, 14 * dt);
    this.focus.x += (this.desired.x - this.focus.x) * planar;
    this.focus.z += (this.desired.z - this.focus.z) * planar;
    this.focus.y += (this.desired.y - this.focus.y) * Math.min(1, 5 * dt);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // The boom is offset towards the character's right shoulder, which is what
    // keeps them out of the middle of the frame without turning the camera.
    //
    // On a pavement one tile wide it has to be willing to swap sides. The boom
    // is traced with a radius of its own, so an offset that lands even a
    // fraction inside a shopfront makes *every* distance behind you read as
    // blocked, and the camera spent the whole game jammed against the
    // character's ear. So: right shoulder, then left, then straight behind.
    let eyeX = this.focus.x;
    let eyeZ = this.focus.z;
    for (const side of [1, -1]) {
      const x = this.focus.x + cos * SHOULDER * side;
      const z = this.focus.z - sin * SHOULDER * side;
      if (!blockedAt(x, this.focus.y, z, SHOULDER + 0.05)) {
        eyeX = x;
        eyeZ = z;
        break;
      }
    }

    const wanted = this.distance * (sprinting ? 1.12 : 1);
    const clear = this.clearDistance(eyeX, this.focus.y, eyeZ, sin, cos, wanted);
    const rate = clear < this.currentDistance ? 1 : Math.min(1, 4 * dt);
    this.currentDistance += (clear - this.currentDistance) * rate;

    // The trace above shortens the boom, but shortening alone cannot always
    // win: stand with your back to a shop and there is no distance behind you
    // that is not inside it. So the last step searches a small grid of
    // (distance, pitch) pairs and takes the first one that puts the lens in
    // open air — preferring to stay far, then to stay level, and falling back
    // to a tight over-the-head shot when the city really has left nowhere to
    // stand. Being inside a wall for even one frame shows the player the
    // inside of a building, and that is the one thing not to allow.
    //
    // The search runs in two passes. The first wants clear air — no wall and
    // no canopy — at the boom the player asked for. The second gives up on the
    // canopy and comes in close instead, because a wall is never negotiable
    // and a leaf is: inside a park every point in the world is inside a tree,
    // and the only shot that shows you the character there is a near one.
    let pitch = this.pitch;
    let distance = TIGHT_STEPS[TIGHT_STEPS.length - 1];
    search: for (const scale of DISTANCE_STEPS) {
      for (const lift of PITCH_STEPS) {
        const p = Math.min(MAX_PITCH, this.pitch + lift);
        const d = this.currentDistance * scale;
        if (this.isClear(eyeX, eyeZ, sin, cos, p, d, true)) {
          pitch = p;
          distance = d;
          break search;
        }
      }

      // Nothing on the ladder: fall back to the tight shots, walls only.
      if (scale === DISTANCE_STEPS[DISTANCE_STEPS.length - 1]) {
        for (const d of TIGHT_STEPS) {
          if (this.isClear(eyeX, eyeZ, sin, cos, this.pitch, d, false)) {
            distance = d;
            break;
          }
        }
      }
    }

    const horizontal = Math.cos(pitch) * distance;
    const x = eyeX + sin * horizontal;
    const z = eyeZ + cos * horizontal;
    const y = this.focus.y + Math.sin(pitch) * distance;

    // Never let the lens dip into the pavement.
    this.camera.position.set(x, Math.max(y, groundHeight(x, z) + 0.35), z);
    this.camera.lookAt(this.focus.x, this.focus.y, this.focus.z);

    const fov = sprinting ? SPRINT_FOV : BASE_FOV;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, 3 * dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Would the lens sit in open air here? */
  private isClear(
    eyeX: number,
    eyeZ: number,
    sin: number,
    cos: number,
    pitch: number,
    distance: number,
    avoidFoliage: boolean,
  ): boolean {
    const y = this.focus.y + Math.sin(pitch) * distance;
    const horizontal = Math.cos(pitch) * distance;
    const x = eyeX + sin * horizontal;
    const z = eyeZ + cos * horizontal;
    if (blockedAt(x, y, z, 0.3)) return false;
    return !avoidFoliage || !inFoliage(x, y, z, 0.15);
  }

  /** How far the boom can extend before it would pass through a building. */
  private clearDistance(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    sin: number,
    cos: number,
    wanted: number,
  ): number {
    // Walls shorten the boom; trees do not. A street tree stands every few
    // metres along the kerb, so a boom that pulled in for foliage spent a walk
    // down Main Street snapping in and out — and a branch crossing the shot for
    // a moment is what a camera under a tree is supposed to look like. What
    // trees do get a say in is where the lens comes to *rest*; see `isClear`.
    const traced = (distance: number): boolean =>
      lineBlocked(
        eyeX,
        eyeY,
        eyeZ,
        eyeX + sin * Math.cos(this.pitch) * distance,
        eyeY + Math.sin(this.pitch) * distance,
        eyeZ + cos * Math.cos(this.pitch) * distance,
        0.35,
      );

    if (!traced(wanted)) return wanted;

    // Binary search rather than stepping: five probes puts the camera within
    // 3 % of the wall, and the whole thing costs a couple of dozen box tests.
    // The floor is the tightest shot there is, not the player's minimum zoom:
    // a wall is allowed to push the camera closer than the player ever would.
    let lo = TIGHT_STEPS[TIGHT_STEPS.length - 1];
    let hi = wanted;
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2;
      if (traced(mid)) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  /** Point the camera behind the character, without moving them. */
  resetBehind(playerFacing: number): void {
    this.yaw = playerFacing + Math.PI;
    this.pitch = START_PITCH;
  }

  /**
   * Put the focus on a point at once instead of easing to it.
   *
   * The focus normally lags the character by design, which is what keeps the
   * picture calm. After a teleport that lag is a long slide across the city
   * with the camera pointing at where you used to be, so anything that moves
   * the character discontinuously says so here.
   */
  snapTo(target: THREE.Vector3): void {
    this.focus.set(target.x, target.y + EYE_HEIGHT, target.z);
    this.started = true;
  }
}

function angleLerp(current: number, target: number, t: number): number {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}
