import { SKILL_LABEL } from "../game/state";
import type { Npc } from "../game/quests";
import type { Speech } from "../learn/speech";
import { closeButton, el, speakerButton } from "./dom";

/**
 * The conversation card.
 *
 * Two rules shape this component, and they are both about keeping the player
 * out on the street rather than in a menu:
 *
 *  1. **A wrong answer never ends the turn.** The option locks, the
 *     explanation appears, and you try again. Failure has to be cheap, or
 *     nobody risks a guess.
 *  2. **The card can be put down.** "Walk and look" minimises it to a pill, so
 *     you can go and read the shop signs and come back to the *same* question.
 *     Walking the route is the game; the card is only where you report back.
 */

export interface DialogHandlers {
  onCorrect(npc: Npc, firstTry: boolean): void;
  onWrong(npc: Npc): void;
  onHint(npc: Npc): void;
  onMinimize(npc: Npc): void;
  onClose(): void;
}

/** Speech synthesis wants words, not markup. */
const plain = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

export class Dialog {
  current: Npc | null = null;
  open = false;
  minimized = false;

  private readonly overlay: HTMLElement;
  private readonly face: HTMLElement;
  private readonly name: HTMLElement;
  private readonly role: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly question: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly explain: HTMLElement;
  private readonly hintButton: HTMLButtonElement;
  private readonly walkButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly pill: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly handlers: DialogHandlers,
  ) {
    this.face = el("div", { class: "talk-face" });
    this.name = el("h2", { class: "talk-name" });
    this.role = el("div", { class: "talk-role" });
    this.tag = el("span", { class: "chip chip-level" });
    this.question = el("div", { class: "talk-question" });
    this.choices = el("div", { class: "quiz-options" });
    this.explain = el("div", { class: "quiz-feedback" });

    this.hintButton = el("button", { class: "pill-button ghost", type: "button", text: "💡 Hint" });
    this.hintButton.addEventListener("click", () => this.showHint());

    this.walkButton = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "🚶 Walk and look",
    });
    this.walkButton.addEventListener("click", () => this.minimize());

    this.nextButton = el("button", { class: "pill-button", type: "button", text: "Done" });
    this.nextButton.addEventListener("click", () => this.close());
    this.nextButton.hidden = true;

    const listen = speakerButton(() => {
      if (this.current) this.speech.speak(plain(this.current.quest.q));
    }, "Listen to the question");

    this.overlay = el("div", { class: "overlay talk-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("header", { class: "talk-head" }, [
            this.face,
            el("div", { class: "talk-who" }, [this.name, this.role]),
          ]),
          el("div", { class: "lesson-chips" }, [this.tag]),
          this.question,
          this.choices,
          this.explain,
          el("div", { class: "lesson-actions talk-actions" }, [
            listen,
            this.hintButton,
            this.walkButton,
            this.nextButton,
          ]),
        ]),
        closeButton(() => this.close(), "Close"),
      ]),
    ]);
    this.overlay.querySelector(".overlay-scrim")!.addEventListener("click", () => this.close());

    this.pill = el("button", { class: "resume-pill", type: "button" });
    this.pill.addEventListener("click", () => {
      if (this.current) this.show(this.current);
    });

    parent.append(this.overlay, this.pill);
  }

  show(npc: Npc): void {
    this.current = npc;
    this.open = true;
    this.minimized = false;
    this.overlay.classList.add("is-open");
    this.overlay.setAttribute("aria-hidden", "false");
    this.pill.classList.remove("is-visible");
    this.face.textContent = npc.face;
    this.name.textContent = npc.name;
    this.role.textContent = npc.role;
    this.tag.textContent = SKILL_LABEL[npc.quest.tag] ?? npc.quest.tag;
    this.render(npc);
  }

  /** Put the card down without losing the question. */
  minimize(): void {
    const npc = this.current;
    if (!npc) return;
    this.minimized = true;
    this.open = false;
    this.overlay.classList.remove("is-open");
    this.overlay.setAttribute("aria-hidden", "true");
    this.pill.textContent = `💬 Go back to ${npc.name}`;
    this.pill.classList.add("is-visible");
    this.handlers.onMinimize(npc);
  }

  close(): void {
    this.overlay.classList.remove("is-open");
    this.overlay.setAttribute("aria-hidden", "true");
    this.pill.classList.remove("is-visible");
    this.speech.stop();
    this.open = false;
    this.minimized = false;
    this.current = null;
    this.handlers.onClose();
  }

  private showHint(): void {
    const npc = this.current;
    if (!npc || (npc.done && !npc.practice)) return;
    npc.quest.hintUsed = true;
    this.explain.innerHTML = npc.quest.hint;
    this.explain.className = "quiz-feedback is-hint";
    this.handlers.onHint(npc);
  }

  private render(npc: Npc): void {
    const quest = npc.quest;
    this.explain.innerHTML = "";
    this.explain.className = "quiz-feedback";
    this.nextButton.hidden = true;

    // A grammar citizen never runs out of questions: once helped they switch to
    // practice mode and keep dealing, so they are still worth talking to.
    const finished = npc.done && !npc.practice;
    this.hintButton.hidden = finished;
    // Somewhere to go and something to check: a place quest sends you out to
    // read a shop sign, a clue sends you to the case file. Both are reasons to
    // put the card down without losing the question, and the button says which.
    this.walkButton.hidden = finished || (!quest.target && quest.kind !== "clue");
    this.walkButton.textContent = quest.target ? "🚶 Walk and look" : "📓 Check the case file";

    if (finished) {
      this.question.innerHTML = quest.target
        ? `✅ You already helped me — thank you! Now I know where <b>${quest.target.name}</b> is. ${quest.target.emoji}`
        : "✅ You already helped me — thank you! My English is better now. 💪";
      this.choices.replaceChildren();
      this.nextButton.hidden = false;
      return;
    }

    this.question.innerHTML = npc.done
      ? `🔁 <b>Practice round ${npc.round}</b> — let's keep going!<br>${quest.q}`
      : `<span class="talk-greet">${npc.greet}</span>${quest.q}`;
    this.speech.speak(plain(quest.q));

    this.choices.replaceChildren(
      ...quest.options.map((option) => {
        const button = el("button", { class: "quiz-option", type: "button", text: option });
        if (quest.locked?.includes(option)) {
          button.classList.add("is-wrong");
          button.disabled = true;
        }
        button.addEventListener("click", () => this.answer(npc, option, button));
        return button;
      }),
    );
  }

  private answer(npc: Npc, option: string, button: HTMLButtonElement): void {
    if (button.disabled) return;
    const quest = npc.quest;
    quest.attempts = (quest.attempts ?? 0) + 1;

    if (option === quest.correct) {
      for (const other of this.choices.querySelectorAll("button")) other.disabled = true;
      button.classList.add("is-correct");
      this.explain.innerHTML = quest.explain;
      this.explain.className = "quiz-feedback is-correct";
      this.handlers.onCorrect(npc, quest.attempts === 1 && !quest.hintUsed);
      this.nextButton.hidden = false;
      return;
    }

    button.classList.add("is-wrong");
    button.disabled = true;
    (quest.locked ??= []).push(option);
    this.explain.innerHTML = `${quest.explain}<br>💪 Don't give up — try again!`;
    this.explain.className = "quiz-feedback is-wrong";
    this.handlers.onWrong(npc);
  }
}
