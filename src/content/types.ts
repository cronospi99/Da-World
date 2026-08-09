/**
 * The content model for the whole game.
 *
 * Everything the player can see, walk to, click and learn is described by
 * these types. Adding a new location or a new word should never require
 * touching the engine — only `src/content/places.ts`.
 */

/** Which parametric low-poly mesh represents a spot in the world. */
export type PropKind =
  | "tree"
  | "palm"
  | "rock"
  | "crate"
  | "barrel"
  | "boat"
  | "lamp"
  | "bench"
  | "sign"
  | "tent"
  | "well"
  | "stall"
  | "house"
  | "flag"
  | "campfire"
  | "clock";

export type WordClass = "noun" | "verb" | "adjective" | "phrase";

/** CEFR-ish difficulty band, used to filter and to order quizzes. */
export type Level = "A1" | "A2" | "B1" | "B2";

export interface Vocab {
  /** English form as it should be spoken and written. */
  en: string;
  /** Native-language gloss shown under the English. */
  es: string;
  /** A full sentence putting the word in context. */
  sentence: string;
  /** Translation of `sentence`. */
  sentenceEs: string;
  wordClass: WordClass;
  level: Level;
  /** Shown on the lesson card and on the world marker. */
  emoji: string;
}

export interface Spot {
  /** Stable id — progress is saved against this, so do not rename casually. */
  id: string;
  /** Position relative to the centre of its place, in world units. */
  offset: [x: number, z: number];
  /** Rotation of the prop around Y, in radians. */
  rotation?: number;
  scale?: number;
  prop: PropKind;
  vocab: Vocab;
}

export interface PlacePalette {
  ground: string;
  accent: string;
  prop: string;
}

export interface Place {
  /** Stable id — progress is saved against this. */
  id: string;
  name: string;
  nameEs: string;
  /** One-line intro shown when the player first arrives. */
  intro: string;
  /** Centre of the place on the terrain plane. */
  center: [x: number, z: number];
  /** Terrain is flattened within this radius so buildings sit level. */
  radius: number;
  palette: PlacePalette;
  spots: Spot[];
}
