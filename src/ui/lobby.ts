import { MAX_PLAYERS } from "../net/protocol";
import type { Peer } from "../net/protocol";
import { closeButton, el } from "./dom";
import { qrCanvas } from "./qr";
import { QrScanner, canScan } from "./scan";

/**
 * Getting a room of people into one city.
 *
 * There are two ways in and they are deliberately not equal. **QR mode** is
 * the front door: one person taps Host, their browser becomes the server, and
 * everybody else scans the code on the board. Nothing is installed, nothing is
 * configured, and the only thing anybody types is their name. **The class
 * server** is the door for a school that would rather have a fixed address
 * than a code that changes every lesson, and it is behind a link, because a
 * teacher with five minutes should never have to read the word "WebSocket".
 *
 * The panel is three screens rather than one form. A student joining sees a
 * Scan button and a code box; a teacher hosting sees a code the size of a
 * headline and a list of who has arrived. Neither is made to look at the
 * other's fields, which is what the old single form did and what made joining
 * a class a four-field exam.
 */

const STORAGE_KEY = "da-world:class";

export interface ServerDetails {
  url: string;
  room: string;
  name: string;
  asTeacher: boolean;
  passphrase: string;
}

export interface LobbyHandlers {
  /** Open a room in this browser. Resolves once the code exists. */
  onHost(name: string): Promise<void>;
  /** Join somebody else's browser by code. */
  onJoin(code: string, name: string): Promise<void>;
  /** The old way in: a class server at a fixed address. */
  onServerJoin(details: ServerDetails): Promise<void>;
  /** The host is done waiting and wants to walk around their own city. */
  onEnter(): void;
  /** Shut the room. */
  onCloseRoom(): void;
  onCancel(): void;
}

type View = "choose" | "host" | "join" | "server";

export class Lobby {
  private readonly root: HTMLElement;
  private readonly views: Record<View, HTMLElement>;
  private readonly scanner: QrScanner;

  /* choose */
  private readonly hostName: HTMLInputElement;

  /* host */
  private readonly codeText: HTMLElement;
  private readonly qrHolder: HTMLElement;
  private readonly linkText: HTMLElement;
  private readonly roster: HTMLElement;
  private readonly hostStatus: HTMLElement;
  private readonly hostNote: HTMLElement;
  private readonly enterButton: HTMLButtonElement;

  /* join */
  private readonly joinCode: HTMLInputElement;
  private readonly joinName: HTMLInputElement;
  private readonly joinStatus: HTMLElement;
  private readonly joinButton: HTMLButtonElement;

  /* server */
  private readonly url: HTMLInputElement;
  private readonly room: HTMLInputElement;
  private readonly serverName: HTMLInputElement;
  private readonly teacher: HTMLInputElement;
  private readonly passphrase: HTMLInputElement;
  private readonly serverStatus: HTMLElement;
  private readonly serverButton: HTMLButtonElement;

  private view: View = "choose";
  /** True once this browser is holding a room open. */
  private hosting = false;

  constructor(
    parent: HTMLElement,
    private readonly handlers: LobbyHandlers,
  ) {
    const saved = read();

    /* --- choose ---------------------------------------------------------- */

    // Empty rather than "Teacher": the value is carried over to the join
    // screen for somebody who taps the wrong one first, and a student walking
    // into a lesson called Teacher is worse than a student typing their name.
    this.hostName = field("Your name", saved.name, "Teacher");

    const hostButton = el("button", { class: "pill-button lobby-big", type: "button" }, [
      el("span", { class: "lobby-big-icon", text: "🏠" }),
      el("span", { class: "lobby-big-label", text: "Host this world" }),
      el("span", {
        class: "lobby-big-sub",
        text: "This browser becomes the server. Your class scans the code.",
      }),
    ]) as HTMLButtonElement;
    hostButton.addEventListener("click", () => void this.startHosting());

    const joinButton = el("button", { class: "pill-button ghost lobby-big", type: "button" }, [
      el("span", { class: "lobby-big-icon", text: "📷" }),
      el("span", { class: "lobby-big-label", text: "Scan a code and join" }),
      el("span", {
        class: "lobby-big-sub",
        text: "Somebody else is hosting. Scan their QR code, or type it.",
      }),
    ]) as HTMLButtonElement;
    joinButton.addEventListener("click", () => this.show("join"));

    const serverLink = el("button", {
      class: "lobby-link",
      type: "button",
      text: "Use a class server instead →",
    });
    serverLink.addEventListener("click", () => this.show("server"));

    this.views = {
      choose: el("div", { class: "lobby-view" }, [
        el("p", {
          class: "info-lead",
          text: `Up to ${MAX_PLAYERS} people walk the same city at the same time. One browser hosts it and everybody else scans a code — no server to install and nothing to set up.`,
        }),
        labelled("Your name", this.hostName),
        el("div", { class: "lobby-choices" }, [hostButton, joinButton]),
        serverLink,
      ]),
      host: el("div", { class: "lobby-view is-hidden" }),
      join: el("div", { class: "lobby-view is-hidden" }),
      server: el("div", { class: "lobby-view is-hidden" }),
    };

    /* --- host ------------------------------------------------------------ */

    this.hostStatus = el("p", { class: "lobby-status", text: "Opening the world…" });
    this.codeText = el("div", { class: "lobby-code", text: "·····" });
    this.qrHolder = el("div", { class: "lobby-qr" });
    this.linkText = el("code", { class: "lobby-link-text" });
    this.roster = el("div", { class: "lobby-roster" });
    this.hostNote = el("p", { class: "info-note" });

    const copyButton = el("button", { class: "chip-button", type: "button", text: "Copy link" });
    copyButton.addEventListener("click", () => {
      const link = this.linkText.textContent ?? "";
      if (!link) return;
      void navigator.clipboard
        ?.writeText(link)
        .then(() => {
          copyButton.textContent = "Copied ✓";
          window.setTimeout(() => (copyButton.textContent = "Copy link"), 1800);
        })
        .catch(() => (copyButton.textContent = "Copy it by hand"));
    });

    this.enterButton = el("button", {
      class: "pill-button",
      type: "button",
      text: "▶ Enter the city",
    }) as HTMLButtonElement;
    this.enterButton.disabled = true;
    this.enterButton.addEventListener("click", () => {
      this.toggle(false);
      this.handlers.onEnter();
    });

    const closeRoom = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "Close the world",
    });
    closeRoom.addEventListener("click", () => {
      this.hosting = false;
      this.handlers.onCloseRoom();
      this.show("choose");
    });

    this.views.host.replaceChildren(
      el("p", {
        class: "info-lead",
        text: "Put this on the board. Everybody points a phone camera at it, or types the letters into the game.",
      }),
      this.codeText,
      this.qrHolder,
      el("div", { class: "lobby-link-row" }, [this.linkText, copyButton]),
      this.hostStatus,
      this.roster,
      this.hostNote,
      el("div", { class: "lesson-actions" }, [this.enterButton, closeRoom]),
      el("p", {
        class: "info-note",
        text: "Keep this tab open: while it is, it is the server. Close it and everybody is dropped back into their own city.",
      }),
    );

    /* --- join ------------------------------------------------------------ */

    this.joinCode = field("Code", "", "ABC12");
    this.joinCode.className = "teacher-input lobby-code-input";
    this.joinCode.maxLength = 8;
    this.joinCode.autocapitalize = "characters";
    this.joinCode.spellcheck = false;
    this.joinCode.addEventListener("input", () => {
      this.joinCode.value = this.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    this.joinName = field("Your name", saved.name || "", "Ana");

    this.scanner = new QrScanner(parent);
    const scanButton = el("button", { class: "pill-button lobby-big", type: "button" }, [
      el("span", { class: "lobby-big-icon", text: "📷" }),
      el("span", { class: "lobby-big-label", text: "Scan the QR code" }),
      el("span", { class: "lobby-big-sub", text: "Point your camera at the board." }),
    ]) as HTMLButtonElement;
    scanButton.addEventListener("click", () => {
      void this.scanner.start((code) => {
        this.joinCode.value = code;
        this.joinStatus.className = "lobby-status";
        this.joinStatus.textContent = `Scanned ${code}.`;
        if (this.joinName.value.trim()) void this.submitJoin();
        else this.joinName.focus();
      });
    });

    this.joinStatus = el("p", { class: "lobby-status" });
    this.joinButton = el("button", {
      class: "pill-button",
      type: "button",
      text: "Join the world",
    }) as HTMLButtonElement;
    this.joinButton.addEventListener("click", () => void this.submitJoin());
    this.joinCode.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.submitJoin();
    });
    this.joinName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.submitJoin();
    });

    this.views.join.replaceChildren(
      el("p", {
        class: "info-lead",
        text: "Your teacher's screen is showing a QR code and five letters. Either will get you in.",
      }),
      canScan()
        ? scanButton
        : el("p", {
            class: "info-note",
            text: "This browser cannot open the camera itself. Scan the code with your phone's camera app — it opens the game already filled in — or type the five letters below.",
          }),
      labelled("Code", this.joinCode),
      labelled("Your name", this.joinName),
      this.joinStatus,
      el("div", { class: "lesson-actions" }, [this.joinButton, this.backButton()]),
    );

    /* --- server (the old way) -------------------------------------------- */

    this.url = field("Server address", saved.url || guessUrl(), "ws://192.168.1.10:8787");
    this.room = field("Room code", saved.room || "class", "class");
    this.serverName = field("Your name", saved.name || "", "Ana");
    this.passphrase = field("Teacher passphrase", "", "only if you are the teacher");
    this.passphrase.type = "password";

    this.teacher = el("input", { type: "checkbox", id: "lobby-teacher" }) as HTMLInputElement;
    const teacherRow = el("label", { class: "lobby-check", for: "lobby-teacher" }, [
      this.teacher,
      el("span", { text: "I am the teacher" }),
    ]);
    const passRow = el("div", { class: "lobby-field is-hidden" }, [
      el("label", { class: "lobby-label", text: "Teacher passphrase" }),
      this.passphrase,
    ]);
    this.teacher.addEventListener("change", () => {
      passRow.classList.toggle("is-hidden", !this.teacher.checked);
    });

    this.serverStatus = el("p", { class: "lobby-status" });
    this.serverButton = el("button", {
      class: "pill-button",
      type: "button",
      text: "Join the class",
    }) as HTMLButtonElement;
    this.serverButton.addEventListener("click", () => void this.submitServer());

    this.views.server.replaceChildren(
      el("p", {
        class: "info-lead",
        text: "For a school running the relay in server/. Your teacher will read out the address.",
      }),
      labelled("Server address", this.url),
      labelled("Room code", this.room),
      labelled("Your name", this.serverName),
      teacherRow,
      passRow,
      this.serverStatus,
      el("div", { class: "lesson-actions" }, [this.serverButton, this.backButton()]),
      el("p", {
        class: "info-note",
        text: "Running one takes two commands — see server/README.md. If you have not got one, go back and host the world in this browser instead.",
      }),
    );

    /* --- the card -------------------------------------------------------- */

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "👥 Play together" }),
          this.views.choose,
          this.views.host,
          this.views.join,
          this.views.server,
        ]),
        closeButton(() => this.dismiss(), "Close"),
      ]),
    ]);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  toggle(open: boolean): void {
    this.root.classList.toggle("is-open", open);
    this.root.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) this.scanner.stop();
  }

  /** Open on the panel that makes sense: the room if we are holding one. */
  open(): void {
    this.show(this.hosting ? "host" : "choose");
    this.toggle(true);
  }

  /** Opened by scanning: straight to the join screen with the code filled in. */
  openWithCode(code: string): void {
    this.joinCode.value = code;
    this.show("join");
    this.toggle(true);
    if (!this.joinName.value) this.joinName.focus();
  }

  private dismiss(): void {
    this.toggle(false);
    // A host closing the panel is going back to their city, not shutting the
    // room: the room is the tab, and the tab is still open.
    if (this.hosting) this.handlers.onEnter();
    else this.handlers.onCancel();
  }

  private backButton(): HTMLButtonElement {
    const button = el("button", {
      class: "pill-button ghost",
      type: "button",
      text: "Back",
    }) as HTMLButtonElement;
    button.addEventListener("click", () => this.show("choose"));
    return button;
  }

  private show(view: View): void {
    this.view = view;
    for (const [name, node] of Object.entries(this.views)) {
      node.classList.toggle("is-hidden", name !== view);
    }
    this.scanner.stop();
    if (view === "join" && !this.joinName.value) this.joinName.value = this.hostName.value.trim();
  }

  /* ------------------------------ hosting -------------------------------- */

  private async startHosting(): Promise<void> {
    const name = this.hostName.value.trim() || "Teacher";
    this.hostName.value = name;
    remember({ name });
    this.show("host");
    this.hosting = true;
    this.codeText.textContent = "·····";
    this.qrHolder.replaceChildren();
    this.linkText.textContent = "";
    this.enterButton.disabled = true;
    this.hostStatus.className = "lobby-status";
    this.hostStatus.textContent = "Opening the world…";
    try {
      await this.handlers.onHost(name);
    } catch (error) {
      this.hosting = false;
      this.hostStatus.className = "lobby-status is-bad";
      this.hostStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  /** The room is open: show the code, the QR and the link. */
  showRoom(code: string, link: string): void {
    this.hosting = true;
    this.codeText.textContent = code;
    this.linkText.textContent = link;
    this.hostStatus.className = "lobby-status";
    this.hostStatus.textContent = "";
    this.enterButton.disabled = false;
    try {
      this.qrHolder.replaceChildren(qrCanvas(link));
    } catch {
      // No QR is survivable: the code underneath it is the same room.
      this.qrHolder.replaceChildren(
        el("p", { class: "info-note", text: "This browser would not draw the QR code — read out the letters instead." }),
      );
    }
    this.hostNote.textContent = isLocal()
      ? "This page is on localhost, so that link only works on this machine. Serve the game on your network (the dev server prints a Network address) and the phones in the room can reach it."
      : "";
  }

  /** Who is in, host included. */
  setRoster(peers: Peer[]): void {
    if (!peers.length) {
      this.roster.replaceChildren();
      return;
    }
    const names = peers.map((peer) =>
      el("span", {
        class: peer.role === "teacher" ? "lobby-name is-host" : "lobby-name",
        text: peer.role === "teacher" ? `👩‍🏫 ${peer.name}` : peer.name,
      }),
    );
    const rows: HTMLElement[] = [
      el("div", { class: "lobby-count", text: `${peers.length} / ${MAX_PLAYERS} in the city` }),
      el("div", { class: "lobby-names" }, names),
    ];
    if (peers.length < 2) {
      rows.push(el("p", { class: "info-note", text: "Waiting for the first phone to scan…" }));
    }
    this.roster.replaceChildren(...rows);
  }

  /* ------------------------------ joining -------------------------------- */

  private async submitJoin(): Promise<void> {
    const code = this.joinCode.value.trim().toUpperCase();
    const name = this.joinName.value.trim();
    if (!code || !name) {
      this.fail("A code and a name, please.");
      return;
    }
    remember({ name });

    this.joinButton.disabled = true;
    this.setStatus("Looking for that world…");
    try {
      await this.handlers.onJoin(code, name);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.joinButton.disabled = false;
    }
  }

  private async submitServer(): Promise<void> {
    const details: ServerDetails = {
      url: this.url.value.trim(),
      room: this.room.value.trim() || "class",
      name: this.serverName.value.trim(),
      asTeacher: this.teacher.checked,
      passphrase: this.passphrase.value,
    };
    if (!details.url || !details.name) {
      this.fail("A server address and a name, please.");
      return;
    }

    this.serverButton.disabled = true;
    this.setStatus("Connecting…");
    try {
      await this.handlers.onServerJoin(details);
      // The passphrase is deliberately not among the things remembered.
      remember({ url: details.url, room: details.room, name: details.name });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.serverButton.disabled = false;
    }
  }

  /* ------------------------------ feedback ------------------------------- */

  /** Progress worth showing whoever is waiting, on whichever screen they are on. */
  setStatus(text: string): void {
    const node = this.statusNode();
    node.className = "lobby-status";
    node.textContent = text;
  }

  /** Shown when we are refused, which happens for good reasons. */
  fail(reason: string): void {
    const node = this.statusNode();
    node.className = "lobby-status is-bad";
    node.textContent = reason;
    this.joinButton.disabled = false;
    this.serverButton.disabled = false;
  }

  private statusNode(): HTMLElement {
    if (this.view === "host") return this.hostStatus;
    if (this.view === "server") return this.serverStatus;
    return this.joinStatus;
  }
}

function field(label: string, value: string, placeholder: string): HTMLInputElement {
  const input = el("input", {
    class: "teacher-input",
    type: "text",
    placeholder,
    "aria-label": label,
  }) as HTMLInputElement;
  input.value = value;
  return input;
}

const labelled = (label: string, input: HTMLElement): HTMLElement =>
  el("div", { class: "lobby-field" }, [el("label", { class: "lobby-label", text: label }), input]);

/** Whether a link to this page would be any use to a phone in the room. */
const isLocal = (): boolean =>
  ["localhost", "127.0.0.1", "::1", ""].includes(location.hostname);

/**
 * A first guess at the class server's address.
 *
 * Almost always wrong, and worth making anyway: when the game is served from
 * the same machine that runs the class server — which is the whole
 * one-laptop-in-a-classroom case — it is exactly right, and the teacher does
 * not have to find their own IP address.
 */
function guessUrl(): string {
  if (typeof location === "undefined") return "";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.hostname || "localhost"}:8787`;
}

interface Saved {
  url: string;
  room: string;
  name: string;
}

function read(): Saved {
  try {
    return { url: "", room: "", name: "", ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return { url: "", room: "", name: "" };
  }
}

function remember(details: Partial<Saved>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ...details }));
  } catch {
    /* private browsing: they type it again next lesson. */
  }
}
