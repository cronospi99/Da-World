import * as THREE from "three";
import type { PlacePalette, PropKind } from "../content/types";
import { toonMaterial, type RampRow } from "./materials";

/**
 * Parametric low-poly props.
 *
 * Every prop is built from primitives so the game ships with zero binary
 * assets. Each builder returns a Group whose origin sits on the ground and
 * whose contents are already shadow-configured.
 *
 * Materials all come from `toonMaterial`, so props shade with the same ramps
 * as the terrain and the character.
 */

const materialCache = new Map<string, THREE.MeshToonMaterial>();

interface MatOptions {
  ramp?: RampRow;
  /** Self-lit surfaces: lamp bulbs, fire. */
  glow?: number;
  /** Sway in the wind — foliage only. */
  wind?: boolean;
  windHeight?: number;
}

function mat(color: string, options: MatOptions = {}): THREE.MeshToonMaterial {
  const { ramp = "default", glow = 0, wind = false, windHeight = 6 } = options;
  const key = `${color}|${ramp}|${glow}|${wind}|${windHeight}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const material = toonMaterial({
    color,
    ramp,
    flatShading: true,
    wind,
    windHeight,
    windStrength: 0.09,
  });
  if (glow > 0) {
    material.emissive = new THREE.Color(color);
    material.emissiveIntensity = glow;
  }
  materialCache.set(key, material);
  return material;
}

const WOOD = "#8a5a3b";
const DARK_WOOD = "#6b452c";
const CANVAS = "#f1e3c6";
const METAL = "#7d8a92";

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

type Builder = (palette: PlacePalette) => THREE.Group;

const builders: Record<PropKind, Builder> = {
  tree: (p) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.42, 2.6, 6), mat(DARK_WOOD), 0, 1.3));
    const leaf = mat(p.prop, { ramp: "foliage", wind: true, windHeight: 7 });
    g.add(mesh(new THREE.ConeGeometry(1.9, 3.0, 7), leaf, 0, 3.6));
    g.add(mesh(new THREE.ConeGeometry(1.5, 2.4, 7), leaf, 0, 5.1));
    g.add(mesh(new THREE.ConeGeometry(1.0, 1.8, 7), leaf, 0, 6.4));
    return g;
  },

  palm: (p) => {
    const g = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(0.2, 0.36, 5.4, 6), mat("#9c7448"), 0, 2.7);
    trunk.rotation.z = 0.14;
    g.add(trunk);
    const leaf = mat(p.prop, { ramp: "foliage", wind: true, windHeight: 6 });
    for (let i = 0; i < 6; i++) {
      const frond = mesh(new THREE.ConeGeometry(0.55, 3.2, 4), leaf, 0.4, 5.3);
      frond.rotation.z = Math.PI / 2 - 0.35;
      frond.rotation.y = (i / 6) * Math.PI * 2;
      frond.position.x = Math.cos((i / 6) * Math.PI * 2) * 1.3 + 0.4;
      frond.position.z = Math.sin((i / 6) * Math.PI * 2) * 1.3;
      g.add(frond);
    }
    return g;
  },

  rock: () => {
    const g = new THREE.Group();
    const main = mesh(new THREE.IcosahedronGeometry(1.1, 0), mat("#9a978d", { ramp: "stone" }), 0, 0.75);
    main.scale.set(1.3, 0.85, 1.1);
    main.rotation.set(0.4, 0.9, 0.2);
    g.add(main);
    const small = mesh(new THREE.IcosahedronGeometry(0.5, 0), mat("#8b8880", { ramp: "stone" }), 1.1, 0.3, 0.5);
    small.rotation.set(0.8, 0.3, 0.5);
    g.add(small);
    return g;
  },

  crate: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.5, 1.4, 1.5), mat(WOOD), 0, 0.7));
    const band = mat(DARK_WOOD);
    g.add(mesh(new THREE.BoxGeometry(1.6, 0.16, 1.6), band, 0, 0.35));
    g.add(mesh(new THREE.BoxGeometry(1.6, 0.16, 1.6), band, 0, 1.1));
    const stacked = mesh(new THREE.BoxGeometry(1.2, 1.1, 1.2), mat(WOOD), 1.2, 0.55, 0.4);
    stacked.rotation.y = 0.5;
    g.add(stacked);
    return g;
  },

  barrel: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.62, 0.5, 1.5, 10), mat("#a3703f"), 0, 0.75));
    const hoop = mat(METAL);
    g.add(mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.12, 10), hoop, 0, 0.45));
    g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 10), hoop, 0, 1.2));
    return g;
  },

  boat: (p) => {
    const g = new THREE.Group();
    const hull = mesh(new THREE.CylinderGeometry(1.0, 0.7, 4.4, 6, 1, false), mat(p.prop), 0, 0.6);
    hull.rotation.set(Math.PI / 2, 0, 0);
    hull.scale.set(1, 1, 0.55);
    g.add(hull);
    g.add(mesh(new THREE.BoxGeometry(2.0, 0.16, 4.2), mat(WOOD), 0, 1.05));
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6), mat(DARK_WOOD), 0, 3.3));
    const sail = mesh(new THREE.ConeGeometry(1.25, 3.4, 3), mat(CANVAS, { ramp: "soft" }), 0.05, 3.2);
    sail.rotation.y = Math.PI / 6;
    g.add(sail);
    return g;
  },

  lamp: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.18, 4.2, 6), mat("#5c5a55"), 0, 2.1));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat("#4a4844"), 0, 4.35));
    const bulb = mesh(new THREE.SphereGeometry(0.26, 8, 6), mat("#ffe9a8", { glow: 1.6, ramp: "soft" }), 0, 4.35);
    bulb.castShadow = false;
    g.add(bulb);
    return g;
  },

  bench: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(2.6, 0.16, 0.8), mat(WOOD), 0, 0.62));
    const back = mesh(new THREE.BoxGeometry(2.6, 0.6, 0.14), mat(WOOD), 0, 1.05, -0.33);
    back.rotation.x = -0.18;
    g.add(back);
    const leg = mat(DARK_WOOD);
    for (const x of [-1.05, 1.05]) {
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.62, 0.7), leg, x, 0.31));
    }
    return g;
  },

  sign: (p) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 6), mat(DARK_WOOD), 0, 1.2));
    const board = mesh(new THREE.BoxGeometry(1.9, 1.1, 0.12), mat(CANVAS, { ramp: "soft" }), 0, 2.1);
    board.rotation.z = 0.06;
    g.add(board);
    g.add(mesh(new THREE.BoxGeometry(2.05, 0.12, 0.16), mat(p.accent), 0, 1.6));
    return g;
  },

  tent: (p) => {
    const g = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 3), mat(p.accent, { ramp: "soft" }), 0, 0.85);
    body.rotation.set(Math.PI / 2, 0, Math.PI / 6);
    g.add(body);
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5), mat(DARK_WOOD), 0, 1.1, 1.7));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5), mat(DARK_WOOD), 0, 1.1, -1.7));
    return g;
  },

  well: (p) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(1.1, 1.15, 1.1, 12), mat("#9a978d", { ramp: "stone" }), 0, 0.55));
    g.add(mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 12), mat("#3f6b7a"), 0, 1.0));
    for (const x of [-0.9, 0.9]) {
      g.add(mesh(new THREE.BoxGeometry(0.16, 2.0, 0.16), mat(DARK_WOOD), x, 2.05));
    }
    const roof = mesh(new THREE.ConeGeometry(1.6, 1.0, 4), mat(p.prop), 0, 3.4);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    return g;
  },

  stall: (p) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(3.0, 0.14, 1.4), mat(WOOD), 0, 1.05));
    const leg = mat(DARK_WOOD);
    for (const x of [-1.35, 1.35]) {
      for (const z of [-0.55, 0.55]) {
        g.add(mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), leg, x, 0.52, z));
        g.add(mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), leg, x, 1.8, z));
      }
    }
    const awning = mesh(new THREE.BoxGeometry(3.4, 0.12, 1.9), mat(p.accent, { ramp: "soft" }), 0, 2.55);
    awning.rotation.x = 0.12;
    g.add(awning);
    for (let i = -1; i <= 1; i++) {
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.14, 1.92), mat(CANVAS, { ramp: "soft" }), i * 1.1, 2.57));
    }
    return g;
  },

  house: (p) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(4.2, 3.0, 3.6), mat(CANVAS, { ramp: "soft" }), 0, 1.5));
    const roof = mesh(new THREE.ConeGeometry(3.4, 1.8, 4), mat(p.prop), 0, 3.9);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    g.add(mesh(new THREE.BoxGeometry(0.9, 1.7, 0.14), mat(DARK_WOOD), 0, 0.85, 1.82));
    const window = mat("#8fc4d8", { glow: 0.25, ramp: "soft" });
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.12), window, -1.4, 1.9, 1.82));
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.12), window, 1.4, 1.9, 1.82));
    return g;
  },

  flag: (p) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.0, 6), mat("#6b6862"), 0, 2.5));
    const cloth = mesh(new THREE.PlaneGeometry(1.6, 1.0, 4, 2), mat(p.accent, { ramp: "soft", wind: true, windHeight: 1 }), 0.8, 4.2);
    (cloth.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    cloth.name = "cloth";
    g.add(cloth);
    return g;
  },

  campfire: () => {
    const g = new THREE.Group();
    const stone = mat("#8b8880", { ramp: "stone" });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const s = mesh(new THREE.IcosahedronGeometry(0.3, 0), stone, Math.cos(a) * 1.1, 0.18, Math.sin(a) * 1.1);
      s.rotation.set(a, a * 0.5, 0);
      g.add(s);
    }
    for (let i = 0; i < 4; i++) {
      const log = mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 5), mat(DARK_WOOD), 0, 0.35);
      log.rotation.set(Math.PI / 2 - 0.5, (i / 4) * Math.PI * 2, 0);
      g.add(log);
    }
    const flame = mesh(new THREE.ConeGeometry(0.45, 1.2, 5), mat("#ff9a3c", { glow: 1.8, ramp: "soft" }), 0, 0.9);
    flame.castShadow = false;
    flame.name = "flame";
    g.add(flame);
    return g;
  },

  clock: (p) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.9, 4.6, 0.9), mat(p.accent), 0, 2.3));
    const face = mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.25, 14), mat(CANVAS, { ramp: "soft" }), 0, 5.0);
    face.rotation.x = Math.PI / 2;
    g.add(face);
    const hands = new THREE.Group();
    hands.name = "hands";
    hands.position.set(0, 5.0, 0.2);
    const hand = mat("#4a4844");
    const hour = mesh(new THREE.BoxGeometry(0.09, 0.5, 0.06), hand, 0, 0.25);
    const minute = mesh(new THREE.BoxGeometry(0.07, 0.75, 0.05), hand, 0, 0.37);
    minute.name = "minute";
    hands.add(hour, minute);
    g.add(hands);
    const roof = mesh(new THREE.ConeGeometry(1.1, 0.8, 4), mat(p.prop), 0, 6.0);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    return g;
  },
};

export function createProp(kind: PropKind, palette: PlacePalette): THREE.Group {
  const group = builders[kind](palette);
  group.name = `prop:${kind}`;
  return group;
}
