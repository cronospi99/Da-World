import type { Progress } from "../learn/progress";
import type { Speech } from "../learn/speech";
import { closeButton, el, speakerButton } from "./dom";
import type { HotspotTarget } from "./hotspots";

/**
 * The paper card that opens when the player interacts with a spot.
 * One card element is reused for every word.
 */
export class LessonCard {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly emoji: HTMLElement;
  private readonly term: HTMLElement;
  private readonly gloss: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly sentence: HTMLElement;
  private readonly sentenceEs: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly placeName: HTMLElement;

  private current: HotspotTarget | null = null;
  private onCloseHandler: (() => void) | null = null;

  get isOpen(): boolean {
    return this.current !== null;
  }

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly progress: Progress,
  ) {
    this.emoji = el("div", { class: "lesson-emoji" });
    this.term = el("h2", { class: "lesson-term" });
    this.gloss = el("p", { class: "lesson-gloss" });
    this.chips = el("div", { class: "lesson-chips" });
    this.sentence = el("p", { class: "lesson-sentence" });
    this.sentenceEs = el("p", { class: "lesson-sentence-es" });
    this.placeName = el("div", { class: "lesson-place" });

    this.confirm = el("button", { class: "pill-button", type: "button", text: "Got it" });
    this.confirm.addEventListener("click", () => this.markAndClose());

    const termRow = el("div", { class: "lesson-term-row" }, [
      this.term,
      speakerButton(() => this.speakTerm(), "Listen to the word"),
    ]);

    const sentenceRow = el("div", { class: "lesson-sentence-row" }, [
      el("div", { class: "lesson-sentence-text" }, [this.sentence, this.sentenceEs]),
      speakerButton(() => this.speakSentence(), "Listen to the sentence"),
    ]);

    this.card = el("div", { class: "card lesson-card" }, [
      el("div", { class: "card-shadow" }),
      el("div", { class: "card-face" }),
      el("article", { class: "card-body" }, [
        this.placeName,
        this.emoji,
        termRow,
        this.gloss,
        this.chips,
        el("hr", { class: "lesson-rule" }),
        sentenceRow,
        el("div", { class: "lesson-actions" }, [this.confirm]),
      ]),
      closeButton(() => this.close(), "Close the card"),
    ]);

    this.root = el("div", { class: "overlay lesson-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      this.card,
    ]);
    this.root.querySelector(".overlay-scrim")!.addEventListener("click", () => this.close());

    parent.appendChild(this.root);
  }

  onClose(fn: () => void): void {
    this.onCloseHandler = fn;
  }

  open(target: HotspotTarget): void {
    this.current = target;
    const { vocab } = target.spot;

    this.placeName.textContent = `${target.place.name} · ${target.place.nameEs}`;
    this.emoji.textContent = vocab.emoji;
    this.term.textContent = vocab.en;
    this.gloss.textContent = vocab.es;
    this.sentence.textContent = vocab.sentence;
    this.sentenceEs.textContent = vocab.sentenceEs;

    this.chips.replaceChildren(
      el("span", { class: "chip", text: vocab.wordClass }),
      el("span", { class: "chip chip-level", text: vocab.level }),
    );

    const alreadyKnown = this.progress.isLearned(target.spot.id);
    this.confirm.textContent = alreadyKnown ? "Close" : "Got it";

    this.root.classList.add("is-open");
    this.root.setAttribute("aria-hidden", "false");
    this.speakTerm();
    this.confirm.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.current) return;
    this.current = null;
    this.speech.stop();
    this.root.classList.remove("is-open");
    this.root.setAttribute("aria-hidden", "true");
    this.onCloseHandler?.();
  }

  private markAndClose(): void {
    if (this.current) this.progress.markLearned(this.current.spot.id);
    this.close();
  }

  private speakTerm(): void {
    if (this.current) this.speech.speak(this.current.spot.vocab.en);
  }

  private speakSentence(): void {
    if (this.current) this.speech.speak(this.current.spot.vocab.sentence, 0.9);
  }
}
