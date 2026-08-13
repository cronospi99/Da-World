import { closeButton, el } from "./dom";

/**
 * How the room is doing, while the room is still doing it.
 *
 * A class walking the same city could already see each other on the pavement
 * and could not see anything else: who had helped the most citizens, who was
 * two missions from finishing, whether the race was close. The teacher's panel
 * had the numbers, and the teacher's panel is on the teacher's screen.
 *
 * So this is the same numbers, on everybody's screen, ranked. It sorts on
 * missions first and experience second, because missions are what the match is
 * won on and XP is what separates two students on the same mission — and it
 * marks your own row, because a leaderboard you have to hunt yourself in is a
 * list rather than a game.
 */

export interface LeaderRow {
  id: string;
  name: string;
  /** The teacher, or whoever is hosting. */
  teacher: boolean;
  missions: number;
  score: number;
  helped: number;
  /** This row is the person reading it. */
  you: boolean;
}

export class Leaderboard {
  private readonly root: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly table: HTMLElement;
  private readonly note: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.banner = el("div", { class: "board-banner is-hidden" });
    this.table = el("div", { class: "board-table" });
    this.note = el("p", { class: "info-note" });

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "🏆 The class" }),
          this.banner,
          this.table,
          this.note,
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

  toggle(open: boolean): void {
    this.root.classList.toggle("is-open", open);
    this.root.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) this.onClose();
  }

  /**
   * Redraw.
   *
   * Called whenever a number changes rather than on a timer, so a class
   * watching the board sees somebody overtake them at the moment it happens.
   */
  update(rows: LeaderRow[], target: number, winner: { id: string; name: string } | null): void {
    const ranked = [...rows].sort(
      (a, b) => b.missions - a.missions || b.score - a.score || b.helped - a.helped,
    );

    this.banner.classList.toggle("is-hidden", !winner);
    if (winner) {
      const you = rows.find((r) => r.id === winner.id)?.you;
      this.banner.textContent = you
        ? `🏆 You won — ${target} missions before anybody else.`
        : `🏆 ${winner.name} won, with ${target} missions.`;
    }

    this.table.replaceChildren(
      el("div", { class: "board-row is-head" }, [
        el("span", { class: "board-rank", text: "#" }),
        el("span", { class: "board-name", text: "Who" }),
        el("span", { class: "board-cell", text: "Missions" }),
        el("span", { class: "board-cell", text: "XP" }),
        el("span", { class: "board-cell", text: "Helped" }),
      ]),
      ...ranked.map((row, index) =>
        el("div", { class: row.you ? "board-row is-you" : "board-row" }, [
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
        ]),
      ),
    );

    this.note.textContent =
      target > 0
        ? `First to ${target} mission${target === 1 ? "" : "s"} wins the match. The teacher sets the number.`
        : "No race set. The teacher can pick how many missions win the match from the teacher panel.";
  }
}

const medal = (index: number): string =>
  ["🥇", "🥈", "🥉"][index] ?? `${index + 1}`;
