/**
 * The day/night cycle.
 *
 * One clock drives everything: the sun's position and colour, the gradient in
 * the sky dome, the fog, the exposure, the stars and — through
 * `setNightGlow` — every window, street lamp, shop sign and headlight in the
 * city. Nothing anywhere else needs to know what time it is; it asks for a
 * `SkySample` and applies it.
 *
 * The keyframes below are a painter's day rather than a physical one: dawn is
 * pink, noon is bright and slightly cool, the golden hour is warm and long,
 * and night is blue rather than black so a twelve-year-old can still read a
 * street sign at 2 a.m.
 */

import { Color } from 'three';

export interface SkySample {
  /** Colour at the top of the dome and at the horizon. */
  top: Color;
  bottom: Color;
  fog: Color;
  fogNear: number;
  fogFar: number;
  sun: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  ambient: number;
  exposure: number;
  envIntensity: number;
  /** 0 = broad daylight, 1 = deep night. Drives every light in the city. */
  night: number;
  /** Direction *towards* the key light, normalised-ish. */
  dirX: number;
  dirY: number;
  dirZ: number;
}

interface Key {
  /** Hour of the day this keyframe describes. */
  t: number;
  top: string;
  bottom: string;
  fog: string;
  sun: string;
  sunI: number;
  hemi: number;
  amb: number;
  exposure: number;
  env: number;
  night: number;
  fogNear: number;
  fogFar: number;
}

/* Hours run 0 → 24; the table wraps, so 23:30 blends into 00:00. */
const KEYS: Key[] = [
  { t: 0, top: '#0b1030', bottom: '#1d2b52', fog: '#1b2749', sun: '#8fa8e0', sunI: 0.22, hemi: 0.3, amb: 0.16, exposure: 1.18, env: 0.16, night: 1, fogNear: 16, fogFar: 88 },
  { t: 4.5, top: '#16224c', bottom: '#3d3a63', fog: '#3a3960', sun: '#b18fd0', sunI: 0.3, hemi: 0.34, amb: 0.15, exposure: 1.16, env: 0.2, night: 0.92, fogNear: 16, fogFar: 92 },
  { t: 6, top: '#4c6ca8', bottom: '#e8a184', fog: '#d59f8f', sun: '#ff9d5c', sunI: 1.1, hemi: 0.4, amb: 0.1, exposure: 1.02, env: 0.34, night: 0.5, fogNear: 18, fogFar: 100 },
  { t: 7.5, top: '#6ea3dc', bottom: '#f0cbb0', fog: '#e4d3c8', sun: '#ffd0a0', sunI: 1.7, hemi: 0.32, amb: 0.06, exposure: 0.96, env: 0.44, night: 0.12, fogNear: 22, fogFar: 108 },
  { t: 12, top: '#7fb6e6', bottom: '#cfe2ef', fog: '#dbe9f3', sun: '#fff2dc', sunI: 2.05, hemi: 0.28, amb: 0.04, exposure: 0.92, env: 0.5, night: 0, fogNear: 26, fogFar: 118 },
  { t: 16.5, top: '#78ade0', bottom: '#e0dcc8', fog: '#e2ddcc', sun: '#ffe2b4', sunI: 1.85, hemi: 0.3, amb: 0.05, exposure: 0.94, env: 0.48, night: 0, fogNear: 24, fogFar: 112 },
  { t: 18.5, top: '#4f7cc0', bottom: '#f3a771', fog: '#e0a583', sun: '#ff9450', sunI: 1.35, hemi: 0.36, amb: 0.08, exposure: 1.0, env: 0.38, night: 0.3, fogNear: 20, fogFar: 100 },
  { t: 20, top: '#25335f', bottom: '#a05f7a', fog: '#8b6079', sun: '#e07a86', sunI: 0.55, hemi: 0.36, amb: 0.13, exposure: 1.1, env: 0.24, night: 0.8, fogNear: 18, fogFar: 92 },
  { t: 21.5, top: '#0e1538', bottom: '#233156', fog: '#202c4f', sun: '#8fa8e0', sunI: 0.24, hemi: 0.3, amb: 0.16, exposure: 1.18, env: 0.16, night: 1, fogNear: 16, fogFar: 88 },
  { t: 24, top: '#0b1030', bottom: '#1d2b52', fog: '#1b2749', sun: '#8fa8e0', sunI: 0.22, hemi: 0.3, amb: 0.16, exposure: 1.18, env: 0.16, night: 1, fogNear: 16, fogFar: 88 },
];

const HEMI_SKY_DAY = new Color('#dff0ff');
const HEMI_SKY_NIGHT = new Color('#4a6ba8');
const HEMI_GROUND_DAY = new Color('#86a06a');
const HEMI_GROUND_NIGHT = new Color('#2a3348');

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Phases, purely for the on-screen clock. */
const PHASES: { from: number; emoji: string; name: string }[] = [
  { from: 0, emoji: '🌙', name: 'Night' },
  { from: 5, emoji: '🌅', name: 'Dawn' },
  { from: 8, emoji: '🌞', name: 'Morning' },
  { from: 12, emoji: '☀️', name: 'Midday' },
  { from: 15, emoji: '🌤️', name: 'Afternoon' },
  { from: 18, emoji: '🌇', name: 'Sunset' },
  { from: 20, emoji: '🌆', name: 'Evening' },
  { from: 22, emoji: '🌙', name: 'Night' },
];

/** Real seconds for one full in-game day at speed 1. */
export const DAY_SECONDS = 420;

export type CycleSpeed = 'off' | 'slow' | 'normal' | 'fast';

const SPEEDS: Record<CycleSpeed, number> = { off: 0, slow: 0.45, normal: 1, fast: 3 };

export class DayNight {
  /** Hour of the day, 0 → 24. */
  hours: number;
  speed: CycleSpeed = 'normal';

  private sample: SkySample = {
    top: new Color(),
    bottom: new Color(),
    fog: new Color(),
    fogNear: 24,
    fogFar: 110,
    sun: new Color(),
    sunIntensity: 2,
    hemiSky: new Color(),
    hemiGround: new Color(),
    hemiIntensity: 0.3,
    ambient: 0.04,
    exposure: 0.92,
    envIntensity: 0.5,
    night: 0,
    dirX: 0,
    dirY: 1,
    dirZ: 0,
  };
  private ca = new Color();
  private cb = new Color();

  constructor(startHour = 8.5) {
    this.hours = startHour;
  }

  setSpeed(speed: CycleSpeed): void {
    this.speed = speed;
  }

  /** Jump straight to an hour (used by the settings panel and by saves). */
  setHours(h: number): void {
    this.hours = ((h % 24) + 24) % 24;
  }

  advance(dt: number): void {
    const mult = SPEEDS[this.speed];
    if (mult === 0) return;
    this.hours = (this.hours + (dt * 24 * mult) / DAY_SECONDS) % 24;
  }

  /** "07:45", ready for the HUD clock. */
  clockText(): string {
    const h = Math.floor(this.hours) % 24;
    const m = Math.floor((this.hours - Math.floor(this.hours)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  phase(): { emoji: string; name: string } {
    let out = PHASES[0];
    for (const p of PHASES) if (this.hours >= p.from) out = p;
    return out;
  }

  /**
   * The lighting environment for the current hour.
   *
   * The returned object is reused every frame — callers read it immediately
   * and never hold on to it, which keeps the frame loop allocation-free.
   */
  current(): SkySample {
    const h = this.hours;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = b.t === a.t ? 0 : (h - a.t) / (b.t - a.t);
    const s = this.sample;

    s.top.set(a.top).lerp(this.ca.set(b.top), t);
    s.bottom.set(a.bottom).lerp(this.ca.set(b.bottom), t);
    s.fog.set(a.fog).lerp(this.ca.set(b.fog), t);
    s.sun.set(a.sun).lerp(this.ca.set(b.sun), t);
    s.sunIntensity = lerp(a.sunI, b.sunI, t);
    s.hemiIntensity = lerp(a.hemi, b.hemi, t);
    s.ambient = lerp(a.amb, b.amb, t);
    s.exposure = lerp(a.exposure, b.exposure, t);
    s.envIntensity = lerp(a.env, b.env, t);
    s.fogNear = lerp(a.fogNear, b.fogNear, t);
    s.fogFar = lerp(a.fogFar, b.fogFar, t);
    s.night = lerp(a.night, b.night, t);

    s.hemiSky.copy(HEMI_SKY_DAY).lerp(this.cb.copy(HEMI_SKY_NIGHT), s.night);
    s.hemiGround.copy(HEMI_GROUND_DAY).lerp(this.cb.copy(HEMI_GROUND_NIGHT), s.night);

    // The sun rises in the east (+x) at 06:00 and sets in the west at 18:00.
    // After dark the same light becomes the moon: it keeps arcing overhead so
    // the city still casts long, soft shadows instead of going flat.
    const dayAngle = ((h - 6) / 12) * Math.PI;
    const moon = h < 6 || h > 18;
    const angle = moon ? ((((h + 12) % 24) - 6) / 12) * Math.PI : dayAngle;
    const elevation = Math.sin(angle);
    s.dirX = Math.cos(angle) * 0.85;
    s.dirY = Math.max(0.22, elevation) * 1.15;
    s.dirZ = 0.42 - elevation * 0.25;
    return s;
  }
}
