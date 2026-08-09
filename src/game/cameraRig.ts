import * as THREE from "three";
import type { Input } from "../core/input";
import { WATER_LEVEL, heightAt } from "../world/terrain";

const MIN_DISTANCE = 8;
const MAX_DISTANCE = 26;
const MIN_PITCH = 0.18;
const MAX_PITCH = 1.15;

/** Smoothed third-person orbit camera that never dips under the ground. */
export class CameraRig {
  /**
   * The rig sits at focus + (sin(yaw), cos(yaw)) * distance, so yaw = 0 puts
   * the camera on the +Z side looking towards -Z.
   */
  yaw = 0;
  private pitch = 0.55;
  private distance = 16;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(dt: number, input: Input, target: THREE.Vector3): void {
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

    // Follow a point slightly above the player's feet.
    this.focus.lerp(
      this.desired.set(target.x, target.y + 1.6, target.z),
      Math.min(1, 8 * dt),
    );

    const horizontal = Math.cos(this.pitch) * this.distance;
    const x = this.focus.x + Math.sin(this.yaw) * horizontal;
    const z = this.focus.z + Math.cos(this.yaw) * horizontal;
    const y = this.focus.y + Math.sin(this.pitch) * this.distance;

    // Never let the camera clip through terrain or sink into the sea.
    const floor = Math.max(heightAt(x, z), WATER_LEVEL) + 1.8;
    this.camera.position.set(x, Math.max(y, floor), z);
    this.camera.lookAt(this.focus);
  }
}
