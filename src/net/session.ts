import {
  MOVE_INTERVAL_MS,
  PROTOCOL,
  type ClientMessage,
  type Peer,
  type Role,
  type ServerMessage,
} from "./protocol";

/**
 * Being in a room, whatever is holding the room together.
 *
 * The city does not care whether the guest list lives in a browser across the
 * classroom or in a node process across the internet: it hands over a position
 * and gets other people's positions back. So everything multiplayer in the
 * game is behind one interface, and `main.ts` never learns which of the two it
 * got.
 *
 * `GuestSession` is the half of that shared by everybody who is *not* holding
 * the guest list — the throttle on outgoing positions and the reading of
 * incoming messages are the same whether they arrive down a WebSocket or a
 * WebRTC data channel, so both transports inherit them and add only the
 * plumbing that differs.
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

/** Everything the game asks of a room. */
export interface Session {
  readonly connected: boolean;
  /** Where I am. Throttled, so walking does not flood a school network. */
  move(x: number, z: number, facing: number): void;
  progress(score: number, helped: number): void;
  /** Only the host's calls count; a guest's are dropped on arrival. */
  setGoal(missionId: string | null): void;
  setMode(modeId: string): void;
  close(): void;
}

/** A session that does not hold the guest list, and so has to ask. */
export abstract class GuestSession implements Session {
  private lastMove = 0;
  /** Our own id, once the host has given us one. */
  you: string | null = null;

  constructor(protected readonly handlers: NetHandlers) {}

  abstract get connected(): boolean;
  abstract close(): void;
  /** Put one message on the wire. Silently dropped when there is no wire. */
  protected abstract deliver(message: ClientMessage): void;

  protected joinMessage(room: string, name: string, role: Role, passphrase?: string): ClientMessage {
    return { t: "join", protocol: PROTOCOL, room, name, role, passphrase };
  }

  move(x: number, z: number, facing: number): void {
    if (!this.connected) return;
    const now = performance.now();
    if (now - this.lastMove < MOVE_INTERVAL_MS) return;
    this.lastMove = now;
    this.deliver({ t: "move", x, z, facing });
  }

  progress(score: number, helped: number): void {
    if (!this.connected) return;
    this.deliver({ t: "progress", score, helped });
  }

  setGoal(missionId: string | null): void {
    if (!this.connected) return;
    this.deliver({ t: "goal", missionId });
  }

  setMode(modeId: string): void {
    if (!this.connected) return;
    this.deliver({ t: "mode", modeId });
  }

  /** One message from the host, already parsed. */
  protected receive(message: ServerMessage): void {
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
        // Our own body is drawn by the game, not by the crowd of classmates,
        // so the one position in the tick that is ours is thrown away here.
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

  /** Text off a socket, which may be anything at all. */
  protected receiveRaw(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    this.receive(message);
  }
}

/** A session that does nothing, used while nobody is hosting anything. */
export const NO_SESSION: Session = {
  connected: false,
  move() {},
  progress() {},
  setGoal() {},
  setMode() {},
  close() {},
};
