import { Group } from "three";
import { Character } from "./character";
import { NPC_DEFS } from "./npcData";
import { CURB } from "./city";
import { blocked } from "./ground";
import { isRoad } from "./layout";
import { mulberry32 } from "../core/rng";

/**
 * The people on the pavement.
 *
 * The city's thirty-two citizens came with names, outfits and a spot to stand
 * on. Here they only have to do one thing — be somewhere, and be walking — so
 * each one paces a short beat around their own corner and turns round when
 * something is in the way. That is enough: a street with nobody on it reads as
 * a model, and a street with a dozen people crossing it reads as a city, and
 * the difference costs one small state machine.
 *
 * They are deliberately *not* merged: everything here moves.
 */

interface Walker {
  character: Character;
  /** Where they belong, and how far they may stray from it. */
  homeX: number;
  homeZ: number;
  range: number;
  /** Current heading, in radians. */
  heading: number;
  speed: number;
  /** Seconds until they pick a new heading. */
  turnIn: number;
  /** Seconds left of standing still. */
  restFor: number;
}

export class Pedestrians {
  readonly group = new Group();
  private readonly walkers: Walker[] = [];

  constructor() {
    const rand = mulberry32(31337);
    for (const def of NPC_DEFS) {
      const character = new Character({
        shirt: def.shirt,
        pants: def.pants,
        skin: def.skin,
        hair: def.hair,
        outfit: def.outfit,
      });
      character.group.position.set(def.x, CURB, def.y);
      this.group.add(character.group);
      this.walkers.push({
        character,
        homeX: def.x,
        homeZ: def.y,
        range: 2.5 + rand() * 3.5,
        heading: rand() * Math.PI * 2,
        speed: 0.7 + rand() * 0.5,
        turnIn: rand() * 3,
        restFor: rand() * 2,
      });
    }
  }

  update(dt: number, playerX: number, playerZ: number): void {
    for (const w of this.walkers) {
      const body = w.character.group.position;

      // Far enough away that nobody would see the difference: stop simulating.
      const dx = body.x - playerX;
      const dz = body.z - playerZ;
      if (dx * dx + dz * dz > 90 * 90) continue;

      if (w.restFor > 0) {
        w.restFor -= dt;
        w.character.update(dt, 0);
        continue;
      }

      w.turnIn -= dt;
      if (w.turnIn <= 0) {
        w.turnIn = 2 + Math.random() * 4;
        // Head roughly home if we have drifted, otherwise anywhere.
        const away = Math.hypot(body.x - w.homeX, body.z - w.homeZ);
        w.heading =
          away > w.range
            ? Math.atan2(w.homeX - body.x, w.homeZ - body.z)
            : Math.random() * Math.PI * 2;
        if (Math.random() < 0.25) w.restFor = 1 + Math.random() * 3;
      }

      const step = w.speed * dt;
      const nx = body.x + Math.sin(w.heading) * step;
      const nz = body.z + Math.cos(w.heading) * step;
      // Walls stop them, and so does the kerb: a citizen who strolls down the
      // middle of the carriageway makes the traffic look like scenery.
      if (blocked(nx, nz, 0.4) || isRoad(Math.floor(nx), Math.floor(nz))) {
        // Turn away from whatever that was, and try again next frame.
        w.heading += Math.PI * (0.5 + Math.random() * 0.5);
        w.character.update(dt, 0);
        continue;
      }

      body.x = nx;
      body.z = nz;
      w.character.group.rotation.y = w.heading;
      w.character.update(dt, Math.min(1, w.speed));
    }
  }
}
