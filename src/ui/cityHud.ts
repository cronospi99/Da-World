import type { Discovery, Explorer } from "../city/discovery";
import type { Speech } from "../learn/speech";
import { closeButton, el, speakerButton } from "./dom";

/**
 * On-screen furniture for a city you walk around.
 *
 * Four things, and nothing else: where you are, what time it is, how much of
 * the city you have found, and what the button under your finger would do. The
 * card that opens when you find somewhere new is the only thing that ever
 * covers the view, and it closes itself out of your way.
 */

interface HudOptions {
  onReset: () => void;
  onPause: (paused: boolean) => void;
}

export class CityHud {
  private readonly streetName: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barLabel: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardBody: HTMLElement;
  private readonly info: HTMLElement;
  private readonly soundButton: HTMLButtonElement;

  private toastTimer = 0;
  private cardTimer = 0;
  private openPlace: Discovery | null = null;

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly explorer: Explorer,
    private readonly options: HudOptions,
  ) {
    this.streetName = el("h1", { class: "hud-place-name", text: "…" });
    this.clock = el("div", { class: "hud-place-sub", text: "" });
    this.barFill = el("div", { class: "hud-bar-fill" });
    this.barLabel = el("div", { class: "hud-bar-label" });

    const corner = el("div", { class: "hud-corner hud-top-left" }, [
      this.streetName,
      this.clock,
      el("div", { class: "hud-bar" }, [this.barFill]),
      this.barLabel,
    ]);

    this.soundButton = el("button", {
      class: "tile-button",
      type: "button",
      "aria-label": "Toggle pronunciation audio",
      text: "🔊",
    });
    this.soundButton.addEventListener("click", () => {
      const muted = this.speech.toggleMute();
      this.soundButton.textContent = muted ? "🔇" : "🔊";
    });

    const infoButton = el("button", {
      class: "tile-button",
      type: "button",
      "aria-label": "How to play",
      text: "?",
    });
    infoButton.addEventListener("click", () => this.toggleInfo(true));

    const buttons = el("nav", { class: "hud-corner hud-top-right" }, [
      this.soundButton,
      infoButton,
    ]);

    this.hint = el("div", { class: "hud-hint" });
    this.toast = el("div", { class: "hud-toast" });

    // --- the place card ---------------------------------------------------
    this.cardBody = el("article", { class: "card-body" });
    this.card = el("div", { class: "overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        this.cardBody,
        closeButton(() => this.closeCard(), "Close"),
      ]),
    ]);
    this.card.querySelector(".overlay-scrim")!.addEventListener("click", () => this.closeCard());

    this.info = this.buildInfo();
    parent.append(corner, buttons, this.hint, this.toast, this.card, this.info);

    this.explorer.subscribe(() => this.refreshProgress());
    this.refreshProgress();
  }

  get isCardOpen(): boolean {
    return this.card.classList.contains("is-open");
  }

  get isInfoOpen(): boolean {
    return this.info.classList.contains("is-open");
  }

  get isBlocking(): boolean {
    return this.isCardOpen || this.isInfoOpen;
  }

  setStreet(name: string): void {
    if (this.streetName.textContent !== name) this.streetName.textContent = name;
  }

  setClock(text: string): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  setHint(text: string | null): void {
    this.hint.textContent = text ?? "";
    this.hint.classList.toggle("is-visible", !!text);
  }

  /** Open the card for a place, and read its sentence aloud. */
  showPlace(place: Discovery, isNew: boolean): void {
    this.openPlace = place;
    this.cardBody.replaceChildren(
      el("div", { class: "lesson-emoji", text: place.emoji }),
      el("h2", { class: "lesson-term", text: place.name }),
      el("p", { class: "lesson-gloss", text: place.sentence }),
      el("p", {
        class: "lesson-place",
        text: isNew ? "New place found!" : `On ${place.street}`,
      }),
      el("div", { class: "lesson-actions" }, [
        speakerButton(() => this.speech.speak(place.sentence), "Listen"),
      ]),
    );
    this.setOverlay(this.card, true);
    this.speech.speak(place.sentence);
    // The card is information, not a modal dialogue: it gets out of the way on
    // its own so walking down a busy street never becomes a clicking exercise.
    this.cardTimer = 6;
  }

  closeCard(): void {
    this.setOverlay(this.card, false);
    this.openPlace = null;
    this.cardTimer = 0;
  }

  /** The place the open card is describing, if any. */
  get shownPlace(): Discovery | null {
    return this.openPlace;
  }

  showToast(title: string, sub: string): void {
    this.toast.replaceChildren(el("strong", { text: title }), el("span", { text: sub }));
    this.toast.classList.add("is-visible");
    this.toastTimer = 3.4;
  }

  toggleInfo(open: boolean): void {
    this.setOverlay(this.info, open);
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove("is-visible");
    }
    if (this.cardTimer > 0) {
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) this.closeCard();
    }
  }

  private setOverlay(node: HTMLElement, open: boolean): void {
    node.classList.toggle("is-open", open);
    node.setAttribute("aria-hidden", open ? "false" : "true");
    this.options.onPause(this.isBlocking);
  }

  private refreshProgress(): void {
    const found = this.explorer.found.size;
    const total = this.explorer.total;
    this.barFill.style.width = `${Math.round((found / total) * 100)}%`;
    this.barLabel.textContent = `${found} of ${total} places found`;
  }

  private buildInfo(): HTMLElement {
    const reset = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "Forget everything I found",
    });
    reset.addEventListener("click", () => {
      this.options.onReset();
      this.refreshProgress();
    });

    const info = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "Da World" }),
          el("p", {
            class: "info-lead",
            text: "A whole city, on foot. Walk up to any shop, park or landmark and it will tell you what it is and which street it is on.",
          }),
          el("ul", { class: "info-list" }, [
            el("li", { text: "Move — WASD / arrow keys, or the left half of a touch screen." }),
            el("li", { text: "Sprint — hold Shift." }),
            el("li", { text: "Jump — space, or a quick tap on the right half." }),
            el("li", { text: "Look — click once to take the mouse, then move it. Esc gives it back." }),
            el("li", { text: "Zoom — scroll, or pinch." }),
            el("li", { text: "Look at a place — walk to its door and press E." }),
            el("li", { text: "Re-centre the camera — press R." }),
          ]),
          el("p", {
            class: "info-note",
            text: "Cars stop at red lights and the sun really does go down. Pronunciation uses your device voice; what you have found is saved in this browser.",
          }),
          el("div", { class: "lesson-actions" }, [reset]),
        ]),
        closeButton(() => this.toggleInfo(false), "Close"),
      ]),
    ]);
    info.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggleInfo(false));
    return info;
  }
}
