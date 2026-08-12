import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial } from "three";
import { Character } from "./character";
import { CURB } from "./city";
import { walkable } from "./ground";
import { buildNpcs, type Npc } from "../game/quests";
import { TARGET_HEIGHT } from "../game/characterModel";

/**
 * The people on the pavement, and the reason to walk up to them.
 *
 * The city's thirty-two citizens are not scenery: each one carries a question
 * generated from the city itself — where a place is, how to get to it, or a
 * point of English — and the game is the loop of walking up, being asked, and
 * answering. A street with nobody on it reads as a model; a street where three
 * people are waiting to ask you something reads as a city with a reason to be
 * in it.
 *
 * Each citizen is a low-poly body plus **one** floating thing: a small ❓ that
 * turns into a ✅ when they have been helped. There are deliberately no name
 * plates and no speech bubbles hanging over the street — at pavement level
 * they cover the shopfronts you are being asked to read. Who someone is
 * belongs in the prompt at the bottom of the screen and in the card that
 * opens; the marker only has to say *there is something here*.
 *
 * They are deliberately not merged: everything here moves.
 */

/**
 * Citizens are scaled to the same height as the player.
 *
 * `Character` is modelled a shade over 1.55 units tall, so this brings a
 * citizen to the player's own 1.2 — which is what stops the crowd reading as
 * a different species from the person walking through it.
 */
const CITIZEN_NATURAL_HEIGHT = 1.58;
export const CITIZEN_SCALE = TARGET_HEIGHT / CITIZEN_NATURAL_HEIGHT;

/** Height of the floating marker above a citizen's feet. */
const MARKER_Y = TARGET_HEIGHT + 0.34;

/** How close you have to be to start a conversation, in tiles. */
export const TALK_RANGE = 2.1;

/** Past this distance a citizen is not simulated at all. */
const SIM_RANGE = 60;

function markerSprite(done: boolean): Sprite {
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 128;
  const c = cv.getContext("2d")!;

  c.fillStyle = done ? "#dfe6c9" : "#fff6e3";
  c.beginPath();
  c.arc(64, 64, 50, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 7;
  c.strokeStyle = done ? "#8f9a7a" : "#b5a997";
  c.stroke();
  c.fillStyle = done ? "#6b8149" : "#b5543f";
  c.font = '900 72px ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(done ? "✓" : "?", 64, 70);

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(0.42, 0.42, 1);
  sprite.renderOrder = 7;
  sprite.position.y = MARKER_Y;
  return sprite;
}

interface NpcView {
  npc: Npc;
  character: Character;
  marker: Sprite;
  group: Group;
  /** Where this citizen stands when not pacing. */
  home: { x: number; y: number };
}

export class Npcs {
  readonly group = new Group();
  readonly npcs: Npc[];
  private readonly views: NpcView[] = [];

  constructor() {
    this.npcs = buildNpcs();
    for (const npc of this.npcs) {
      const holder = new Group();
      const character = new Character(npc, CITIZEN_SCALE);
      const marker = markerSprite(false);
      holder.add(character.group, marker);
      // The citizen's own group carries the walk-cycle bob, so the height of
      // the pavement lives on the holder above it. Putting both on the same
      // node is how the old pedestrians ended up sunk into the kerb.
      holder.position.set(npc.x, CURB, npc.y);
      this.group.add(holder);
      this.views.push({ npc, character, marker, group: holder, home: { x: npc.x, y: npc.y } });
    }
  }

  /** Restore "already helped" flags coming from a save file. */
  applyProgress(helped: Set<number>): void {
    for (const view of this.views) {
      if (helped.has(view.npc.id)) {
        view.npc.done = true;
        this.refreshMarker(view.npc.id);
      }
    }
  }

  /** Repaint one citizen's marker after their state changed. */
  refreshMarker(id: number): void {
    const view = this.views.find((v) => v.npc.id === id);
    if (!view) return;
    const next = markerSprite(view.npc.done);
    view.group.remove(view.marker);
    view.marker.material.map?.dispose();
    view.marker.material.dispose();
    view.marker = next;
    view.group.add(next);
  }

  /** Closest citizen within talking range, or null. */
  nearest(x: number, z: number): Npc | null {
    let best: Npc | null = null;
    let bestDist = TALK_RANGE;
    for (const view of this.views) {
      const d = Math.hypot(view.npc.x - x, view.npc.y - z);
      if (d < bestDist) {
        bestDist = d;
        best = view.npc;
      }
    }
    return best;
  }

  update(dt: number, time: number, playerX: number, playerZ: number): void {
    for (const view of this.views) {
      const npc = view.npc;
      const dx = playerX - npc.x;
      const dz = playerZ - npc.y;
      const distSq = dx * dx + dz * dz;
      if (distSq > SIM_RANGE * SIM_RANGE) continue;

      let speed01 = 0;

      // Pacing: a slow sine along the pavement. The amplitude is small and the
      // axis follows the street, and the destination is checked against the
      // pedestrian rules anyway, so a citizen never strolls into the traffic.
      if (npc.walk) {
        const w = time * 0.32 + npc.id * 1.7;
        const offset = Math.sin(w) * npc.walk;
        const nx = npc.axis === "v" ? view.home.x : view.home.x + offset;
        const nz = npc.axis === "v" ? view.home.y + offset : view.home.y;
        if (walkable(nx, nz)) {
          npc.x = nx;
          npc.y = nz;
          view.group.position.set(npc.x, CURB, npc.y);
          speed01 = Math.min(1, Math.abs(Math.cos(w) * npc.walk * 0.32) / 1.1);
        }
      }

      const dist = Math.sqrt(distSq);
      // Turn to greet the player. That beats any amount of walking animation
      // as a signal that this person is waiting to be spoken to.
      if (dist < 5) {
        view.character.faceTowards(Math.atan2(dx, dz), dt);
        speed01 *= 0.3;
      } else if (npc.walk) {
        const rising = Math.cos(time * 0.32 + npc.id * 1.7) > 0;
        const heading =
          npc.axis === "v" ? (rising ? 0 : Math.PI) : rising ? Math.PI / 2 : -Math.PI / 2;
        view.character.faceTowards(heading, dt);
      }

      // The marker bobs, and hides when the player is too far to care.
      view.marker.visible = dist < 26;
      view.marker.position.y = MARKER_Y + Math.sin(time * 2.2 + npc.id) * 0.07;
      view.character.update(dt, speed01);
    }
  }
}
