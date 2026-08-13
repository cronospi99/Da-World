import { MISSION_GROUPS, MISSIONS, type Mission } from "../game/missions";
import { MODE_LIST, lastMode, type GameMode, type GameModeId } from "../game/modes";
import { QUALITY, type QualityName } from "../core/quality";
import type { GameState } from "../game/state";
import { el } from "./dom";

/**
 * The front door.
 *
 * This used to be one long screen: the modes, then every mission in the game,
 * then the graphics settings, then Play at the bottom. Everything was there and
 * nothing was findable — a student opening the game was handed a settings page
 * and had to scroll past fifteen missions to start playing, and a teacher at
 * the front of a class had to scroll to find the thing they came for.
 *
 * So it is a menu now: a title, one button that starts the game, and a short
 * list of the five other places you might want to go. Each of those opens over
 * the same panel and comes back with Back, which means the first screen is
 * always four words and a button, and the depth is only there for the people
 * who went looking for it.
 *
 * The mission list is still grouped the way a syllabus is — exploring,
 * vocabulary, grammar, directions — because fifteen goals in a flat list is a
 * wall of text nobody reads and four headings you can open is a lesson plan.
 */

export interface MenuHandlers {
  onStart(mode: GameMode): void;
  onQuality(name: QualityName): void;
  onTeacher(): void;
  /** Open the character customiser. */
  onCharacter(): void;
}

type View = "home" | "modes" | "missions" | "graphics";

export class Menu {
  private readonly root: HTMLElement;
  private readonly views: Record<View, HTMLElement>;
  private readonly startButton: HTMLButtonElement;
  private readonly playButton: HTMLButtonElement;
  private readonly modeTile: HTMLElement;
  private readonly missionTile: HTMLElement;
  private readonly graphicsTile: HTMLElement;
  private readonly missionBook: HTMLElement;
  private readonly modeCards = new Map<GameModeId, HTMLElement>();
  private selected: GameMode;
  private quality: QualityName;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    quality: QualityName,
    private readonly handlers: MenuHandlers,
  ) {
    const remembered = lastMode();
    this.selected = MODE_LIST.find((m) => m.id === remembered) ?? MODE_LIST[0];
    this.quality = quality;

    /* --- home ------------------------------------------------------------ */

    this.playButton = el("button", {
      class: "pill-button menu-start",
      type: "button",
    }) as HTMLButtonElement;
    this.playButton.addEventListener("click", () => this.handlers.onStart(this.selected));

    this.modeTile = this.tile("🎮", "Choose a mode", "", () => this.show("modes"));
    const characterTile = this.tile(
      "🧍",
      "Your character",
      "Be a person or a robot, and pick their colours.",
      () => this.handlers.onCharacter(),
    );
    const together = MODE_LIST.find((m) => m.networked);
    const classTile = this.tile(
      "👥",
      "Play together",
      "Up to twelve in one city. One browser hosts; the rest scan its code.",
      () => together && this.handlers.onStart(together),
    );
    this.missionTile = this.tile("🎯", "Missions", "", () => this.show("missions"));
    this.graphicsTile = this.tile("⚙️", "Graphics", "", () => this.show("graphics"));
    const teacherTile = this.tile(
      "👩‍🏫",
      "Teacher",
      "Set the class a mission, see how they are doing, export it.",
      () => this.handlers.onTeacher(),
    );

    /* --- the other screens ------------------------------------------------ */

    const modes = el("div", { class: "mode-grid" }, MODE_LIST.map((mode) => this.modeCard(mode)));
    this.startButton = el("button", {
      class: "pill-button menu-start",
      type: "button",
    }) as HTMLButtonElement;
    this.startButton.addEventListener("click", () => this.handlers.onStart(this.selected));

    this.missionBook = el("div", { class: "mission-book" });

    this.views = {
      home: el("div", { class: "menu-view" }, [
        el("div", { class: "menu-actions" }, [this.playButton]),
        el("div", { class: "menu-tiles" }, [
          this.modeTile,
          characterTile,
          classTile,
          this.missionTile,
          this.graphicsTile,
          teacherTile,
        ]),
      ]),
      modes: el("div", { class: "menu-view is-hidden" }, [
        el("h2", { class: "menu-section", text: "Choose a mode" }),
        modes,
        el("div", { class: "menu-actions" }, [this.startButton, this.backButton()]),
      ]),
      missions: el("div", { class: "menu-view is-hidden" }, [
        el("h2", { class: "menu-section", text: "Missions" }),
        el("p", {
          class: "info-note",
          text: "Every mission in the game, whichever mode you play. Your progress is kept when you switch.",
        }),
        this.missionBook,
        el("div", { class: "menu-actions" }, [this.backButton()]),
      ]),
      graphics: el("div", { class: "menu-view is-hidden" }, [
        el("h2", { class: "menu-section", text: "Graphics" }),
        el("p", {
          class: "info-note",
          text: "Lower is smoother. A phone that gets warm or a city that stutters wants Low.",
        }),
        this.qualityRow(),
        el("div", { class: "menu-actions" }, [this.backButton()]),
      ]),
    };

    this.root = el("div", { class: "menu-screen" }, [
      el("div", { class: "menu-panel" }, [
        el("header", { class: "menu-head" }, [
          el("h1", { class: "menu-title", text: "Da World" }),
          el("p", {
            class: "menu-sub",
            text: "A whole city, on foot. The people on the pavement need your help — walk up to a ❓ and give them the English they are asking for.",
          }),
        ]),
        this.views.home,
        this.views.modes,
        this.views.missions,
        this.views.graphics,
      ]),
    ]);

    parent.append(this.root);
    this.select(this.selected);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("is-gone");
  }

  hide(): void {
    this.root.classList.add("is-gone");
  }

  show(view: View = "home"): void {
    this.root.classList.remove("is-gone");
    for (const [name, node] of Object.entries(this.views)) {
      node.classList.toggle("is-hidden", name !== view);
    }
    if (view === "missions") this.renderMissions();
    this.refresh();
  }

  /** Bring the panel back exactly as it was left. */
  private backButton(): HTMLButtonElement {
    const button = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "Back",
    }) as HTMLButtonElement;
    button.addEventListener("click", () => this.show("home"));
    return button;
  }

  private tile(
    icon: string,
    label: string,
    blurb: string,
    onClick: () => void,
  ): HTMLElement {
    const tile = el("button", { class: "menu-tile", type: "button" }, [
      el("span", { class: "tile-icon", text: icon }),
      el("span", { class: "tile-label", text: label }),
      el("span", { class: "tile-blurb", text: blurb }),
    ]);
    tile.addEventListener("click", onClick);
    return tile;
  }

  private setBlurb(tile: HTMLElement, text: string): void {
    const blurb = tile.querySelector(".tile-blurb");
    if (blurb) blurb.textContent = text;
  }

  /** The labels that depend on state, refreshed whenever the menu is shown. */
  private refresh(): void {
    const label = `${this.selected.icon}  Play ${this.selected.name}`;
    this.playButton.textContent = label;
    this.startButton.textContent = label;

    this.setBlurb(this.modeTile, `${this.selected.name} — ${this.selected.blurb}`);
    const done = MISSIONS.filter((m) => this.state.missionsDone.has(m.id)).length;
    this.setBlurb(this.missionTile, `${done} of ${MISSIONS.length} done.`);
    this.setBlurb(this.graphicsTile, QUALITY[this.quality].label);
  }

  private select(mode: GameMode): void {
    this.selected = mode;
    for (const [id, card] of this.modeCards) {
      card.classList.toggle("is-chosen", id === mode.id);
      card.setAttribute("aria-pressed", id === mode.id ? "true" : "false");
    }
    this.refresh();
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
  private renderMissions(): void {
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

    this.missionBook.replaceChildren(...groups);
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

  private qualityRow(): HTMLElement {
    const buttons = (Object.keys(QUALITY) as QualityName[]).map((name) => {
      const button = el("button", {
        class: name === this.quality ? "chip-button is-chosen" : "chip-button",
        type: "button",
        text: QUALITY[name].label,
      });
      button.addEventListener("click", () => {
        this.quality = name;
        for (const other of row.querySelectorAll(".chip-button")) {
          other.classList.remove("is-chosen");
        }
        button.classList.add("is-chosen");
        this.setBlurb(this.graphicsTile, QUALITY[name].label);
        this.handlers.onQuality(name);
      });
      return button;
    });
    const row = el("div", { class: "chip-row" }, buttons);
    return row;
  }
}
