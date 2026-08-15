import { closeButton, el } from "./dom";

/**
 * "Are you sure?", for the two or three things in this game you cannot undo.
 *
 * The game deliberately makes almost nothing cost anything — a wrong answer
 * locks an option and you try again, a wrong accusation just says no. Wiping
 * your missions is the exception: it is the one button that throws away an
 * afternoon, it lives on the HUD next to buttons that open panels, and on a
 * phone it is about a centimetre from the one that opens the mission list.
 *
 * So it asks first. One card, one sentence, and the destructive button is the
 * one you have to reach for rather than the one under your thumb.
 */
export class Confirm {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly yes: HTMLButtonElement;

  private onYes: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.title = el("h2", { class: "info-title" });
    this.body = el("p", { class: "info-lead" });

    this.yes = el("button", { class: "pill-button", type: "button" }) as HTMLButtonElement;
    this.yes.addEventListener("click", () => {
      const run = this.onYes;
      this.toggle(false);
      run?.();
    });

    const no = el("button", { class: "pill-button ghost", type: "button", text: "Cancel" });
    no.addEventListener("click", () => this.toggle(false));

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card confirm-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          this.title,
          this.body,
          // Cancel first, so the finger that is already moving lands on the
          // harmless one.
          el("div", { class: "lesson-actions" }, [no, this.yes]),
        ]),
        closeButton(() => this.toggle(false), "Cancel"),
      ]),
    ]);
    this.root.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggle(false));
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  ask(title: string, body: string, confirmLabel: string, onYes: () => void): void {
    this.title.textContent = title;
    this.body.textContent = body;
    this.yes.textContent = confirmLabel;
    this.onYes = onYes;
    this.toggle(true);
  }

  toggle(open: boolean): void {
    this.root.classList.toggle("is-open", open);
    this.root.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      this.onYes = null;
      this.onClose();
    }
  }
}
