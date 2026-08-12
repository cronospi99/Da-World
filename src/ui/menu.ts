import { MISSION_GROUPS, MISSIONS, type Mission } from "../game/missions";
import { MODE_LIST, lastMode, type GameMode, type GameModeId } from "../game/modes";
import { QUALITY, type QualityName } from "../core/quality";
import type { GameState } from "../game/state";
import { el } from "./dom";

/**
 * The front door.
 *
 * Everything a class has to agree on before anybody walks anywhere: which mode
 * they are playing, what that mode teaches, what the missions in it are, and
 * how hard the machine is allowed to work. It is one screen rather than a
 * chain of them, because it is read by a teacher in front of a room, standing
 * up, once, and a settings page you have to hunt through is a settings page
 * that gets left on whatever it was.
 *
 * The mission list is collapsed by default and grouped the way a syllabus is —
 * exploring, vocabulary, grammar, directions. Fifteen goals in a flat list is
 * a wall of text nobody reads; four headings you can open is a lesson plan.
 */

export interface MenuHandlers {
  onStart(mode: GameMode): void;
  onQuality(name: QualityName): void;
  onTeacher(): void;
}

export class Menu {
  private readonly root: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly modeCards = new Map<GameModeId, HTMLElement>();
  private selected: GameMode;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    quality: QualityName,
    private readonly handlers: MenuHandlers,
  ) {
    const remembered = lastMode();
    this.selected = MODE_LIST.find((m) => m.id === remembered) ?? MODE_LIST[0];

    const modes = el("div", { class: "mode-grid" }, MODE_LIST.map((mode) => this.modeCard(mode)));

    const start = el("button", { class: "pill-button menu-start", type: "button" });
    start.addEventListener("click", () => this.handlers.onStart(this.selected));

    const teacher = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "👩‍🏫 Teacher",
    });
    teacher.addEventListener("click", () => this.handlers.onTeacher());

    this.root = el("div", { class: "menu-screen" }, [
      el("div", { class: "menu-panel" }, [
        el("header", { class: "menu-head" }, [
          el("h1", { class: "menu-title", text: "Da World" }),
          el("p", {
            class: "menu-sub",
            text: "A whole city, on foot. The people on the pavement need your help — walk up to a ❓ and give them the English they are asking for.",
          }),
        ]),
        el("h2", { class: "menu-section", text: "Choose a mode" }),
        modes,
        this.missionBook(),
        el("h2", { class: "menu-section", text: "Graphics" }),
        this.qualityRow(quality),
        el("div", { class: "menu-actions" }, [start, teacher]),
      ]),
    ]);

    this.startButton = start;
    parent.append(this.root);
    this.select(this.selected);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("is-gone");
  }

  hide(): void {
    this.root.classList.add("is-gone");
  }

  show(): void {
    this.root.classList.remove("is-gone");
    this.refreshStart();
  }

  private refreshStart(): void {
    this.startButton.textContent = `${this.selected.icon}  Play ${this.selected.name}`;
  }

  private select(mode: GameMode): void {
    this.selected = mode;
    for (const [id, card] of this.modeCards) {
      card.classList.toggle("is-chosen", id === mode.id);
      card.setAttribute("aria-pressed", id === mode.id ? "true" : "false");
    }
    this.refreshStart();
  }

  private modeCard(mode: GameMode): HTMLElement {
    const card = el("button", { class: "mode-card", type: "button", "aria-pressed": "false" }, [
      el("div", { class: "mode-icon", text: mode.icon }),
      el("div", { class: "mode-name", text: mode.name }),
      el("div", { class: "mode-blurb", text: mode.blurb }),
      el(
        "ul",
        { class: "mode-covers" },
        mode.covers.map((line) => el("li", { text: line })),
      ),
      mode.networked
        ? el("div", { class: "mode-note", text: "One browser hosts it. Everybody else scans the code." })
        : null,
    ]);
    card.addEventListener("click", () => this.select(mode));
    this.modeCards.set(mode.id, card);
    return card;
  }

  /**
   * The missions, grouped and collapsed.
   *
   * Every mission in the game is listed, not only the chosen mode's: a teacher
   * picking a mode wants to see what the other one would have covered.
   */
  private missionBook(): HTMLElement {
    const groups = MISSION_GROUPS.map((group): HTMLElement | null => {
      const items = MISSIONS.filter((m) => m.group === group.id);
      if (!items.length) return null;

      const list = el(
        "ul",
        { class: "mission-list" },
        items.map((mission) => this.missionRow(mission)),
      );
      const body = el("div", { class: "book-body" }, [list]);

      const done = items.filter((m) => this.state.missionsDone.has(m.id)).length;
      const toggle = el("button", { class: "book-toggle", type: "button", "aria-expanded": "false" }, [
        el("span", { class: "book-caret", text: "▸" }),
        el("span", { class: "book-icon", text: group.icon }),
        el("span", { class: "book-label", text: group.label }),
        el("span", { class: "book-count", text: `${done}/${items.length}` }),
      ]);

      const section = el("section", { class: "book-group" }, [toggle, body]);
      toggle.addEventListener("click", () => {
        const open = section.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.querySelector(".book-caret")!.textContent = open ? "▾" : "▸";
      });
      return section;
    }).filter((node): node is HTMLElement => node !== null);

    return el("div", { class: "mission-book" }, [
      el("h2", { class: "menu-section", text: "Missions" }),
      ...groups,
    ]);
  }

  private missionRow(mission: Mission): HTMLElement {
    const done = this.state.missionsDone.has(mission.id);
    const progress = Math.min(mission.get(this.state), mission.goal);
    return el("li", { class: done ? "mission is-done" : "mission" }, [
      el("span", { class: "mission-icon", text: done ? "✅" : mission.icon }),
      el("span", { class: "mission-label", text: mission.label }),
      el("span", { class: "mission-count", text: `${progress}/${mission.goal}` }),
    ]);
  }

  private qualityRow(current: QualityName): HTMLElement {
    const buttons = (Object.keys(QUALITY) as QualityName[]).map((name) => {
      const button = el("button", {
        class: name === current ? "chip-button is-chosen" : "chip-button",
        type: "button",
        text: QUALITY[name].label,
      });
      button.addEventListener("click", () => {
        for (const other of row.querySelectorAll(".chip-button")) {
          other.classList.remove("is-chosen");
        }
        button.classList.add("is-chosen");
        this.handlers.onQuality(name);
      });
      return button;
    });
    const row = el("div", { class: "chip-row" }, buttons);
    return row;
  }
}
