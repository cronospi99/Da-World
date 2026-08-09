import * as THREE from "three";

/**
 * Unified keyboard / mouse / touch input.
 *
 * Desktop: WASD or arrows to walk, drag to orbit, wheel to zoom, E to interact.
 * Touch: left half of the screen is a virtual stick, right half orbits,
 * pinch zooms.
 */
export class Input {
  /** x = strafe, y = forward. Length is clamped to 1. */
  readonly move = new THREE.Vector2();
  /** Consumed (and reset) by the camera rig every frame. */
  readonly look = new THREE.Vector2();
  zoom = 0;

  /** True while any walk input is active — used to drive the walk animation. */
  get isMoving(): boolean {
    return this.move.lengthSq() > 0.0004;
  }

  private readonly keys = new Set<string>();
  private readonly interactHandlers: Array<() => void> = [];
  private readonly cancelHandlers: Array<() => void> = [];

  private stickId: number | null = null;
  private stickOrigin = new THREE.Vector2();
  private lookId: number | null = null;
  private lastLook = new THREE.Vector2();
  private pinchDistance: number | null = null;
  private readonly activePointers = new Map<number, THREE.Vector2>();

  /** Set while a modal is open so the world stops responding. */
  enabled = true;

  constructor(element: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    element.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  onInteract(fn: () => void): void {
    this.interactHandlers.push(fn);
  }

  onCancel(fn: () => void): void {
    this.cancelHandlers.push(fn);
  }

  /** Call once per frame, after the camera and player have read the state. */
  endFrame(): void {
    this.look.set(0, 0);
    this.zoom = 0;
  }

  update(): void {
    const x = (this.keys.has("d") ? 1 : 0) - (this.keys.has("a") ? 1 : 0);
    const y = (this.keys.has("w") ? 1 : 0) - (this.keys.has("s") ? 1 : 0);

    if (this.stickId !== null) return; // touch stick wins over keyboard
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
    if (!this.enabled) this.move.set(0, 0);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = normalizeKey(event.key);
    if (key === "escape") {
      for (const fn of this.cancelHandlers) fn();
      return;
    }
    if (!this.enabled) return;
    if (key === "e" || key === " " || key === "enter") {
      event.preventDefault();
      for (const fn of this.interactHandlers) fn();
      return;
    }
    if (key === "w" || key === "a" || key === "s" || key === "d") {
      event.preventDefault();
      this.keys.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(normalizeKey(event.key));
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.move.set(0, 0);
    this.stickId = null;
    this.lookId = null;
    this.activePointers.clear();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.activePointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));

    const isTouch = event.pointerType === "touch";
    const leftHalf = event.clientX < window.innerWidth * 0.5;

    if (isTouch && leftHalf && this.stickId === null) {
      this.stickId = event.pointerId;
      this.stickOrigin.set(event.clientX, event.clientY);
      return;
    }
    if (this.lookId === null) {
      this.lookId = event.pointerId;
      this.lastLook.set(event.clientX, event.clientY);
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const tracked = this.activePointers.get(event.pointerId);
    if (tracked) tracked.set(event.clientX, event.clientY);

    if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      const distance = a!.distanceTo(b!);
      if (this.pinchDistance !== null) this.zoom += (this.pinchDistance - distance) * 0.02;
      this.pinchDistance = distance;
      return;
    }
    this.pinchDistance = null;

    if (event.pointerId === this.stickId) {
      const dx = event.clientX - this.stickOrigin.x;
      const dy = event.clientY - this.stickOrigin.y;
      const radius = 70;
      this.move.set(dx / radius, -dy / radius);
      if (this.move.lengthSq() > 1) this.move.normalize();
      return;
    }

    if (event.pointerId === this.lookId) {
      this.look.x += event.clientX - this.lastLook.x;
      this.look.y += event.clientY - this.lastLook.y;
      this.lastLook.set(event.clientX, event.clientY);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size < 2) this.pinchDistance = null;
    if (event.pointerId === this.stickId) {
      this.stickId = null;
      this.move.set(0, 0);
    }
    if (event.pointerId === this.lookId) this.lookId = null;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.zoom += event.deltaY * 0.01;
  };
}

function normalizeKey(key: string): string {
  switch (key) {
    case "ArrowUp":
      return "w";
    case "ArrowDown":
      return "s";
    case "ArrowLeft":
      return "a";
    case "ArrowRight":
      return "d";
    case "Escape":
      return "escape";
    case "Enter":
      return "enter";
    default:
      return key.toLowerCase();
  }
}
