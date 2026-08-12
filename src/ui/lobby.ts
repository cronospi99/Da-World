import { MAX_STUDENTS } from "../net/protocol";
import { closeButton, el } from "./dom";

/**
 * Joining a class.
 *
 * Four fields and a button, because it is filled in by a room of students
 * reading an address off a whiteboard, and every extra field is thirty people
 * getting it wrong. The address and the room code are remembered, so the
 * second lesson is one tap.
 */

const STORAGE_KEY = "da-world:class";

export interface LobbyDetails {
  url: string;
  room: string;
  name: string;
  asTeacher: boolean;
  passphrase: string;
}

export interface LobbyHandlers {
  onJoin(details: LobbyDetails): Promise<void>;
  onCancel(): void;
}

export class Lobby {
  private readonly root: HTMLElement;
  private readonly url: HTMLInputElement;
  private readonly room: HTMLInputElement;
  private readonly name: HTMLInputElement;
  private readonly teacher: HTMLInputElement;
  private readonly passphrase: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly joinButton: HTMLButtonElement;

  constructor(parent: HTMLElement, private readonly handlers: LobbyHandlers) {
    const saved = read();

    this.url = field("Server address", saved.url || guessUrl(), "ws://192.168.1.10:8787");
    this.room = field("Room code", saved.room || "class", "class");
    this.name = field("Your name", saved.name || "", "Ana");
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

    this.status = el("p", { class: "lobby-status" });
    this.joinButton = el("button", { class: "pill-button", type: "button", text: "Join the class" });
    this.joinButton.addEventListener("click", () => void this.submit());

    const cancel = el("button", { class: "pill-button ghost", type: "button", text: "Back" });
    cancel.addEventListener("click", () => {
      this.toggle(false);
      this.handlers.onCancel();
    });

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "👥 Join a class" }),
          el("p", {
            class: "info-lead",
            text: `Up to ${MAX_STUDENTS} students and one teacher walk the same city. Your teacher will read out the server address.`,
          }),
          labelled("Server address", this.url),
          labelled("Room code", this.room),
          labelled("Your name", this.name),
          teacherRow,
          passRow,
          this.status,
          el("div", { class: "lesson-actions" }, [this.joinButton, cancel]),
          el("p", {
            class: "info-note",
            text: "No server yet? Vocabulary and Directions work on their own, with no connection at all. Running one takes two commands — see server/README.md.",
          }),
        ]),
        closeButton(() => {
          this.toggle(false);
          this.handlers.onCancel();
        }, "Close"),
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
    if (open) {
      this.status.textContent = "";
      this.status.className = "lobby-status";
      if (!this.name.value) this.name.focus();
    }
  }

  private async submit(): Promise<void> {
    const details: LobbyDetails = {
      url: this.url.value.trim(),
      room: this.room.value.trim() || "class",
      name: this.name.value.trim(),
      asTeacher: this.teacher.checked,
      passphrase: this.passphrase.value,
    };
    if (!details.url || !details.name) {
      this.fail("A server address and a name, please.");
      return;
    }

    this.joinButton.disabled = true;
    this.status.className = "lobby-status";
    this.status.textContent = "Connecting…";
    try {
      await this.handlers.onJoin(details);
      remember(details);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.joinButton.disabled = false;
    }
  }

  /** Shown when the server refuses us, which it does for good reasons. */
  fail(reason: string): void {
    this.status.className = "lobby-status is-bad";
    this.status.textContent = reason;
    this.joinButton.disabled = false;
  }
}

function field(label: string, value: string, placeholder: string): HTMLInputElement {
  const input = el("input", {
    class: "teacher-input",
    type: "text",
    value,
    placeholder,
    "aria-label": label,
  }) as HTMLInputElement;
  input.value = value;
  return input;
}

const labelled = (label: string, input: HTMLElement): HTMLElement =>
  el("div", { class: "lobby-field" }, [el("label", { class: "lobby-label", text: label }), input]);

/**
 * A first guess at the server address.
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

function read(): { url: string; room: string; name: string } {
  try {
    return { url: "", room: "", name: "", ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return { url: "", room: "", name: "" };
  }
}

function remember(details: LobbyDetails): void {
  try {
    // The passphrase is deliberately not among the things remembered.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ url: details.url, room: details.room, name: details.name }),
    );
  } catch {
    /* private browsing: they type it again next lesson. */
  }
}
