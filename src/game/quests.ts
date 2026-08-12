/**
 * Quest engine — what the citizens of the city actually ask you.
 *
 * Three question families, all generated from the real city geometry so the
 * English the player reads is always true of the world they can walk through:
 *
 *   directions → BFS route between two intersections, verbalised as
 *                "Go straight on Oak Street for 2 blocks, turn left onto…"
 *   find       → prepositions of place derived from real neighbours
 *                ("between … and …", "opposite", "on the corner of")
 *   grammar    → one item from the grammar bank
 *
 * Distractors are produced by *flipping* one property of the correct answer
 * (left/right, the final side, the block count) instead of being random noise:
 * a wrong option is therefore always plausible and always diagnostic.
 *
 * Nothing here knows about pixels. The route it computes is walkable because
 * it is computed from `layout.ts`, the same table the pavement, the crossings
 * and the painted street names come from.
 */

import { HROADS, VROADS, INTERSECTIONS, type Intersection } from "../city/layout";
import { BUILDINGS, doorOf, relationsOf, type Building } from "../city/buildings";
import { GRAMMAR_BANK, type GrammarItem, type GrammarTag } from "./grammar";
import { nearestWalkable } from "../city/ground";
import { mulberry32, shuffle } from "../core/rng";
import { NPC_DEFS, type NpcDef, type QuestKind } from "../city/npcData";

export interface Quest {
  kind: QuestKind;
  target: Building | null;
  /** Question text — may contain inline HTML (`<span class="hl">`). */
  q: string;
  correct: string;
  wrongs: string[];
  /** Stable option order (shuffled once, with the NPC's own seed). */
  options: string[];
  explain: string;
  hint: string;
  tag: GrammarTag | "directions" | "prepositions";
  /** Runtime flags. */
  hintUsed?: boolean;
  locked?: string[];
  attempts?: number;
}

export interface Npc extends NpcDef {
  id: number;
  quest: Quest;
  done: boolean;
  /**
   * Grammar citizens keep teaching after their first question: every time the
   * player answers, they deal the next item from the bank. That is what makes
   * the per-language-point missions reachable with thirty-odd citizens, and it
   * turns each of them into a little drill station.
   */
  practice: boolean;
  round: number;
}

/* ------------------------------- routing ------------------------------- */

const nodeAt = (vi: number, hi: number): Intersection | undefined =>
  INTERSECTIONS.find((n) => n.vi === vi && n.hi === hi);

function neighbours(n: Intersection): Intersection[] {
  const out: Intersection[] = [];
  for (const [dvi, dhi] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const m = nodeAt(n.vi + dvi, n.hi + dhi);
    if (m) out.push(m);
  }
  return out;
}

export function nearestNode(x: number, y: number): Intersection {
  let best = INTERSECTIONS[0];
  let bd = Infinity;
  for (const n of INTERSECTIONS) {
    const d = Math.hypot(n.cx - x, n.cy - y);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function bfsPath(a: Intersection, b: Intersection): Intersection[] | null {
  const prev = new Map<Intersection, Intersection | null>([[a, null]]);
  const queue: Intersection[] = [a];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === b) break;
    for (const m of neighbours(n)) {
      if (!prev.has(m)) {
        prev.set(m, n);
        queue.push(m);
      }
    }
  }
  if (!prev.has(b)) return null;
  const path: Intersection[] = [];
  let cur: Intersection | null | undefined = b;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return path;
}

const segStreet = (a: Intersection, b: Intersection): string =>
  a.hi === b.hi ? HROADS[a.hi].name : VROADS[a.vi].name;

/**
 * Turn a path into natural-language directions.
 * `flip` mutates one aspect of the truth to build a believable distractor:
 *   0 = correct · 1 = every turn mirrored · 2 = final side mirrored
 *   3 = first leg one block too long
 */
function buildInstructions(path: Intersection[], target: Building, flip: 0 | 1 | 2 | 3): string {
  const dirs = [];
  for (let i = 1; i < path.length; i++) {
    dirs.push({
      dx: Math.sign(path[i].cx - path[i - 1].cx),
      dy: Math.sign(path[i].cy - path[i - 1].cy),
    });
  }
  const groups: { street: string; len: number; dir: { dx: number; dy: number } }[] = [];
  let cd = dirs[0];
  let cl = 1;
  let cs = segStreet(path[0], path[1]);
  for (let k = 1; k < dirs.length; k++) {
    if (dirs[k].dx === cd.dx && dirs[k].dy === cd.dy) {
      cl++;
    } else {
      groups.push({ street: cs, len: cl, dir: cd });
      cd = dirs[k];
      cl = 1;
      cs = segStreet(path[k], path[k + 1]);
    }
  }
  groups.push({ street: cs, len: cl, dir: cd });

  const lr = (cross: number) => ((flip === 1 ? cross <= 0 : cross > 0) ? "right" : "left");
  const steps: string[] = [];
  const n0 = flip === 3 ? groups[0].len + 1 : groups[0].len;
  steps.push(`Go straight on ${groups[0].street} for ${n0} ${n0 === 1 ? "block" : "blocks"}`);
  for (let k = 1; k < groups.length; k++) {
    const p = groups[k - 1].dir;
    const c = groups[k].dir;
    steps.push(`turn ${lr(p.dx * c.dy - p.dy * c.dx)} onto ${groups[k].street}`);
    if (groups[k].len > 1) steps.push(`go straight for ${groups[k].len} blocks`);
  }
  const last = groups[groups.length - 1].dir;
  const end = path[path.length - 1];
  const tv = { dx: target.x + target.w / 2 - end.cx, dy: target.y + target.h / 2 - end.cy };
  let cross = last.dx * tv.dy - last.dy * tv.dx;
  if (flip === 2) cross = -cross;
  let tail = `the ${target.type.replace(/^an? /, "")} is on your ${cross > 0 ? "right" : "left"}`;
  const rel = relationsOf(target);
  const nb = rel.left ?? rel.right;
  if (nb) tail += `, next to ${nb.name}`;
  steps.push(tail);
  const text = steps.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

function makeDirectionsQuest(npc: NpcDef, rand: () => number): Quest {
  const from = nearestNode(npc.x, npc.y);
  const candidates = BUILDINGS.filter((b) => {
    const d = doorOf(b);
    const to = nearestNode(d.x, d.y);
    return to !== from && Math.abs(to.vi - from.vi) + Math.abs(to.hi - from.hi) >= 2;
  });
  const target = candidates[Math.floor(rand() * candidates.length)];
  const door = doorOf(target);
  const path = bfsPath(from, nearestNode(door.x, door.y))!;
  const correct = buildInstructions(path, target, 0);
  const wrongs: string[] = [];
  for (const f of [1, 2, 3] as const) {
    const w = buildInstructions(path, target, f);
    if (w !== correct && !wrongs.includes(w)) wrongs.push(w);
  }
  while (wrongs.length > 2) wrongs.pop();
  return {
    kind: "directions",
    target,
    q: `Excuse me! 🙏 I'm lost… How do I get to <span class="hl">${target.name}</span> ${target.emoji} from here?`,
    correct,
    wrongs,
    options: [],
    explain:
      "🧭 Trace the route in your head: count the blocks and check LEFT ⬅ / ➡ RIGHT carefully.",
    hint: `💡 ${target.name} is on <b>${target.street}</b>. Look for the gold arrow over its roof — walk the route yourself and come back.`,
    tag: "directions",
  };
}

function makeFindQuest(npc: NpcDef, rand: () => number): Quest {
  void npc;
  const candidates = BUILDINGS.filter((b) => {
    const r = relationsOf(b);
    return r.left ?? r.right;
  });
  const target = candidates[Math.floor(rand() * candidates.length)];
  const rel = relationsOf(target);
  const templates: string[] = [];
  if (rel.left && rel.right)
    templates.push(`It's on ${target.street}, between ${rel.left.name} and ${rel.right.name}.`);
  if (rel.corner) {
    const nb = (rel.left ?? rel.right)!;
    templates.push(`It's on the corner of ${target.street} and ${rel.corner}, next to ${nb.name}.`);
  }
  if (rel.opp) templates.push(`It's on ${target.street}, opposite ${rel.opp.name}.`);
  {
    const nb = (rel.left ?? rel.right)!;
    templates.push(`It's on ${target.street}, next to ${nb.name}.`);
  }
  const correct = templates[Math.floor(rand() * templates.length)];
  const others = BUILDINGS.filter(
    (o) => o !== target && o !== rel.left && o !== rel.right && o !== rel.opp,
  );
  const o1 = others[Math.floor(rand() * others.length)];
  const o2 = others[Math.floor(rand() * others.length)];
  const wrongStreet = HROADS.map((r) => r.name).filter((s) => s !== target.street)[
    Math.floor(rand() * 3)
  ];
  const wrongs = [
    correct.replace(target.street, wrongStreet),
    `It's on ${target.street}, ${rand() < 0.5 ? "opposite " : "next to "}${o1.name}.`,
  ];
  if (wrongs[1] === correct) wrongs[1] = `It's on ${target.street}, behind ${o2.name}.`;
  return {
    kind: "find",
    target,
    q: `Sorry to bother you! 😅 Where is <span class="hl">${target.name}</span> ${target.emoji}? (${target.type})`,
    correct,
    wrongs,
    options: [],
    explain: `🗺️ Walk to <b>${target.street}</b> and read the shop signs! Use prepositions: <b>next to</b>, <b>between … and …</b>, <b>opposite</b>, <b>on the corner of</b>.`,
    hint: `💡 ${target.name} is on <b>${target.street}</b> — the gold arrow marks its roof. Walk there, look at its <b>neighbours</b>, then come back and answer.`,
    tag: "prepositions",
  };
}

/* --------------------------- NPC construction --------------------------- */

/** Deal grammar items so no two citizens ask the same thing. */
function grammarDealer() {
  const rand = mulberry32(99);
  const bank = shuffle(GRAMMAR_BANK, rand);
  let i = 0;
  return () => bank[i++ % bank.length];
}

/**
 * The deck the grammar citizens draw from. It is rebuilt by `buildNpcs()`, so
 * a fresh city always deals the same first hand — the determinism that lets a
 * player leave a conversation, walk the route and come back to it.
 */
let deal = grammarDealer();

function grammarQuest(g: GrammarItem, id: number, round: number): Quest {
  const quest: Quest = {
    kind: "grammar",
    target: null,
    q: `Quick English question! ⚡ Complete the sentence:<br><span class="hl">${g.q}</span>`,
    correct: g.o[g.c],
    wrongs: g.o.filter((_, i) => i !== g.c),
    options: [],
    explain: `✏️ ${g.e}`,
    hint: `💡 ${g.h}`,
    tag: g.tag,
  };
  quest.options = shuffle(
    [quest.correct, ...quest.wrongs],
    mulberry32(5000 + id * 31 + round * 977),
  );
  return quest;
}

/** Hand a grammar citizen the next item in the deck. */
export function refreshGrammarQuest(npc: Npc): void {
  if (npc.type !== "grammar") return;
  npc.round += 1;
  npc.practice = true;
  npc.quest = grammarQuest(deal(), npc.id, npc.round);
}

export function buildNpcs(): Npc[] {
  deal = grammarDealer();
  return NPC_DEFS.map((rawDef, id) => {
    // The citizens are hand-placed, and the pedestrian rules are derived from
    // the street grid, so a citizen is snapped onto legal pavement before
    // anything else happens. It costs nothing when the data is right, and when
    // a change to the layout moves a street out from under somebody it is the
    // difference between a citizen you can walk up to and one standing inside
    // a shop with a quest nobody can reach. The quest is generated from the
    // snapped position, so what they say stays true of where they are.
    const spot = nearestWalkable(rawDef.x, rawDef.y);
    const def: NpcDef = { ...rawDef, x: spot.x, y: spot.z };

    const rand = mulberry32(1000 + id * 77);
    if (def.type === "grammar") {
      return {
        ...def,
        id,
        quest: grammarQuest(deal(), id, 0),
        done: false,
        practice: false,
        round: 0,
      };
    }
    const quest =
      def.type === "directions" ? makeDirectionsQuest(def, rand) : makeFindQuest(def, rand);
    quest.options = shuffle([quest.correct, ...quest.wrongs], mulberry32(5000 + id * 31));
    return { ...def, id, quest, done: false, practice: false, round: 0 };
  });
}
