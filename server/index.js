/**
 * The class server.
 *
 * One small WebSocket relay so a teacher and up to twelve students can walk
 * around the same city. It is the whole of Da World's networking, and it is
 * deliberately the least it could be:
 *
 * - **It does not simulate anything.** Every browser has the entire city, the
 *   quest generator and the grammar bank, all derived from the same tables
 *   with the same seeds, so every browser independently produces the same
 *   questions from the same shops. Nothing about the world needs sending.
 * - **It keeps a guest list and forwards positions.** Who is here, where they
 *   are, how they are getting on, and what the teacher has just asked the room
 *   to do. That is all one browser cannot work out on its own.
 * - **It has one privileged operation**, joining as the teacher, and that is
 *   the only thing it checks a passphrase for. Unlike the passphrase baked
 *   into the page, this one lives on the server and is never sent to a
 *   student's browser, so it is the real lock.
 *
 * Run it:
 *
 *     cd server
 *     npm install
 *     DA_WORLD_TEACHER_PASSPHRASE=something npm start
 *
 * Then open the game, choose Class, and point it at ws://<this machine>:8787.
 * See README.md in this folder for running it on a school network.
 */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const TEACHER_PASSPHRASE = process.env.DA_WORLD_TEACHER_PASSPHRASE ?? "teacher";
const PROTOCOL = 1;
/** Everybody in one city at once, the teacher included. Keep in step with
 *  MAX_PLAYERS in src/net/protocol.ts. */
const MAX_PLAYERS = 12;
/** How often everybody's position goes out, in milliseconds. */
const TICK_MS = 100;

if (TEACHER_PASSPHRASE === "teacher") {
  console.warn(
    "[da-world] Using the default teacher passphrase. Set DA_WORLD_TEACHER_PASSPHRASE before a real lesson.",
  );
}

/**
 * Rooms, keyed by the code students type in.
 *
 * A room is created by the first person to ask for it and thrown away when the
 * last one leaves, which is the entire lifecycle a classroom needs: no
 * database, no cleanup job, and nothing to reset between lessons.
 */
const rooms = new Map();

function room(code) {
  let found = rooms.get(code);
  if (!found) {
    found = { code, peers: new Map(), goal: null, mode: null, target: 0, winner: null };
    rooms.set(code, found);
  }
  return found;
}

const send = (socket, message) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

function broadcast(target, message, except) {
  for (const peer of target.peers.values()) {
    if (peer.id !== except) send(peer.socket, message);
  }
}

/** The public shape of a peer — everything except its socket. */
const publicPeer = (peer) => ({
  id: peer.id,
  name: peer.name,
  role: peer.role,
  x: peer.x,
  z: peer.z,
  facing: peer.facing,
  score: peer.score,
  helped: peer.helped,
  missions: peer.missions,
  look: peer.look,
});

/**
 * A look, as far as this server is concerned.
 *
 * It never draws anybody, so it does not care what the colours mean — only
 * that what it stores and forwards is small, is strings, and cannot carry
 * anything surprising into twelve other browsers.
 */
function sanitiseLook(look) {
  if (!look || typeof look !== "object") return null;
  const colour = (value) =>
    typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "#cccccc";
  return {
    kind: look.kind === "robot" ? "robot" : "human",
    shirt: colour(look.shirt),
    pants: colour(look.pants),
    skin: colour(look.skin),
    hair: colour(look.hair),
    outfit: typeof look.outfit === "string" ? look.outfit.slice(0, 16) : "none",
  };
}

/**
 * Has this person just won?
 *
 * Decided here rather than in each browser, for the same reason the guest list
 * is: twelve copies of the game each deciding they won first is twelve
 * different winners. The server counts, announces once, and the announcement
 * is what every screen shows.
 */
function checkWinner(target, peer) {
  if (target.winner || target.target <= 0 || peer.missions < target.target) return;
  target.winner = { id: peer.id, name: peer.name };
  broadcast(target, { t: "won", id: peer.id, name: peer.name, missions: peer.missions });
  console.log(`[da-world] ${peer.name} won ${target.code} with ${peer.missions} missions`);
}

const server = createServer((request, response) => {
  // A plain GET is somebody checking the server is up, usually by pasting the
  // address into a browser. Say so in a way a teacher can act on.
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end(
    `Da World class server, protocol ${PROTOCOL}.\n` +
      `${rooms.size} room(s) open.\n\n` +
      `This address is for the game, not for a browser tab.\n` +
      `In Da World choose Class and enter:  ws://${request.headers.host}\n`,
  );
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  let peer = null;
  let joined = null;

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.t === "join") {
      if (peer) return;
      if (message.protocol !== PROTOCOL) {
        send(socket, {
          t: "denied",
          reason: "This city is a different version from the server. Reload the page.",
        });
        socket.close();
        return;
      }

      const target = room(String(message.room || "class"));
      const isTeacher = message.role === "teacher";

      if (isTeacher && message.passphrase !== TEACHER_PASSPHRASE) {
        send(socket, { t: "denied", reason: "That is not the teacher passphrase." });
        socket.close();
        return;
      }
      if (isTeacher && [...target.peers.values()].some((p) => p.role === "teacher")) {
        send(socket, { t: "denied", reason: "This room already has a teacher." });
        socket.close();
        return;
      }
      // The teacher counts towards the room: twelve people in one city is the
      // limit whichever of them is holding it open, so that a class told they
      // can have twelve gets twelve here and in QR mode alike.
      if (target.peers.size >= MAX_PLAYERS) {
        send(socket, {
          t: "denied",
          reason: `This room is full (${MAX_PLAYERS} people).`,
        });
        socket.close();
        return;
      }

      peer = {
        id: `p${Math.random().toString(36).slice(2, 9)}`,
        name: String(message.name || "Someone").slice(0, 24),
        role: isTeacher ? "teacher" : "student",
        x: 0,
        z: 0,
        facing: 0,
        score: 0,
        helped: 0,
        missions: 0,
        // Trusted as given: it is only ever used to draw them, and a student
        // who lies about their own trousers has not gained anything.
        look: sanitiseLook(message.look),
        socket,
      };
      joined = target;

      send(socket, {
        t: "welcome",
        you: peer.id,
        room: target.code,
        peers: [...target.peers.values()].map(publicPeer),
        goal: target.goal,
        mode: target.mode,
        target: target.target,
        winner: target.winner,
      });
      target.peers.set(peer.id, peer);
      broadcast(target, { t: "joined", peer: publicPeer(peer) }, peer.id);
      console.log(`[da-world] ${peer.name} (${peer.role}) joined ${target.code}`);
      return;
    }

    if (!peer || !joined) return;

    switch (message.t) {
      case "move":
        peer.x = Number(message.x) || 0;
        peer.z = Number(message.z) || 0;
        peer.facing = Number(message.facing) || 0;
        break;

      case "progress":
        peer.score = Number(message.score) || 0;
        peer.helped = Number(message.helped) || 0;
        peer.missions = Number(message.missions) || 0;
        broadcast(joined, {
          t: "progress",
          id: peer.id,
          score: peer.score,
          helped: peer.helped,
          missions: peer.missions,
        });
        checkWinner(joined, peer);
        break;

      // The two teacher commands. Checked by role here rather than trusted from
      // the page: a student who edits their own client still cannot set the
      // room's mission, because their socket never joined as a teacher.
      case "goal":
        if (peer.role !== "teacher") return;
        joined.goal = message.missionId ?? null;
        broadcast(joined, { t: "goal", missionId: joined.goal });
        break;

      case "mode":
        if (peer.role !== "teacher") return;
        joined.mode = String(message.modeId);
        broadcast(joined, { t: "mode", modeId: joined.mode });
        break;

      // How many missions win the match. Changing it starts a new race, so the
      // old winner is cleared — a lesson can run more than one.
      case "target":
        if (peer.role !== "teacher") return;
        joined.target = Math.max(0, Math.floor(Number(message.missions) || 0));
        joined.winner = null;
        broadcast(joined, { t: "target", missions: joined.target });
        for (const other of joined.peers.values()) checkWinner(joined, other);
        break;

      default:
        break;
    }
  });

  socket.on("close", () => {
    if (!peer || !joined) return;
    joined.peers.delete(peer.id);
    broadcast(joined, { t: "left", id: peer.id });
    console.log(`[da-world] ${peer.name} left ${joined.code}`);
    if (joined.peers.size === 0) rooms.delete(joined.code);
  });
});

/**
 * Positions go out on a timer rather than on arrival.
 *
 * Twelve students each sending their position ten times a second is 120
 * messages in, but only ten out per student — one frame of everybody — which
 * is the difference between a school wifi that copes and one that does not.
 */
setInterval(() => {
  for (const target of rooms.values()) {
    if (target.peers.size < 2) continue;
    const peers = [...target.peers.values()].map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      facing: p.facing,
    }));
    broadcast(target, { t: "positions", peers });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`[da-world] class server listening on port ${PORT}`);
  console.log(`[da-world] students connect to  ws://<this machine>:${PORT}`);
});
