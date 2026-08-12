/**
 * Low-poly character rig — shared by the player and by all citizens.
 *
 * Still no skeleton and no animation files, but a good deal more of a person
 * than the six boxes it started as: shoes, hips, a collar, a neck, hands, a
 * painted face and a wardrobe of accessories (cap, sun hat, helmet, apron,
 * backpack, glasses). Every geometry is created once at module load and shared
 * by all thirty-odd citizens, and every colour goes through the material cache,
 * so the whole crowd still costs a handful of materials.
 *
 * The walk cycle drives hips, shoulders, torso bob, a forward lean when
 * running and a small counter-rotation of the chest, which is most of what
 * makes a walk read as a walk rather than as a slide.
 */

import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat } from './palette';
import type { Outfit } from './npcData';

export interface CharacterColors {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  outfit?: Outfit;
}

const geo = {
  torso: new RoundedBoxGeometry(0.52, 0.5, 0.34, 1, 0.1),
  collar: new RoundedBoxGeometry(0.55, 0.09, 0.37, 1, 0.04),
  hips: new RoundedBoxGeometry(0.44, 0.16, 0.3, 1, 0.06),
  neck: new RoundedBoxGeometry(0.17, 0.11, 0.17, 1, 0.04),
  head: new RoundedBoxGeometry(0.4, 0.38, 0.36, 1, 0.12),
  hair: new RoundedBoxGeometry(0.44, 0.17, 0.4, 1, 0.08),
  hairBack: new RoundedBoxGeometry(0.42, 0.3, 0.16, 1, 0.07),
  ear: new RoundedBoxGeometry(0.06, 0.11, 0.09, 1, 0.03),
  leg: new RoundedBoxGeometry(0.16, 0.4, 0.17, 1, 0.06),
  shoe: new RoundedBoxGeometry(0.19, 0.11, 0.27, 1, 0.045),
  arm: new RoundedBoxGeometry(0.14, 0.38, 0.15, 1, 0.05),
  hand: new RoundedBoxGeometry(0.15, 0.13, 0.17, 1, 0.055),
  peak: new RoundedBoxGeometry(0.34, 0.05, 0.22, 1, 0.02),
  brim: new RoundedBoxGeometry(0.66, 0.06, 0.62, 1, 0.03),
  crown: new RoundedBoxGeometry(0.36, 0.2, 0.34, 1, 0.08),
  helmet: new RoundedBoxGeometry(0.45, 0.26, 0.43, 1, 0.15),
  pack: new RoundedBoxGeometry(0.36, 0.42, 0.18, 1, 0.07),
  strap: new RoundedBoxGeometry(0.07, 0.34, 0.05, 1, 0.02),
  apron: new RoundedBoxGeometry(0.42, 0.46, 0.06, 1, 0.04),
  glasses: new RoundedBoxGeometry(0.38, 0.08, 0.05, 1, 0.02),
  face: new PlaneGeometry(0.34, 0.3),
};

/**
 * One face for the whole city, drawn once. Eyes with a highlight and a small
 * smile is all it takes: at the game's camera distance a mouth that curves is
 * the difference between a citizen and a mannequin.
 */
let faceMaterial: MeshBasicMaterial | null = null;
function face(): MeshBasicMaterial {
  if (faceMaterial) return faceMaterial;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 112;
  const c = cv.getContext('2d')!;

  const eye = (x: number) => {
    c.fillStyle = '#241a2e';
    c.beginPath();
    c.ellipse(x, 44, 9, 11, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(x + 3, 39, 3.2, 0, Math.PI * 2);
    c.fill();
  };
  eye(44);
  eye(84);

  // Brows, a smile and a hint of blush.
  c.strokeStyle = 'rgba(36,26,46,.75)';
  c.lineWidth = 5;
  c.lineCap = 'round';
  for (const x of [44, 84]) {
    c.beginPath();
    c.moveTo(x - 10, 27);
    c.lineTo(x + 10, 25);
    c.stroke();
  }
  c.strokeStyle = '#3a2334';
  c.lineWidth = 5.5;
  c.beginPath();
  c.arc(64, 62, 15, 0.28 * Math.PI, 0.72 * Math.PI);
  c.stroke();
  c.fillStyle = 'rgba(226,120,120,.32)';
  for (const x of [28, 100]) {
    c.beginPath();
    c.ellipse(x, 58, 10, 6, 0, 0, Math.PI * 2);
    c.fill();
  }

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  faceMaterial = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return faceMaterial;
}

export class Character {
  readonly group = new Group();
  private legL = new Group();
  private legR = new Group();
  private armL = new Group();
  private armR = new Group();
  private upper = new Group();
  private chest = new Group();
  private head = new Group();
  private phase = 0;

  constructor(colors: CharacterColors, scale = 1) {
    const shirt = mat(colors.shirt);
    const pants = mat(colors.pants);
    const skin = mat(colors.skin);
    const hair = mat(colors.hair);
    const shoe = mat('#33303a');

    /* ---- legs, hinged at the hip ---- */
    for (const [limb, side] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as const) {
      const thigh = new Mesh(geo.leg, pants);
      thigh.position.y = -0.2;
      const foot = new Mesh(geo.shoe, shoe);
      foot.position.set(0, -0.42, 0.045);
      limb.add(thigh, foot);
      limb.position.set(side * 0.13, 0.46, 0);
      this.group.add(limb);
    }

    /* ---- torso ---- */
    const hips = new Mesh(geo.hips, pants);
    hips.position.y = 0.52;
    const torso = new Mesh(geo.torso, shirt);
    torso.position.y = 0.83;
    const collar = new Mesh(geo.collar, shirt);
    collar.position.y = 1.06;
    const neck = new Mesh(geo.neck, skin);
    neck.position.y = 1.13;
    this.chest.add(torso, collar, neck);

    /* ---- arms, hinged at the shoulder ---- */
    for (const [limb, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      const upperArm = new Mesh(geo.arm, shirt);
      upperArm.position.y = -0.19;
      const hand = new Mesh(geo.hand, skin);
      hand.position.y = -0.43;
      limb.add(upperArm, hand);
      limb.position.set(side * 0.33, 1.0, 0);
      this.chest.add(limb);
    }

    /* ---- head ---- */
    const skull = new Mesh(geo.head, skin);
    const cap = new Mesh(geo.hair, hair);
    cap.position.y = 0.16;
    const back = new Mesh(geo.hairBack, hair);
    back.position.set(0, 0.02, -0.13);
    const faceMesh = new Mesh(geo.face, face());
    faceMesh.position.set(0, 0.0, 0.187);
    this.head.add(skull, cap, back, faceMesh);
    for (const s of [-1, 1]) {
      const ear = new Mesh(geo.ear, skin);
      ear.position.set(s * 0.205, -0.01, 0);
      this.head.add(ear);
    }
    this.head.position.y = 1.36;
    this.chest.add(this.head);

    this.addOutfit(colors, shirt);

    this.upper.add(hips, this.chest);
    this.group.add(this.upper);

    this.group.traverse((o) => {
      if (o instanceof Mesh && o.material !== faceMaterial) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.scale.setScalar(scale);
  }

  /** The one accessory that says at a glance who this citizen is. */
  private addOutfit(colors: CharacterColors, shirt: ReturnType<typeof mat>): void {
    switch (colors.outfit) {
      case 'cap': {
        const crown = new Mesh(geo.crown, shirt);
        crown.position.y = 0.21;
        const peak = new Mesh(geo.peak, shirt);
        peak.position.set(0, 0.15, 0.2);
        this.head.add(crown, peak);
        break;
      }
      case 'hat': {
        const crown = new Mesh(geo.crown, mat('#d8c191'));
        crown.position.y = 0.23;
        const brim = new Mesh(geo.brim, mat('#c9ad78'));
        brim.position.y = 0.15;
        this.head.add(crown, brim);
        break;
      }
      case 'helmet': {
        const shell = new Mesh(geo.helmet, mat('#f0f0f0'));
        shell.position.y = 0.16;
        this.head.add(shell);
        break;
      }
      case 'glasses': {
        const frames = new Mesh(geo.glasses, mat('#2b2b38'));
        frames.position.set(0, 0.0, 0.18);
        this.head.add(frames);
        break;
      }
      case 'backpack': {
        const pack = new Mesh(geo.pack, mat('#3f4a6b'));
        pack.position.set(0, 0.84, -0.26);
        this.chest.add(pack);
        for (const s of [-1, 1]) {
          const strap = new Mesh(geo.strap, mat('#2c3550'));
          strap.position.set(s * 0.17, 0.86, 0.16);
          this.chest.add(strap);
        }
        break;
      }
      case 'apron': {
        const apron = new Mesh(geo.apron, mat('#f4f1e6'));
        apron.position.set(0, 0.78, 0.19);
        this.chest.add(apron);
        break;
      }
      default:
        break;
    }
  }

  /** `speed01` is 0 when idle and 1 at full walking speed. */
  update(dt: number, speed01: number): void {
    this.phase += dt * (4 + speed01 * 7);
    const swing = Math.sin(this.phase) * (0.15 + speed01 * 0.8);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.9;
    this.armR.rotation.x = swing * 0.9;
    // Arms swing out a little as they come forward, which reads as effort.
    this.armL.rotation.z = -0.06 - Math.abs(swing) * 0.12;
    this.armR.rotation.z = 0.06 + Math.abs(swing) * 0.12;

    // Idle characters breathe; walking characters bounce, lean into the walk
    // and counter-rotate their shoulders against their hips.
    this.upper.position.y = Math.abs(Math.sin(this.phase)) * (0.015 + speed01 * 0.05);
    this.chest.rotation.y = -swing * 0.16;
    this.chest.rotation.x = speed01 * 0.14;
    this.head.rotation.x = -speed01 * 0.1 + Math.sin(this.phase * 2) * 0.02;
    this.group.position.y = Math.abs(Math.sin(this.phase)) * speed01 * 0.045;
  }

  /** Turn smoothly towards a heading in radians. */
  faceTowards(angle: number, dt: number): void {
    let diff = angle - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 12);
  }
}
