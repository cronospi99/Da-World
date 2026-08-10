import * as THREE from "three";
import type { Input } from "../core/input";
import { WATER_LEVEL, heightAt } from "../world/terrain";

// The reference frames its character closely and low to the ground, which is
// what lets the horizon and the sky do most of the work in the picture.
const MIN_DISTANCE = 5.5;
const MAX_DISTANCE = 18;
const MIN_PITCH = 0.06;
const MAX_PITCH = 0.85;
const START_DISTANCE = 9;
const START_PITCH = 0.3;

/** Amplitude of the idle camera drift, in radians / world units. */
const SHAKE = new THREE.Vector3(0.08, 0.08, 0.02);
const SHAKE_SPEED = 0.2;

/** Smoothed third-person orbit camera that never dips under the ground. */
export class CameraRig {
  /**
   * The rig sits at focus + (sin(yaw), cos(yaw)) * distance, so yaw = 0 puts
   * the camera on the +Z side looking towards -Z.
   */
  yaw = 0;
  private pitch = START_PITCH;
  private distance = START_DISTANCE;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private elapsed = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(dt: number, input: Input, target: THREE.Vector3): void {
    this.elapsed += dt;

    this.yaw -= input.look.x * 0.005;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + input.look.y * 0.004,
      MIN_PITCH,
      MAX_PITCH,
    );
    this.distance = THREE.MathUtils.clamp(
      this.distance + input.zoom,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );

    // Follow a point around the character's chest. Horizontal tracking is
    // snappy, vertical is deliberately lazy — a camera that matches a jump
    // one-for-one makes the jump invisible and the picture queasy.
    this.desired.set(target.x, target.y + 1.35, target.z);
    const planar = Math.min(1, 8 * dt);
    this.focus.x += (this.desired.x - this.focus.x) * planar;
    this.focus.z += (this.desired.z - this.focus.z) * planar;
    this.focus.y += (this.desired.y - this.focus.y) * Math.min(1, 2.6 * dt);

    // A slow, barely-there drift. It is the difference between a screenshot
    // and something that feels hand-held.
    const t = this.elapsed * SHAKE_SPEED;
    const driftYaw = Math.sin(t * 1.13) * SHAKE.x * 0.5 + Math.sin(t * 0.47) * SHAKE.x * 0.5;
    const driftPitch = Math.sin(t * 0.83 + 1.7) * SHAKE.y * 0.5;
    const driftZoom = Math.sin(t * 0.61 + 0.4) * SHAKE.z;

    const yaw = this.yaw + driftYaw;
    const pitch = THREE.MathUtils.clamp(this.pitch + driftPitch, 0.02, MAX_PITCH);
    const distance = this.distance * (1 + driftZoom);

    const horizontal = Math.cos(pitch) * distance;
    const x = this.focus.x + Math.sin(yaw) * horizontal;
    const z = this.focus.z + Math.cos(yaw) * horizontal;
    const y = this.focus.y + Math.sin(pitch) * distance;

    // Never let the camera clip through terrain or sink into the sea.
    const floor = Math.max(heightAt(x, z), WATER_LEVEL) + 1.4;
    this.camera.position.set(x, Math.max(y, floor), z);
    this.camera.lookAt(this.focus);
  }
}
