import {
  HAIR_COLOURS,
  OUTFITS,
  PANTS_COLOURS,
  SHIRT_COLOURS,
  SKIN_COLOURS,
  type Appearance,
  type BodyKind,
} from "../game/appearance";
import type { Outfit } from "../city/npcData";
import { closeButton, el } from "./dom";

/**
 * Who you want to be, before you walk out of the door.
 *
 * The point of this screen is not the colours. It is that a class of thirty
 * students walking the same city all looked like the same person, and the first
 * thing anybody says when they see their classmates on the pavement is "which
 * one is me?" — a question a name tag answers and a character does not. Two
 * bodies and four palettes is enough for a room of twelve to be twelve
 * different people at a glance.
 *
 * It is a live preview rather than a description, because "shirt: #19b8e8" is
 * not something a twelve-year-old should have to imagine. The figure to the
 * left is drawn from the same numbers the game builds the character from, so
 * what you pick is what walks out.
 */

export interface CharacterHandlers {
  /** Called on every change: the character in the city updates as you pick. */
  onChange(appearance: Appearance): void;
  onClose(): void;
}

export class CharacterPanel {
  private readonly root: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly humanOnly: HTMLElement;
  private readonly bodyCards = new Map<BodyKind, HTMLElement>();
  private readonly swatchRows: { key: keyof Appearance; row: HTMLElement }[] = [];
  private readonly outfitRow: HTMLElement;
  private readonly shirtLabel: HTMLElement;
  private appearance: Appearance;

  constructor(
    parent: HTMLElement,
    appearance: Appearance,
    private readonly handlers: CharacterHandlers,
  ) {
    this.appearance = { ...appearance };

    this.preview = el("div", { class: "avatar" });
    this.shirtLabel = el("label", { class: "lobby-label", text: "Shirt" });

    const bodies = el("div", { class: "body-grid" }, [
      this.bodyCard("human", "🧍", "Person", "Built like everybody else in the city."),
      this.bodyCard("robot", "🤖", "Robot", "A real skeleton, with a wave and a jump of its own."),
    ]);

    const shirtRow = this.swatchRow("shirt", SHIRT_COLOURS);
    const pantsRow = this.swatchRow("pants", PANTS_COLOURS);
    const skinRow = this.swatchRow("skin", SKIN_COLOURS);
    const hairRow = this.swatchRow("hair", HAIR_COLOURS);

    this.outfitRow = el(
      "div",
      { class: "chip-row" },
      OUTFITS.map((outfit) => {
        const button = el("button", {
          class: "chip-button",
          type: "button",
          text: outfit.label,
        });
        button.addEventListener("click", () => this.set("outfit", outfit.id));
        button.dataset.outfit = outfit.id;
        return button;
      }),
    );

    // Everything below the shirt is a person's; the robot is painted panels and
    // a chassis, and offering it a haircut would be a menu that does nothing.
    this.humanOnly = el("div", {}, [
      el("div", { class: "lobby-field" }, [
        el("label", { class: "lobby-label", text: "Trousers" }),
        pantsRow,
      ]),
      el("div", { class: "lobby-field" }, [el("label", { class: "lobby-label", text: "Skin" }), skinRow]),
      el("div", { class: "lobby-field" }, [el("label", { class: "lobby-label", text: "Hair" }), hairRow]),
      el("div", { class: "lobby-field" }, [
        el("label", { class: "lobby-label", text: "What they carry" }),
        this.outfitRow,
      ]),
    ]);

    const done = el("button", { class: "pill-button", type: "button", text: "Done" });
    done.addEventListener("click", () => this.dismiss());

    this.root = el("div", { class: "overlay info-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "card info-card" }, [
        el("div", { class: "card-shadow" }),
        el("div", { class: "card-face" }),
        el("article", { class: "card-body" }, [
          el("h2", { class: "info-title", text: "🧍 Your character" }),
          el("p", {
            class: "info-lead",
            text: "This is who walks the city, and who your class sees on the pavement.",
          }),
          el("div", { class: "avatar-row" }, [
            this.preview,
            el("div", { class: "avatar-choices" }, [
              bodies,
              el("div", { class: "lobby-field" }, [this.shirtLabel, shirtRow]),
              this.humanOnly,
            ]),
          ]),
          el("div", { class: "lesson-actions" }, [done]),
        ]),
        closeButton(() => this.dismiss(), "Close"),
      ]),
    ]);
    this.root.querySelector(".overlay-scrim")!.addEventListener("click", () => this.dismiss());
    parent.append(this.root);
    this.refresh();
  }

  get isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  toggle(open: boolean): void {
    this.root.classList.toggle("is-open", open);
    this.root.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) this.refresh();
  }

  private dismiss(): void {
    this.toggle(false);
    this.handlers.onClose();
  }

  private bodyCard(kind: BodyKind, icon: string, name: string, blurb: string): HTMLElement {
    const card = el("button", { class: "body-card", type: "button", "aria-pressed": "false" }, [
      el("div", { class: "body-icon", text: icon }),
      el("div", { class: "body-name", text: name }),
      el("div", { class: "body-blurb", text: blurb }),
    ]);
    card.addEventListener("click", () => this.set("kind", kind));
    this.bodyCards.set(kind, card);
    return card;
  }

  private swatchRow(key: keyof Appearance, colours: readonly string[]): HTMLElement {
    const row = el(
      "div",
      { class: "swatch-row" },
      colours.map((colour) => {
        const swatch = el("button", {
          class: "swatch",
          type: "button",
          "aria-label": colour,
          style: `background-color:${colour}`,
        });
        swatch.dataset.colour = colour;
        swatch.addEventListener("click", () => this.set(key, colour));
        return swatch;
      }),
    );
    this.swatchRows.push({ key, row });
    return row;
  }

  private set(key: keyof Appearance, value: string): void {
    this.appearance = { ...this.appearance, [key]: value } as Appearance;
    this.refresh();
    this.handlers.onChange({ ...this.appearance });
  }

  private refresh(): void {
    const robot = this.appearance.kind === "robot";
    for (const [kind, card] of this.bodyCards) {
      const chosen = kind === this.appearance.kind;
      card.classList.toggle("is-chosen", chosen);
      card.setAttribute("aria-pressed", chosen ? "true" : "false");
    }
    for (const { key, row } of this.swatchRows) {
      for (const node of row.children) {
        const swatch = node as HTMLElement;
        swatch.classList.toggle("is-chosen", swatch.dataset.colour === this.appearance[key]);
      }
    }
    for (const node of this.outfitRow.children) {
      const chip = node as HTMLElement;
      chip.classList.toggle("is-chosen", chip.dataset.outfit === this.appearance.outfit);
    }
    this.shirtLabel.textContent = robot ? "Paint" : "Shirt";
    this.humanOnly.style.display = robot ? "none" : "block";
    this.preview.innerHTML = robot ? robotSvg(this.appearance) : personSvg(this.appearance);
  }
}

/**
 * The mannequin.
 *
 * Flat SVG rather than a second three.js scene: the figure only has to answer
 * "is that the blue I meant?", and a live 3D preview on a phone that is already
 * drawing a city is a second renderer for a question a drawing answers.
 */
function personSvg(a: Appearance): string {
  const hat = outfitOverlay(a.outfit, a.shirt);
  return `<svg viewBox="0 0 100 150" role="img" aria-label="Your character">
    <ellipse cx="50" cy="143" rx="26" ry="5" fill="rgba(60,54,46,.16)"/>
    <rect x="34" y="96" width="13" height="40" rx="6" fill="${a.pants}"/>
    <rect x="53" y="96" width="13" height="40" rx="6" fill="${a.pants}"/>
    <rect x="31" y="131" width="18" height="9" rx="4" fill="#3a3330"/>
    <rect x="51" y="131" width="18" height="9" rx="4" fill="#3a3330"/>
    <rect x="30" y="56" width="40" height="46" rx="12" fill="${a.shirt}"/>
    <rect x="20" y="60" width="11" height="34" rx="5" fill="${a.shirt}"/>
    <rect x="69" y="60" width="11" height="34" rx="5" fill="${a.shirt}"/>
    <rect x="19" y="90" width="13" height="12" rx="5" fill="${a.skin}"/>
    <rect x="68" y="90" width="13" height="12" rx="5" fill="${a.skin}"/>
    <rect x="45" y="48" width="10" height="10" rx="3" fill="${a.skin}"/>
    <rect x="31" y="16" width="38" height="36" rx="12" fill="${a.skin}"/>
    <path d="M31 28 q19 -18 38 0 v-6 q-19 -14 -38 0 z" fill="${a.hair}"/>
    <rect x="29" y="14" width="42" height="12" rx="6" fill="${a.hair}"/>
    <circle cx="42" cy="34" r="3.4" fill="#241a2e"/>
    <circle cx="58" cy="34" r="3.4" fill="#241a2e"/>
    <path d="M43 42 q7 6 14 0" stroke="#3a2334" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${hat}
  </svg>`;
}

function outfitOverlay(outfit: Outfit, shirt: string): string {
  switch (outfit) {
    case "cap":
      return `<rect x="29" y="10" width="42" height="12" rx="6" fill="${shirt}"/>
              <rect x="29" y="19" width="30" height="5" rx="2.5" fill="${shirt}"/>`;
    case "hat":
      return `<ellipse cx="50" cy="20" rx="31" ry="7" fill="#d8c191"/>
              <rect x="34" y="6" width="32" height="14" rx="7" fill="#d8c191"/>`;
    case "helmet":
      return `<path d="M28 22 a22 20 0 0 1 44 0 v4 h-44 z" fill="#e8c33f"/>`;
    case "apron":
      return `<rect x="36" y="62" width="28" height="38" rx="6" fill="#f3ece0"/>`;
    case "glasses":
      return `<rect x="34" y="30" width="32" height="8" rx="3" fill="none" stroke="#2f2a26" stroke-width="2.4"/>`;
    case "backpack":
      return `<rect x="24" y="58" width="8" height="34" rx="4" fill="#6b5a4a"/>
              <rect x="68" y="58" width="8" height="34" rx="4" fill="#6b5a4a"/>`;
    default:
      return "";
  }
}

function robotSvg(a: Appearance): string {
  return `<svg viewBox="0 0 100 150" role="img" aria-label="Your robot">
    <ellipse cx="50" cy="143" rx="26" ry="5" fill="rgba(60,54,46,.16)"/>
    <rect x="33" y="98" width="14" height="34" rx="5" fill="#9aa0a6"/>
    <rect x="53" y="98" width="14" height="34" rx="5" fill="#9aa0a6"/>
    <rect x="29" y="128" width="20" height="11" rx="4" fill="#4a4f55"/>
    <rect x="51" y="128" width="20" height="11" rx="4" fill="#4a4f55"/>
    <rect x="29" y="56" width="42" height="46" rx="10" fill="${a.shirt}"/>
    <rect x="37" y="66" width="26" height="18" rx="4" fill="rgba(255,255,255,.35)"/>
    <rect x="17" y="58" width="12" height="32" rx="6" fill="#9aa0a6"/>
    <rect x="71" y="58" width="12" height="32" rx="6" fill="#9aa0a6"/>
    <rect x="15" y="86" width="16" height="14" rx="6" fill="${a.shirt}"/>
    <rect x="69" y="86" width="16" height="14" rx="6" fill="${a.shirt}"/>
    <rect x="46" y="48" width="8" height="10" rx="3" fill="#4a4f55"/>
    <rect x="28" y="14" width="44" height="36" rx="13" fill="${a.shirt}"/>
    <rect x="34" y="24" width="32" height="16" rx="8" fill="#2f3439"/>
    <circle cx="43" cy="32" r="4.2" fill="#8fe8ff"/>
    <circle cx="57" cy="32" r="4.2" fill="#8fe8ff"/>
    <rect x="48" y="2" width="4" height="10" rx="2" fill="#9aa0a6"/>
    <circle cx="50" cy="3" r="4" fill="#e8637c"/>
  </svg>`;
}
