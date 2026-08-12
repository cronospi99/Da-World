/**
 * Missions — the reason to keep walking, expressed as goals.
 *
 * Order matters: the HUD ticker always shows the first unfinished mission, so
 * this list is effectively the sequence the player walks through — explore the
 * city first, then help its citizens, then work through the language points
 * one at a time.
 *
 * The grammar missions are generated from the grammar bank's own tags, so
 * adding a language point to `grammar.ts` adds a mission for it automatically
 * and the two can never drift apart.
 */

import { GRAMMAR_TAGS, GRAMMAR_TAG_LABEL, type GrammarTag } from "./grammar";
import { PARKS } from "../city/layout";
import type { GameMode, MissionGroup } from "./modes";
import type { GameState, SkillTag } from "./state";

export interface Mission {
  id: string;
  icon: string;
  label: string;
  goal: number;
  get: (s: GameState) => number;
  /** Language point this mission trains, if any. */
  tag?: SkillTag;
  /** Which section of the mission list this belongs to. */
  group: MissionGroup;
}

/** The sections the mission list is drawn in, in order. */
export const MISSION_GROUPS: { id: MissionGroup; icon: string; label: string }[] = [
  { id: "explore", icon: "🏙️", label: "Exploring the city" },
  { id: "vocabulary", icon: "🏷️", label: "Vocabulary" },
  { id: "grammar", icon: "✏️", label: "Grammar" },
  { id: "directions", icon: "🧭", label: "Directions" },
];

/** Correct answers recorded for one language point. */
const scored = (tag: SkillTag) => (s: GameState) => s.skills[tag]?.correct ?? 0;

const TAG_ICON: Record<GrammarTag, string> = {
  "there-is-are": "🔢",
  "some-any-no": "❔",
  "much-many-a-lot-of": "⚖️",
  "a-an": "🔤",
  countability: "🧮",
  "in-on-at": "📍",
  "wh-questions": "❓",
};

/** How many correct answers each grammar point needs. */
const GRAMMAR_GOAL = 3;

/** Grammar points a teacher would file under vocabulary rather than grammar. */
const VOCABULARY_POINTS = new Set<GrammarTag>([
  "there-is-are",
  "some-any-no",
  "much-many-a-lot-of",
]);

const EXPLORE: Mission[] = [
  {
    id: "m1",
    icon: "🏙️",
    label: "Walk past 25 places in the city",
    goal: 25,
    get: (s) => s.found.size,
    group: "explore",
  },
  {
    id: "m2",
    icon: "💬",
    label: "Help 12 citizens (answer correctly)",
    goal: 12,
    get: (s) => s.helped.size,
    group: "explore",
  },
  {
    id: "m3",
    icon: "✅",
    label: "Get 20 correct answers",
    goal: 20,
    get: (s) => s.correct,
    group: "explore",
  },
  {
    id: "m4",
    icon: "🏟️",
    label: "Find the Stadium, the Church, the Airport and the Train Station",
    goal: 4,
    get: (s) =>
      ["national-stadium", "st-mary-s-church", "el-dorado-airport", "central-train-station"].filter(
        (id) => s.found.has(id),
      ).length,
    group: "explore",
  },
  {
    id: "m5",
    icon: "🌳",
    label: "Visit all three parks: Central, Riverside and Sunset Sports",
    goal: PARKS.length,
    get: (s) => PARKS.filter((p) => s.found.has(p.id)).length,
    group: "explore",
  },
  {
    id: "m6",
    icon: "🧭",
    label: "Guide 5 lost citizens to where they are going",
    goal: 5,
    get: scored("directions"),
    tag: "directions",
    group: "directions",
  },
  {
    id: "m7",
    icon: "📌",
    label: "Describe 5 places with prepositions of place",
    goal: 5,
    get: scored("prepositions"),
    tag: "prepositions",
    group: "vocabulary",
  },
];

/** One mission per language point in the grammar bank. */
const GRAMMAR: Mission[] = GRAMMAR_TAGS.map((tag) => ({
  id: `g-${tag}`,
  icon: TAG_ICON[tag],
  label: `Master “${GRAMMAR_TAG_LABEL[tag]}” — ${GRAMMAR_GOAL} correct answers`,
  goal: GRAMMAR_GOAL,
  get: scored(tag),
  tag,
  // "there is/are", "some/any" and "much/many" are the vocabulary of saying
  // what a city has in it, which is what the Vocabulary mode is named after;
  // the rest are grammar in the narrower sense. Both sections show in both
  // modes, but the split is what a teacher would expect to see on the board.
  group: VOCABULARY_POINTS.has(tag) ? "vocabulary" : "grammar",
}));

const CROWN: Mission = {
  id: "m-champion",
  icon: "👑",
  label: "Reach level 6 (XP comes only from correct answers!)",
  goal: 6,
  get: (s) => s.level,
  group: "explore",
};

export const MISSIONS: Mission[] = [...EXPLORE, ...GRAMMAR, CROWN];

/**
 * The missions a mode is played for.
 *
 * A directions lesson should not be told it has failed to master "some / any",
 * and a vocabulary lesson should not be sent out to follow five sets of
 * directions. The HUD ticker, the mission list and "every mission complete"
 * all read this rather than the full table.
 */
export function missionsFor(mode: GameMode): Mission[] {
  return MISSIONS.filter((m) => mode.groups.includes(m.group));
}
