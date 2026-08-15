import * as THREE from "three";

/**
 * Unified keyboard / mouse / touch input.
 *
 * Desktop: WASD or arrows to walk, Shift to sprint, space to jump, wheel to
 * zoom, E (or Enter) to interact. Clicking the canvas locks the pointer and
 * hands the mouse to the camera, the way a third-person game expects; Esc
 * releases it and drag-to-look takes over again.
 * Touch: the drawn stick in the bottom-left corner walks (see `ui/touch.ts`,
 * which claims it with `ownStick`), a drag anywhere else orbits, pinch zooms,
 * a quick tap that did not drag jumps, and the 🏃 button latches the run on.
 * Where no controls are drawn, the whole left half of the screen falls back to
 * being an invisible stick.
 */
export class Input {
  /** x = strafe, y = forward. Length is clamped to 1. */
  readonly move = new THREE.Vector2();
  /** Consumed (and reset) by the camera rig every frame. */
  readonly look = new THREE.Vector2();
  zoom = 0;

  /**
   * True while the character should be running.
   *
   * Two sources, kept apart on purpose. Shift is *held*: pressing it runs,
   * letting go walks. The touch button is *latched*: a phone's right thumb is
   * the one that drags the camera, so a run you had to hold would cost you the
   * ability to look where you are going, and the character would sprint down a
   * street you could not steer. Storing them separately is what stops one from
   * cancelling the other — a keyboard user on a touchscreen laptop who taps
   * 🏃 and then presses and releases Shift should still be running.
   */
  get sprint(): boolean {
    return this.keySprint || this.touchSprint;
  }

  private keySprint = false;
  private touchSprint = false;

  /** Latch the run on or off from the touch controls. */
  setSprint(on: boolean): void {
    this.touchSprint = on;
  }

  /**
   * True when the look this frame came from a finger rather than a mouse.
   *
   * The camera needs to know: a thumb drags perhaps a fifth of the screen
   * before it runs out of hand, where a mouse has a whole desk, so the same
   * radians-per-pixel that feels precise with a mouse feels like turning a ship
   * with a phone. See the sensitivities in `cameraRig.ts`.
   */
  get lookIsTouch(): boolean {
    return this.lookFromTouch;
  }

  /** True while any walk input is active — used to drive the walk animation. */
  get isMoving(): boolean {
    return this.move.lengthSq() > 0.0004;
  }

  private readonly keys = new Set<string>();
  /** Edge-triggered: set on press, cleared by `consumeJump`. */
  private jumpQueued = false;
  private readonly interactHandlers: Array<() => void> = [];
  private readonly cancelHandlers: Array<() => void> = [];

  /** Set while the on-screen stick is being held, so keys do not fight it. */
  private externalStick = false;
  /**
   * True once the touch layer has claimed walking for its own widget.
   *
   * Without it there are two sticks on a phone: the drawn one in the bottom
   * left, and this file's own "anywhere on the left half of the screen is a
   * stick" fallback. They do not conflict so much as duplicate — a thumb put
   * down on the top left, over the street name, started the character walking
   * with no control on screen to explain why, and a second finger anywhere in
   * that half could take over the walk from the widget. The drawn stick is the
   * better control, so when it exists it is the only one.
   */
  private stickOwned = false;
  private stickId: number | null = null;
  private stickOrigin = new THREE.Vector2();
  private lookId: number | null = null;
  private lastLook = new THREE.Vector2();
  /** Where and when the look pointer went down, to tell a tap from a drag. */
  private lookStart = new THREE.Vector2();
  private lookStartTime = 0;
  /** Whether the pointer currently aiming the camera is a finger. */
  private lookFromTouch = false;
  private pinchDistance: number | null = null;
  private readonly activePointers = new Map<number, THREE.Vector2>();

  /** Set while a modal is open so the world stops responding. */
  enabled = true;

  /** The element the pointer gets locked to, so the mouse can aim the camera. */
  private readonly surface: HTMLElement;

  constructor(element: HTMLElement) {
    this.surface = element;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    element.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", this.onLockedMove);
  }

  /** True while the mouse is driving the camera directly. */
  get pointerLocked(): boolean {
    return document.pointerLockElement === this.surface;
  }

  /**
   * Ask for the pointer. Browsers only grant this from a user gesture, and
   * only some time after a previous unlock, so a refusal is normal and the
   * drag-to-look path stays available.
   */
  requestPointerLock(): void {
    if (this.pointerLocked) return;
    void this.surface.requestPointerLock?.();
  }

  releasePointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock?.();
  }

  /**
   * While locked there is no cursor to drag, so movement arrives as deltas on
   * the document instead. Same accumulator, so the camera cannot tell.
   */
  private onLockedMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.pointerLocked) return;
    this.look.x += event.movementX;
    this.look.y += event.movementY;
  };

  onInteract(fn: () => void): void {
    this.interactHandlers.push(fn);
  }

  onCancel(fn: () => void): void {
    this.cancelHandlers.push(fn);
  }

  /**
   * Hand walking to the on-screen stick, permanently.
   *
   * Called by the touch layer at construction. From then on a touch outside
   * that widget aims the camera and nothing else.
   */
  ownStick(): void {
    this.stickOwned = true;
    this.stickId = null;
  }

  /**
   * Drive the walk from an on-screen stick.
   *
   * The touch layer owns the widget and its feel; all the controller ever sees
   * is the same `move` vector the keyboard writes, so nothing downstream knows
   * or cares which one is being held.
   */
  setStick(x: number, y: number): void {
    this.externalStick = x !== 0 || y !== 0;
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
  }

  /** Jump, from a button rather than a key. */
  queueJump(): void {
    if (this.enabled) this.jumpQueued = true;
  }

  /** True once per press. The character controller buffers it from there. */
  consumeJump(): boolean {
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return jump;
  }

  /** Call once per frame, after the camera and player have read the state. */
  endFrame(): void {
    this.look.set(0, 0);
    this.zoom = 0;
    // An unconsumed jump (modal open, say) must not fire later.
    this.jumpQueued = false;
  }

  update(): void {
    const x = (this.keys.has("d") ? 1 : 0) - (this.keys.has("a") ? 1 : 0);
    const y = (this.keys.has("w") ? 1 : 0) - (this.keys.has("s") ? 1 : 0);

    // Either touch stick wins over the keyboard: a finger on the screen is a
    // deliberate act, and a stuck key should not drag you out from under it.
    if (this.stickId !== null || this.externalStick) {
      if (!this.enabled) this.move.set(0, 0);
      return;
    }
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
    // Somebody is typing. This listener is on the window, so every key in the
    // game's vocabulary reached it wherever the caret was — and five of those
    // keys are letters. `W`, `A`, `S`, `D` and `E` were swallowed before they
    // reached the field, `space` with them, and `Enter` talked to whoever was
    // standing nearby instead of submitting; a student typing "Esteban" into
    // the name box got "tbn" and reasonably concluded that letters were not
    // allowed. Nothing the world listens for is worth a keystroke aimed at an
    // input.
    if (isTyping(event.target)) return;
    if (!this.enabled) return;
    if (key === " ") {
      event.preventDefault();
      if (!event.repeat) this.jumpQueued = true;
      return;
    }
    if (key === "e" || key === "enter") {
      event.preventDefault();
      for (const fn of this.interactHandlers) fn();
      return;
    }
    if (key === "shift") {
      this.keySprint = true;
      return;
    }
    if (key === "w" || key === "a" || key === "s" || key === "d") {
      event.preventDefault();
      this.keys.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const key = normalizeKey(event.key);
    if (key === "shift") this.keySprint = false;
    this.keys.delete(key);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.keySprint = false;
    this.move.set(0, 0);
    this.externalStick = false;
    this.stickId = null;
    this.lookId = null;
    this.activePointers.clear();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    // With the pointer locked the mouse is already feeding the camera; a
    // second, drag-shaped source of the same movement would double it.
    if (this.pointerLocked) return;
    this.activePointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));

    const isTouch = event.pointerType === "touch";
    const leftHalf = event.clientX < window.innerWidth * 0.5;

    if (isTouch && leftHalf && !this.stickOwned && this.stickId === null) {
      this.stickId = event.pointerId;
      this.stickOrigin.set(event.clientX, event.clientY);
      return;
    }
    if (this.lookId === null) {
      this.lookId = event.pointerId;
      this.lastLook.set(event.clientX, event.clientY);
      this.lookStart.set(event.clientX, event.clientY);
      this.lookStartTime = performance.now();
      this.lookFromTouch = isTouch;
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
    if (event.pointerId === this.lookId) {
      // A quick tap that did not drag is a jump, not a camera move.
      const held = performance.now() - this.lookStartTime;
      const moved = this.lookStart.distanceTo(_tap.set(event.clientX, event.clientY));
      if (this.lookFromTouch && held < 250 && moved < 12) this.jumpQueued = true;
      this.lookId = null;
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.zoom += event.deltaY * 0.01;
  };
}

const _tap = new THREE.Vector2();

/**
 * Is this key going into a text field?
 *
 * Checked on the event's target rather than `document.activeElement`, which is
 * the same thing here and cheaper to reason about: the target is where the
 * character would land.
 */
export function isTyping(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable;
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
