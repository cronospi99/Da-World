import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial } from "three";
import { Character, PERSON_HEIGHT, PERSON_SCALE } from "./character";
import { CURB } from "./city";
import { mulberry32 } from "../core/rng";
import { CharacterModel } from "../game/characterModel";
import type { Outfit } from "./npcData";
import type { Peer } from "../net/protocol";

/**
 * The other students, drawn in your city.
 *
 * A classmate is the same low-poly person as everybody else, in colours dealt
 * from their name so the same student looks the same on every screen in the
 * room, with their name on a small tag above them. The name tag is the one
 * place in this game where floating text is right: the whole point of the mode
 * is that the person crossing the road is somebody you know, and a nameless
 * body on the pavement is indistinguishable from a citizen.
 *
 * Since students choose their character, a classmate is drawn as whoever they
 * made: their own colours, their own hat, and the rigged robot if that is what
 * they picked. The colours dealt from a name are still there as the fallback,
 * for anybody on an older version who joins without saying what they look like.
 *
 * Positions arrive ten times a second, which is a fifth of a frame rate, so
 * every classmate is eased towards the last thing the server said rather than
 * snapped to it. The alternative is a room full of people teleporting, which
 * looks broken even though the data is perfect.
 */

/** How fast a classmate catches up with where the server last put them. */
const SMOOTHING = 9;

/** A classmate is not simulated once they are this far away. */
const SIM_RANGE = 70;

/** Ground speed the low-poly walk cycle runs at full tilt. */
const WALK_CYCLE_SPEED = 2.5;

/** Ease an angle towards another the short way round. */
function turnTowards(from: number, to: number, dt: number): number {
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * Math.min(1, 10 * dt);
}

function nameTag(name: string, teacher: boolean): Sprite {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 96;
  const c = cv.getContext("2d")!;

  c.fillStyle = teacher ? "rgba(217, 143, 90, 0.94)" : "rgba(255, 246, 227, 0.94)";
  const r = 26;
  c.beginPath();
  c.moveTo(10 + r, 10);
  c.arcTo(502, 10, 502, 86, r);
  c.arcTo(502, 86, 10, 86, r);
  c.arcTo(10, 86, 10, 10, r);
  c.arcTo(10, 10, 502, 10, r);
  c.closePath();
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = teacher ? "#8d3f2e" : "#b5a997";
  c.stroke();

  c.fillStyle = teacher ? "#fff8ec" : "#6f6a63";
  c.font = '600 44px ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(teacher ? `👩‍🏫 ${name}` : name, 256, 50, 470);

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.5, 0.28, 1);
  sprite.renderOrder = 8;
  sprite.position.y = PERSON_HEIGHT + 0.3;
  return sprite;
}

/** Clothes dealt from a name, so a student looks the same on every screen. */
function colours(name: string): { shirt: string; pants: string; skin: string; hair: string } {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
  const rand = mulberry32(seed || 1);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  return {
    shirt: pick(["#e8637c", "#4fbf8f", "#54a8e8", "#f0d060", "#8f5be8", "#e8a33f", "#3fc4c4"]),
    pants: pick(["#3f4a6b", "#33384a", "#5a4a7a", "#7a5f3a", "#2f3542"]),
    skin: pick(["#f0c39a", "#e8b98d", "#d8a273", "#c78a5c", "#8a5a33", "#b3764a"]),
    hair: pick(["#241a12", "#5a3a20", "#a8462c", "#dcdcdc", "#1a1410", "#6a3ad0"]),
  };
}

interface View {
  peer: Peer;
  /** The low-poly person: worn, or standing in until the robot lands. */
  character: Character;
  /** The rigged robot, once it has loaded, for classmates who chose one. */
  robot: CharacterModel | null;
  tag: Sprite;
  group: Group;
  /** Where the server last said they were; the body eases towards it. */
  target: { x: number; z: number; facing: number };
}

export class Classmates {
  readonly group = new Group();
  private readonly views = new Map<string, View>();

  add(peer: Peer): void {
    if (this.views.has(peer.id)) return;
    const holder = new Group();
    const look = peer.look;
    const character = new Character(
      look
        ? { shirt: look.shirt, pants: look.pants, skin: look.skin, hair: look.hair, outfit: look.outfit as Outfit }
        : { ...colours(peer.name), outfit: peer.role === "teacher" ? "glasses" : "backpack" },
      PERSON_SCALE,
    );
    const tag = nameTag(peer.name, peer.role === "teacher");
    holder.add(character.group, tag);
    holder.position.set(peer.x, CURB, peer.z);
    this.group.add(holder);
    const view: View = {
      peer,
      character,
      robot: null,
      tag,
      group: holder,
      target: { x: peer.x, z: peer.z, facing: peer.facing },
    };
    this.views.set(peer.id, view);

    // The robot arrives late and may never arrive at all; the person it
    // replaces is already walking around, so nothing has to wait for it.
    if (look?.kind === "robot") {
      void CharacterModel.load(look.shirt)
        .then((robot) => {
          if (this.views.get(peer.id) !== view) return;
          view.robot = robot;
          view.group.remove(view.character.group);
          view.group.add(robot.object);
        })
        .catch(() => {
          /* they stay a person, which is what they already look like. */
        });
    }
  }

  remove(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.group.remove(view.group);
    view.robot?.dispose();
    view.tag.material.map?.dispose();
    view.tag.material.dispose();
    this.views.delete(id);
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  /** The people currently in the room, for the teacher's panel. */
  peers(): Peer[] {
    return [...this.views.values()].map((v) => v.peer);
  }

  setProgress(id: string, score: number, helped: number, missions: number): void {
    const view = this.views.get(id);
    if (!view) return;
    view.peer.score = score;
    view.peer.helped = helped;
    view.peer.missions = missions;
  }

  /** A tick of positions from the server. */
  setPositions(peers: { id: string; x: number; z: number; facing: number }[]): void {
    for (const p of peers) {
      const view = this.views.get(p.id);
      if (!view) continue;
      view.target.x = p.x;
      view.target.z = p.z;
      view.target.facing = p.facing;
    }
  }

  update(dt: number, playerX: number, playerZ: number): void {
    const ease = Math.min(1, SMOOTHING * dt);
    for (const view of this.views.values()) {
      const position = view.group.position;
      const dx = view.target.x - position.x;
      const dz = view.target.z - position.z;

      if ((position.x - playerX) ** 2 + (position.z - playerZ) ** 2 > SIM_RANGE * SIM_RANGE) {
        view.group.visible = false;
        continue;
      }
      view.group.visible = true;

      position.x += dx * ease;
      position.z += dz * ease;
      position.y = CURB;

      // The walk cycle is driven by how fast they are actually closing on the
      // target, so somebody standing still stands still and somebody running
      // across a junction runs.
      const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      if (view.robot) {
        // A classmate has no physics here — only where they were and where
        // they are going — so the state is read off that closing speed.
        view.robot.update(dt, speed > 0.25 ? "run" : "idle", speed);
        view.robot.object.rotation.y = turnTowards(
          view.robot.object.rotation.y,
          view.target.facing,
          dt,
        );
      } else {
        view.character.update(dt, Math.min(1, speed / WALK_CYCLE_SPEED));
        view.character.faceTowards(view.target.facing, dt);
      }
    }
  }
}
