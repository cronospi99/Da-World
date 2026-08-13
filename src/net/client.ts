import type { ClientMessage, PeerLook, Role } from "./protocol";
import { GuestSession, type NetHandlers } from "./session";

/**
 * The other end of the class server.
 *
 * A thin wrapper over one WebSocket: it knows how to join and it turns
 * messages into callbacks, with the throttling and the reading inherited from
 * `GuestSession` because a WebRTC guest does exactly the same with them. It
 * deliberately holds no opinion about the city — the game hands it a position
 * and gets other people's positions back, and everything else about the world
 * each browser works out for itself.
 *
 * Everything is best-effort. A classroom network drops, a laptop sleeps, a
 * student closes the lid; none of that should end the lesson, so a lost
 * connection stops the multiplayer part and leaves the city running.
 */

export interface JoinOptions {
  url: string;
  room: string;
  name: string;
  role: Role;
  look: PeerLook;
  passphrase?: string;
}

export class NetClient extends GuestSession {
  private socket: WebSocket | null = null;

  constructor(handlers: NetHandlers) {
    super(handlers);
  }

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
        socket.send(
          JSON.stringify(
            this.joinMessage(
              options.room,
              options.name,
              options.role,
              options.look,
              options.passphrase,
            ),
          ),
        );
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

      socket.addEventListener("message", (event) => this.receiveRaw(event.data));
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.you = null;
    socket?.close();
  }

  protected deliver(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
