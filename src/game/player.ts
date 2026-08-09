import * as THREE from "three";
import type { Input } from "../core/input";
import { WATER_LEVEL, WORLD_SIZE, heightAt } from "../world/terrain";
import { toonMaterial } from "../world/materials";

const WALK_SPEED = 9.5;
const TURN_SPEED = 9;
const ACCEL = 12;

/** A small low-poly traveller with a hand-animated walk cycle. */
export class Player {
  readonly object = new THREE.Group();
  readonly position = new THREE.Vector3();

  private readonly body = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private velocity = new THREE.Vector2();
  private facing = 0;
  private stride = 0;

  constructor(start: THREE.Vector2) {
    const skin = toonMaterial({ color: "#e8b98d", ramp: "skin" });
    const shirt = toonMaterial({ color: "#d96f52" });
    const trousers = toonMaterial({ color: "#4c6a86" });
    const hat = toonMaterial({ color: "#f3e3bd", ramp: "soft" });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.5, 3, 8), shirt);
    torso.position.y = 1.15;
    this.body.add(torso);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), skin);
    head.position.y = 1.82;
    this.body.add(head);

    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 10), hat);
    brim.position.y = 2.02;
    this.body.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.3, 10), hat);
    crown.position.y = 2.17;
    this.body.add(crown);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.45, 2, 6), skin);
      arm.position.set(side * 0.44, 1.22, 0);
      this.arms.push(arm);
      this.body.add(arm);

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 2, 6), trousers);
      leg.position.set(side * 0.18, 0.45, 0);
      this.legs.push(leg);
      this.body.add(leg);
    }

    for (const child of this.body.children) {
      child.castShadow = true;
      child.receiveShadow = true;
    }

    this.object.add(this.body);
    this.object.name = "player";

    this.position.set(start.x, heightAt(start.x, start.y), start.y);
    this.object.position.copy(this.position);
  }

  update(dt: number, input: Input, cameraYaw: number): void {
    // Desired direction in world space, relative to where the camera looks.
    const target = new THREE.Vector2(0, 0);
    if (input.isMoving) {
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      // The rig sits at focus + (sin(yaw), cos(yaw)) * distance, so the
      // direction the player sees as "forward" is (-sin, -cos) and "right"
      // is (cos, -sin).
      target.set(
        input.move.x * cos - input.move.y * sin,
        -input.move.x * sin - input.move.y * cos,
      );
      if (target.lengthSq() > 1) target.normalize();
    }

    this.velocity.lerp(target, Math.min(1, ACCEL * dt));
    if (this.velocity.lengthSq() < 1e-5) this.velocity.set(0, 0);

    const step = WALK_SPEED * dt;
    let nextX = this.position.x + this.velocity.x * step;
    let nextZ = this.position.z + this.velocity.y * step;

    // Keep the player on dry land and inside the island.
    const limit = WORLD_SIZE * 0.46;
    nextX = THREE.MathUtils.clamp(nextX, -limit, limit);
    nextZ = THREE.MathUtils.clamp(nextZ, -limit, limit);
    if (heightAt(nextX, nextZ) < WATER_LEVEL + 0.35) {
      nextX = this.position.x;
      nextZ = this.position.z;
      this.velocity.multiplyScalar(0.2);
    }

    this.position.set(nextX, heightAt(nextX, nextZ), nextZ);
    this.object.position.copy(this.position);

    // Face the direction of travel.
    const speed = this.velocity.length();
    if (speed > 0.05) {
      const desired = Math.atan2(this.velocity.x, this.velocity.y);
      this.facing = angleLerp(this.facing, desired, Math.min(1, TURN_SPEED * dt));
    }
    this.object.rotation.y = this.facing;

    // Walk cycle.
    this.stride += speed * dt * 11;
    const swing = Math.sin(this.stride) * 0.5 * Math.min(speed, 1);
    this.legs[0]!.rotation.x = swing;
    this.legs[1]!.rotation.x = -swing;
    this.arms[0]!.rotation.x = -swing * 0.7;
    this.arms[1]!.rotation.x = swing * 0.7;
    this.body.position.y = Math.abs(Math.sin(this.stride)) * 0.07 * Math.min(speed, 1);
  }
}

function angleLerp(current: number, target: number, t: number): number {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}
