import {
  FAMILY_WORDS,
  LEVELS,
  NEGATIVE_RULE,
  WORD_ORDER,
  type FamilyWord,
} from "../game/family";
import type { Speech } from "../learn/speech";
import { closeButton, el } from "./dom";

/**
 * The vocabulary checker — the worksheet, in the pocket of somebody walking.
 *
 * A student stopped in the street by *"she ___ works in the garden — about
 * half the time"* has one of two problems. Either they do not know where 50%
 * sits on the scale, or they do not know what a great-aunt is. Both are
 * lookups, and neither is a reason to guess.
 *
 * So: the scale, the three word-order patterns, the rule about double
 * negatives, and all twenty-three family words — the reference pages of the
 * original worksheet, reachable in one tap from anywhere in the city, with the
 * device voice reading any of it aloud.
 *
 * The third tab is a self-test, and it is worth being explicit about what it
 * is *not*: it pays no XP and it counts towards no mission. Everything that
 * moves a number in this game is out on the pavement, being asked by somebody
 * — a checker that paid would be a way to finish the lesson sitting on a bench
 * with a menu open, which is the opposite of the point of a city.
 */

type View = "family" | "often" | "test";

interface Question {
  prompt: string;
  answer: string;
  options: string[];
}

const shuffled = <T,>(list: readonly T[]): T[] => {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const TEST_LENGTH = 6;

export class VocabCheck {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<View, HTMLElement>();

  private questions: Question[] = [];
  private answered = 0;
  private right = 0;

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly onClose: () => void,
  ) {
    this.body = el("div", { class: "vocab-body" });

    const tabRow = el(
      "div",
      { class: "chip-row" },
      (
        [
          ["family", "👨‍👩‍👧‍👦 Family words"],
          ["often", "📊 How often?"],
          ["test", "✍️ Check me"],
        ] as [View, string][]
      ).map(([id, label]) => {
        const chip = el("button", { class: "chip-button", type: "button", text: label });
        chip.addEventListener("click", () => this.show(id));
        this.tabs.set(id, chip);
        return chip;
      }),
    );

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card vocab-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "📖 Vocabulary checker" }),
          el("p", {
            class: "info-lead",
            text: "Look anything up, any time. Tap a card to hear it. Nothing in here is graded — the XP is out on the street.",
          }),
          tabRow,
          this.body,
        ]),
        closeButton(() => this.toggle(false), "Close"),
      ]),
    ]);
    this.root.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggle(false));
    parent.append(this.root);
    this.show("family");
  }

  get isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  toggle(open: boolean): void {
    this.root.classList.toggle("is-open", open);
    this.root.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      this.speech.stop();
      this.onClose();
    }
  }

  private show(view: View): void {
    for (const [id, chip] of this.tabs) chip.classList.toggle("is-chosen", id === view);
    if (view === "family") this.renderFamily();
    else if (view === "often") this.renderFrequency();
    else this.renderTest(true);
  }

  /* ------------------------------ family ------------------------------ */

  private renderFamily(): void {
    this.body.replaceChildren(
      el(
        "div",
        { class: "vocab-grid" },
        FAMILY_WORDS.map((word) => this.wordCard(word)),
      ),
    );
  }

  private wordCard(word: FamilyWord): HTMLElement {
    const card = el("button", { class: "vocab-word", type: "button" }, [
      el("span", { class: "vocab-emoji", text: word.emoji }),
      el("span", { class: "vocab-term", text: word.word }),
      el("span", { class: "vocab-defn", text: word.relation }),
      word.syn ? el("span", { class: "vocab-syn", text: `also: ${word.syn}` }) : null,
    ]);
    card.addEventListener("click", () => {
      this.speech.speak(`${word.word}. Your ${word.relation}.`);
      for (const other of this.body.querySelectorAll(".vocab-word")) {
        other.classList.remove("is-chosen");
      }
      card.classList.add("is-chosen");
    });
    return card;
  }

  /* ---------------------------- how often ----------------------------- */

  private renderFrequency(): void {
    const scale = el(
      "div",
      { class: "freq-scale" },
      LEVELS.map((level) => {
        const row = el("button", { class: "freq-row", type: "button" }, [
          el("span", {
            class: "freq-pct",
            text: `${level.pct}%`,
            style: `background:${level.colour}`,
          }),
          el("span", {
            class: "freq-word",
            text: level.words.join(" / "),
            style: `background:${level.colour}`,
          }),
          el("span", { class: "freq-ex", text: level.example }),
        ]);
        row.addEventListener("click", () => this.speech.speak(level.example));
        return row;
      }),
    );

    const patterns = el(
      "div",
      { class: "order-list" },
      WORD_ORDER.map((pattern) =>
        el("div", { class: "order-row" }, [
          el("span", { class: "order-label", text: pattern.label }),
          el(
            "span",
            { class: "order-boxes" },
            pattern.boxes.flatMap((box, i) => [
              i > 0 ? el("span", { class: "order-arrow", text: "→" }) : null,
              el("span", { class: "order-box", text: box }),
            ]),
          ),
          el("span", { class: "order-ex", text: pattern.example }),
        ]),
      ),
    );

    const rule = el("div", { class: "rule-box" }, [
      el("h4", { text: `⚠️ ${NEGATIVE_RULE.title}` }),
      ...NEGATIVE_RULE.wrong.map((bad, i) =>
        el("p", { class: "rule-pair" }, [
          el("span", { class: "rule-wrong", text: bad }),
          el("span", { class: "rule-right", text: `✅ ${NEGATIVE_RULE.right[i]}` }),
        ]),
      ),
    ]);

    this.body.replaceChildren(
      el("h3", { class: "case-heading", text: "The frequency scale" }),
      scale,
      el("h3", { class: "case-heading", text: "Where the adverb goes" }),
      patterns,
      rule,
    );
  }

  /* ------------------------------ test -------------------------------- */

  /**
   * Six questions, half vocabulary and half scale, drawn fresh each time.
   *
   * It uses `Math.random` rather than the game's seeded generator on purpose:
   * everything a citizen asks is seeded so a student can walk away and come
   * back to the same question, and this is the one place where the opposite is
   * wanted — press it again, get a different six.
   */
  private renderTest(fresh: boolean): void {
    if (fresh) {
      this.answered = 0;
      this.right = 0;
      const family = shuffled(FAMILY_WORDS)
        .slice(0, TEST_LENGTH / 2)
        .map((word): Question => ({
          prompt: `Who is your <b>${word.relation}</b>?`,
          answer: word.word,
          options: shuffled([
            word.word,
            ...shuffled(FAMILY_WORDS.filter((w) => w.word !== word.word))
              .slice(0, 3)
              .map((w) => w.word),
          ]),
        }));
      const often = shuffled(LEVELS)
        .slice(0, TEST_LENGTH / 2)
        .map((level): Question => {
          const answer = level.words[0];
          return {
            prompt: `Which word means <b>${level.pct}%</b>?`,
            answer,
            options: shuffled([
              answer,
              ...shuffled(LEVELS.filter((l) => l.id !== level.id))
                .slice(0, 3)
                .map((l) => l.words[0]),
            ]),
          };
        });
      this.questions = shuffled([...family, ...often]);
    }

    const score = el("p", { class: "info-note" });
    const refresh = (): void => {
      score.textContent =
        this.answered < this.questions.length
          ? `${this.right} right out of ${this.answered} — ${this.questions.length - this.answered} to go.`
          : `Finished: ${this.right} out of ${this.questions.length}. Nothing scored — go and find a citizen for that.`;
    };

    const again = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "🔄 Six more",
    });
    again.addEventListener("click", () => this.renderTest(true));

    this.body.replaceChildren(
      ...this.questions.map((question, i) => {
        const feedback = el("div", { class: "quiz-feedback" });
        const options = el(
          "div",
          { class: "quiz-options" },
          question.options.map((option) => {
            const button = el("button", {
              class: "quiz-option",
              type: "button",
              text: option,
            }) as HTMLButtonElement;
            button.addEventListener("click", () => {
              if (options.querySelector(".is-correct")) return;
              this.answered++;
              const ok = option === question.answer;
              if (ok) this.right++;
              button.classList.add(ok ? "is-correct" : "is-wrong");
              button.disabled = true;
              if (ok) {
                for (const other of options.querySelectorAll("button")) other.disabled = true;
                feedback.textContent = "✅ Yes.";
                feedback.className = "quiz-feedback is-correct";
                this.speech.speak(question.answer);
              } else {
                feedback.textContent = "❌ Not that one — try again.";
                feedback.className = "quiz-feedback is-wrong";
              }
              refresh();
            });
            return button;
          }),
        );
        const prompt = el("div", { class: "quiz-prompt" });
        prompt.innerHTML = `${i + 1}. ${question.prompt}`;
        return el("div", { class: "check-block" }, [prompt, options, feedback]);
      }),
      score,
      el("div", { class: "lesson-actions" }, [again]),
    );
    refresh();
  }
}
