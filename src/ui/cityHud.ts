import { MISSIONS } from "../game/missions";
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
  private readonly missions: HTMLElement;
  private readonly missionList: HTMLElement;
  private readonly soundButton: HTMLButtonElement;

  private toastTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly speech: Speech,
    private readonly state: GameState,
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

    const buttons = el("nav", { class: "hud-corner hud-top-right" }, [
      this.soundButton,
      missionButton,
      infoButton,
    ]);

    this.hint = el("div", { class: "hud-hint" });
    this.toast = el("div", { class: "hud-toast" });

    this.missionList = el("ul", { class: "mission-list" });
    this.missions = this.buildMissions();
    this.info = this.buildInfo();

    parent.append(corner, buttons, this.hint, this.toast, this.missions, this.info);
    this.refresh();
  }

  get isInfoOpen(): boolean {
    return this.info.classList.contains("is-open");
  }

  get isMissionsOpen(): boolean {
    return this.missions.classList.contains("is-open");
  }

  get isBlocking(): boolean {
    return this.isInfoOpen || this.isMissionsOpen;
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
    if (open) this.renderMissions();
    this.setOverlay(this.missions, open);
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
    const next = MISSIONS.find((m) => !state.missionsDone.has(m.id));
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

  private renderMissions(): void {
    const state = this.state;
    this.missionList.replaceChildren(
      ...MISSIONS.map((mission) => {
        const done = state.missionsDone.has(mission.id);
        const progress = Math.min(mission.get(state), mission.goal);
        return el("li", { class: done ? "mission is-done" : "mission" }, [
          el("span", { class: "mission-icon", text: done ? "✅" : mission.icon }),
          el("span", { class: "mission-label", text: mission.label }),
          el("span", { class: "mission-count", text: `${progress}/${mission.goal}` }),
        ]);
      }),
    );
  }

  private buildMissions(): HTMLElement {
    const done = MISSIONS.length;
    const panel = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "Missions" }),
          el("p", {
            class: "info-lead",
            text: `${done} things to do in this city. Talk to the citizens: every correct answer is XP, and XP is the only thing that raises your level.`,
          }),
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
            el("li", { text: "Sprint — hold Shift." }),
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
          el("div", { class: "lesson-actions" }, [reset]),
        ]),
        closeButton(() => this.toggleInfo(false), "Close"),
      ]),
    ]);
    info.querySelector(".overlay-scrim")!.addEventListener("click", () => this.toggleInfo(false));
    return info;
  }
}
