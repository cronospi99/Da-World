import type { Outfit } from "../city/npcData";

/**
 * Who you are in the city.
 *
 * Two bodies, because they answer different questions. The **person** is built
 * from the same rig as every citizen on the pavement, at the same height, in
 * colours you pick — which is what makes the crowd feel like a crowd you are
 * part of rather than one you are visiting. The **robot** is the rigged GLB the
 * game shipped with first: a real skeleton with real animation clips, and the
 * one thing in Da World that is unmistakably *yours*.
 *
 * The old objection to the robot was never the robot. It was that it stood half
 * a metre over everybody, shaded like plastic beside a matte city, and was the
 * only thing you could be. All three are fixed rather than argued with: it is
 * scaled to the same `PERSON_HEIGHT` as everybody else, its materials are
 * rebuilt with the city's own ramps, and it is now a choice you make on a
 * screen before you walk out of the door.
 *
 * The choice is remembered, so a student picks their character once and it is
 * still theirs next lesson.
 */

export type BodyKind = "human" | "robot";

export interface Appearance {
  kind: BodyKind;
  /** Shirt on a person; the painted panels on a robot. */
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  outfit: Outfit;
}

/** The palettes the customiser offers, chosen to read at camera distance. */
export const SHIRT_COLOURS = [
  "#19b8e8",
  "#e8637c",
  "#4fbf8f",
  "#f0d060",
  "#8f5be8",
  "#e8a33f",
  "#3fc4c4",
  "#f5f2e8",
] as const;

export const PANTS_COLOURS = [
  "#3a2a5e",
  "#3f4a6b",
  "#33384a",
  "#7a5f3a",
  "#2f3542",
  "#8d3f2e",
] as const;

export const SKIN_COLOURS = [
  "#f0c39a",
  "#e8b98d",
  "#d8a273",
  "#c78a5c",
  "#8a5a33",
  "#5e3a1f",
] as const;

export const HAIR_COLOURS = [
  "#241a12",
  "#5a3a20",
  "#a8462c",
  "#dcdcdc",
  "#1a1410",
  "#7a3df0",
] as const;

export const OUTFITS: { id: Outfit; label: string }[] = [
  { id: "backpack", label: "🎒 Backpack" },
  { id: "cap", label: "🧢 Cap" },
  { id: "hat", label: "👒 Sun hat" },
  { id: "helmet", label: "⛑️ Helmet" },
  { id: "apron", label: "🥼 Apron" },
  { id: "glasses", label: "🤓 Glasses" },
  { id: "none", label: "Nothing" },
];

/** The explorer: the one person in the city dressed like a visitor to it. */
export const DEFAULT_APPEARANCE: Appearance = {
  kind: "human",
  shirt: "#19b8e8",
  pants: "#3a2a5e",
  skin: "#f0c39a",
  hair: "#7a3df0",
  outfit: "backpack",
};

const STORAGE_KEY = "da-world:appearance";

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const saved = JSON.parse(raw) as Partial<Appearance>;
    return sanitise({ ...DEFAULT_APPEARANCE, ...saved });
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* private browsing: they are this character for this lesson only. */
  }
}

/**
 * A saved appearance from an older version — or an edited one — must never be
 * able to produce a character the game cannot build.
 */
function sanitise(appearance: Appearance): Appearance {
  const oneOf = <T extends string>(value: string, list: readonly T[], fallback: T): T =>
    (list as readonly string[]).includes(value) ? (value as T) : fallback;
  return {
    kind: appearance.kind === "robot" ? "robot" : "human",
    shirt: oneOf(appearance.shirt, SHIRT_COLOURS, DEFAULT_APPEARANCE.shirt as never),
    pants: oneOf(appearance.pants, PANTS_COLOURS, DEFAULT_APPEARANCE.pants as never),
    skin: oneOf(appearance.skin, SKIN_COLOURS, DEFAULT_APPEARANCE.skin as never),
    hair: oneOf(appearance.hair, HAIR_COLOURS, DEFAULT_APPEARANCE.hair as never),
    outfit: oneOf(
      appearance.outfit,
      OUTFITS.map((o) => o.id),
      DEFAULT_APPEARANCE.outfit,
    ),
  };
}
