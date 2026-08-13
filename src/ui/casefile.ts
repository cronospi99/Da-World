import {
  CLUES_TO_ACCUSE,
  SUSPECTS,
  factLine,
  matches,
  type Accusation,
  type Detective,
  type Suspect,
} from "../game/detective";
import { closeButton, el } from "./dom";

/**
 * The case file — everything you know, and the one button that ends the case.
 *
 * It is a notebook rather than a quiz screen, and the difference matters: it
 * never asks anything. The English happens out on the pavement, and this is
 * where a student comes to see whether it got them anywhere. Two things are on
 * it and nothing else — the sentences you have earned, and eighteen faces with
 * the ruled-out ones struck through.
 *
 * The crossing-out is the whole design. A student who answers *"she is never
 * late for Sunday dinner"* and then watches four faces grey out has just been
 * told, in the only language the game has, that the adverb they chose meant
 * something. That is a much better argument for caring about `never` than a
 * tick, and it is why the grid is the biggest thing on the page.
 *
 * Naming somebody is deliberately gated on `CLUES_TO_ACCUSE` facts. Eighteen
 * faces and a free guess is a one-in-eighteen lottery that a bored student
 * will play eighteen times, and every one of those guesses is a question not
 * answered.
 */

export interface CaseHandlers {
  /** Name somebody. The engine decides, and the panel reports. */
  onAccuse(suspect: Suspect): Accusation;
  /** Close this case and open a fresh one. */
  onNewCase(): void;
  onClose(): void;
}

export class CaseFile {
  private readonly root: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly clueList: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly verdict: HTMLElement;
  private readonly accuseButton: HTMLButtonElement;
  private readonly newCaseButton: HTMLButtonElement;

  private detective: Detective | null = null;
  private picked: Suspect | null = null;

  constructor(parent: HTMLElement, private readonly handlers: CaseHandlers) {
    this.lead = el("p", { class: "info-lead" });
    this.clueList = el("ul", { class: "clue-list" });
    this.grid = el("div", { class: "suspect-grid" });
    this.verdict = el("div", { class: "case-verdict" });

    this.accuseButton = el("button", {
      class: "pill-button",
      type: "button",
      text: "Name them",
    }) as HTMLButtonElement;
    this.accuseButton.addEventListener("click", () => this.accuse());

    this.newCaseButton = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "🔎 New case",
    }) as HTMLButtonElement;
    this.newCaseButton.addEventListener("click", () => {
      this.handlers.onNewCase();
    });

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card case-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "📓 Case file" }),
          this.lead,
          el("h3", { class: "case-heading", text: "What we know" }),
          this.clueList,
          el("h3", { class: "case-heading", text: "The family" }),
          this.grid,
          this.verdict,
          el("div", { class: "lesson-actions" }, [this.accuseButton, this.newCaseButton]),
        ]),
        closeButton(() => this.toggle(false), "Close"),
      ]),
    ]);
    this.root.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggle(false));
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  /** Point the file at a case — a new one, or the same one after a clue. */
  setCase(detective: Detective | null): void {
    if (detective !== this.detective) {
      this.picked = null;
      this.verdict.replaceChildren();
      this.verdict.className = "case-verdict";
    }
    this.detective = detective;
    if (this.isOpen) this.render();
  }

  toggle(open: boolean): void {
    if (open) this.render();
    this.root.classList.toggle("is-open", open);
    this.root.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) this.handlers.onClose();
  }

  private render(): void {
    const detective = this.detective;
    if (!detective) {
      this.lead.textContent = "No case is open. Start Family Detective from the menu.";
      this.clueList.replaceChildren();
      this.grid.replaceChildren();
      this.accuseButton.hidden = true;
      this.newCaseButton.hidden = true;
      return;
    }

    const left = detective.remaining;
    const found = detective.cluesFound;

    this.lead.innerHTML = detective.solved
      ? `✅ Case closed. It was <b>${detective.secret.name}</b>, my ${detective.secret.relation.toLowerCase()}.`
      : `Someone in the family is behind it. Talk to people in the city — every question you get right is a clue. ` +
        `<b>${found}</b> ${found === 1 ? "clue" : "clues"} so far, <b>${left.length}</b> of ${SUSPECTS.length} still in the frame.`;

    this.clueList.replaceChildren(
      ...detective.collected.map((fact) => {
        const item = el("li", { class: "clue" });
        item.innerHTML = factLine(fact, detective.secret.she);
        return item;
      }),
    );

    this.grid.replaceChildren(
      ...SUSPECTS.map((suspect) => {
        const out = !left.includes(suspect);
        const card = el(
          "button",
          {
            class: `suspect${out ? " is-out" : ""}${this.picked === suspect ? " is-picked" : ""}`,
            type: "button",
            "aria-pressed": this.picked === suspect ? "true" : "false",
          },
          [
            el("span", { class: "suspect-face", text: suspect.emoji }),
            el("span", { class: "suspect-name", text: suspect.name }),
            el("span", { class: "suspect-rel", text: suspect.relation }),
          ],
        );
        if (detective.solved && suspect === detective.secret) card.classList.add("is-guilty");
        card.addEventListener("click", () => {
          if (detective.solved) return;
          this.picked = this.picked === suspect ? null : suspect;
          this.render();
        });
        return card;
      }),
    );

    this.newCaseButton.hidden = !detective.solved;
    this.accuseButton.hidden = detective.solved;
    this.accuseButton.disabled = !detective.canAccuse || !this.picked;
    this.accuseButton.textContent = !detective.canAccuse
      ? `🔒 ${CLUES_TO_ACCUSE - found} more ${CLUES_TO_ACCUSE - found === 1 ? "clue" : "clues"} first`
      : this.picked
        ? `🗣️ It's ${this.picked.name}!`
        : "Choose a suspect";
  }

  private accuse(): void {
    const detective = this.detective;
    const suspect = this.picked;
    if (!detective || !suspect || !detective.canAccuse) return;

    const result = this.handlers.onAccuse(suspect);
    this.picked = null;
    this.showVerdict(detective, result);
    this.render();
  }

  /**
   * Why a wrong name was wrong.
   *
   * There are two ways to be wrong and they deserve different answers. If a
   * fact in the file already rules the person out, say *which* — that is a
   * student who has the evidence and has not read it, and pointing at the line
   * teaches more than "no" does. If nothing rules them out, the file genuinely
   * cannot tell them apart yet, and the honest answer is to go and find
   * another clue.
   */
  private showVerdict(detective: Detective, result: Accusation): void {
    if (result.right) {
      this.verdict.className = "case-verdict is-right";
      this.verdict.innerHTML =
        `🎉 <b>${result.suspect.name}</b> it is — my ${result.suspect.relation.toLowerCase()}. ` +
        `Closed on ${detective.cluesFound} clues.`;
      return;
    }

    const contradiction = detective.collected.find((fact) => !matches(result.suspect, fact));
    this.verdict.className = "case-verdict is-wrong";
    this.verdict.innerHTML = contradiction
      ? `❌ Not ${result.suspect.name} — look at your own file: ${factLine(contradiction, detective.secret.she)}`
      : `❌ Not ${result.suspect.name}. Nothing in the file rules them out yet either — go and find another clue before you name anybody else.`;
  }
}
