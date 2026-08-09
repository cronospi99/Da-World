import * as THREE from "three";
import type { Place, Spot } from "../content/types";
import type { Progress } from "../learn/progress";
import { el } from "./dom";

export interface HotspotTarget {
  place: Place;
  spot: Spot;
  /** World position of the marker (above the prop). */
  anchor: THREE.Vector3;
}

/** Distance at which a marker becomes clickable. */
export const INTERACT_RADIUS = 6.5;
/** Distance at which a marker stops being drawn at all. */
const VISIBLE_RADIUS = 55;

interface Entry {
  target: HotspotTarget;
  node: HTMLButtonElement;
  labelNode: HTMLSpanElement;
}

/**
 * Projects world anchors to screen space and keeps one DOM marker per spot.
 * DOM markers (rather than sprites) keep the text crisp and accessible.
 */
export class Hotspots {
  private readonly entries: Entry[] = [];
  private readonly projected = new THREE.Vector3();
  /** The spot the player can currently interact with, if any. */
  active: HotspotTarget | null = null;

  constructor(
    private readonly layer: HTMLElement,
    targets: HotspotTarget[],
    private readonly camera: THREE.PerspectiveCamera,
    private readonly progress: Progress,
    private readonly onSelect: (target: HotspotTarget) => void,
  ) {
    for (const target of targets) {
      const labelNode = el("span", { class: "marker-label", text: target.spot.vocab.en });
      const node = el(
        "button",
        {
          class: "marker",
          type: "button",
          "aria-label": `Learn: ${target.spot.vocab.en}`,
        },
        [
          el("span", { class: "marker-dot" }, [
            el("span", { class: "marker-emoji", text: target.spot.vocab.emoji }),
          ]),
          labelNode,
        ],
      );
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        this.onSelect(target);
      });
      this.layer.appendChild(node);
      this.entries.push({ target, node, labelNode });
    }

    this.progress.subscribe(() => this.refreshLearnedState());
  }

  private refreshLearnedState(): void {
    for (const entry of this.entries) {
      entry.node.classList.toggle(
        "is-learned",
        this.progress.isLearned(entry.target.spot.id),
      );
    }
  }

  update(playerPosition: THREE.Vector3): void {
    let closest: HotspotTarget | null = null;
    let closestDistance = Infinity;

    const halfWidth = window.innerWidth * 0.5;
    const halfHeight = window.innerHeight * 0.5;

    for (const entry of this.entries) {
      const distance = entry.target.anchor.distanceTo(playerPosition);

      if (distance > VISIBLE_RADIUS) {
        entry.node.style.display = "none";
        continue;
      }

      this.projected.copy(entry.target.anchor).project(this.camera);
      const behindCamera = this.projected.z > 1;
      if (behindCamera) {
        entry.node.style.display = "none";
        continue;
      }

      entry.node.style.display = "";
      const x = this.projected.x * halfWidth + halfWidth;
      const y = -this.projected.y * halfHeight + halfHeight;
      entry.node.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

      const near = distance <= INTERACT_RADIUS;
      entry.node.classList.toggle("is-near", near);
      // Far markers fade to a quiet dot so the horizon does not get noisy.
      entry.node.style.opacity = String(
        near ? 1 : Math.max(0.4, 1 - (distance - INTERACT_RADIUS) / 45),
      );
      entry.node.disabled = !near;

      if (near && distance < closestDistance) {
        closestDistance = distance;
        closest = entry.target;
      }
    }

    this.active = closest;
  }
}
