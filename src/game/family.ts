/**
 * The lesson: adverbs of frequency, and the words for a family.
 *
 * This is the content of the "English Fun Zone – Adverbs & Family Tree"
 * worksheet, moved into the city. The worksheet was a page you scrolled: a
 * frequency scale, three word-order patterns, one rule about double negatives,
 * twenty-three family words, a family tree to label, and two banks of
 * gap-fill questions. All of it is here, and none of it is decoration —
 * `detective.ts` builds its suspects out of the family tree's own people,
 * writes its clues with the frequency scale's own percentages, and its
 * wrong answers are the two mistakes the worksheet's rule box calls out.
 *
 * Nothing in this file knows about the 3D city, and nothing in it renders.
 * It is the syllabus; the city is where it gets taught.
 */

/* ============================ frequency ============================== */

export type LevelId = "always" | "usually" | "often" | "sometimes" | "rarely" | "never";

export interface FrequencyLevel {
  id: LevelId;
  /** How often, as the worksheet's scale puts it. */
  pct: number;
  /**
   * The words that express this level.
   *
   * Only 10% has two, and that is the point of storing a list: "rarely" and
   * "hardly ever" mean the same thing, so a question may offer one or the
   * other but must never offer both — two correct answers in a multiple
   * choice is a broken question, not a hard one.
   */
  words: string[];
  /** The worksheet's own example sentence. */
  example: string;
  /** How the clue sentences say the percentage out loud. */
  tell: string;
  /** Scale colour, matching the worksheet's bands. */
  colour: string;
}

export const LEVELS: FrequencyLevel[] = [
  {
    id: "always",
    pct: 100,
    words: ["always"],
    example: "You are always late.",
    tell: "every single time, without fail",
    colour: "#cf7364",
  },
  {
    id: "usually",
    pct: 90,
    words: ["usually"],
    example: "We usually go to the cinema on Sunday.",
    tell: "about nine times out of ten",
    colour: "#5b8de8",
  },
  {
    id: "often",
    pct: 70,
    words: ["often"],
    example: "He often cooks pasta.",
    tell: "most weeks, but not all of them",
    colour: "#d98f5a",
  },
  {
    id: "sometimes",
    pct: 50,
    words: ["sometimes"],
    example: "We sometimes order pizza for dinner.",
    tell: "about half the time",
    colour: "#7fa05a",
  },
  {
    id: "rarely",
    pct: 10,
    words: ["rarely", "hardly ever"],
    example: "She hardly ever smiles.",
    tell: "maybe once or twice a year",
    colour: "#8e6ec8",
  },
  {
    id: "never",
    pct: 0,
    words: ["never"],
    example: "They are never at home when we call.",
    tell: "not once, not ever",
    colour: "#9a7a5c",
  },
];

export const LEVEL_BY_ID = new Map(LEVELS.map((l) => [l.id, l]));

/** Single-letter codes, so a suspect's whole routine fits on one line. */
export const LEVEL_CODE: Record<string, LevelId> = {
  A: "always",
  U: "usually",
  O: "often",
  S: "sometimes",
  R: "rarely",
  N: "never",
};

/* ============================ word order ============================= */

export interface WordOrderPattern {
  id: "positive" | "be" | "question";
  label: string;
  /** The pattern as the worksheet draws it, box by box. */
  boxes: string[];
  example: string;
}

export const WORD_ORDER: WordOrderPattern[] = [
  {
    id: "positive",
    label: "✅ Positive",
    boxes: ["Subject", "Frequency adverb", "Verb"],
    example: "He often cooks pasta.",
  },
  {
    id: "be",
    label: "🔵 With BE",
    boxes: ["Subject", "BE", "Frequency adverb"],
    example: "You are always late.",
  },
  {
    id: "question",
    label: "❓ Question",
    boxes: ["Auxiliary", "Subject", "Frequency adverb"],
    example: "Are you always late? · Does he often cook?",
  },
];

/**
 * The one rule the worksheet puts in a warning box, and the reason the
 * word-order questions in this game have the wrong answers they do.
 *
 * `never` and `hardly ever` are already negative, so the verb stays positive.
 * Both of the wrong options a citizen offers are these two sentences.
 */
export const NEGATIVE_RULE = {
  title: "Use NEVER and HARDLY EVER with positive verbs",
  wrong: ["He isn't never late.", "They don't hardly ever go to the library."],
  right: ["He is never late.", "They hardly ever go to the library."],
};

/* ============================== family =============================== */

export interface FamilyWord {
  word: string;
  emoji: string;
  /** The definition, in the worksheet's words — and the riddle a citizen asks. */
  relation: string;
  /** Other names for the same person. */
  syn: string;
}

export const FAMILY_WORDS: FamilyWord[] = [
  { word: "Father", emoji: "👨", relation: "male parent", syn: "dad, daddy, papa" },
  { word: "Mother", emoji: "👩", relation: "female parent", syn: "mom, mummy, mama" },
  { word: "Son", emoji: "👦", relation: "male child", syn: "boy child" },
  { word: "Daughter", emoji: "👧", relation: "female child", syn: "girl child" },
  { word: "Brother", emoji: "🧑", relation: "male sibling", syn: "bro" },
  { word: "Sister", emoji: "👱‍♀️", relation: "female sibling", syn: "sis" },
  { word: "Grandfather", emoji: "👴", relation: "parent's father", syn: "grandpa, granddad" },
  { word: "Grandmother", emoji: "👵", relation: "parent's mother", syn: "grandma, granny, nan" },
  {
    word: "Great-Grandfather",
    emoji: "👴",
    relation: "grandparent's father",
    syn: "great-grandpa",
  },
  {
    word: "Great-Grandmother",
    emoji: "👵",
    relation: "grandparent's mother",
    syn: "great-grandma",
  },
  { word: "Uncle", emoji: "🧔", relation: "parent's brother", syn: "" },
  { word: "Aunt", emoji: "👩‍🦱", relation: "parent's sister", syn: "auntie" },
  { word: "Great-Uncle", emoji: "🧓", relation: "grandparent's brother", syn: "" },
  { word: "Great-Aunt", emoji: "👩‍🦳", relation: "grandparent's sister", syn: "" },
  { word: "Cousin", emoji: "🧒", relation: "uncle or aunt's child", syn: "" },
  { word: "Nephew", emoji: "👦", relation: "sibling's son", syn: "" },
  { word: "Niece", emoji: "👧", relation: "sibling's daughter", syn: "" },
  { word: "Wife", emoji: "👰", relation: "married female partner", syn: "spouse" },
  { word: "Father-in-law", emoji: "🧓", relation: "wife or husband's father", syn: "spouse's dad" },
  { word: "Mother-in-law", emoji: "👩‍🦳", relation: "wife or husband's mother", syn: "spouse's mom" },
  {
    word: "Brother-in-law",
    emoji: "🤵",
    relation: "spouse's brother, or a sibling's husband",
    syn: "",
  },
  { word: "Sister-in-law", emoji: "👰", relation: "spouse's sister, or a sibling's wife", syn: "" },
  { word: "Baby", emoji: "👶", relation: "very young child", syn: "infant" },
];

export const FAMILY_BY_WORD = new Map(FAMILY_WORDS.map((f) => [f.word, f]));

/* ========================== practice bank ============================ */

/**
 * The worksheet's two quizzes, kept for what they are good at.
 *
 * These are not clues — they say nothing about the person you are looking
 * for. They are what a citizen asks *after* their clue has been written into
 * the case file, so somebody who has already been helped is still worth
 * walking up to. Without them a solved street goes quiet, and a class of
 * twelve on one case would run out of English long before they ran out of
 * lesson.
 */
export interface PracticeItem {
  q: string;
  answer: string;
  wrong: string[];
  /** Which of the two banks it came from, for the explanation. */
  about: "day" | "family";
}

export const PRACTICE_BANK: PracticeItem[] = [
  /* ── adverbs of frequency ── */
  { q: "She ___ brushes her teeth before bed — every single night!", answer: "always", wrong: ["never", "often", "rarely"], about: "day" },
  { q: "He ___ eats breakfast. Maybe once a month.", answer: "rarely", wrong: ["always", "usually", "sometimes"], about: "day" },
  { q: "We ___ go swimming on Saturdays — about 9 times out of 10!", answer: "usually", wrong: ["never", "rarely", "always"], about: "day" },
  { q: "They ___ order pizza for dinner — about half the time.", answer: "sometimes", wrong: ["always", "never", "usually"], about: "day" },
  { q: "I ___ drink coffee. I prefer tea 100% of the time.", answer: "never", wrong: ["always", "often", "usually"], about: "day" },
  { q: "My dog ___ barks at strangers — almost every time!", answer: "often", wrong: ["never", "rarely", "sometimes"], about: "day" },
  { q: "The train is ___ on time — you can count on it every day.", answer: "always", wrong: ["rarely", "sometimes", "never"], about: "day" },
  { q: "She ___ goes to the gym — less than once in a while.", answer: "hardly ever", wrong: ["usually", "always", "often"], about: "day" },
  { q: "We ___ have family dinner on Sundays — about 70% of weekends.", answer: "often", wrong: ["never", "always", "rarely"], about: "day" },
  { q: "He ___ forgets his homework. It happens about half the school days.", answer: "sometimes", wrong: ["always", "never", "usually"], about: "day" },
  { q: "I ___ miss the bus — I'm on time every single morning!", answer: "never", wrong: ["often", "sometimes", "usually"], about: "day" },
  { q: "They ___ watch movies at the weekend — almost every weekend.", answer: "usually", wrong: ["rarely", "never", "hardly ever"], about: "day" },

  /* ── the same adverbs, about a family ── */
  { q: "My grandmother ___ bakes cookies on Sundays — every week without fail!", answer: "always", wrong: ["never", "rarely", "sometimes"], about: "family" },
  { q: "My brother ___ forgets to call me — we talk maybe once or twice a year.", answer: "rarely", wrong: ["always", "usually", "often"], about: "family" },
  { q: "My aunt ___ visits us during the summer — about 9 summers out of 10.", answer: "usually", wrong: ["never", "rarely", "sometimes"], about: "family" },
  { q: "My cousins and I ___ play video games together — about half the time we meet.", answer: "sometimes", wrong: ["never", "always", "usually"], about: "family" },
  { q: "My uncle ___ tells the same jokes — he loves telling them every single time!", answer: "always", wrong: ["rarely", "sometimes", "never"], about: "family" },
  { q: "My sister ___ borrows my clothes without asking — almost every day!", answer: "often", wrong: ["never", "rarely", "usually"], about: "family" },
  { q: "My nephew ___ cries — he's a very happy baby!", answer: "hardly ever", wrong: ["always", "usually", "often"], about: "family" },
  { q: "My niece ___ wins at board games — she is really good!", answer: "often", wrong: ["never", "hardly ever", "rarely"], about: "family" },
  { q: "My parents ___ argue — they have a very peaceful relationship.", answer: "never", wrong: ["always", "usually", "sometimes"], about: "family" },
  { q: "My grandfather ___ naps after lunch — it's his daily routine!", answer: "always", wrong: ["rarely", "never", "sometimes"], about: "family" },
];
