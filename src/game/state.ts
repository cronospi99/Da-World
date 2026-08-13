/**
 * Game state + persistence.
 *
 * The state is deliberately small and serialisable: everything that says how
 * far you have got — places walked past, citizens helped, accuracy per
 * language point, missions completed — lives here and survives a page reload
 * through localStorage.
 */

import { GRAMMAR_TAG_LABEL, type GrammarTag } from "./grammar";
import { BUILDINGS } from "../city/buildings";
import { PARKS } from "../city/layout";

/**
 * A language point the game can score you on.
 *
 * The last three are Family Detective's: choosing the adverb, putting it in
 * the right place, and naming the relative. They are tags rather than one
 * "detective" bucket because they fail separately — a student can be fluent
 * on the frequency scale and still write *he isn't never late*, and a report
 * that says so is worth more than one that says they got 60%.
 */
export type SkillTag =
  | GrammarTag
  | "directions"
  | "prepositions"
  | "frequency"
  | "word-order"
  | "family";

/**
 * What each language point is called, wherever one is named to a human.
 *
 * One map, because there are three places that need it — the chip on a
 * conversation card, the teacher's accuracy table, and anything printed after
 * them — and a tag missing from one of those copies does not fail, it just
 * shows a student's teacher the word `word-order` in a report.
 */
export const SKILL_LABEL: Record<string, string> = {
  ...GRAMMAR_TAG_LABEL,
  directions: "giving directions",
  prepositions: "prepositions of place",
  frequency: "adverbs of frequency",
  "word-order": "word order",
  family: "family words",
};

export interface SkillStat {
  asked: number;
  correct: number;
  firstTry: number;
  hints: number;
}

export interface GameState {
  score: number;
  level: number;
  correct: number;
  attempts: number;
  found: Set<string>;
  helped: Set<number>;
  skills: Record<string, SkillStat>;
  missionsDone: Set<string>;
  champion: boolean;
  /** Seconds of active play. */
  playtime: number;
  /** Family Detective cases closed with the right name. */
  casesSolved: number;
  /** Clues written into a case file, across every case. */
  cluesFound: number;
  /** Building highlighted by a hint, if any. */
  hintTargetId: string | null;
  /**
   * The mission the teacher has put the room on, if any.
   *
   * It overrides the HUD's own "next unfinished mission", so a whole class is
   * looking at the same line of text however far ahead or behind each student
   * happens to be.
   */
  focusMissionId: string | null;
  /** Time of day, in hours, so a saved city resumes at the same hour. */
  clock: number;
  /**
   * The open Family Detective case, small enough to write down.
   *
   * A case is entirely determined by its seed, so the eighteen suspects, the
   * guilty one and every clue in the city rebuild from this number alone —
   * only the facts already earned have to be listed. It matters more than it
   * looks: a phone that locks mid-lesson, or a tab that reloads, would
   * otherwise throw away an hour of a student's detective work and hand them
   * a different culprit.
   */
  caseSeed: number | null;
  /** Clue ids already written into the file, for the case above. */
  caseFacts: string[];
}

export const TOTAL_PLACES = BUILDINGS.length + PARKS.length;

export function createState(): GameState {
  return {
    score: 0,
    level: 1,
    correct: 0,
    attempts: 0,
    found: new Set(),
    helped: new Set(),
    skills: {},
    missionsDone: new Set(),
    champion: false,
    playtime: 0,
    casesSolved: 0,
    cluesFound: 0,
    hintTargetId: null,
    focusMissionId: null,
    clock: 9,
    caseSeed: null,
    caseFacts: [],
  };
}

export function statFor(state: GameState, tag: SkillTag): SkillStat {
  return (state.skills[tag] ??= { asked: 0, correct: 0, firstTry: 0, hints: 0 });
}

export const XP_PER_CORRECT = 100;
export const XP_WITH_HINT = 50;
/** Repeat questions from a citizen you have already helped: practice, not discovery. */
export const XP_PRACTICE = 40;
/** Naming the right person. A whole level, because it is a whole case. */
export const XP_CASE_CLOSED = 300;
export const XP_PER_LEVEL = 300;

export function levelOf(score: number): number {
  return Math.floor(score / XP_PER_LEVEL) + 1;
}

/* ------------------------------ persistence ------------------------------ */

const SAVE_KEY = "da-world:save:v1";

interface SaveShape {
  v: 1;
  score: number;
  correct: number;
  attempts: number;
  found: string[];
  helped: number[];
  skills: Record<string, SkillStat>;
  missionsDone: string[];
  champion: boolean;
  playtime: number;
  clock: number;
  savedAt: number;
  /**
   * Added after v1 shipped, so both are optional: a save written before
   * Family Detective existed is still a good save, it has simply never
   * closed a case. Loading defaults them to zero rather than bumping the
   * version and throwing away everybody's city.
   */
  casesSolved?: number;
  cluesFound?: number;
  caseSeed?: number | null;
  caseFacts?: string[];
}

export function saveState(state: GameState): void {
  try {
    const payload: SaveShape = {
      v: 1,
      score: state.score,
      correct: state.correct,
      attempts: state.attempts,
      found: [...state.found],
      helped: [...state.helped],
      skills: state.skills,
      missionsDone: [...state.missionsDone],
      champion: state.champion,
      playtime: Math.round(state.playtime),
      clock: state.clock,
      savedAt: Date.now(),
      casesSolved: state.casesSolved,
      cluesFound: state.cluesFound,
      caseSeed: state.caseSeed,
      caseFacts: state.caseFacts,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    /* private browsing / quota — the game keeps working, it just forgets. */
  }
}

export function loadState(state: GameState): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as SaveShape;
    if (data.v !== 1) return false;
    state.score = data.score ?? 0;
    state.correct = data.correct ?? 0;
    state.attempts = data.attempts ?? 0;
    state.found = new Set(data.found ?? []);
    state.helped = new Set(data.helped ?? []);
    state.skills = data.skills ?? {};
    state.missionsDone = new Set(data.missionsDone ?? []);
    state.champion = !!data.champion;
    state.playtime = data.playtime ?? 0;
    state.clock = data.clock ?? 9;
    state.casesSolved = data.casesSolved ?? 0;
    state.cluesFound = data.cluesFound ?? 0;
    state.caseSeed = data.caseSeed ?? null;
    state.caseFacts = data.caseFacts ?? [];
    state.level = levelOf(state.score);
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
