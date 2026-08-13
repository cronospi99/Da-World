import { MISSION_GROUPS, MISSIONS, type Mission } from "../game/missions";
import { MODE_LIST, type GameMode } from "../game/modes";
import { GRAMMAR_TAG_LABEL } from "../game/grammar";
import type { GameState, SkillTag } from "../game/state";
import { closeButton, el } from "./dom";

/**
 * The teacher's panel.
 *
 * One screen with the three things somebody running a lesson actually needs:
 * set the mission the room is working towards, see how the class is doing on
 * each language point, and take the numbers away as a spreadsheet.
 *
 * ## About the lock
 *
 * The panel is behind a passphrase, and it is important to be honest about
 * what that passphrase is: it is a **classroom lock, not security**. Da World
 * is a static site — everything it knows is in the browser, including the
 * passphrase, and a determined thirteen-year-old with the developer tools open
 * will find it in under a minute. What it does buy is the thing it is actually
 * for: a student who taps 👩‍🏫 out of curiosity gets a prompt instead of the
 * controls, and the panel cannot be opened by accident on a projector.
 *
 * Real authentication needs a server to authenticate against. When the class
 * server in `server/` is running, that is where it belongs, and the teacher
 * session it hands out is what should gate this panel; the passphrase here is
 * the offline fallback for the single-machine case.
 */

/** Overridable at build time, so a school can set its own. */
const PASSPHRASE = (import.meta.env.VITE_TEACHER_PASSPHRASE as string) || "teacher";

const UNLOCKED_KEY = "da-world:teacher-unlocked";

export interface TeacherHandlers {
  /** Focus the class on one mission. Null clears it. */
  onSetGoal(mission: Mission | null): void;
  onSwitchMode(mode: GameMode): void;
  onPause(paused: boolean): void;
}

export class TeacherPanel {
  private readonly root: HTMLElement;
  private readonly lock: HTMLElement;
  private readonly body: HTMLElement;
  private readonly report: HTMLElement;
  private readonly goalList: HTMLElement;
  private unlocked = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly handlers: TeacherHandlers,
  ) {
    this.unlocked = sessionUnlocked();

    const input = el("input", {
      class: "teacher-input",
      type: "password",
      placeholder: "Passphrase",
      "aria-label": "Teacher passphrase",
    }) as HTMLInputElement;
    const error = el("p", { class: "teacher-error" });
    const submit = el("button", { class: "pill-button", type: "button", text: "Unlock" });

    const tryUnlock = (): void => {
      if (input.value === PASSPHRASE) {
        this.unlocked = true;
        rememberUnlocked();
        error.textContent = "";
        input.value = "";
        this.refresh();
      } else {
        error.textContent = "That is not the passphrase.";
        input.select();
      }
    };
    submit.addEventListener("click", tryUnlock);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") tryUnlock();
    });

    this.lock = el("div", { class: "teacher-lock" }, [
      el("p", {
        class: "info-lead",
        text: "The teacher panel sets what the class is working on and shows how they are doing.",
      }),
      el("div", { class: "teacher-row" }, [input, submit]),
      error,
      el("p", {
        class: "info-note",
        text: "This lock keeps a curious student out of the controls. It is not security: everything a static site knows lives in the browser. Run the class server if you need real accounts.",
      }),
    ]);

    this.goalList = el("div", { class: "teacher-goals" });
    this.report = el("div", { class: "teacher-report" });
    this.body = el("div", { class: "teacher-body" }, [
      el("h3", { class: "teacher-head", text: "Mode" }),
      el(
        "div",
        { class: "chip-row" },
        MODE_LIST.filter((m) => !m.networked).map((mode) => {
          const button = el("button", {
            class: "chip-button",
            type: "button",
            text: `${mode.icon} ${mode.name}`,
          });
          button.addEventListener("click", () => this.handlers.onSwitchMode(mode));
          return button;
        }),
      ),
      el("h3", { class: "teacher-head", text: "Set the mission" }),
      el("p", {
        class: "info-note",
        text: "The chosen mission is the one every student sees at the top of their screen, whatever else they have finished.",
      }),
      this.goalList,
      el("h3", { class: "teacher-head", text: "How the class is doing" }),
      this.report,
      el("div", { class: "lesson-actions" }, [this.exportButton()]),
    ]);

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "👩‍🏫 Teacher" }),
          this.lock,
          this.body,
        ]),
        closeButton(() => this.toggle(false), "Close"),
      ]),
    ]);
    this.root.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggle(false));
    parent.append(this.root);
    this.refresh();
  }

  get isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  /**
   * Open the panel without the passphrase.
   *
   * Called when this browser is hosting a world. It is not a hole in the lock:
   * the room exists only while this tab does, so whoever opened it is standing
   * at the machine, which is everything the passphrase was ever checking.
   * Deliberately not remembered — close the tab and the room and the panel go
   * together.
   */
  unlock(): void {
    this.unlocked = true;
    this.refresh();
  }

  toggle(open: boolean): void {
    if (open) this.refresh();
    this.root.classList.toggle("is-open", open);
    this.root.setAttribute("aria-hidden", open ? "false" : "true");
    this.handlers.onPause(open);
  }

  private refresh(): void {
    this.lock.style.display = this.unlocked ? "none" : "block";
    this.body.style.display = this.unlocked ? "block" : "none";
    if (!this.unlocked) return;
    this.renderGoals();
    this.renderReport();
  }

  /** Every mission, grouped, as a row of one-tap goals. */
  private renderGoals(): void {
    const sections = MISSION_GROUPS.map((group): HTMLElement | null => {
      const items = MISSIONS.filter((m) => m.group === group.id);
      if (!items.length) return null;
      return el("div", { class: "teacher-goal-group" }, [
        el("h4", { class: "teacher-goal-head", text: `${group.icon} ${group.label}` }),
        el(
          "div",
          { class: "chip-row" },
          items.map((mission) => {
            const chosen = this.state.focusMissionId === mission.id;
            const button = el("button", {
              class: chosen ? "chip-button is-chosen" : "chip-button",
              type: "button",
              text: `${mission.icon} ${mission.label}`,
            });
            button.addEventListener("click", () => {
              const next = chosen ? null : mission;
              this.handlers.onSetGoal(next);
              this.renderGoals();
            });
            return button;
          }),
        ),
      ]);
    }).filter((node): node is HTMLElement => node !== null);

    this.goalList.replaceChildren(...sections);
  }

  /** First-try accuracy per language point — the number a teacher marks from. */
  private rows(): { tag: SkillTag; label: string; asked: number; correct: number; firstTry: number }[] {
    const labels: Record<string, string> = {
      ...GRAMMAR_TAG_LABEL,
      directions: "giving directions",
      prepositions: "prepositions of place",
    };
    return Object.entries(this.state.skills).map(([tag, stat]) => ({
      tag: tag as SkillTag,
      label: labels[tag] ?? tag,
      asked: stat.asked,
      correct: stat.correct,
      firstTry: stat.firstTry,
    }));
  }

  private renderReport(): void {
    const rows = this.rows();
    if (!rows.length) {
      this.report.replaceChildren(
        el("p", { class: "info-note", text: "Nothing answered yet." }),
      );
      return;
    }
    this.report.replaceChildren(
      el("table", { class: "teacher-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Language point" }),
            el("th", { text: "Asked" }),
            el("th", { text: "Right" }),
            el("th", { text: "First try" }),
          ]),
        ]),
        el(
          "tbody",
          {},
          rows.map((row) =>
            el("tr", {}, [
              el("td", { text: row.label }),
              el("td", { text: String(row.asked) }),
              el("td", { text: String(row.correct) }),
              el("td", {
                text: row.asked ? `${Math.round((row.firstTry / row.asked) * 100)}%` : "—",
              }),
            ]),
          ),
        ),
      ]),
    );
  }

  private exportButton(): HTMLButtonElement {
    const button = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "⬇ Export as CSV",
    });
    button.addEventListener("click", () => {
      const lines = [
        "language point,asked,correct,first try,hints",
        ...this.rows().map((row) => {
          const stat = this.state.skills[row.tag];
          return `"${row.label}",${row.asked},${row.correct},${row.firstTry},${stat?.hints ?? 0}`;
        }),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = el("a", { href: url, download: "da-world-progress.csv" });
      link.click();
      URL.revokeObjectURL(url);
    });
    return button;
  }
}

function sessionUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberUnlocked(): void {
  try {
    // Session storage, not local: closing the tab locks the panel again, which
    // is what you want on a shared classroom machine.
    sessionStorage.setItem(UNLOCKED_KEY, "1");
  } catch {
    /* the panel simply asks again next time. */
  }
}
