import { MISSION_GROUPS, type Mission } from "../game/missions";
import type { GameMode } from "../game/modes";
import type { Npc } from "../game/quests";
import { TOTAL_PLACES, XP_PER_LEVEL, type GameState } from "../game/state";
import type { Speech } from "../learn/speech";
import { closeButton, el } from "./dom";

/**
 * On-screen furniture for a city you walk around with a job to do.
 *
 * Five things, and nothing else: where you are, what time it is, what you are
 * meant to be doing next, how far along you are, and what the button under
 * your finger would do. The one thing that is deliberately *not* here is the
 * name of the place you happen to be standing in front of — the shops have
 * their names painted on them, and a card that jumps up every time you walk
 * past a door turns a walk down a street into a clicking exercise.
 */

interface HudOptions {
  onReset: () => void;
  onPause: (paused: boolean) => void;
  /** Reopen the class panel — the code, the QR and who is in. */
  onRoom: () => void;
  /** Open the character customiser from inside the game. */
  onCharacter: () => void;
  /** Open the class leaderboard. */
  onLeaderboard: () => void;
}

export class CityHud {
  private readonly streetName: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly missionLine: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barLabel: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly info: HTMLElement;
  private readonly missionPanel: HTMLElement;
  private readonly missionList: HTMLElement;
  private missionLead!: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly roomButton: HTMLButtonElement;
  private readonly boardButton: HTMLButtonElement;

  private toastTimer = 0;

  /** Which section of the mission panel is open, so it survives a refresh. */
  private readonly openGroups = new Set<string>();
  private mode: GameMode | null = null;

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly state: GameState,
    /** The missions of the mode being played — the mode can change. */
    private readonly missions: () => Mission[],
    private readonly options: HudOptions,
  ) {
    this.streetName = el("h1", { class: "hud-place-name", text: "…" });
    this.clock = el("div", { class: "hud-place-sub", text: "" });
    this.missionLine = el("div", { class: "hud-mission" });
    this.barFill = el("div", { class: "hud-bar-fill" });
    this.barLabel = el("div", { class: "hud-bar-label" });

    const corner = el("div", { class: "hud-corner hud-top-left" }, [
      this.streetName,
      this.clock,
      this.missionLine,
      el("div", { class: "hud-bar" }, [this.barFill]),
      this.barLabel,
    ]);

    this.soundButton = el("button", {
      class: "tile-button",
      type: "button",
      "aria-label": "Toggle pronunciation audio",
      text: "🔊",
    });
    this.soundButton.addEventListener("click", () => {
      const muted = this.speech.toggleMute();
      this.soundButton.textContent = muted ? "🔇" : "🔊";
    });

    const missionButton = el("button", {
      class: "tile-button",
      type: "button",
      "aria-label": "Missions",
      text: "🎯",
    });
    missionButton.addEventListener("click", () => this.toggleMissions(true));

    const infoButton = el("button", {
      class: "tile-button",
      type: "button",
      "aria-label": "How to play",
      text: "?",
    });
    infoButton.addEventListener("click", () => this.toggleInfo(true));

    // Hidden until there is a room to show. A host walks off to help somebody
    // and needs the code back on screen; a student wants to know who is in.
    this.roomButton = el("button", {
      class: "tile-button is-gone",
      type: "button",
      "aria-label": "The class",
      text: "👥",
    });
    this.roomButton.addEventListener("click", () => this.options.onRoom());

    // Everybody in a room gets the board; only whoever is holding the room
    // open gets the code button beside it.
    this.boardButton = el("button", {
      class: "tile-button is-gone",
      type: "button",
      "aria-label": "The class leaderboard",
      text: "🏆",
    });
    this.boardButton.addEventListener("click", () => this.options.onLeaderboard());

    const buttons = el("nav", { class: "hud-corner hud-top-right" }, [
      this.boardButton,
      this.roomButton,
      this.soundButton,
      missionButton,
      infoButton,
    ]);

    this.hint = el("div", { class: "hud-hint" });
    this.toast = el("div", { class: "hud-toast" });

    this.missionList = el("ul", { class: "mission-list" });
    this.missionPanel = this.buildMissions();
    this.info = this.buildInfo();

    parent.append(corner, buttons, this.hint, this.toast, this.missionPanel, this.info);
    this.refresh();
  }

  get isInfoOpen(): boolean {
    return this.info.classList.contains("is-open");
  }

  get isMissionsOpen(): boolean {
    return this.missionPanel.classList.contains("is-open");
  }

  get isBlocking(): boolean {
    return this.isInfoOpen || this.isMissionsOpen;
  }

  /**
   * The room this city is part of, or null when it is only yours.
   *
   * The label is the room's code and how full it is, which is the one thing a
   * host is asked over and over while a class files in.
   */
  setRoom(label: string | null): void {
    this.roomButton.classList.toggle("is-gone", label === null);
    this.roomButton.setAttribute("aria-label", label ? `The class — ${label}` : "The class");
    this.roomButton.title = label ?? "";
  }

  /** Show the leaderboard button, which only means anything in a room. */
  setLeaderboard(visible: boolean): void {
    this.boardButton.classList.toggle("is-gone", !visible);
  }

  /** The mode being played, shown on the mission panel. */
  setMode(mode: GameMode): void {
    this.mode = mode;
    this.refresh();
  }

  setStreet(name: string): void {
    if (this.streetName.textContent !== name) this.streetName.textContent = name;
  }

  setClock(text: string): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  /** The prompt at the bottom of the screen: who you could talk to, and how. */
  setTalkHint(npc: Npc | null): void {
    const text = npc ? `${npc.face}  Press E — talk to ${npc.name}, ${npc.role.toLowerCase()}` : "";
    if (this.hint.textContent !== text) this.hint.textContent = text;
    this.hint.classList.toggle("is-visible", !!npc);
  }

  showToast(emoji: string, title: string, sub: string): void {
    this.toast.replaceChildren(
      el("strong", { text: `${emoji}  ${title}` }),
      el("span", { text: sub }),
    );
    this.toast.classList.add("is-visible");
    this.toastTimer = 3.6;
  }

  /** Take the toast off the screen at once, so a card never opens on top of it. */
  clearToast(): void {
    this.toast.classList.remove("is-visible");
    this.toastTimer = 0;
  }

  toggleInfo(open: boolean): void {
    this.setOverlay(this.info, open);
  }

  toggleMissions(open: boolean): void {
    if (open) {
      const mine = this.missions();
      const done = mine.filter((m) => this.state.missionsDone.has(m.id)).length;
      this.missionLead.textContent = this.mode
        ? `${this.mode.icon} ${this.mode.name} — ${done} of ${mine.length} done. Every correct answer is XP, and XP is the only thing that raises your level.`
        : "";
      this.renderMissions();
    }
    this.setOverlay(this.missionPanel, open);
  }

  /** Shut whichever panel is on top. Returns false if there was nothing to shut. */
  closeTop(): boolean {
    if (this.isMissionsOpen) {
      this.toggleMissions(false);
      return true;
    }
    if (this.isInfoOpen) {
      this.toggleInfo(false);
      return true;
    }
    return false;
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove("is-visible");
    }
  }

  /** Re-read the game state. Cheap enough to call whenever it changes. */
  refresh(): void {
    const state = this.state;
    // A mission set by the teacher wins over the player's own progress: the
    // point of it is that the whole room is reading the same line.
    const next =
      (state.focusMissionId
        ? this.missions().find((m) => m.id === state.focusMissionId)
        : null) ?? this.missions().find((m) => !state.missionsDone.has(m.id));
    this.missionLine.textContent = next
      ? `${next.icon}  ${next.label}  (${Math.min(next.get(state), next.goal)}/${next.goal})`
      : "🏆  Every mission complete!";

    const intoLevel = (state.score % XP_PER_LEVEL) / XP_PER_LEVEL;
    this.barFill.style.transform = `scaleX(${intoLevel})`;
    this.barLabel.textContent = `Level ${state.level}  ·  ${state.score} XP  ·  ${state.helped.size} citizens helped  ·  ${state.found.size}/${TOTAL_PLACES} places`;
    if (this.isMissionsOpen) this.renderMissions();
  }

  private setOverlay(node: HTMLElement, open: boolean): void {
    node.classList.toggle("is-open", open);
    node.setAttribute("aria-hidden", open ? "false" : "true");
    this.options.onPause(this.isBlocking);
  }

  /**
   * The mission panel, grouped and collapsible.
   *
   * Fifteen goals in a flat list is a wall of text; four headings you can open
   * is a lesson plan. Only the groups this mode is played for are shown — a
   * directions lesson has not failed to master "some / any".
   */
  private renderMissions(): void {
    const state = this.state;
    const mine = this.missions();

    const sections = MISSION_GROUPS.map((group) => {
      const items = mine.filter((m) => m.group === group.id);
      if (!items.length) return null;

      const done = items.filter((m) => state.missionsDone.has(m.id)).length;
      const open = this.openGroups.has(group.id);

      const toggle = el(
        "button",
        { class: "book-toggle", type: "button", "aria-expanded": open ? "true" : "false" },
        [
          el("span", { class: "book-caret", text: open ? "▾" : "▸" }),
          el("span", { class: "book-icon", text: group.icon }),
          el("span", { class: "book-label", text: group.label }),
          el("span", { class: "book-count", text: `${done}/${items.length}` }),
        ],
      );

      const list = el(
        "ul",
        { class: "mission-list" },
        items.map((mission) => {
          const isDone = state.missionsDone.has(mission.id);
          const progress = Math.min(mission.get(state), mission.goal);
          return el("li", { class: isDone ? "mission is-done" : "mission" }, [
            el("span", { class: "mission-icon", text: isDone ? "✅" : mission.icon }),
            el("span", { class: "mission-label", text: mission.label }),
            el("span", { class: "mission-count", text: `${progress}/${mission.goal}` }),
          ]);
        }),
      );

      const section = el("section", { class: open ? "book-group is-open" : "book-group" }, [
        toggle,
        el("div", { class: "book-body" }, [list]),
      ]);
      toggle.addEventListener("click", () => {
        if (this.openGroups.has(group.id)) this.openGroups.delete(group.id);
        else this.openGroups.add(group.id);
        this.renderMissions();
      });
      return section;
    }).filter((node): node is HTMLElement => node !== null);

    this.missionList.replaceChildren(...sections);
  }

  private buildMissions(): HTMLElement {
    this.missionLead = el("p", { class: "info-lead" });
    const panel = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "Missions" }),
          this.missionLead,
          this.missionList,
        ]),
        closeButton(() => this.toggleMissions(false), "Close"),
      ]),
    ]);
    panel.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggleMissions(false));
    return panel;
  }

  private buildInfo(): HTMLElement {
    const reset = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "Start the city again",
    });
    reset.addEventListener("click", () => this.options.onReset());

    // The customiser lives on the main menu, which is gone once you are
    // walking — and "can I be the robot instead?" is a question that arrives
    // about ninety seconds into a lesson, not before it.
    const character = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "🧍 Your character",
    });
    character.addEventListener("click", () => {
      this.toggleInfo(false);
      this.options.onCharacter();
    });

    const info = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "Da World" }),
          el("p", {
            class: "info-lead",
            text: "A whole city, on foot. The people on the pavement are lost, looking for somewhere, or practising their English — walk up to a ❓ and help them.",
          }),
          el("ul", { class: "info-list" }, [
            el("li", { text: "Move — WASD / arrow keys, or the left half of a touch screen." }),
            el("li", { text: "Sprint — hold Shift. A walk is a walk; Shift is for a hurry." }),
            el("li", { text: "Jump — space, or a quick tap on the right half." }),
            el("li", {
              text: "Look — click once to take the mouse, then move it. Esc gives it back.",
            }),
            el("li", { text: "Zoom — scroll, or pinch." }),
            el("li", { text: "Talk to somebody — walk up to them and press E." }),
            el("li", { text: "Re-centre the camera — press R." }),
          ]),
          el("p", {
            class: "info-note",
            text: "Stay on the pavement and cross at the crossings — that is the whole point of the directions people give you. A wrong answer costs nothing: the option locks and you try again. Cars stop at red lights and the sun really does go down. Pronunciation uses your device voice; your progress is saved in this browser.",
          }),
          el("div", { class: "lesson-actions" }, [character, reset]),
        ]),
        closeButton(() => this.toggleInfo(false), "Close"),
      ]),
    ]);
    info.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggleInfo(false));
    return info;
  }
}
