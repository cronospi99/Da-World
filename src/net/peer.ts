import { Peer as PeerJs, type DataConnection, type PeerOptions } from "peerjs";
import {
  MAX_PLAYERS,
  MOVE_INTERVAL_MS,
  PROTOCOL,
  type ClientMessage,
  type Peer,
  type ServerMessage,
} from "./protocol";
import { GuestSession, type NetHandlers, type Session } from "./session";

/**
 * QR mode: the city with no server at all.
 *
 * `server/index.js` is the right shape for a school that wants a fixed address
 * students type once and use all year. It is the wrong shape for a teacher who
 * has five minutes and a room of phones, because it is a thing to install, a
 * machine to run it on, and an IP address to read out to thirty people who
 * will mistype it.
 *
 * So this is the other way in. The teacher's own browser holds the guest list
 * and forwards positions over WebRTC; students scan a QR code and are in. The
 * only thing in the middle is PeerJS's public signalling server, which the two
 * browsers use to find each other and then stop needing — once a data channel
 * is open the lesson is running directly between the phones in the room, and
 * with the LAN candidates that usually means the traffic never leaves the
 * building.
 *
 * The host speaks *exactly* the protocol in `protocol.ts`, the same one the
 * node relay speaks, which is the point: the game cannot tell which of them it
 * is talking to, and neither half had to learn about the other.
 *
 * ## What this depends on
 *
 * - **PeerJS's cloud signalling**, to swap connection details. It is only
 *   needed while somebody is joining, and a school that would rather not
 *   depend on it can run `peerjs-server` and point the game at it with
 *   `?peerhost=host:port`.
 * - **STUN, and TURN when STUN is not enough.** Two devices behind the same
 *   school wifi usually connect directly. Two behind strict NAT — a phone on
 *   mobile data and a laptop on the school network — cannot, and without a
 *   relay to fall back on they simply hang, which is what the free TURN
 *   servers below are here to stop.
 */

/** Namespaced so we cannot collide with another PeerJS app's room codes. */
const ID_PREFIX = "daworld-";

/** Letters and digits with no I/O/0/1/L: this gets read aloud and retyped. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

/** How often everybody's position goes out, in milliseconds. */
const TICK_MS = MOVE_INTERVAL_MS;

/** The host's own id in its own room. */
const HOST_ID = "host";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

/**
 * PeerJS's settings, and the one knob a school might turn.
 *
 * By default this is the free public cloud. `?peerhost=192.168.1.10:9000`
 * points it at a `peerjs-server` on the school's own network instead, which is
 * the answer for a building whose firewall does not let the cloud through.
 */
function peerOptions(): PeerOptions {
  const search = new URLSearchParams(location.search);
  // `?peerdebug` turns on PeerJS's own logging, which is the only way to see
  // why a join that says "still trying…" is still trying.
  const base: PeerOptions = {
    debug: search.has("peerdebug") ? 3 : 0,
    config: { iceServers: ICE_SERVERS },
  };
  const override = search.get("peerhost");
  if (!override) return base;
  const [host, port] = override.split(":");
  return {
    ...base,
    host,
    port: Number(port) || 443,
    path: "/",
    secure: location.protocol === "https:" && host !== "localhost",
  };
}

export function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The link that puts a phone in this room.
 *
 * The code goes in the hash rather than a query string, so it survives being
 * served from a subfolder on GitHub Pages and never reaches a server that
 * would have to know about it. The query string that is already there is kept:
 * a school running its own signalling server is on `?peerhost=…`, and a
 * student sent to the same page without it would look for this room in the
 * public cloud and never find it.
 */
export function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}${location.search}#join=${code}`;
}

/** The code in the address bar, if this tab was opened by scanning one. */
export function codeInUrl(): string | null {
  const match = /^#join=([A-Za-z0-9]{4,8})$/.exec(location.hash);
  return match ? match[1].toUpperCase() : null;
}

/** Forget the code, so a reload does not silently rejoin. */
export function clearCodeInUrl(): void {
  if (location.hash.startsWith("#join=")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export interface HostHandlers {
  /** The room is live. This is the code students scan or type. */
  onOpen(code: string): void;
  /** Somebody joined or left; the whole guest list, host included. */
  onRoster(peers: Peer[]): void;
  onError(reason: string): void;
  onJoined(peer: Peer): void;
  onLeft(id: string): void;
  onPositions(peers: Pick<Peer, "id" | "x" | "z" | "facing">[]): void;
  onProgress(id: string, score: number, helped: number): void;
}

interface HostPeer extends Peer {
  /** Null for the host, whose "connection" is the game running this tab. */
  connection: DataConnection | null;
}

/**
 * The browser that is the server.
 *
 * This is `server/index.js` again, in a tab: a guest list, a position tick and
 * two privileged commands. The differences are all consequences of where it
 * runs — the host is *also* a player, so it holds a record for itself and puts
 * its own position in the tick, and there is no passphrase, because you cannot
 * be a guest at a room your own browser is holding open.
 */
export class PeerHost implements Session {
  private peer: PeerJs | null = null;
  private readonly peers = new Map<string, HostPeer>();
  private timer = 0;
  private destroyed = false;
  private idAttempts = 0;
  private nextId = 1;
  code = "";
  goal: string | null = null;
  mode: string | null = null;

  constructor(
    name: string,
    private readonly handlers: HostHandlers,
  ) {
    this.peers.set(HOST_ID, {
      id: HOST_ID,
      name,
      role: "teacher",
      x: 0,
      z: 0,
      facing: 0,
      score: 0,
      helped: 0,
      connection: null,
    });
    this.boot();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  /** A host is connected to itself the moment the code exists. */
  get connected(): boolean {
    return !this.destroyed && this.code !== "";
  }

  /** Everybody in the room, the host first. */
  roster(): Peer[] {
    return [...this.peers.values()].map(publicPeer);
  }

  private boot(): void {
    this.code = randomCode();
    const peer = new PeerJs(ID_PREFIX + this.code, peerOptions());
    this.peer = peer;

    // A code clash throws this peer away and takes another one; the discarded
    // peer keeps emitting, and must not be allowed to speak for the room.
    const stale = (): boolean => this.destroyed || this.peer !== peer;

    peer.on("open", () => {
      if (stale()) return;
      this.handlers.onOpen(this.code);
      this.handlers.onRoster(this.roster());
    });
    peer.on("connection", (connection) => {
      if (stale()) tryTo(() => connection.close());
      else this.welcome(connection);
    });
    peer.on("disconnected", () => {
      // Signalling dropped — which a browser tab left in the background can do
      // on its own, because the keep-alive is a timer and a background tab's
      // timers are slowed down. Everybody already in stays in, their data
      // channels being direct; but nobody new could join until it is back, so
      // it is worth getting back.
      if (!stale()) tryTo(() => peer.reconnect());
    });
    peer.on("error", (error) => {
      if (stale()) return;
      if (error.type === "unavailable-id" && this.idAttempts < 4) {
        // Somebody else is already holding that code. Take another one; the
        // panel has not shown it yet, so nobody is inconvenienced.
        this.idAttempts++;
        tryTo(() => peer.destroy());
        this.boot();
      } else if (error.type === "network" || error.type === "disconnected") {
        tryTo(() => peer.reconnect());
      } else {
        this.handlers.onError(reasonFor(error.type));
      }
    });
  }

  private welcome(connection: DataConnection): void {
    connection.on("open", () => {
      if (this.destroyed) {
        tryTo(() => connection.close());
        return;
      }
      connection.on("data", (data) => this.receive(connection, data));
      connection.on("close", () => this.drop(connection));
      connection.on("error", () => this.drop(connection));
    });
  }

  private receive(connection: DataConnection, data: unknown): void {
    const message = data as ClientMessage;
    if (!message || typeof message !== "object") return;

    const existing = [...this.peers.values()].find((p) => p.connection === connection);

    if (message.t === "join") {
      if (existing) return;
      if (message.protocol !== PROTOCOL) {
        this.refuse(connection, "This city is a different version from the host. Reload the page.");
        return;
      }
      if (this.peers.size >= MAX_PLAYERS) {
        this.refuse(connection, `This world is full (${MAX_PLAYERS} people).`);
        return;
      }

      // Everybody who arrives this way is a student. The teacher's commands
      // belong to whoever is holding the room open, and that is this tab.
      const peer: HostPeer = {
        id: `p${this.nextId++}`,
        name: String(message.name || "Someone").slice(0, 24),
        role: "student",
        x: 0,
        z: 0,
        facing: 0,
        score: 0,
        helped: 0,
        connection,
      };

      this.sendTo(connection, {
        t: "welcome",
        you: peer.id,
        room: this.code,
        peers: this.roster(),
        goal: this.goal,
        mode: this.mode,
      });
      this.peers.set(peer.id, peer);
      this.broadcast({ t: "joined", peer: publicPeer(peer) }, peer.id);
      this.handlers.onJoined(publicPeer(peer));
      this.handlers.onRoster(this.roster());
      return;
    }

    if (!existing) return;

    switch (message.t) {
      case "move":
        existing.x = Number(message.x) || 0;
        existing.z = Number(message.z) || 0;
        existing.facing = Number(message.facing) || 0;
        break;

      case "progress":
        existing.score = Number(message.score) || 0;
        existing.helped = Number(message.helped) || 0;
        this.broadcast(
          { t: "progress", id: existing.id, score: existing.score, helped: existing.helped },
          existing.id,
        );
        this.handlers.onProgress(existing.id, existing.score, existing.helped);
        break;

      // Setting the room's mission and mode is the host's, and a student who
      // edits their own copy of the game still cannot do it: their messages
      // arrive down a connection this tab knows belongs to a student.
      case "goal":
      case "mode":
        break;

      default:
        break;
    }
  }

  private drop(connection: DataConnection): void {
    const gone = [...this.peers.values()].find((p) => p.connection === connection);
    tryTo(() => connection.close());
    if (!gone) return;
    this.peers.delete(gone.id);
    this.broadcast({ t: "left", id: gone.id });
    this.handlers.onLeft(gone.id);
    this.handlers.onRoster(this.roster());
  }

  private refuse(connection: DataConnection, reason: string): void {
    this.sendTo(connection, { t: "denied", reason });
    // Long enough for the message to actually go out before the channel shuts.
    window.setTimeout(() => tryTo(() => connection.close()), 500);
  }

  /**
   * Positions go out on a timer rather than on arrival.
   *
   * Eleven students each sending their position ten times a second is a lot of
   * messages in, but only ten out per student — one frame of everybody — which
   * is the difference between a school wifi that copes and one that does not.
   */
  private tick(): void {
    if (this.destroyed || this.peers.size < 2) return;
    const positions = [...this.peers.values()].map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      facing: p.facing,
    }));
    this.broadcast({ t: "positions", peers: positions });
    this.handlers.onPositions(positions.filter((p) => p.id !== HOST_ID));
  }

  private sendTo(connection: DataConnection, message: ServerMessage): void {
    tryTo(() => connection.send(message));
  }

  private broadcast(message: ServerMessage, except?: string): void {
    for (const peer of this.peers.values()) {
      if (!peer.connection || peer.id === except) continue;
      this.sendTo(peer.connection, message);
    }
  }

  /* ---------------------------- as a player ------------------------------ */

  move(x: number, z: number, facing: number): void {
    const me = this.peers.get(HOST_ID);
    if (!me) return;
    // No throttle: this only writes to a record in this tab, and the tick is
    // what decides how often any of it leaves the machine.
    me.x = x;
    me.z = z;
    me.facing = facing;
  }

  progress(score: number, helped: number): void {
    const me = this.peers.get(HOST_ID);
    if (!me) return;
    me.score = score;
    me.helped = helped;
    this.broadcast({ t: "progress", id: HOST_ID, score, helped });
  }

  setGoal(missionId: string | null): void {
    this.goal = missionId;
    this.broadcast({ t: "goal", missionId });
  }

  setMode(modeId: string): void {
    this.mode = modeId;
    this.broadcast({ t: "mode", modeId });
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearInterval(this.timer);
    for (const peer of this.peers.values()) {
      if (peer.connection) tryTo(() => peer.connection!.close());
    }
    this.peers.clear();
    tryTo(() => this.peer?.destroy());
    this.peer = null;
  }
}

/* ------------------------------- the guest -------------------------------- */

/**
 * How long a step of joining may take before it is worth starting over.
 *
 * Generous, and deliberately so. Both ends of this are browsers drawing a 3D
 * city, on a phone, on school wifi: a handshake that takes one second on a
 * desk can take ten in a classroom, and a retry that fires while the first
 * attempt was still working throws away a connection that was about to open
 * and starts the wait again. Better to wait too long once than to loop.
 */
const OPEN_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 6;

export interface GuestOptions {
  code: string;
  name: string;
  /** Progress worth putting in front of somebody waiting: "still trying…". */
  onStatus(text: string): void;
}

/**
 * A phone that scanned the code.
 *
 * Joining a room hosted by a browser is less reliable than joining a server —
 * the host may not have finished opening, the signalling cloud may be slow,
 * the first ICE attempt may fail — and every one of those looks identical to a
 * student: nothing happens. So none of them are errors here. Each one waits,
 * throws the whole peer away and tries again from scratch, up to six times,
 * saying what it is doing; only then does it give up and offer a Retry.
 */
export class PeerGuest extends GuestSession {
  private peer: PeerJs | null = null;
  private connection: DataConnection | null = null;
  private openTimer = 0;
  private connectTimer = 0;
  private attempt = 0;
  private joined = false;
  private destroyed = false;
  private settle: { resolve(): void; reject(error: Error): void } | null = null;

  constructor(
    handlers: NetHandlers,
    private readonly options: GuestOptions,
  ) {
    super(handlers);
  }

  get connected(): boolean {
    return !this.destroyed && this.connection?.open === true && this.you !== null;
  }

  /**
   * Join the room.
   *
   * Resolves when the data channel is open and the join has been sent — not
   * when it has been accepted, which arrives as `onReady`, or refused, which
   * arrives as `onDenied`. Rejects only once the retries are spent.
   */
  join(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.settle = { resolve, reject };
      this.boot();
    });
  }

  private boot(): void {
    if (this.destroyed) return;
    const peer = new PeerJs(peerOptions());
    this.peer = peer;

    this.openTimer = window.setTimeout(() => this.retry("the network is slow"), OPEN_TIMEOUT_MS);

    // Every handler asks whether this peer is still the current one. A retry
    // throws its peer away, but PeerJS goes on emitting from the wreckage —
    // and answering a dead peer's `disconnected` with `reconnect` brings it
    // back to life alongside its replacement, which is how one student ends up
    // holding three sockets open and joining none of them.
    const stale = (): boolean => this.destroyed || this.peer !== peer;

    peer.on("open", () => {
      if (!stale()) this.connect(peer);
    });
    peer.on("disconnected", () => {
      if (!stale() && !this.joined) tryTo(() => peer.reconnect());
    });
    peer.on("error", (error) => {
      if (stale()) return;
      if (error.type === "peer-unavailable") {
        // No such room — or the teacher's tab has not finished opening it.
        // Both are worth waiting through.
        this.retry("waiting for the host…");
      } else if (
        error.type === "network" ||
        error.type === "disconnected" ||
        error.type === "socket-error"
      ) {
        this.retry("reconnecting…");
      } else {
        this.fail(reasonFor(error.type));
      }
    });
  }

  private connect(peer: PeerJs): void {
    window.clearTimeout(this.connectTimer);
    const connection = peer.connect(ID_PREFIX + this.options.code, { reliable: true });
    this.connection = connection;
    this.connectTimer = window.setTimeout(() => this.retry("still trying…"), CONNECT_TIMEOUT_MS);

    connection.on("open", () => {
      if (this.destroyed) return;
      window.clearTimeout(this.openTimer);
      window.clearTimeout(this.connectTimer);
      this.joined = true;
      this.deliver(this.joinMessage(this.options.code, this.options.name, "student"));
      this.options.onStatus("Waiting for the host to let you in…");
      this.settle?.resolve();
      this.settle = null;
    });
    connection.on("data", (data) => this.receive(data as ServerMessage));
    connection.on("close", () => {
      if (this.destroyed) return;
      this.you = null;
      this.handlers.onClosed();
    });
    connection.on("error", () => {
      if (!this.destroyed && !this.joined) this.retry("connection error");
    });
  }

  private retry(reason: string): void {
    if (this.destroyed || this.joined) return;
    this.attempt++;
    if (this.attempt > MAX_ATTEMPTS) {
      this.fail("Could not reach that world. Check the code and your internet, then try again.");
      return;
    }
    this.options.onStatus(`${reason} (try ${this.attempt}/${MAX_ATTEMPTS})`);
    // Thrown away and rebuilt rather than nudged: with the PeerJS cloud, a
    // fresh peer is far more likely to work than a retried one.
    this.teardown();
    window.setTimeout(() => this.boot(), 1200);
  }

  private fail(reason: string): void {
    const settle = this.settle;
    this.settle = null;
    this.close();
    if (settle) settle.reject(new Error(reason));
    else this.handlers.onDenied(reason);
  }

  private teardown(): void {
    window.clearTimeout(this.openTimer);
    window.clearTimeout(this.connectTimer);
    tryTo(() => this.connection?.close());
    tryTo(() => this.peer?.destroy());
    this.connection = null;
    this.peer = null;
  }

  protected deliver(message: ClientMessage): void {
    if (this.connection?.open) tryTo(() => this.connection!.send(message));
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.you = null;
    this.teardown();
  }
}

/* -------------------------------- helpers --------------------------------- */

const publicPeer = (peer: HostPeer): Peer => ({
  id: peer.id,
  name: peer.name,
  role: peer.role,
  x: peer.x,
  z: peer.z,
  facing: peer.facing,
  score: peer.score,
  helped: peer.helped,
});

/**
 * PeerJS error types, in words a teacher standing in front of a class can act
 * on. Anything unrecognised keeps its type, which is at least something to
 * search for.
 */
function reasonFor(type: string): string {
  switch (type) {
    case "browser-incompatible":
      return "This browser cannot do QR mode. Try Chrome, Edge or Safari.";
    case "ssl-unavailable":
      return "QR mode needs a secure page (https).";
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return "The service that introduces the phones to each other is not answering. Try again in a moment.";
    case "network":
      return "The network dropped. Check the wifi and try again.";
    case "unavailable-id":
      return "Every code we tried was taken. Try again.";
    default:
      return `Something went wrong with the connection (${type}).`;
  }
}

/**
 * Run something that talks to a socket we do not control.
 *
 * PeerJS throws from `send`, `close`, `destroy` and `reconnect` when the thing
 * underneath has already gone, and in every case here the answer is the same:
 * that connection is over, carry on with the lesson.
 */
function tryTo(action: () => void): void {
  try {
    action();
  } catch {
    /* the connection is already gone, which is what we wanted anyway. */
  }
}
