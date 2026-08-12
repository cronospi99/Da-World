/**
 * Game state + persistence.
 *
 * The state is deliberately small and serialisable: everything that says how
 * far you have got — places walked past, citizens helped, accuracy per
 * language point, missions completed — lives here and survives a page reload
 * through localStorage.
 */

import type { GrammarTag } from "./grammar";
import { BUILDINGS } from "../city/buildings";
import { PARKS } from "../city/layout";

export type SkillTag = GrammarTag | "directions" | "prepositions";

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
    hintTargetId: null,
    focusMissionId: null,
    clock: 9,
  };
}

export function statFor(state: GameState, tag: SkillTag): SkillStat {
  return (state.skills[tag] ??= { asked: 0, correct: 0, firstTry: 0, hints: 0 });
}

export const XP_PER_CORRECT = 100;
export const XP_WITH_HINT = 50;
/** Repeat questions from a citizen you have already helped: practice, not discovery. */
export const XP_PRACTICE = 40;
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
