import type { Input } from "../core/input";
import { el } from "./dom";

/**
 * Touch controls for a phone held upright.
 *
 * The desktop scheme — left half of the screen is a stick, right half aims the
 * camera, tap to jump — works, but only if you already know it. Held in
 * portrait it is worse than that: your thumbs reach the bottom third and
 * nothing else, and an invisible control you have to discover by dragging is
 * not a control a class of twelve-year-olds will find in the first minute.
 *
 * So on a touch device the game draws the controls it already had:
 *
 * - a **visible stick** at the bottom left, anchored where your left thumb
 *   already is, that follows your finger the moment you touch anywhere in its
 *   corner rather than only on the dot itself;
 * - a **talk button** at the bottom right, which is the one verb in the game,
 *   lit up when somebody is in range and dark when nobody is;
 * - a **jump button** beside it.
 *
 * Aiming the camera stays a drag anywhere else on the screen, because a second
 * stick is one thumb more than a phone has. Everything here just moves the
 * numbers `Input` already exposes, so the controller, the camera and the
 * character know nothing about any of it.
 */

const STICK_RADIUS = 62;

export interface TouchHandlers {
  onTalk(): void;
}

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly talkButton: HTMLButtonElement;
  private readonly stickZone: HTMLElement;

  private stickId: number | null = null;
  private readonly origin = { x: 0, y: 0 };

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
    handlers: TouchHandlers,
  ) {
    this.stickKnob = el("div", { class: "stick-knob" });
    this.stickBase = el("div", { class: "stick-base" }, [this.stickKnob]);

    this.talkButton = el("button", {
      class: "touch-button touch-talk",
      type: "button",
      "aria-label": "Talk",
      text: "💬",
    });
    // Pointer, not click: a click waits for the browser to rule out a scroll,
    // and a control that answers 300 ms late feels broken rather than slow.
    this.talkButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handlers.onTalk();
    });

    const jump = el("button", {
      class: "touch-button touch-jump",
      type: "button",
      "aria-label": "Jump",
      text: "⤴",
    });
    jump.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.input.queueJump();
    });

    const stickZone = el("div", { class: "stick-zone" }, [this.stickBase]);
    this.stickZone = stickZone;
    stickZone.addEventListener("pointerdown", this.onStickDown);
    // From here on this widget is the only thing that walks: the "left half of
    // the screen is a stick" fallback in `Input` is for a touch device with no
    // controls drawn, and having both means the character can be walked from
    // outside the one control the player can see.
    input.ownStick();
    window.addEventListener("pointermove", this.onStickMove);
    window.addEventListener("pointerup", this.onStickUp);
    window.addEventListener("pointercancel", this.onStickUp);

    this.root = el("div", { class: "touch-layer" }, [
      stickZone,
      el("div", { class: "touch-buttons" }, [jump, this.talkButton]),
    ]);
    parent.append(this.root);
  }

  /** Show the controls only while there is a world to control. */
  setVisible(visible: boolean): void {
    this.root.classList.toggle("is-on", visible);
  }

  /** Light the talk button when somebody is close enough to speak to. */
  setTalkReady(ready: boolean): void {
    this.talkButton.classList.toggle("is-ready", ready);
  }

  private onStickDown = (event: PointerEvent): void => {
    // One stick, and only from its own corner. A second finger elsewhere is
    // the camera's, and a finger that arrives while the stick is held is
    // ignored rather than allowed to take the walk over from the far side of
    // the screen.
    if (this.stickId !== null) return;
    if (!this.inZone(event.clientX, event.clientY)) return;
    event.preventDefault();
    this.stickId = event.pointerId;
    // The stick appears under the thumb rather than the thumb having to find
    // the stick, which is the whole difference on a screen you cannot look at
    // while you are walking.
    this.origin.x = event.clientX;
    this.origin.y = event.clientY;
    // `left`/`top` are relative to the zone, not the viewport, so the touch
    // point has to be brought into the zone's frame — otherwise the stick
    // draws itself somewhere off the bottom of the screen while still working
    // perfectly, which is the most confusing way for a control to be wrong.
    const rect = this.stickZone.getBoundingClientRect();
    this.stickBase.style.left = `${event.clientX - rect.left}px`;
    this.stickBase.style.top = `${event.clientY - rect.top}px`;
    this.stickBase.classList.add("is-held");
    this.moveKnob(0, 0);
  };

  private onStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickId) return;
    const dx = event.clientX - this.origin.x;
    const dy = event.clientY - this.origin.y;
    const length = Math.hypot(dx, dy);
    const clamped = Math.min(1, length / STICK_RADIUS);
    const nx = length > 0 ? (dx / length) * clamped : 0;
    const ny = length > 0 ? (dy / length) * clamped : 0;

    this.input.setStick(nx, -ny);
    this.moveKnob(nx * STICK_RADIUS, ny * STICK_RADIUS);
  };

  private onStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickId) return;
    this.stickId = null;
    this.input.setStick(0, 0);
    this.stickBase.classList.remove("is-held");
    this.moveKnob(0, 0);
  };

  /** Is this touch inside the corner the stick lives in? */
  private inZone(x: number, y: number): boolean {
    const r = this.stickZone.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private moveKnob(x: number, y: number): void {
    this.stickKnob.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }
}

/** Is this a device where the touch controls should be drawn at all? */
export const isTouchDevice = (): boolean =>
  "ontouchstart" in window || navigator.maxTouchPoints > 0;
