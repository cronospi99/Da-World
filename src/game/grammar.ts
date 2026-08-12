/**
 * Grammar bank — "there is / there are", quantifiers, articles, the
 * in/on/at prepositions the shop signs use and the question words the
 * directions quests rely on.
 *
 * Each item carries the explanation the student reads after answering and a
 * hint that reformulates the rule as a question instead of giving the answer.
 * `c` is the index of the correct option inside `o`.
 *
 * Every sentence talks about a street, a shop or a park that really exists in
 * the city, so a student who is unsure can walk there and look.
 */
export interface GrammarItem {
  q: string;
  o: string[];
  c: number;
  /** Explanation shown after answering. */
  e: string;
  /** Socratic hint (never states the answer). */
  h: string;
  /** Teaching tag, used by the progress report and by the missions. */
  tag: GrammarTag;
}

export type GrammarTag =
  | 'there-is-are'
  | 'some-any-no'
  | 'much-many-a-lot-of'
  | 'a-an'
  | 'countability'
  | 'in-on-at'
  | 'wh-questions';

export const GRAMMAR_BANK: GrammarItem[] = [
  /* ── there is / there are ── */
  {
    q: 'Look at Main Street! There ___ a lot of cars today. 🚗🚗🚗',
    o: ['are', 'is', 'am'],
    c: 0,
    e: '<b>Cars</b> is plural → <b>there ARE</b> a lot of cars.',
    h: "Is 'cars' singular or plural? 🤔",
    tag: 'there-is-are',
  },
  {
    q: '___ there a pharmacy near here? 💊',
    o: ['Is', 'Are', 'Do'],
    c: 0,
    e: '<b>A pharmacy</b> is singular → <b>Is there…?</b>',
    h: "'A pharmacy' = one place. Singular or plural?",
    tag: 'there-is-are',
  },
  {
    q: 'There ___ an ice cream shop on Oak Street. 🍦',
    o: ['is', 'are', 'have'],
    c: 0,
    e: 'Singular (<b>an ice cream shop</b>) → <b>there IS</b>.',
    h: "'An ice cream shop' — one place or many?",
    tag: 'there-is-are',
  },
  {
    q: 'There ___ three parks in this city: Central, Riverside and Sunset Sports. 🌳',
    o: ['are', 'is', 'be'],
    c: 0,
    e: '<b>Three parks</b> is plural → <b>there ARE</b>.',
    h: 'Count them: one park, two parks, three parks… 🧮',
    tag: 'there-is-are',
  },
  {
    q: 'There ___ any buses at the Bus Terminal at 3 a.m. 🚌🌙',
    o: ["aren't", "isn't", "don't"],
    c: 0,
    e: 'Plural + negative → <b>there AREN’T any</b>.',
    h: "'Buses' is plural, and the sentence is negative. ❌",
    tag: 'there-is-are',
  },
  {
    q: '___ there any people in Riverside Park tonight? 🏞️',
    o: ['Are', 'Is', 'Does'],
    c: 0,
    e: '<b>People</b> is plural → <b>Are there…?</b>',
    h: "'People' — one person or many? 👥",
    tag: 'there-is-are',
  },

  /* ── some / any / no ── */
  {
    q: "There aren't ___ buses on 1st Avenue right now. 🚌",
    o: ['any', 'some', 'much'],
    c: 0,
    e: 'Negative sentence → use <b>any</b>.',
    h: "'Aren't' is NEGATIVE. Which word do we use in negatives?",
    tag: 'some-any-no',
  },
  {
    q: 'There are ___ beautiful trees in Central Park. 🌳',
    o: ['some', 'any', 'a'],
    c: 0,
    e: 'Affirmative + plural → <b>some</b>.',
    h: "It's an affirmative ✅ sentence with a plural noun.",
    tag: 'some-any-no',
  },
  {
    q: 'There is ___ time — the bus leaves in 1 minute! ⏱️',
    o: ['no', 'any', 'many'],
    c: 0,
    e: '<b>No</b> + noun in an affirmative form = zero.',
    h: 'The sentence is affirmative but the meaning is ZERO. ⭕',
    tag: 'some-any-no',
  },
  {
    q: 'Are there ___ police officers near the station? 👮',
    o: ['any', 'much', 'a'],
    c: 0,
    e: 'Questions with plurals → <b>any</b>.',
    h: "It's a QUESTION with a plural noun. ❓",
    tag: 'some-any-no',
  },
  {
    q: 'Would you like ___ empanadas from Doña Luz? 🥟',
    o: ['some', 'any', 'much'],
    c: 0,
    e: 'Offers and invitations keep <b>some</b>, even inside a question.',
    h: 'This question is an OFFER 🎁, not a real question. Which word stays?',
    tag: 'some-any-no',
  },
  {
    q: 'There are ___ shops open on Sunset Boulevard on Sunday — they are all closed. 🚪',
    o: ['no', 'any', 'some'],
    c: 0,
    e: '<b>No</b> + plural noun = zero shops open.',
    h: 'All closed = how many are open? ⭕',
    tag: 'some-any-no',
  },

  /* ── much / many / a lot of ── */
  {
    q: 'How ___ traffic is there on River Road? 🚦',
    o: ['much', 'many', 'a lot'],
    c: 0,
    e: '<b>Traffic</b> is uncountable → How <b>much</b>.',
    h: "Can you count 'traffic'? One traffic, two traffics…? 🚫",
    tag: 'much-many-a-lot-of',
  },
  {
    q: 'How ___ shops are there on Market Street? 🛍️',
    o: ['many', 'much', 'some'],
    c: 0,
    e: '<b>Shops</b> is countable plural → How <b>many</b>.',
    h: 'Can you count shops? 1 shop, 2 shops… ✅',
    tag: 'much-many-a-lot-of',
  },
  {
    q: 'There are ___ of people at the National Stadium today! 🏟️',
    o: ['a lot', 'much', 'many'],
    c: 0,
    e: '<b>A lot OF</b> + plural or uncountable.',
    h: "Which one goes with 'OF'? 👀",
    tag: 'much-many-a-lot-of',
  },
  {
    q: 'How ___ water is there in the lake at Riverside Park? 💧',
    o: ['much', 'many', 'lots'],
    c: 0,
    e: '<b>Water</b> is uncountable → How <b>much</b>.',
    h: 'One water, two waters…? Can you count it? 🚫',
    tag: 'much-many-a-lot-of',
  },
  {
    q: 'There is ___ noise near the airport, but not many planes today. ✈️',
    o: ['a lot of', 'many', 'a few'],
    c: 0,
    e: '<b>A lot of</b> works with uncountable nouns like <b>noise</b>.',
    h: "'Noise' is uncountable — which phrase can go with it? 🔊",
    tag: 'much-many-a-lot-of',
  },

  /* ── a / an ── */
  {
    q: 'There is ___ airport at the end of Market Street. ✈️',
    o: ['an', 'a', 'some'],
    c: 0,
    e: '<b>Airport</b> starts with a vowel sound → <b>an</b>.',
    h: 'A-irport. Does it start with a vowel sound?',
    tag: 'a-an',
  },
  {
    q: 'There is ___ hotel next to El Dorado Restaurant. 🏨',
    o: ['a', 'an', 'any'],
    c: 0,
    e: '<b>Hotel</b> starts with the consonant sound /h/ → <b>a</b>.',
    h: 'Say it out loud: /HOtel/. Vowel or consonant sound?',
    tag: 'a-an',
  },
  {
    q: 'Is there ___ bank on Oak Street? 🏦',
    o: ['a', 'some', 'many'],
    c: 0,
    e: 'Questions with singular countable nouns use <b>a/an</b>.',
    h: "'Bank' is singular and countable.",
    tag: 'a-an',
  },
  {
    q: 'Palma Aquarium is ___ amazing place for a school trip. 🐠',
    o: ['an', 'a', 'the'],
    c: 0,
    e: '<b>Amazing</b> starts with a vowel sound → <b>an</b> amazing place.',
    h: 'Listen to the word right after the gap, not to the noun. 👂',
    tag: 'a-an',
  },
  {
    q: 'My uncle works in ___ university near Palm Avenue. 🎓',
    o: ['a', 'an', 'some'],
    c: 0,
    e: '<b>University</b> begins with the sound /juː/, a consonant sound → <b>a</b>.',
    h: 'Say it out loud: /YOU-niversity/. Which sound do you hear first?',
    tag: 'a-an',
  },
  {
    q: 'There is ___ observatory on Palm Avenue. 🔭',
    o: ['an', 'a', 'any'],
    c: 0,
    e: '<b>Observatory</b> starts with a vowel sound → <b>an</b>.',
    h: 'O-bservatory. Vowel sound or consonant sound?',
    tag: 'a-an',
  },

  /* ── countable & uncountable ── */
  {
    q: "There isn't ___ noise in the Public Library. 🤫📖",
    o: ['much', 'many', 'some'],
    c: 0,
    e: '<b>Noise</b> is uncountable → not <b>much</b> noise.',
    h: "Can you count 'noise'? 1 noise, 2 noises…? 🚫",
    tag: 'countability',
  },
  {
    q: "We don't have ___ money for the cinema. 🎬💸",
    o: ['much', 'many', 'a'],
    c: 0,
    e: '<b>Money</b> is uncountable → not <b>much</b> money.',
    h: "Can you count 'money'? 1 money, 2 moneys…? 🚫",
    tag: 'countability',
  },
  {
    q: 'There are ___ churches in this city — only one. ⛪',
    o: ['not many', 'not much', 'no a'],
    c: 0,
    e: 'Countable plural → <b>not many</b> churches.',
    h: "'Churches' is countable and plural.",
    tag: 'countability',
  },
  {
    q: 'I bought ___ bread at Pepe’s Bakery. 🥖',
    o: ['a loaf of', 'a', 'three'],
    c: 0,
    e: '<b>Bread</b> is uncountable, so we measure it: <b>a loaf of</b> bread.',
    h: 'Bread is uncountable — how do we measure it? 🍞',
    tag: 'countability',
  },
  {
    q: 'There are ___ benches in Central Park. 🪑',
    o: ['a few', 'a little', 'much'],
    c: 0,
    e: '<b>Benches</b> is countable plural → <b>a few</b> benches.',
    h: 'Countable plural. Which quantifier belongs to countables? ✅',
    tag: 'countability',
  },
  {
    q: 'Please put ___ sugar in my coffee at Doña Rosa’s. ☕',
    o: ['a little', 'a few', 'many'],
    c: 0,
    e: '<b>Sugar</b> is uncountable → <b>a little</b> sugar.',
    h: 'Sugar cannot be counted one by one. Which quantifier is for uncountables? 🥄',
    tag: 'countability',
  },

  /* ── in / on / at ── */
  {
    q: 'The Public Library is ___ Oak Street. 📖',
    o: ['on', 'in', 'at'],
    c: 0,
    e: 'We use <b>on</b> with the name of a street.',
    h: 'Which little word goes with the NAME of a street? 🛣️',
    tag: 'in-on-at',
  },
  {
    q: 'Meet me ___ the bus stop opposite Mega Mall. 🚏',
    o: ['at', 'in', 'on'],
    c: 0,
    e: 'We use <b>at</b> for a point or a meeting place.',
    h: 'A bus stop is a POINT, not an area or a surface. 📍',
    tag: 'in-on-at',
  },
  {
    q: 'The children are playing ___ Riverside Park. 🏞️',
    o: ['in', 'on', 'at'],
    c: 0,
    e: 'A park is an area you go inside → <b>in</b> the park.',
    h: 'Are they INSIDE an area, or standing over a line? 🟢',
    tag: 'in-on-at',
  },
  {
    q: 'Turn left ___ the corner of Main Street and 1st Avenue. 🧭',
    o: ['at', 'in', 'on'],
    c: 0,
    e: 'A corner is a point on the map → <b>at</b> the corner.',
    h: 'A corner is one exact spot. Which preposition marks a spot? 📍',
    tag: 'in-on-at',
  },
  {
    q: 'The Golden Llama Hotel is ___ the corner, ___ Main Street. 🏨',
    o: ['on / on', 'in / at', 'at / in'],
    c: 0,
    e: 'A building stands <b>on</b> the corner and <b>on</b> the street it faces.',
    h: 'Both gaps talk about the same street. Which word goes with street names? 🛣️',
    tag: 'in-on-at',
  },

  /* ── question words ── */
  {
    q: '___ is the Central Train Station? — It’s on Market Street. 🚉',
    o: ['Where', 'What', 'How'],
    c: 0,
    e: 'We ask for a PLACE with <b>Where…?</b>',
    h: 'The answer is a place. Which question word asks for a place? 🗺️',
    tag: 'wh-questions',
  },
  {
    q: '___ do I get to the stadium? — Go straight and turn right. 🏟️',
    o: ['How', 'Where', 'Who'],
    c: 0,
    e: 'We ask for a way or a method with <b>How…?</b>',
    h: 'The answer explains the WAY to go, not the place itself. 🧭',
    tag: 'wh-questions',
  },
  {
    q: '___ many blocks is the museum from here? — Two. 🏛️',
    o: ['How', 'What', 'Where'],
    c: 0,
    e: '<b>How many…?</b> asks for a number of countable things.',
    h: 'The answer is a NUMBER. Which word starts a quantity question? 🔢',
    tag: 'wh-questions',
  },
  {
    q: '___ time does Zipa Supermarket close? — At 9 p.m. 🕘',
    o: ['What', 'Where', 'Which'],
    c: 0,
    e: 'We ask the clock with <b>What time…?</b>',
    h: 'The answer is a time on the clock. ⏰',
    tag: 'wh-questions',
  },
  {
    q: '___ is the shop on your left? — It is Bogotá Books. 📚',
    o: ['What', 'How', 'When'],
    c: 0,
    e: 'We ask for a thing or a name with <b>What…?</b>',
    h: 'The answer names a shop. Which question word asks for a thing? 🏷️',
    tag: 'wh-questions',
  },
];

export const GRAMMAR_TAG_LABEL: Record<GrammarTag, string> = {
  'there-is-are': 'there is / there are',
  'some-any-no': 'some / any / no',
  'much-many-a-lot-of': 'much / many / a lot of',
  'a-an': 'a / an',
  countability: 'countable & uncountable nouns',
  'in-on-at': 'in / on / at',
  'wh-questions': 'question words',
};

/** Every tag, in the order the missions walk the class through them. */
export const GRAMMAR_TAGS = Object.keys(GRAMMAR_TAG_LABEL) as GrammarTag[];
