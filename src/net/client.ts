import {
  MOVE_INTERVAL_MS,
  PROTOCOL,
  type ClientMessage,
  type Peer,
  type Role,
  type ServerMessage,
} from "./protocol";

/**
 * The other end of the class server.
 *
 * A thin wrapper over one WebSocket: it knows how to join, it throttles the
 * position it sends, and it turns messages into callbacks. It deliberately
 * holds no opinion about the city — the game hands it a position and gets
 * other people's positions back, and everything else about the world each
 * browser works out for itself.
 *
 * Everything is best-effort. A classroom network drops, a laptop sleeps, a
 * student closes the lid; none of that should end the lesson, so a lost
 * connection stops the multiplayer part and leaves the city running.
 */

export interface NetHandlers {
  onReady(you: string, peers: Peer[], goal: string | null, mode: string | null): void;
  onDenied(reason: string): void;
  onJoined(peer: Peer): void;
  onLeft(id: string): void;
  onPositions(peers: { id: string; x: number; z: number; facing: number }[]): void;
  onProgress(id: string, score: number, helped: number): void;
  onGoal(missionId: string | null): void;
  onMode(modeId: string): void;
  onClosed(): void;
}

export interface JoinOptions {
  url: string;
  room: string;
  name: string;
  role: Role;
  passphrase?: string;
}

export class NetClient {
  private socket: WebSocket | null = null;
  private lastMove = 0;
  /** Our own id, once the server has given us one. */
  you: string | null = null;

  constructor(private readonly handlers: NetHandlers) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.you !== null;
  }

  /**
   * Connect and join a room.
   *
   * Resolves when the socket is open and the join has been sent — not when it
   * has been accepted. Acceptance arrives as `onReady`, refusal as `onDenied`,
   * because the server checks the passphrase and the room's capacity and only
   * it can say.
   */
  join(options: JoinOptions): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(options.url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.send({
          t: "join",
          protocol: PROTOCOL,
          room: options.room,
          name: options.name,
          role: options.role,
          passphrase: options.passphrase,
        });
        resolve();
      });

      socket.addEventListener("error", () => {
        // The browser deliberately does not say *why* a WebSocket failed, so
        // there is nothing more useful to pass on than that it did.
        reject(new Error("Could not reach the class server at that address."));
      });

      socket.addEventListener("close", () => {
        if (this.socket === socket) {
          this.socket = null;
          this.you = null;
          this.handlers.onClosed();
        }
      });

      socket.addEventListener("message", (event) => this.receive(event.data));
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.you = null;
    socket?.close();
  }

  /** Where I am. Throttled, so walking does not flood a school network. */
  move(x: number, z: number, facing: number): void {
    if (!this.connected) return;
    const now = performance.now();
    if (now - this.lastMove < MOVE_INTERVAL_MS) return;
    this.lastMove = now;
    this.send({ t: "move", x, z, facing });
  }

  progress(score: number, helped: number): void {
    if (!this.connected) return;
    this.send({ t: "progress", score, helped });
  }

  setGoal(missionId: string | null): void {
    if (!this.connected) return;
    this.send({ t: "goal", missionId });
  }

  setMode(modeId: string): void {
    if (!this.connected) return;
    this.send({ t: "mode", modeId });
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private receive(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case "welcome":
        this.you = message.you;
        this.handlers.onReady(message.you, message.peers, message.goal, message.mode);
        break;
      case "denied":
        this.handlers.onDenied(message.reason);
        this.close();
        break;
      case "joined":
        this.handlers.onJoined(message.peer);
        break;
      case "left":
        this.handlers.onLeft(message.id);
        break;
      case "positions":
        this.handlers.onPositions(message.peers.filter((p) => p.id !== this.you));
        break;
      case "progress":
        this.handlers.onProgress(message.id, message.score, message.helped);
        break;
      case "goal":
        this.handlers.onGoal(message.missionId);
        break;
      case "mode":
        this.handlers.onMode(message.modeId);
        break;
      default:
        break;
    }
  }
}
