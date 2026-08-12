/**
 * The citizens of the city. Positions are in tiles and always land on a
 * sidewalk (or inside a park) so the player can reach them on foot.
 *
 * Beyond the quest they carry, every citizen has a *greeting* — a line of
 * small talk that pops up as a speech bubble when the player walks past. It
 * costs nothing, it is never graded, and it is the cheapest reading practice
 * in the game: thirty short sentences the student meets simply by exploring.
 *
 * Citizens whose quest does not depend on where they are standing may also
 * patrol a short stretch of pavement (`walk` + `axis`). Anybody who gives
 * directions stays put, because their route was computed from their corner.
 */

export type QuestKind = 'directions' | 'find' | 'grammar';

/** Accessory that makes a citizen recognisable from across the street. */
export type Outfit = 'none' | 'cap' | 'hat' | 'backpack' | 'apron' | 'helmet' | 'glasses';

export interface NpcDef {
  name: string;
  /** Emoji face, drawn onto the billboard portrait above the character. */
  face: string;
  role: string;
  x: number;
  y: number;
  type: QuestKind;
  /** Shirt / hair colours for the low-poly body. */
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  outfit?: Outfit;
  /** Small talk shown in a bubble when the player is close. */
  greet: string;
  /** Half-length of the pavement stretch this citizen paces, in tiles. */
  walk?: number;
  /** Axis the patrol runs along. */
  axis?: 'h' | 'v';
}

export const NPC_DEFS: NpcDef[] = [
  /* ── Main Street ── */
  { name: 'Sofía', face: '👩‍🦰', role: 'Lost tourist', x: 15.5, y: 7.5, type: 'directions', shirt: '#e8637c', pants: '#3f4a6b', skin: '#f0c39a', hair: '#a8462c', outfit: 'backpack', greet: 'My map is upside down again! 🗺️' },
  { name: 'Don Pepe', face: '👨‍🦳', role: 'Baker', x: 20.5, y: 7.5, type: 'find', shirt: '#f2f0e8', pants: '#8a8f9c', skin: '#e8b98d', hair: '#dcdcdc', outfit: 'apron', greet: 'The bread is still warm! 🥖' },
  { name: 'Farmer Joe', face: '👨‍🌾', role: 'Farmer', x: 3.5, y: 12.5, type: 'find', shirt: '#79a84f', pants: '#7a5f3a', skin: '#d8a273', hair: '#8a6a3a', outfit: 'hat', greet: 'There are a lot of apples today! 🍎', walk: 2, axis: 'h' },
  { name: 'Valery', face: '👧', role: 'Student', x: 28.5, y: 12.5, type: 'find', shirt: '#ffcf5c', pants: '#4f7fc0', skin: '#f0c39a', hair: '#5a3a20', outfit: 'backpack', greet: 'Is there a library near here? 📖' },
  { name: 'Lucía', face: '👩‍⚕️', role: 'Nurse', x: 33.5, y: 12.5, type: 'grammar', shirt: '#f4f6fa', pants: '#6fb6c8', skin: '#b3764a', hair: '#241a12', greet: 'The hospital is opposite the pet shop. 🏥', walk: 2, axis: 'h' },
  { name: 'Rosa', face: '💐', role: 'Florist', x: 46.5, y: 12.5, type: 'find', shirt: '#e08bb4', pants: '#5a7f5a', skin: '#e8c8a8', hair: '#3a2418', outfit: 'apron', greet: 'Some flowers for Main Street! 🌷' },
  { name: 'Beto', face: '🍖', role: 'Butcher', x: 60.5, y: 7.5, type: 'find', shirt: '#f0eae0', pants: '#7a3a3a', skin: '#c78a5c', hair: '#241a12', outfit: 'apron', greet: 'Welcome to the east side of the city! 🧭' },

  /* ── Oak Street ── */
  { name: 'Ramírez', face: '👮', role: 'Police officer', x: 7.5, y: 14.5, type: 'grammar', shirt: '#3f5a95', pants: '#2c3a5c', skin: '#c78a5c', hair: '#2a2018', outfit: 'cap', greet: 'Cross at the crossing, please! 🚸', walk: 2.5, axis: 'v' },
  { name: 'Mike', face: '🧢', role: 'Skater', x: 31.5, y: 19.5, type: 'directions', shirt: '#4fbf8f', pants: '#33384a', skin: '#d8a273', hair: '#2a2018', outfit: 'cap', greet: 'The arcade is my favourite place. 🕹️' },
  { name: 'Diego', face: '🚴', role: 'Cyclist', x: 47.5, y: 19.5, type: 'find', shirt: '#e8a33f', pants: '#2f3542', skin: '#8a5a33', hair: '#1a1410', outfit: 'helmet', greet: 'Are there any bike lanes on Palm Avenue? 🚲', walk: 3, axis: 'h' },
  { name: 'Andrés', face: '🧔', role: 'Bus driver', x: 14.5, y: 24.5, type: 'directions', shirt: '#c9743f', pants: '#3b4152', skin: '#c78a5c', hair: '#33241a', outfit: 'cap', greet: 'My bus leaves in five minutes! 🚌' },
  { name: 'Karol', face: '👱‍♀️', role: 'Shop assistant', x: 30.5, y: 24.5, type: 'find', shirt: '#d989c4', pants: '#5a4a7a', skin: '#f0c39a', hair: '#e8c96a', greet: 'We have a lot of new shoes! 👟' },
  { name: 'Naty', face: '🎨', role: 'Painter', x: 62.5, y: 24.5, type: 'grammar', shirt: '#f0f0e0', pants: '#4a4a6a', skin: '#e0ae82', hair: '#6a2a8a', outfit: 'apron', greet: 'There is an art gallery behind me. 🖼️' },
  { name: 'Samuel', face: '🧑‍🚒', role: 'Firefighter', x: 7.5, y: 26.5, type: 'grammar', shirt: '#d05a3a', pants: '#33384a', skin: '#8a5a33', hair: '#1a1410', outfit: 'helmet', greet: 'Is there any smoke? No? Perfect. 🚒', walk: 2, axis: 'v' },

  /* ── River Road ── */
  { name: 'Nico', face: '🕹️', role: 'Gamer', x: 22.5, y: 28.5, type: 'directions', shirt: '#3fc4c4', pants: '#4a4a5e', skin: '#f0c39a', hair: '#6a3ad0', outfit: 'glasses', greet: 'One more level and I go home. 🎮' },
  { name: 'Marta', face: '👩‍🏫', role: 'Teacher', x: 29.5, y: 31.5, type: 'grammar', shirt: '#8fb0e0', pants: '#3a3a5a', skin: '#e8c8a8', hair: '#4a3018', outfit: 'glasses', greet: 'How many shops are there on this street? 🤔', walk: 3, axis: 'h' },
  { name: 'Ms. Lee', face: '👵', role: 'Grandmother', x: 45.5, y: 31.5, type: 'directions', shirt: '#9f8fd0', pants: '#6a6070', skin: '#e8c8a8', hair: '#e4e4e8', greet: 'I walk here every morning. 🚶‍♀️' },
  { name: 'Lina', face: '🐠', role: 'Aquarium guide', x: 58.5, y: 31.5, type: 'grammar', shirt: '#4fb0d0', pants: '#2f4a6a', skin: '#b3764a', hair: '#1a1420', greet: 'There are a lot of fish inside! 🐟' },
  { name: 'Tommy', face: '👦', role: 'Kid with a map', x: 16.5, y: 36.5, type: 'find', shirt: '#54a8e8', pants: '#3f6b3f', skin: '#e8b98d', hair: '#4a3018', outfit: 'backpack', greet: 'Where is the toy store? 🧸' },
  { name: 'Camila', face: '🎧', role: 'DJ', x: 34.5, y: 36.5, type: 'grammar', shirt: '#8f5be8', pants: '#22222e', skin: '#a5673d', hair: '#1a1420', greet: 'Turn the music up! 🎶', walk: 2.5, axis: 'h' },
  { name: 'Ariel', face: '⛴️', role: 'Ferry captain', x: 5.5, y: 36.5, type: 'directions', shirt: '#f0f0f0', pants: '#2a3a5a', skin: '#c78a5c', hair: '#dcdcdc', outfit: 'cap', greet: 'The ferry leaves at four o’clock. ⛴️' },
  { name: 'Mateo', face: '🧑‍🔧', role: 'Mechanic', x: 52.5, y: 36.5, type: 'find', shirt: '#5a6a7a', pants: '#3a3a3a', skin: '#8a5a33', hair: '#241a12', outfit: 'cap', greet: 'I can fix any bike on Palm Avenue. 🛠️' },

  /* ── Market Street ── */
  { name: 'Yuli', face: '💇', role: 'Hairdresser', x: 27.5, y: 40.5, type: 'find', shirt: '#e08bd0', pants: '#4a3a5a', skin: '#f0c39a', hair: '#e05fa0', greet: 'Your hair looks great already! ✂️' },
  { name: 'Pablo', face: '🚕', role: 'Taxi driver', x: 12.5, y: 43.5, type: 'grammar', shirt: '#f0d060', pants: '#3a3a4a', skin: '#c78a5c', hair: '#241a12', outfit: 'cap', greet: 'Taxi! Where do you want to go? 🚕', walk: 2, axis: 'v' },
  { name: 'Paula', face: '👩‍🍳', role: 'Waitress', x: 44.5, y: 43.5, type: 'grammar', shirt: '#f0f0f0', pants: '#3a3a4a', skin: '#e0ae82', hair: '#5c3a22', outfit: 'apron', greet: 'Would you like some juice? 🥤' },
  { name: 'Coach Óscar', face: '🏋️', role: 'Coach', x: 18.5, y: 48.5, type: 'directions', shirt: '#e85d3d', pants: '#2f3542', skin: '#8a5a33', hair: '#1a1410', outfit: 'cap', greet: 'The stadium is right behind me! 🏟️' },
  { name: 'Iván', face: '🚉', role: 'Train guard', x: 59.5, y: 48.5, type: 'directions', shirt: '#4a6a9a', pants: '#2a2a3a', skin: '#e8c8a8', hair: '#3a2a1a', outfit: 'cap', greet: 'The next train is at half past two. 🚆' },

  /* ── Sunset Boulevard and the parks ── */
  { name: 'Abuela Inés', face: '🧶', role: 'Grandma knitting', x: 3.5, y: 3.5, type: 'grammar', shirt: '#d0a8c8', pants: '#7a6a8a', skin: '#e8c8a8', hair: '#f0f0f0', greet: 'There are some lovely trees in this park. 🌳' },
  { name: 'Elena', face: '🏃', role: 'Runner', x: 4.5, y: 62.5, type: 'directions', shirt: '#3fd0a0', pants: '#2a2a3a', skin: '#b3764a', hair: '#241a12', greet: 'Riverside Park is the best place to run! 🏞️' },
  { name: 'Sara', face: '🩰', role: 'Dancer', x: 20.5, y: 60.5, type: 'grammar', shirt: '#f0a0c0', pants: '#5a3a6a', skin: '#f0c39a', hair: '#2a1a10', greet: 'There is a dance class at six. 💃', walk: 2.5, axis: 'h' },
  { name: 'Hugo', face: '📻', role: 'Radio host', x: 45.5, y: 60.5, type: 'grammar', shirt: '#c0a070', pants: '#3a3a4a', skin: '#e0ae82', hair: '#4a3018', outfit: 'glasses', greet: 'You are live on Andes Radio! 🎙️' },
  { name: 'Kevin', face: '🛹', role: 'Skate kid', x: 63.5, y: 62.5, type: 'grammar', shirt: '#f06a4a', pants: '#33384a', skin: '#d8a273', hair: '#2a2018', outfit: 'cap', greet: 'Come and play football with us! ⚽', walk: 2, axis: 'h' },
];
