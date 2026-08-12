/**
 * What the city and whoever is hosting it say to each other.
 *
 * Deliberately small and deliberately dumb. The host is a relay with a guest
 * list: it does not simulate the city, does not generate quests and does not
 * mark answers, because every browser already has the whole city and the whole
 * quest generator, and they all derive the same questions from the same
 * tables. What has to be shared is only what one browser cannot know on its
 * own — where the other students are, what the teacher has just asked the room
 * to do, and how everybody is getting on.
 *
 * There are two things that can be the host and they speak exactly this:
 *
 * - **A browser**, in QR mode. The teacher's own tab keeps the guest list and
 *   forwards positions over WebRTC, and students reach it by scanning a code.
 *   Nothing is installed and nothing is run; see `src/net/peer.ts`.
 * - **`server/index.js`**, the WebSocket relay, for a school that would rather
 *   have a fixed address than a code that changes every lesson.
 *
 * That is why this file is imported by all of them. The server is plain
 * JavaScript run by node and the game is TypeScript built by vite, so the
 * types here are the only thing keeping them honest with each other; if you
 * change a message, change it here first and let both ends fail to compile.
 */

/** Protocol version. A mismatch is refused rather than half-understood. */
export const PROTOCOL = 1;

/**
 * The most people who may be in one city at once, the host included.
 *
 * Twelve is what a room of students and one teacher hosting from the front of
 * it comes to, and it is also about what one browser can relay without the
 * frame rate of the lesson suffering for it.
 */
export const MAX_PLAYERS = 12;

export type Role = "student" | "teacher";

/** A person in the room, as everybody else sees them. */
export interface Peer {
  id: string;
  name: string;
  role: Role;
  /** Tile-space position and heading, or null before their first move. */
  x: number;
  z: number;
  facing: number;
  /** Their score, so the teacher's panel can show the room at a glance. */
  score: number;
  helped: number;
}

/* ----------------------------- client → server ---------------------------- */

export type ClientMessage =
  | {
      t: "join";
      protocol: number;
      room: string;
      name: string;
      role: Role;
      /** Required for `role: "teacher"`; checked by the server, not the page. */
      passphrase?: string;
    }
  /** Where I am. Sent on a timer, not every frame. */
  | { t: "move"; x: number; z: number; facing: number }
  /** I answered somebody. Carries the totals so nobody has to add up. */
  | { t: "progress"; score: number; helped: number }
  /** Teacher only: put the room on a mission, or clear it with null. */
  | { t: "goal"; missionId: string | null }
  /** Teacher only: switch everybody to another mode. */
  | { t: "mode"; modeId: string };

/* ----------------------------- server → client ---------------------------- */

export type ServerMessage =
  /** You are in. `you` is your own id; `peers` is everybody already here. */
  | { t: "welcome"; you: string; room: string; peers: Peer[]; goal: string | null; mode: string | null }
  /** Turned away, with a reason worth showing a human. */
  | { t: "denied"; reason: string }
  | { t: "joined"; peer: Peer }
  | { t: "left"; id: string }
  /** Everybody's position, at the server's tick rate. */
  | { t: "positions"; peers: Pick<Peer, "id" | "x" | "z" | "facing">[] }
  | { t: "progress"; id: string; score: number; helped: number }
  | { t: "goal"; missionId: string | null }
  | { t: "mode"; modeId: string };

/** How often a client tells the server where it is, in milliseconds. */
export const MOVE_INTERVAL_MS = 100;
