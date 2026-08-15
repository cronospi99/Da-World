import { el } from "./dom";
import type { LeaderRow } from "./leaderboard";

/**
 * The end of the match.
 *
 * Somebody reaching the target used to produce a toast — a small card in the
 * corner saying who won, over a city everybody carried on walking around. That
 * is a scoreboard update, not an ending, and in a room of twelve it means the
 * eleven people who did not win find out from a notification they may already
 * have walked past.
 *
 * So the match *ends*. The city fades to black over about a second, the final
 * table comes up on the black, and nothing else is reachable until somebody
 * chooses what happens next. The fade is the whole point of the effect: it is
 * the thing that makes a room look up from their screens at the same moment,
 * and it is why this is a full-screen element rather than another card on the
 * pile of overlays.
 *
 * It is deliberately not the in-play leaderboard with a different hat on. That
 * one is a thing you peek at mid-lesson and dismiss; this one is a result, and
 * the only ways out of it are decisions.
 */

/** How long the world takes to go dark, in milliseconds. Matches the CSS. */
const FADE_MS = 1100;

export interface MatchOverHandlers {
  /** Wipe the missions and race again. Only offered to whoever can do it. */
  onNewMatch(): void;
  /** Dismiss and carry on walking around the same city. */
  onKeepPlaying(): void;
  onMenu(): void;
}

export interface MatchResult {
  rows: LeaderRow[];
  target: number;
  winner: { id: string; name: string } | null;
  /**
   * Whether this browser is allowed to start the next match.
   *
   * True on one laptop, and true for whoever is holding a room open. False for
   * a student in somebody else's room: the race is the teacher's to restart,
   * and a button that silently did nothing would be worse than no button.
   */
  canRestart: boolean;
}

export class MatchOver {
  private readonly root: HTMLElement;
  private readonly headline: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly table: HTMLElement;
  private readonly actions: HTMLElement;

  private revealTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly handlers: MatchOverHandlers,
  ) {
    this.headline = el("h1", { class: "over-headline" });
    this.sub = el("p", { class: "over-sub" });
    this.table = el("div", { class: "board-table over-table" });
    this.actions = el("div", { class: "over-actions" });

    this.root = el("div", { class: "match-over", "aria-hidden": "true" }, [
      el("div", { class: "over-panel" }, [
        this.headline,
        this.sub,
        this.table,
        this.actions,
      ]),
    ]);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.root.classList.contains("is-on");
  }

  /**
   * Take the screen.
   *
   * Two steps on purpose: black first, results after. Showing the table at the
   * same moment as the fade means reading a leaderboard through a city that is
   * still disappearing behind it, and the pause is what turns a transition
   * into an announcement.
   */
  show(result: MatchResult): void {
    this.render(result);
    this.root.setAttribute("aria-hidden", "false");
    this.root.classList.add("is-on");
    this.root.classList.remove("is-revealed");

    window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      this.root.classList.add("is-revealed");
    }, FADE_MS);
  }

  hide(): void {
    window.clearTimeout(this.revealTimer);
    this.root.classList.remove("is-on", "is-revealed");
    this.root.setAttribute("aria-hidden", "true");
  }

  private render(result: MatchResult): void {
    const { rows, target, winner } = result;
    const youWon = !!winner && rows.some((row) => row.id === winner.id && row.you);

    this.headline.textContent = !winner
      ? "Match over"
      : youWon
        ? "🏆 You won!"
        : `🏆 ${winner.name} won`;
    this.sub.textContent = winner
      ? `${target} mission${target === 1 ? "" : "s"} finished first.`
      : "The race is over.";

    const ranked = [...rows].sort(
      (a, b) => b.missions - a.missions || b.score - a.score || b.helped - a.helped,
    );

    this.table.replaceChildren(
      el("div", { class: "board-row is-head" }, [
        el("span", { class: "board-rank", text: "#" }),
        el("span", { class: "board-name", text: "Who" }),
        el("span", { class: "board-cell", text: "Missions" }),
        el("span", { class: "board-cell", text: "XP" }),
        el("span", { class: "board-cell", text: "Helped" }),
      ]),
      ...ranked.map((row, index) => {
        const classes = ["board-row"];
        if (row.you) classes.push("is-you");
        if (winner && row.id === winner.id) classes.push("is-winner");
        return el("div", { class: classes.join(" ") }, [
          el("span", { class: "board-rank", text: medal(index) }),
          el("span", {
            class: "board-name",
            text: `${row.teacher ? "👩‍🏫 " : ""}${row.name}${row.you ? " (you)" : ""}`,
          }),
          el("span", {
            class: "board-cell",
            text: target > 0 ? `${row.missions}/${target}` : String(row.missions),
          }),
          el("span", { class: "board-cell", text: String(row.score) }),
          el("span", { class: "board-cell", text: String(row.helped) }),
        ]);
      }),
    );

    const newMatch = el("button", {
      class: "pill-button",
      type: "button",
      text: "🔄 New match",
    }) as HTMLButtonElement;
    newMatch.addEventListener("click", () => this.handlers.onNewMatch());

    const keep = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "🚶 Keep exploring",
    }) as HTMLButtonElement;
    keep.addEventListener("click", () => this.handlers.onKeepPlaying());

    const menu = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "🏠 Main menu",
    }) as HTMLButtonElement;
    menu.addEventListener("click", () => this.handlers.onMenu());

    this.actions.replaceChildren(...(result.canRestart ? [newMatch, keep, menu] : [keep, menu]));
  }
}

const medal = (index: number): string => ["🥇", "🥈", "🥉"][index] ?? `${index + 1}`;
