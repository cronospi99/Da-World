import type { QuestKind } from "../city/npcData";

/**
 * The ways to play.
 *
 * A mode is not a different city — it is the same ninety-one places and the
 * same thirty-two citizens, asking a different *kind* of question. That is
 * what makes them worth having: a class working on prepositions of place and a
 * class working on directions walk the same streets and read the same signs,
 * and the teacher picks which language the city speaks today.
 *
 * The kinds a mode lists are dealt round-robin to the citizens, so a mode with
 * one kind means everybody asks that kind, and a mode with two means the city
 * is half and half. Nobody is left standing on the pavement with nothing to
 * say.
 */

export type GameModeId = "vocabulary" | "directions" | "multiplayer";

/** Groups the missions are shown in, and that a mode draws its goals from. */
export type MissionGroup = "explore" | "vocabulary" | "grammar" | "directions";

export interface GameMode {
  id: GameModeId;
  name: string;
  icon: string;
  /** One line under the title on the menu. */
  blurb: string;
  /** What the mode actually teaches, in the words a teacher would use. */
  covers: string[];
  /** Question families the citizens of this mode ask. */
  kinds: QuestKind[];
  /** Mission groups that count towards finishing this mode. */
  groups: MissionGroup[];
  /** Needs a server and other people. */
  networked?: boolean;
}

export const MODES: Record<GameModeId, GameMode> = {
  vocabulary: {
    id: "vocabulary",
    name: "Vocabulary",
    icon: "🏷️",
    blurb: "Say what is in the city, and where it is.",
    covers: [
      "there is / there are",
      "some / any / no",
      "much / many / a lot of",
      "prepositions of place",
      "the words for a city and everything in it",
    ],
    kinds: ["find", "grammar"],
    groups: ["explore", "vocabulary", "grammar"],
  },
  directions: {
    id: "directions",
    name: "Directions",
    icon: "🧭",
    blurb: "Tell a lost stranger how to get there.",
    covers: [
      "go straight on / turn left / turn right",
      "counting blocks",
      "naming the street you turn onto",
      "which side of the road it ends up on",
    ],
    kinds: ["directions"],
    groups: ["explore", "directions"],
  },
  multiplayer: {
    id: "multiplayer",
    name: "Class",
    icon: "👥",
    blurb: "Up to twelve students and a teacher in one city.",
    covers: [
      "everything in both modes",
      "the teacher sets the mission for the room",
      "everybody walks the same streets at the same time",
    ],
    kinds: ["find", "grammar", "directions"],
    groups: ["explore", "vocabulary", "grammar", "directions"],
    networked: true,
  },
};

export const MODE_LIST: GameMode[] = [
  MODES.vocabulary,
  MODES.directions,
  MODES.multiplayer,
];

const STORAGE_KEY = "da-world:mode";

export function rememberMode(id: GameModeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private browsing: the choice lasts for this session only. */
  }
}

export function lastMode(): GameModeId | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw in MODES ? (raw as GameModeId) : null;
  } catch {
    return null;
  }
}
