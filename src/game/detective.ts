import { mulberry32, pick, shuffle } from "../core/rng";
import { FAMILY_BY_WORD, LEVELS, LEVEL_BY_ID, LEVEL_CODE, type LevelId } from "./family";

/**
 * The case: somebody in the family is the answer, and the city knows why.
 *
 * The worksheet ended with a family tree you labelled and a quiz you marked.
 * This is what that becomes when the classroom is a city you walk through:
 * eighteen people off the same tree, one of them the answer, and the only way
 * to tell them apart is to get the English right. A citizen on the pavement
 * says *"she ___ bakes cookies — every single time"*; choose `always` and that
 * fact goes in your case file and crosses out everybody it does not fit. Get
 * it wrong and you learn nothing about anybody, which is a far better reason
 * to care about the answer than a tick in a margin.
 *
 * Three things make it hold together:
 *
 * **Every suspect is distinguishable.** The routine table gives each of the
 * eighteen a different six-habit fingerprint, so the full set of clues can
 * never leave two people standing. `assertSolvable()` says so out loud rather
 * than trusting the table to stay that way through the next edit.
 *
 * **Every clue is true.** Clues are read off the secret's own row, so nothing
 * a citizen tells you can mislead — a student who is stuck is stuck on the
 * English, never on the puzzle.
 *
 * **You cannot guess your way out.** The accusation stays locked until the
 * file holds `CLUES_TO_ACCUSE` facts, so the route to the answer runs through
 * the questions rather than around them.
 */

/* ============================== suspects ============================= */

/**
 * The six routines every suspect has an answer for, in table order.
 *
 * `s` is the third-person form the sentences are built from and `base` the
 * bare one the double-negative distractor needs ("doesn't never *bake*"). The
 * two `be` habits are complements rather than verbs, which is what lets the
 * word-order questions cover both of the worksheet's patterns instead of only
 * the first.
 */
export const HABITS = [
  {
    id: "cookies",
    s: "bakes cookies for the whole family",
    base: "bake cookies for the whole family",
    be: false,
  },
  { id: "garden", s: "works in the garden", base: "work in the garden", be: false },
  { id: "jokes", s: "tells the same old jokes", base: "tell the same old jokes", be: false },
  {
    id: "films",
    s: "watches films late at night",
    base: "watch films late at night",
    be: false,
  },
  { id: "late", s: "late for Sunday dinner", base: "late for Sunday dinner", be: true },
  { id: "tired", s: "tired on Monday morning", base: "tired on Monday morning", be: true },
] as const;

export type HabitId = (typeof HABITS)[number]["id"];

export interface Suspect {
  id: string;
  name: string;
  emoji: string;
  /** The family word for this person — one of nine, each held by two people. */
  relation: string;
  she: boolean;
  /** One level per habit, in `HABITS` order. */
  routine: LevelId[];
}

/**
 * The eighteen, straight off the worksheet's tree.
 *
 * Every family word is held by *exactly two* people, and that is the whole
 * reason the roster looks like this. A relation only one person had would end
 * the case the moment somebody answered "my parent's sister" — one question,
 * no walking, no city. Paired up, the family words narrow eighteen to two and
 * the routines finish the job, which is the order a detective story wants
 * anyway: work out what kind of person, then which one.
 *
 * The routine codes are A/U/O/S/R/N — always, usually, often, sometimes,
 * rarely, never — chosen to read as people (a grandmother who always bakes, a
 * great-uncle who is never on time) and checked below to be unique.
 */
const ROSTER: [name: string, emoji: string, relation: string, she: boolean, routine: string][] = [
  ["Robert", "👴", "Grandfather", false, "RAANNS"],
  ["James", "👴", "Grandfather", false, "NOSRSA"],
  ["Mary", "👵", "Grandmother", true, "ASUNRO"],
  ["Susan", "👵", "Grandmother", true, "UNRANS"],
  ["Peter", "🧔", "Uncle", false, "NRAOUN"],
  ["Mark", "🧔", "Uncle", false, "SUAUOR"],
  ["Linda", "👩‍🦱", "Aunt", true, "OANSRU"],
  ["Helen", "👩‍🦱", "Aunt", true, "SUNAOS"],
  ["Jack", "🧒", "Cousin", false, "NOUSAR"],
  ["Lily", "🧒", "Cousin", true, "USONAO"],
  ["Arthur", "👴", "Great-Grandfather", false, "RNOUSN"],
  ["Harold", "👴", "Great-Grandfather", false, "AURSNU"],
  ["Edna", "👵", "Great-Grandmother", true, "ORSAUN"],
  ["Dorothy", "👵", "Great-Grandmother", true, "ANAROU"],
  ["Walter", "🧓", "Great-Uncle", false, "SAORNA"],
  ["Ernest", "🧓", "Great-Uncle", false, "RSNOAU"],
  ["Mabel", "👩‍🦳", "Great-Aunt", true, "OURNSA"],
  ["Agnes", "👩‍🦳", "Great-Aunt", true, "NASURO"],
];

export const SUSPECTS: Suspect[] = ROSTER.map(([name, emoji, relation, she, routine]) => ({
  id: name.toLowerCase(),
  name,
  emoji,
  relation,
  she,
  routine: [...routine].map((code) => LEVEL_CODE[code]),
}));

export const SUSPECT_BY_ID = new Map(SUSPECTS.map((s) => [s.id, s]));

/** The family words in play, in the order the case file lists them. */
export const RELATIONS: string[] = [...new Set(SUSPECTS.map((s) => s.relation))];

/**
 * A case with two answers, or a clue that gives the game away, is a bug that
 * looks like a lesson going wrong.
 *
 * Called once when a case is built. It is cheap, it can only fail because
 * somebody edited the roster, and the alternative to failing loudly is a class
 * of twelve hunting for a person who cannot be found.
 */
export function assertSolvable(): void {
  const seen = new Map<string, string>();
  for (const suspect of SUSPECTS) {
    const key = suspect.routine.join("|");
    const clash = seen.get(key);
    if (clash) {
      throw new Error(
        `[da-world] ${suspect.name} and ${clash} have the same routine — the case would have two answers.`,
      );
    }
    seen.set(key, suspect.name);
  }
  for (const relation of RELATIONS) {
    const holders = SUSPECTS.filter((s) => s.relation === relation);
    if (holders.length < 2) {
      throw new Error(
        `[da-world] only ${holders[0]?.name} is a ${relation} — that clue would end the case on its own.`,
      );
    }
  }
}

/* ================================ facts ============================== */

/**
 * One thing you know, and what it rules out.
 *
 * A fact is the *payload* of a clue rather than the question that carried it:
 * two citizens can ask differently-worded questions and hand you the same
 * fact, and the case file should show it once.
 */
export type Fact =
  | { kind: "habit"; habit: HabitId; level: LevelId }
  | { kind: "relation"; relation: string; is: boolean }
  | { kind: "gender"; she: boolean };

export function factId(fact: Fact): string {
  if (fact.kind === "gender") return `g:${fact.she ? "she" : "he"}`;
  return fact.kind === "habit"
    ? `h:${fact.habit}:${fact.level}`
    : `r:${fact.relation}:${fact.is ? "yes" : "no"}`;
}

const habitOf = (id: HabitId) => HABITS.find((h) => h.id === id)!;

/** Does this suspect survive the fact? */
export function matches(suspect: Suspect, fact: Fact): boolean {
  if (fact.kind === "gender") return suspect.she === fact.she;
  if (fact.kind === "relation") {
    return fact.is ? suspect.relation === fact.relation : suspect.relation !== fact.relation;
  }
  const index = HABITS.findIndex((h) => h.id === fact.habit);
  return suspect.routine[index] === fact.level;
}

/** The fact, written the way the case file reads it back to you. */
export function factLine(fact: Fact, she: boolean): string {
  const who = she ? "She" : "He";
  if (fact.kind === "gender") {
    return fact.she
      ? "The person is a <b>woman</b> — the family keep saying <i>she</i>."
      : "The person is a <b>man</b> — the family keep saying <i>he</i>.";
  }
  if (fact.kind === "relation") {
    const word = FAMILY_BY_WORD.get(fact.relation);
    const gloss = word ? ` — my ${word.relation}` : "";
    return fact.is
      ? `${who} is my <b>${fact.relation.toLowerCase()}</b>${gloss}.`
      : `${who} is <b>not</b> my ${fact.relation.toLowerCase()}${gloss}.`;
  }
  const habit = habitOf(fact.habit);
  const word = LEVEL_BY_ID.get(fact.level)!.words[0];
  return habit.be
    ? `${who} is <b>${word}</b> ${habit.s}.`
    : `${who} <b>${word}</b> ${habit.s}.`;
}

/* ================================ clues =============================== */

export type ClueForm = "frequency" | "order" | "family";

export interface Clue {
  id: string;
  form: ClueForm;
  fact: Fact;
  /** Question text, with inline HTML. */
  q: string;
  correct: string;
  wrongs: string[];
  explain: string;
  hint: string;
}

/** How many facts the file needs before the family will hear an accusation. */
export const CLUES_TO_ACCUSE = 5;

const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The frequency scale, written out for a hint. */
const SCALE = LEVELS.map((l) => `${l.pct}% ${l.words.join(" / ")}`).join(" · ");

/**
 * A frequency question: the sentence is true, the adverb is missing, and the
 * end of the sentence says the percentage in words.
 *
 * This is the worksheet's own gap-fill with one difference that changes what
 * it is for — the sentence is about the person you are hunting, so being right
 * is worth something past the tick. The distractors are the other bands of the
 * scale, so a near miss is a near miss and the explanation can say where on
 * the scale you landed.
 */
function frequencyClue(
  fact: Extract<Fact, { kind: "habit" }>,
  she: boolean,
  rand: () => number,
): Clue {
  const habit = habitOf(fact.habit);
  const level = LEVEL_BY_ID.get(fact.level)!;
  const who = she ? "She" : "He";
  // 10% has two words for it. Offer one, never the other: "rarely" and
  // "hardly ever" are the same answer, and a question with two right answers
  // is broken rather than difficult.
  const correct = pick(level.words, rand);
  const wrongs = shuffle(
    LEVELS.filter((l) => l.id !== level.id).map((l) => l.words[0]),
    rand,
  ).slice(0, 3);

  const sentence = habit.be
    ? `${who} is <span class="blank">___</span> ${habit.s}`
    : `${who} <span class="blank">___</span> ${habit.s}`;

  return {
    id: factId(fact),
    form: "frequency",
    fact,
    q:
      "📓 Here's what I know about them:<br>" +
      `<span class="hl">${sentence} — ${level.tell}.</span><br>` +
      "Which word goes in the gap?",
    correct,
    wrongs,
    explain: `📊 “${cap(level.tell)}” is <b>${level.pct}%</b> → <b>${level.words.join(" / ")}</b>. ${level.example}`,
    hint: `💡 Put it on the scale — ${SCALE}. Where does “${level.tell}” sit?`,
  };
}

/**
 * A word-order question: same fact, but what is being tested is where the
 * adverb *goes*.
 *
 * The wrong options are the worksheet's own flagged mistakes and nothing else.
 * That is why these are only written for BE sentences and for `never` /
 * `rarely`: those are the two cases where every wrong ordering is
 * unambiguously wrong. Put `often` at the end of a sentence and half the
 * staffroom will argue it is fine — and a distractor a teacher would defend is
 * a distractor that teaches the wrong lesson.
 */
function orderable(level: LevelId, be: boolean): boolean {
  return be || level === "never" || level === "rarely";
}

function orderClue(fact: Extract<Fact, { kind: "habit" }>, she: boolean): Clue {
  const habit = habitOf(fact.habit);
  const word = LEVEL_BY_ID.get(fact.level)!.words[0];
  const who = she ? "She" : "He";
  const lower = who.toLowerCase();

  const negative = fact.level === "never" || fact.level === "rarely";
  const correct = habit.be ? `${who} is ${word} ${habit.s}.` : `${who} ${word} ${habit.s}.`;

  // Every wrong option is one of the two mistakes the worksheet's rule box
  // names. Which pair applies depends on the sentence: the adverb is always
  // allowed to be on the wrong side of BE or of the verb, and the double
  // negative only exists where the adverb is already negative.
  const beforeBe = `${who} ${word} is ${habit.s}.`;
  const questionOrder = `Is ${lower} ${word} ${habit.s}.`;
  const doubleNegativeBe = `${who} isn't ${word} ${habit.s}.`;
  const afterVerb = `${who} ${habit.s.replace(/^(\S+)\s/, `$1 ${word} `)}.`;
  const doubleNegative = `${who} doesn't ${word} ${habit.base}.`;

  const wrongs = habit.be
    ? negative
      ? [beforeBe, doubleNegativeBe]
      : [beforeBe, questionOrder]
    : [doubleNegative, afterVerb];

  return {
    id: factId(fact),
    form: "order",
    fact,
    q:
      "📓 I know this much about them — but only one of these is good English.<br>" +
      "Which one goes in the case file?",
    correct,
    wrongs,
    explain: negative
      ? `🔤 <b>${cap(word)}</b> is already negative, so the verb stays <b>positive</b>: <i>he is never late</i>, not <i>he isn't never late</i>. And the adverb goes ${habit.be ? "<b>after</b> BE" : "<b>before</b> the verb"}.`
      : habit.be
        ? "🔤 With <b>BE</b> the adverb comes <b>after</b> it: subject → BE → adverb. <i>You are always late.</i> Auxiliary → subject → adverb is the <b>question</b> pattern: <i>Are you always late?</i>"
        : "🔤 With a normal verb the adverb comes <b>before</b> it: subject → adverb → verb. <i>He often cooks pasta.</i>",
    hint: negative
      ? `💡 “${cap(word)}” already means no — do you need <i>${habit.be ? "isn't" : "doesn't"}</i> as well?`
      : habit.be
        ? "💡 This one uses BE. Does the adverb come before BE or after it — and which pattern starts with the auxiliary?"
        : "💡 This one uses a normal verb. Does the adverb come before the verb or after it?",
  };
}

/**
 * A family question: the riddle is the worksheet's own definition and the
 * answer is the word.
 *
 * Used both ways round. A positive one ("she IS my parent's sister") leaves
 * the two people who share that word; a negative one crosses two off. Both are
 * the same piece of vocabulary, which is the point of asking either.
 */
function familyClue(
  fact: Extract<Fact, { kind: "relation" }>,
  she: boolean,
  rand: () => number,
): Clue {
  const word = FAMILY_BY_WORD.get(fact.relation)!;
  const wrongs = shuffle(
    RELATIONS.filter((r) => r !== fact.relation),
    rand,
  ).slice(0, 3);
  const who = she ? "She" : "He";
  return {
    id: factId(fact),
    form: "family",
    fact,
    q:
      "📓 One more thing about them:<br>" +
      `<span class="hl">${who} is ${fact.is ? "" : "<b>not</b> "}my ${word.relation}.</span><br>` +
      "What do we call that person in English?",
    correct: fact.relation,
    wrongs,
    explain: `👨‍👩‍👧‍👦 Your <b>${fact.relation.toLowerCase()}</b> is your ${word.relation}.${word.syn ? ` Also: ${word.syn}.` : ""}`,
    hint: `💡 Read it slowly — “my ${word.relation}”. Whose relative is it, and is it a man or a woman?`,
  };
}

/* ================================ case =============================== */

export interface Accusation {
  right: boolean;
  suspect: Suspect;
}

/**
 * One case, from opening the file to naming the person.
 *
 * The clue list is fixed when the case is built, because the citizens are
 * handed their questions at that moment and a clue that changed underneath
 * them would be a citizen who asks something different every time you walk
 * past — which is the one thing the quest engine promises never to do.
 */
export class Detective {
  readonly secret: Suspect;
  readonly clues: Clue[];
  /** Facts written into the file, oldest first. */
  readonly collected: Fact[] = [];
  solved = false;
  /** Wrong names given to the family. They cost nothing, but they are counted. */
  wrongAccusations = 0;

  private readonly collectedIds = new Set<string>();

  constructor(seed: number) {
    assertSolvable();
    const rand = mulberry32(seed);
    this.secret = pick(SUSPECTS, rand);

    // Every clue is read off the secret's own row, so nothing a citizen says
    // can be false. There are more of them than the case strictly needs:
    // twelve students spreading out across a city will not all find the same
    // three, and a file that fills up from any direction is what lets them.
    const habitFacts = HABITS.map(
      (habit, i): Extract<Fact, { kind: "habit" }> => ({
        kind: "habit",
        habit: habit.id,
        level: this.secret.routine[i],
      }),
    );
    // A negative family clue is only worth asking about a word somebody of the
    // secret's own gender could hold. "He is not my grandmother" is true, and
    // useless: every clue sentence says *he*, so the student ruled the
    // grandmothers out before they were asked. What is left after that filter
    // genuinely crosses two names off the grid.
    const sameGender = (relation: string): boolean =>
      SUSPECTS.some((s) => s.relation === relation && s.she === this.secret.she);
    const relationFacts: Extract<Fact, { kind: "relation" }>[] = [
      { kind: "relation", relation: this.secret.relation, is: true },
      ...shuffle(
        RELATIONS.filter((r) => r !== this.secret.relation && sameGender(r)),
        rand,
      )
        .slice(0, 3)
        .map((relation) => ({ kind: "relation" as const, relation, is: false })),
    ];

    const clues: Clue[] = [];
    for (const fact of habitFacts) {
      clues.push(frequencyClue(fact, this.secret.she, rand));
      // The same routine asked the other way, where it can be asked without
      // inventing a wrong answer somebody could defend.
      if (orderable(fact.level, habitOf(fact.habit).be)) {
        clues.push(orderClue(fact, this.secret.she));
      }
    }
    for (const fact of relationFacts) {
      clues.push(familyClue(fact, this.secret.she, rand));
    }
    this.clues = shuffle(clues, rand);

    // The file is never blank. Every clue sentence in the city says "he" or
    // "she", so the student would work this out from the first citizen they
    // met anyway — writing it down at the start means the suspect grid agrees
    // with what they can already see, instead of showing eighteen faces when
    // nine of them have been ruled out since the opening line.
    this.write({ kind: "gender", she: this.secret.she });
  }

  /** Suspects still standing, given everything in the file. */
  get remaining(): Suspect[] {
    return SUSPECTS.filter((s) => this.collected.every((fact) => matches(s, fact)));
  }

  /**
   * Facts earned by answering somebody, which is what the gate counts.
   *
   * The opening "it is a woman" line is not one of them: it was free, and a
   * gate you are already a fifth of the way through the moment you open the
   * file is not a gate.
   */
  get cluesFound(): number {
    return this.collected.filter((f) => f.kind !== "gender").length;
  }

  get canAccuse(): boolean {
    return this.cluesFound >= CLUES_TO_ACCUSE;
  }

  /**
   * Write a clue into the file. Returns false when the fact was already
   * there, which is how the caller knows to say "we knew that one" rather
   * than celebrating a discovery twice.
   */
  collect(clue: Clue): boolean {
    return this.write(clue.fact);
  }

  /** Every fact in the file, as ids — what a save file needs to keep. */
  factIds(): string[] {
    return this.collected.map(factId);
  }

  /**
   * Put a saved file back. Ids that no longer match a clue are dropped rather
   * than trusted: the seed rebuilds the case exactly, so an id that misses is
   * a save from a version whose clues were written differently, and inventing
   * a fact from it would be inventing evidence.
   */
  restore(ids: readonly string[]): void {
    for (const id of ids) {
      const clue = this.clues.find((c) => c.id === id);
      if (clue) this.collect(clue);
    }
  }

  private write(fact: Fact): boolean {
    const id = factId(fact);
    if (this.collectedIds.has(id)) return false;
    this.collectedIds.add(id);
    this.collected.push(fact);
    return true;
  }

  accuse(suspect: Suspect): Accusation {
    const right = suspect.id === this.secret.id;
    if (right) this.solved = true;
    else this.wrongAccusations++;
    return { right, suspect };
  }
}
