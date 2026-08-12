/**
 * The phrase book.
 *
 * Everything a citizen might ask you to produce, gathered in one place so a
 * player who is stuck has somewhere to look that is not the answer. It is
 * reference material, not content: the questions are generated from the city
 * (see `quests.ts`), and this is the vocabulary they are generated *in*.
 *
 * Ported from City Explorer, where it filled the same role, and grouped here by
 * the two things the game modes are named after — the words for describing
 * where a place is, and the words for telling somebody how to get there.
 */

export const DIRECTION_PHRASES: [string, string][] = [
  ['⬆️', 'Go straight on / ahead'],
  ['➡️', 'Turn right'],
  ['⬅️', 'Turn left'],
  ['🔁', 'Turn around'],
  ['⏭️', 'Pass / go past'],
  ['🛣️', 'Go along'],
  ['🌉', 'Go across'],
  ['🚇', 'Go through'],
  ['🧱', 'Go for 1 / 2 / 3 blocks'],
  ['📍', 'Stay on … until you reach'],
  ['1️⃣', 'Take the 1st / 2nd right or left'],
  ['🏁', 'Go to the end of the street'],
  ['🛤️', 'Merge onto'],
  ['🚪', 'Exit … at'],
  ['🧭', "It's on your left / right"],
];

export const PREPOSITIONS: [string, string][] = [
  ['↔️', 'next to'],
  ['🤝', 'between … and …'],
  ['🔄', 'opposite / across from'],
  ['⬅️🏠', 'in front of'],
  ['🏠➡️', 'behind'],
  ['📍', 'near / close to'],
  ['📐', 'on the corner of … and …'],
  ['🏁', 'at the end of'],
  ['🚀', 'far from'],
];

export const EXTRA_PLACES: { e: string; t: string }[] = [
  { e: '🌳', t: 'park' },
  { e: '⚽', t: 'sports park' },
  { e: '🚏', t: 'bus stop' },
  { e: '🚦', t: 'traffic light' },
  { e: '🚸', t: 'crosswalk' },
  { e: '🛣️', t: 'avenue / boulevard' },
  { e: '🪧', t: 'street sign' },
  { e: '🛤️', t: 'pavement / sidewalk' },
  { e: '⛲', t: 'fountain' },
  { e: '🏞️', t: 'lake' },
  { e: '🎪', t: 'bandstand' },
  { e: '🛝', t: 'playground' },
];

export const GRAMMAR_NOTES: string[] = [
  '<b>There is</b> + singular / uncountable → There is <b>a</b> bank. There is <b>a lot of</b> traffic.',
  '<b>There are</b> + plural → There are <b>some</b> shops on Market Street.',
  '<b>Some</b> → affirmative. <b>Any</b> → negatives &amp; questions (Are there any buses? There aren\'t any buses).',
  '<b>Much</b> + uncountable (How much traffic?). <b>Many</b> + countable plural (How many shops?).',
  '<b>A lot of</b> works with both: a lot of people, a lot of noise.',
  '<b>A / An</b>: a hotel, a bakery — an airport, an arcade (the vowel SOUND decides!).',
  '<b>No</b> + noun = zero in affirmative form: There is <b>no</b> time. There are <b>no</b> taxis.',
  'Location: <b>The bakery is next to the café, between the bank and the school, opposite the gym.</b>',
  '<b>In / on / at</b>: <b>in</b> a park or a city, <b>on</b> a street, <b>at</b> a bus stop or a corner.',
  '<b>Question words</b>: <b>Where</b> (place), <b>How</b> (the way), <b>How many</b> (number), <b>What time</b> (clock).',
  'Telling the time: <b>It\'s half past two. The shop opens at nine o\'clock. It closes at nine p.m.</b>',
];
