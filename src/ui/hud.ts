import type { Place } from "../content/types";
import type { Progress } from "../learn/progress";
import type { Speech } from "../learn/speech";
import { closeButton, el } from "./dom";

interface HudOptions {
  onOpenQuiz: (place: Place) => void;
}

/** Persistent on-screen furniture: place name, progress, buttons, hints. */
export class Hud {
  private readonly placeName: HTMLElement;
  private readonly placeSub: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barLabel: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly quizButton: HTMLButtonElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly info: HTMLElement;

  private currentPlace: Place | null = null;
  private toastTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly progress: Progress,
    private readonly options: HudOptions,
  ) {
    // --- top left: where you are, how far along you are -------------------
    this.placeName = el("h1", { class: "hud-place-name", text: "…" });
    this.placeSub = el("div", { class: "hud-place-sub" });
    this.barFill = el("div", { class: "hud-bar-fill" });
    this.barLabel = el("div", { class: "hud-bar-label" });

    const corner = el("div", { class: "hud-corner hud-top-left" }, [
      this.placeName,
      this.placeSub,
      el("div", { class: "hud-bar" }, [this.barFill]),
      this.barLabel,
    ]);

    // --- top right: buttons ----------------------------------------------
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

    this.quizButton = el("button", {
      class: "tile-button",
      type: "button",
      "aria-label": "Practise the words of this place",
      text: "✓",
    });
    this.quizButton.addEventListener("click", () => {
      if (this.currentPlace) this.options.onOpenQuiz(this.currentPlace);
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
      this.quizButton,
      infoButton,
    ]);

    // --- bottom: contextual hint and toasts ------------------------------
    this.hint = el("div", { class: "hud-hint" });
    this.toast = el("div", { class: "hud-toast" });

    // --- info panel -------------------------------------------------------
    this.info = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "Da World" }),
          el("p", {
            class: "info-lead",
            text: "Walk around, touch the things you see, and collect the English word for each one.",
          }),
          el("ul", { class: "info-list" }, [
            el("li", { text: "Move — WASD / arrow keys, or the left half of a touch screen." }),
            el("li", { text: "Jump — space, or a quick tap on the right half." }),
            el("li", { text: "Look — drag anywhere, or scroll / pinch to zoom." }),
            el("li", { text: "Learn — walk up to a glowing marker and press E (or tap it)." }),
            el("li", { text: "Practise — the ✓ button opens a quick check once you have seen every word in a place." }),
          ]),
          el("p", {
            class: "info-note",
            text: "Pronunciation uses your device voice. Progress is saved in this browser.",
          }),
          el("div", { class: "lesson-actions" }, [this.resetButton()]),
        ]),
        closeButton(() => this.toggleInfo(false), "Close"),
      ]),
    ]);
    this.info.querySelector(".overlay-scrim")!.addEventListener("click", () =>
      this.toggleInfo(false),
    );

    parent.append(corner, buttons, this.hint, this.toast, this.info);

    this.progress.subscribe(() => this.refresh());
  }

  get isInfoOpen(): boolean {
    return this.info.classList.contains("is-open");
  }

  private resetButton(): HTMLButtonElement {
    const button = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "Reset progress",
    });
    button.addEventListener("click", () => {
      if (window.confirm("Forget every word you have collected?")) {
        this.progress.reset();
        this.toggleInfo(false);
      }
    });
    return button;
  }

  toggleInfo(open: boolean): void {
    this.info.classList.toggle("is-open", open);
    this.info.setAttribute("aria-hidden", open ? "false" : "true");
  }

  setPlace(place: Place | null): void {
    if (place?.id === this.currentPlace?.id) return;
    const isNew = place !== null && place.id !== this.currentPlace?.id;
    this.currentPlace = place;
    this.refresh();
    if (isNew) this.showToast(`${place.name} · ${place.nameEs}`, place.intro);
  }

  setHint(text: string | null): void {
    this.hint.textContent = text ?? "";
    this.hint.classList.toggle("is-visible", text !== null);
  }

  showToast(title: string, detail = ""): void {
    this.toast.replaceChildren(
      el("strong", { text: title }),
      detail ? el("span", { text: detail }) : el("span"),
    );
    this.toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove("is-visible");
    }, 4200);
  }

  private refresh(): void {
    const place = this.currentPlace;
    if (place) {
      const { learned, total } = this.progress.placeProgress(place.id);
      this.placeName.textContent = place.name;
      this.placeSub.textContent = `${place.nameEs} · ${learned}/${total} words here`;
    } else {
      this.placeName.textContent = "On the road";
      this.placeSub.textContent = "Follow a path to the next place";
    }

    const ratio = this.progress.total ? this.progress.learnedCount / this.progress.total : 0;
    this.barFill.style.transform = `scaleX(${ratio})`;
    this.barLabel.textContent = `${this.progress.learnedCount} / ${this.progress.total} words collected`;

    const canQuiz = place !== null && this.progress.isPlaceComplete(place.id);
    this.quizButton.disabled = !canQuiz;
    this.quizButton.classList.toggle("is-ready", canQuiz);
  }
}
