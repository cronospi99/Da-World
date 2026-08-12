/**
 * Traffic — the vehicles and the lights they obey.
 *
 * The simulation is the one from the 2D prototype, kept because it is
 * *teachable*: cars drive on the right, stop on red, queue behind each other
 * and brake for pedestrians, so "cross at the crosswalk when the light is red
 * for the cars" is a rule the student can actually observe.
 *
 * The vehicles themselves are Kenney Car Kit models: one merged mesh per
 * vehicle, sharing the kit's single palette material, so a saloon costs one
 * draw call and comes with wheels, mirrors, a grille and glass that no amount
 * of stacked boxes was going to produce. What the models do *not* have is
 * lamps that can be switched, and those are gameplay — a queue at a red light
 * with its hazards on is the whole point — so headlights, brake lights,
 * indicators and beacons are still four small emissive meshes bolted on in the
 * vehicle's own space, each merged so that a swap costs one material change.
 *
 * A car's length is read from its model rather than declared, because the
 * following distance, the stop line and the wrap-around all measure in tiles.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GH, GW, HROADS, INTERSECTIONS, ROAD_OVERRUN, ROAD_W, VROADS, laneOffsets } from './layout';
import { PALETTE, mat } from './palette';
import { kitMaterial, localGeometry, model } from './kits';
import { mulberry32 } from '../core/rng';
import { CURB } from './city';

export type LightColor = 'g' | 'y' | 'r';

const CYCLE = 9;

export function lightPhase(time: number, vi: number, hi: number): number {
  return (time + (vi * 2 + hi) * 1.45) % CYCLE;
}

export function lightState(time: number, vi: number, hi: number, axis: 'h' | 'v'): LightColor {
  const p = lightPhase(time, vi, hi);
  if (axis === 'h') return p < 3.8 ? 'g' : p < 4.5 ? 'y' : 'r';
  return p < 4.5 ? 'r' : p < 8.3 ? 'g' : 'y';
}

type VehicleKind = 'car' | 'large' | 'police' | 'taxi';

interface Vehicle {
  kind: VehicleKind;
  axis: 'h' | 'v';
  /** Centre of the lane, in tiles (not a tile index — roads are ROAD_W wide). */
  lane: number;
  dir: 1 | -1;
  /** Position along the axis, in tiles. */
  pos: number;
  speed: number;
  len: number;
  hi: number;
  vi: number;
  mesh: Group;
  /** Roof beacons (police) — alternate, never both on. */
  beacons: Mesh[];
  /** Amber indicators, blinking only while the vehicle is stopped. */
  indicators: Mesh[];
  /** Brake lights, on whenever the vehicle is held. */
  brakes: Mesh[];
  stopped: boolean;
}

/**
 * Which model plays which part.
 *
 * The car kit has no bus, so the heavy vehicles that used to be one yellow box
 * are a delivery van, a bin lorry, an ambulance and a fire engine — which is
 * both more honest about a city street and better vocabulary for a class.
 */
const MODELS: Record<VehicleKind, string[]> = {
  car: ['sedan', 'sedan-sports', 'suv', 'suv-luxury', 'hatchback-sports', 'van', 'truck'],
  large: ['delivery', 'garbage-truck', 'ambulance', 'firetruck'],
  police: ['police'],
  taxi: ['taxi'],
};

/** Vehicles that run a light bar: the kit models have the bar, not the flash. */
const HAS_BEACONS = new Set(['police', 'ambulance', 'firetruck']);

/**
 * Kit cars are 1.5 units across; a lane here is a shade under two tiles. 0.63
 * puts a saloon at 0.95 tiles wide and 1.6 long — the size the old boxes were,
 * so every following distance in the simulation still means what it meant.
 */
const CAR_SCALE = 0.63;

/** Lamp materials shared by every vehicle: swapped, never re-created. */
const LAMP = {
  amberOn: new MeshBasicMaterial({ color: '#ffb020', toneMapped: false }),
  amberOff: new MeshBasicMaterial({ color: '#6b5320' }),
  redOn: new MeshBasicMaterial({ color: '#ff3b2f', toneMapped: false }),
  redOff: new MeshBasicMaterial({ color: '#6e211c' }),
  blueOn: new MeshBasicMaterial({ color: '#3f7bff', toneMapped: false }),
  blueOff: new MeshBasicMaterial({ color: '#1e2f6b' }),
};

interface VehicleBuild {
  group: Group;
  beacons: Mesh[];
  indicators: Mesh[];
  brakes: Mesh[];
  /** Bumper-to-bumper length in tiles, measured off the model. */
  len: number;
}

/** One merged mesh per lamp bank, so switching them is one material swap. */
function lampMesh(geos: BufferGeometry[], material: Material): Mesh {
  const mesh = new Mesh(mergeGeometries(geos, false)!, material);
  geos.forEach((g) => g.dispose());
  return mesh;
}

/**
 * A vehicle: the kit model, plus the lamps the model does not have.
 *
 * Everything is built in the model's own frame — the kit exports its cars
 * facing +Z — and the group is turned to face down its lane at spawn time.
 */
function buildVehicleMesh(name: string): VehicleBuild {
  const g = new Group();
  const kitModel = model('cars', name);
  // `origin` keeps the model centred on its own axle line and drops the wheels
  // onto y = 0, which is where the road is.
  const geo = localGeometry(kitModel, 'origin');
  geo.scale(CAR_SCALE, CAR_SCALE, CAR_SCALE);
  const body = new Mesh(geo, kitMaterial('cars', { roughness: 0.55, metalness: 0.05 }));
  body.castShadow = true;
  g.add(body);

  const len = kitModel.size.z * CAR_SCALE;
  const halfW = (kitModel.size.x / 2) * CAR_SCALE;
  const nose = kitModel.max.z * CAR_SCALE;
  const tailZ = kitModel.min.z * CAR_SCALE;
  const roofY = (kitModel.max.y - kitModel.min.y) * CAR_SCALE;
  const lampY = roofY * 0.36;

  const lampGeo = () => new BoxGeometry(0.16, 0.1, 0.07);
  const heads: BufferGeometry[] = [];
  const tails: BufferGeometry[] = [];
  const blinkers: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    heads.push(lampGeo().translate(s * halfW * 0.62, lampY, nose - 0.03));
    tails.push(lampGeo().translate(s * halfW * 0.62, lampY, tailZ + 0.03));
    // Indicators sit outboard of the lamps, at both ends.
    blinkers.push(new BoxGeometry(0.08, 0.09, 0.09).translate(s * halfW * 0.93, lampY, nose - 0.12));
    blinkers.push(new BoxGeometry(0.08, 0.09, 0.09).translate(s * halfW * 0.93, lampY, tailZ + 0.12));
  }

  g.add(lampMesh(heads, mat('#fff4d8', { glow: 'head', roughness: 0.2 })));
  const brake = lampMesh(tails, LAMP.redOff);
  g.add(brake);
  const indicator = lampMesh(blinkers, LAMP.amberOff);
  g.add(indicator);

  const beacons: Mesh[] = [];
  if (HAS_BEACONS.has(name)) {
    // A two-lamp bar above the cabin, the halves out of phase with each other.
    for (const [s, hue] of [
      [-1, 'red'],
      [1, 'blue'],
    ] as const) {
      const lamp = new Mesh(
        new BoxGeometry(0.2, 0.1, 0.2),
        hue === 'blue' ? LAMP.blueOff : LAMP.redOff,
      );
      lamp.position.set(s * 0.16, roofY + 0.05, len * 0.05);
      lamp.userData.hue = hue;
      g.add(lamp);
      beacons.push(lamp);
    }
  }
  if (name === 'taxi') {
    const sign = new Mesh(
      new BoxGeometry(0.4, 0.14, 0.18),
      mat('#ffe8ad', { glow: 'sign', roughness: 0.4 }),
    );
    sign.position.set(0, roofY + 0.05, 0);
    g.add(sign);
  }

  return { group: g, beacons, indicators: [indicator], brakes: [brake], len };
}

export class Traffic {
  readonly group = new Group();
  private vehicles: Vehicle[] = [];
  private lamps: { mesh: Mesh; vi: number; hi: number; axis: 'h' | 'v' }[] = [];
  private lampMats: Record<LightColor, MeshBasicMaterial>;

  constructor() {
    const rand = mulberry32(2026);

    const spawn = (
      axis: 'h' | 'v',
      lane: number,
      dir: 1 | -1,
      kind: VehicleKind,
      hi: number,
      vi: number,
      span: number,
    ): void => {
      const pool = MODELS[kind];
      const build = buildVehicleMesh(pool[Math.floor(rand() * pool.length)]);
      this.group.add(build.group);
      this.vehicles.push({
        kind,
        axis,
        lane,
        dir,
        pos: rand() * span,
        speed: (kind === 'large' ? 1.7 : 2.0) + rand() * 1.3,
        len: build.len,
        hi,
        vi,
        mesh: build.group,
        beacons: build.beacons,
        indicators: build.indicators,
        brakes: build.brakes,
        stopped: false,
      });
    };

    HROADS.forEach((r, hi) => {
      for (let k = 0; k < 5; k++) {
        const east = k % 2 === 0;
        const kind: VehicleKind = k === 3 ? 'large' : k === 4 && hi % 2 === 0 ? 'taxi' : 'car';
        spawn('h', r.rows[0] + (east ? laneOffsets[1] : laneOffsets[0]), east ? 1 : -1, kind, hi, -1, GW);
      }
    });

    VROADS.forEach((r, vi) => {
      for (let k = 0; k < 4; k++) {
        const south = k % 2 === 0;
        const kind: VehicleKind =
          vi === 1 && k === 2 ? 'large' : vi === 2 && k === 3 ? 'police' : 'car';
        spawn('v', r.cols[0] + (south ? laneOffsets[0] : laneOffsets[1]), south ? 1 : -1, kind, -1, vi, GH);
      }
    });

    /* ---- traffic lights ---- */
    this.lampMats = {
      r: new MeshBasicMaterial({ color: '#ff4d4d', toneMapped: false }),
      y: new MeshBasicMaterial({ color: '#ffc633', toneMapped: false }),
      g: new MeshBasicMaterial({ color: '#3fdc73', toneMapped: false }),
    };
    const poles: BufferGeometry[] = [];
    const heads: BufferGeometry[] = [];
    const lampGeo = new CylinderGeometry(0.13, 0.13, 0.1, 8);
    lampGeo.rotateZ(Math.PI / 2);

    for (const it of INTERSECTIONS) {
      const specs: { x: number; z: number; axis: 'h' | 'v'; rot: number }[] = [
        { x: it.cx + ROAD_W / 2 + 0.4, z: it.cy - ROAD_W / 2 - 0.4, axis: 'h', rot: 0 },
        { x: it.cx - ROAD_W / 2 - 0.4, z: it.cy + ROAD_W / 2 + 0.4, axis: 'v', rot: Math.PI / 2 },
      ];
      for (const s of specs) {
        const pole = new CylinderGeometry(0.07, 0.07, 2.9, 6);
        pole.translate(s.x, CURB + 1.45, s.z);
        poles.push(pole);
        const head = new BoxGeometry(0.3, 0.78, 0.3);
        head.translate(s.x, CURB + 3.05, s.z);
        heads.push(head);
        const lamp = new Mesh(lampGeo, this.lampMats.g);
        lamp.position.set(s.x + 0.16, CURB + 3.05, s.z);
        lamp.rotation.y = s.rot;
        if (s.rot) lamp.position.set(s.x, CURB + 3.05, s.z + 0.16);
        this.group.add(lamp);
        this.lamps.push({ mesh: lamp, vi: it.vi, hi: it.hi, axis: s.axis });
      }
    }
    const poleMesh = new Mesh(mergeGeometries(poles, false)!, mat(PALETTE.darkMetal));
    poleMesh.castShadow = true;
    this.group.add(poleMesh);
    const headMesh = new Mesh(mergeGeometries(heads, false)!, new MeshLambertMaterial({ color: '#2b2f38' }));
    headMesh.castShadow = true;
    this.group.add(headMesh);
  }

  /** Distance to the next red/amber stop line ahead, in tiles. */
  private stopLineDist(v: Vehicle, time: number): number {
    let best = Infinity;
    if (v.axis === 'h') {
      for (let vi = 0; vi < VROADS.length; vi++) {
        const c = VROADS[vi].cols;
        const line = v.dir > 0 ? c[0] - 0.55 : c[0] + ROAD_W + 0.55;
        const d = (line - v.pos) * v.dir;
        if (d > -0.15 && d < best && lightState(time, vi, v.hi, 'h') !== 'g') best = d;
      }
    } else {
      for (let hi = 0; hi < HROADS.length; hi++) {
        const rows = HROADS[hi].rows;
        const line = v.dir > 0 ? rows[0] - 0.55 : rows[0] + ROAD_W + 0.55;
        const d = (line - v.pos) * v.dir;
        if (d > -0.15 && d < best && lightState(time, v.vi, hi, 'v') !== 'g') best = d;
      }
    }
    return best;
  }

  update(dt: number, time: number, playerX: number, playerZ: number): void {
    // One phase for the whole city, so a row of waiting cars blinks together —
    // which is exactly what a real queue at a red light looks like.
    const blinkOn = time % 0.9 < 0.45;
    const beaconOn = time % 0.6 < 0.3;

    for (const v of this.vehicles) {
      let stop = this.stopLineDist(v, time) < 0.75;

      if (!stop) {
        for (const o of this.vehicles) {
          if (o === v || o.axis !== v.axis || o.lane !== v.lane || o.dir !== v.dir) continue;
          const gap = (o.pos - v.pos) * v.dir;
          if (gap > 0 && gap < (v.len + o.len) / 2 + 0.4) {
            stop = true;
            break;
          }
        }
      }
      if (!stop) {
        // Brake for a pedestrian standing in the lane.
        const perp = v.axis === 'h' ? playerZ : playerX;
        const along = v.axis === 'h' ? playerX : playerZ;
        const ahead = (along - v.pos) * v.dir;
        if (Math.abs(perp - v.lane) < 0.7 && ahead > 0 && ahead < 1.8) stop = true;
      }
      if (!stop) {
        v.pos += v.speed * v.dir * dt;
        // Wrap out where the carriageway does, so traffic arrives from the
        // haze rather than popping into existence on the grass.
        const span = (v.axis === 'h' ? GW : GH) + ROAD_OVERRUN;
        if (v.pos > span) v.pos = -ROAD_OVERRUN;
        if (v.pos < -ROAD_OVERRUN) v.pos = span;
      }

      if (v.stopped !== stop) {
        v.stopped = stop;
        for (const b of v.brakes) b.material = stop ? LAMP.redOn : LAMP.redOff;
      }
      // Hazards while held, dark while rolling: one material swap per change,
      // not per frame.
      const wantAmber = stop && blinkOn;
      for (const ind of v.indicators) {
        const next = wantAmber ? LAMP.amberOn : LAMP.amberOff;
        if (ind.material !== next) ind.material = next;
      }
      for (const lamp of v.beacons) {
        const blue = lamp.userData.hue === 'blue';
        const on = blue ? !beaconOn : beaconOn;
        const next = blue ? (on ? LAMP.blueOn : LAMP.blueOff) : on ? LAMP.redOn : LAMP.redOff;
        if (lamp.material !== next) lamp.material = next;
      }

      // The kit exports its cars nose-first along +Z, so a vehicle heading east
      // is turned a quarter turn and one heading south is left alone.
      if (v.axis === 'h') {
        v.mesh.position.set(v.pos, 0, v.lane);
        v.mesh.rotation.y = v.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        v.mesh.position.set(v.lane, 0, v.pos);
        v.mesh.rotation.y = v.dir > 0 ? 0 : Math.PI;
      }
    }

    for (const l of this.lamps) {
      l.mesh.material = this.lampMats[lightState(time, l.vi, l.hi, l.axis)];
    }
  }
}
