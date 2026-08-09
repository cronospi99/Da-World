import * as THREE from "three";
import { CAMERA_FAR, CAMERA_NEAR } from "../world/environment";
import { createPost, type Post } from "./post";

export type UpdateFn = (dt: number, elapsed: number) => void;

/**
 * Owns the renderer, scene, camera and the render loop.
 * Everything else in the game registers an update callback here.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly post: Post;

  private readonly clock = new THREE.Clock();
  private readonly updates: UpdateFn[] = [];
  private running = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping is applied by the OutputPass, then graded by the LUT-style
    // pass in core/post.ts — see there for why the order matters.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvas = this.renderer.domElement;
    this.canvas.classList.add("webgl");
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();

    // A short far plane is part of the look: distance dissolves into haze
    // rather than staying legible all the way to the horizon.
    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    this.camera.position.set(0, 12, 20);

    this.post = createPost(this.renderer, this.scene, this.camera);

    window.addEventListener("resize", this.onResize);
  }

  onUpdate(fn: UpdateFn): void {
    this.updates.push(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private tick = (): void => {
    // Clamped so a backgrounded tab does not teleport the player on return.
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const elapsed = this.clock.getElapsedTime();
    for (const fn of this.updates) fn(dt, elapsed);
    this.post.composer.render(dt);
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  };
}
