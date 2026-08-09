import * as THREE from "three";
import { PLACES } from "../content/places";
import type { Place } from "../content/types";
import { createProp } from "../world/props";
import { heightAt } from "../world/terrain";
import type { HotspotTarget } from "../ui/hotspots";

export interface BuiltWorld {
  group: THREE.Group;
  targets: HotspotTarget[];
  /** Objects that animate (flags, flames, clock hands). */
  animated: THREE.Object3D[];
}

/** Height above the prop where its marker floats, per prop kind. */
const MARKER_HEIGHT: Record<string, number> = {
  tree: 7.4,
  palm: 6.4,
  rock: 2.2,
  crate: 2.4,
  barrel: 2.2,
  boat: 5.6,
  lamp: 5.4,
  bench: 2.2,
  sign: 3.4,
  tent: 3.2,
  well: 4.4,
  stall: 3.6,
  house: 5.4,
  flag: 5.8,
  campfire: 2.4,
  clock: 7.0,
};

/**
 * Instantiates every place described in the content file: props on the
 * terrain plus the hotspot anchors the UI projects to the screen.
 */
export function buildPlaces(): BuiltWorld {
  const group = new THREE.Group();
  group.name = "places";
  const targets: HotspotTarget[] = [];
  const animated: THREE.Object3D[] = [];

  for (const place of PLACES) {
    const placeGroup = new THREE.Group();
    placeGroup.name = `place:${place.id}`;

    for (const spot of place.spots) {
      const x = place.center[0] + spot.offset[0];
      const z = place.center[1] + spot.offset[1];
      const y = heightAt(x, z);

      const prop = createProp(spot.prop, place.palette);
      prop.position.set(x, y, z);
      prop.rotation.y = spot.rotation ?? 0;
      const scale = spot.scale ?? 1;
      prop.scale.setScalar(scale);
      prop.userData.spotId = spot.id;
      placeGroup.add(prop);

      for (const child of prop.children) {
        if (child.name === "cloth" || child.name === "flame" || child.name === "hands") {
          animated.push(child);
        }
      }

      targets.push({
        place,
        spot,
        anchor: new THREE.Vector3(
          x,
          y + (MARKER_HEIGHT[spot.prop] ?? 3) * scale * 0.85,
          z,
        ),
      });
    }

    group.add(placeGroup);
  }

  return { group, targets, animated };
}

/** The place whose radius currently contains the player, if any. */
export function placeAt(x: number, z: number): Place | null {
  let best: Place | null = null;
  let bestDistance = Infinity;
  for (const place of PLACES) {
    const distance = Math.hypot(x - place.center[0], z - place.center[1]);
    if (distance < place.radius && distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  return best;
}

/** Cheap idle motion for the animated bits of the props. */
export function animateProps(objects: THREE.Object3D[], elapsed: number): void {
  for (const object of objects) {
    switch (object.name) {
      case "cloth":
        object.rotation.y = Math.sin(elapsed * 2.2) * 0.25;
        object.scale.x = 1 + Math.sin(elapsed * 3.1) * 0.06;
        break;
      case "flame":
        object.scale.set(
          1 + Math.sin(elapsed * 9) * 0.12,
          1 + Math.sin(elapsed * 7 + 1) * 0.2,
          1 + Math.cos(elapsed * 8) * 0.12,
        );
        break;
      case "hands":
        object.rotation.z = -elapsed * 0.25;
        break;
    }
  }
}
