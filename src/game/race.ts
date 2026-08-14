import { MISSIONS } from "./missions";

/**
 * The race: how many missions win the match.
 *
 * It already existed, buried in the teacher panel behind a passphrase and
 * reachable only once everybody was already walking around. That is the wrong
 * moment for it. A race is a rule you announce *before* the whistle — "first to
 * five" — and a teacher setting it mid-lesson has to interrupt a class that has
 * already started to tell them the game changed.
 *
 * So the number lives here instead of in the panel, is chosen from the menu
 * before anybody starts, and is remembered between lessons. The teacher panel
 * still sets it, because a race called off halfway through is a real thing that
 * happens; both write to the same number.
 *
 * Zero means no race, and zero is the default, because most lessons are not
 * one.
 */

/** Every mission in the game — the most anybody could be asked for. */
export const MAX_TARGET = MISSIONS.length;

export const NO_RACE = 0;

const STORAGE_KEY = "da-world:race-target";

export function loadRaceTarget(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? NO_RACE : clampTarget(Number.parseInt(raw, 10));
  } catch {
    return NO_RACE;
  }
}

export function saveRaceTarget(target: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampTarget(target)));
  } catch {
    /* private browsing: the race lasts for this lesson only. */
  }
}

/**
 * A target from an older version, a hand-edited one, or a number field that
 * came back `NaN` must never be able to produce a match nobody can win.
 */
export function clampTarget(target: number): number {
  if (!Number.isFinite(target)) return NO_RACE;
  return Math.max(NO_RACE, Math.min(MAX_TARGET, Math.round(target)));
}

/** How the setting reads on a tile, a chip or a banner. */
export function raceLabel(target: number): string {
  if (target <= NO_RACE) return "No race — nobody wins, everybody explores";
  return `First to ${target} mission${target === 1 ? "" : "s"} wins`;
}
