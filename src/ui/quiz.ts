import { ALL_SPOTS } from "../content/places";
import type { Place, Vocab } from "../content/types";
import type { Progress } from "../learn/progress";
import type { Speech } from "../learn/speech";
import { closeButton, el, speakerButton } from "./dom";

interface Question {
  vocab: Vocab;
  options: string[];
}

const OPTION_COUNT = 4;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Builds a short multiple-choice round from the words of one place. */
function buildQuestions(place: Place): Question[] {
  const own = place.spots.map((s) => s.vocab);
  const others = ALL_SPOTS.map(({ spot }) => spot.vocab).filter(
    (v) => !own.some((o) => o.en === v.en),
  );

  return shuffle(own)
    .slice(0, Math.min(5, own.length))
    .map((vocab) => {
      const distractorPool = shuffle([
        ...own.filter((v) => v.en !== vocab.en),
        ...others,
      ]);
      const options = shuffle([
        vocab.en,
        ...distractorPool.slice(0, OPTION_COUNT - 1).map((v) => v.en),
      ]);
      return { vocab, options };
    });
}

/** End-of-place quiz. Opens once every word in a place has been visited. */
export class Quiz {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptEmoji: HTMLElement;
  private readonly optionList: HTMLElement;
  private readonly feedback: HTMLElement;

  private place: Place | null = null;
  private questions: Question[] = [];
  private index = 0;
  private correct = 0;
  private locked = false;
  private onCloseHandler: (() => void) | null = null;

  get isOpen(): boolean {
    return this.place !== null;
  }

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly progress: Progress,
  ) {
    this.title = el("h2", { class: "quiz-title" });
    this.counter = el("div", { class: "quiz-counter" });
    this.promptEmoji = el("div", { class: "quiz-emoji" });
    this.prompt = el("p", { class: "quiz-prompt" });
    this.optionList = el("div", { class: "quiz-options" });
    this.feedback = el("p", { class: "quiz-feedback" });

    const card = el("div", { class: "card quiz-card" }, [
      el("div", { class: "card-shadow" }),
      el("div", { class: "card-face" }),
      el("article", { class: "card-body" }, [
        this.counter,
        this.title,
        this.promptEmoji,
        el("div", { class: "quiz-prompt-row" }, [
          this.prompt,
          speakerButton(() => this.speakPrompt(), "Listen"),
        ]),
        this.optionList,
        this.feedback,
      ]),
      closeButton(() => this.close(), "Close the quiz"),
    ]);

    this.root = el("div", { class: "overlay quiz-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      card,
    ]);
    parent.appendChild(this.root);
  }

  onClose(fn: () => void): void {
    this.onCloseHandler = fn;
  }

  open(place: Place): void {
    this.place = place;
    this.questions = buildQuestions(place);
    this.index = 0;
    this.correct = 0;
    this.locked = false;
    this.title.textContent = `${place.name} — quick check`;
    this.root.classList.add("is-open");
    this.root.setAttribute("aria-hidden", "false");
    this.renderQuestion();
  }

  close(): void {
    if (!this.place) return;
    this.place = null;
    this.speech.stop();
    this.root.classList.remove("is-open");
    this.root.setAttribute("aria-hidden", "true");
    this.onCloseHandler?.();
  }

  private get question(): Question | null {
    return this.questions[this.index] ?? null;
  }

  private renderQuestion(): void {
    const question = this.question;
    if (!question) return;

    this.counter.textContent = `${this.index + 1} / ${this.questions.length}`;
    this.promptEmoji.textContent = question.vocab.emoji;
    this.prompt.textContent = question.vocab.es;
    this.feedback.textContent = "";
    this.feedback.className = "quiz-feedback";

    this.optionList.replaceChildren(
      ...question.options.map((option) => {
        const button = el("button", { class: "quiz-option", type: "button", text: option });
        button.addEventListener("click", () => this.answer(option, button));
        return button;
      }),
    );
  }

  private answer(option: string, button: HTMLButtonElement): void {
    const question = this.question;
    if (!question || this.locked) return;
    this.locked = true;

    const isCorrect = option === question.vocab.en;
    if (isCorrect) this.correct++;

    button.classList.add(isCorrect ? "is-correct" : "is-wrong");
    for (const child of this.optionList.children) {
      const optionEl = child as HTMLButtonElement;
      optionEl.disabled = true;
      if (!isCorrect && optionEl.textContent === question.vocab.en) {
        optionEl.classList.add("is-correct");
      }
    }

    this.feedback.textContent = isCorrect
      ? question.vocab.sentence
      : `${question.vocab.en} — ${question.vocab.sentence}`;
    this.feedback.classList.add(isCorrect ? "is-correct" : "is-wrong");
    this.speech.speak(question.vocab.en);

    window.setTimeout(() => {
      this.locked = false;
      this.index++;
      if (this.question) this.renderQuestion();
      else this.finish();
    }, 1500);
  }

  private finish(): void {
    if (!this.place) return;
    const score = this.questions.length ? this.correct / this.questions.length : 0;
    this.progress.recordQuiz(this.place.id, score);

    this.counter.textContent = "Done";
    this.promptEmoji.textContent = score === 1 ? "🏆" : score >= 0.6 ? "👏" : "🌱";
    this.prompt.textContent = `${this.correct} / ${this.questions.length} correct`;
    this.feedback.textContent =
      score === 1
        ? "Perfect. Try another place."
        : "Walk back to the words you missed and listen again.";
    this.feedback.className = "quiz-feedback";

    const again = el("button", { class: "pill-button", type: "button", text: "Play again" });
    again.addEventListener("click", () => this.place && this.open(this.place));
    const done = el("button", { class: "pill-button ghost", type: "button", text: "Back to the world" });
    done.addEventListener("click", () => this.close());
    this.optionList.replaceChildren(again, done);
  }

  private speakPrompt(): void {
    const question = this.question;
    if (question) this.speech.speak(question.vocab.en);
  }
}
