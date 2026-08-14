import { MISSION_GROUPS, MISSIONS, type Mission } from "../game/missions";
import { MODE_LIST, lastMode, type GameMode, type GameModeId } from "../game/modes";
import { MAX_TARGET, NO_RACE, clampTarget, raceLabel } from "../game/race";
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
 * list of the other places you might want to go. Each of those opens over the
 * same panel and comes back with Back, which means the first screen is always
 * four words and a button, and the depth is only there for the people who went
 * looking for it.
 *
 * The mission list is still grouped the way a syllabus is — exploring,
 * vocabulary, grammar, directions, family — because twenty goals in a flat list
 * is a wall of text nobody reads and five headings you can open is a lesson
 * plan.
 *
 * 🏁 is the one tile that is not a settings page. The race used to be set from
 * the teacher panel, which is behind a passphrase and only reachable once
 * everybody is already walking around — the wrong moment for a rule you are
 * meant to announce before the whistle.
 */

export interface MenuHandlers {
  onStart(mode: GameMode): void;
  onQuality(name: QualityName): void;
  onTeacher(): void;
  /** Open the character customiser. */
  onCharacter(): void;
  /** How many missions win the match. 0 is no race. */
  onSetTarget(missions: number): void;
}

type View = "home" | "modes" | "missions" | "graphics" | "race";

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
  private readonly raceTile: HTMLElement;
  private readonly raceNumber: HTMLElement;
  private readonly raceCaption: HTMLElement;
  private readonly raceChips: HTMLElement;
  private selected: GameMode;
  private quality: QualityName;
  private target: number;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    quality: QualityName,
    target: number,
    private readonly handlers: MenuHandlers,
  ) {
    this.target = clampTarget(target);
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
    // Before the whistle, not halfway through the lesson: this is the one
    // setting a teacher wants to announce to a room before anybody moves.
    this.raceTile = this.tile("🏁", "Win the match", "", () => this.show("race"));
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

    this.raceNumber = el("div", { class: "race-number" });
    this.raceCaption = el("p", { class: "info-note race-caption" });
    this.raceChips = el("div", { class: "chip-row" });

    this.views = {
      home: el("div", { class: "menu-view" }, [
        el("div", { class: "menu-actions" }, [this.playButton]),
        el("div", { class: "menu-tiles" }, [
          this.modeTile,
          characterTile,
          classTile,
          this.raceTile,
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
      race: el("div", { class: "menu-view is-hidden" }, [
        el("h2", { class: "menu-section", text: "Win the match" }),
        el("p", {
          class: "info-note",
          text: "How many missions each student has to finish to win. The first one there ends the match for everybody — the screen fades out and the final table comes up. It works on one laptop as well as in a class of twelve.",
        }),
        el("div", { class: "race-setter" }, [
          this.stepButton("−", -1),
          this.raceNumber,
          this.stepButton("+", 1),
        ]),
        this.raceCaption,
        this.raceChips,
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
        this.views.race,
        this.views.graphics,
      ]),
    ]);

    parent.append(this.root);
    this.renderRace();
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
    if (view === "race") this.renderRace();
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

  /** One end of the − / + pair either side of the number. */
  private stepButton(glyph: string, delta: number): HTMLButtonElement {
    const button = el("button", {
      class: "race-step",
      type: "button",
      "aria-label": delta > 0 ? "One more mission" : "One fewer mission",
      text: glyph,
    }) as HTMLButtonElement;
    button.addEventListener("click", () => this.setTarget(this.target + delta));
    return button;
  }

  /**
   * Set the number, tell the game, and redraw.
   *
   * The stepper and the presets both come through here rather than each
   * writing the field, so there is one place where the number is clamped —
   * a race of minus one, or of thirty when the game has twenty missions, is a
   * match with no finish line.
   */
  private setTarget(next: number): void {
    const clamped = clampTarget(next);
    if (clamped === this.target) return;
    this.target = clamped;
    this.handlers.onSetTarget(clamped);
    this.renderRace();
  }

  /** Let the teacher panel's copy of the number win when it changes there. */
  setRaceTarget(target: number): void {
    this.target = clampTarget(target);
    this.renderRace();
  }

  private renderRace(): void {
    this.raceNumber.textContent = this.target > NO_RACE ? String(this.target) : "—";
    this.raceCaption.textContent = raceLabel(this.target);
    this.setBlurb(this.raceTile, raceLabel(this.target));

    // The stepper is for choosing a number; these are for the four a teacher
    // actually picks — a short lesson, a long one, a double period, and the
    // whole game — plus the way to turn the race off again.
    const presets: { label: string; value: number }[] = [
      { label: "No race", value: NO_RACE },
      { label: "3", value: 3 },
      { label: "5", value: 5 },
      { label: "8", value: 8 },
      { label: `All ${MAX_TARGET}`, value: MAX_TARGET },
    ];
    this.raceChips.replaceChildren(
      ...presets.map((preset) => {
        const chip = el("button", {
          class: preset.value === this.target ? "chip-button is-chosen" : "chip-button",
          type: "button",
          text: preset.label,
        });
        chip.addEventListener("click", () => this.setTarget(preset.value));
        return chip;
      }),
    );
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
    this.setBlurb(this.raceTile, raceLabel(this.target));
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
