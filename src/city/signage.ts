/**
 * Signage — every piece of graphic design in the city, drawn into a canvas.
 *
 * The city has three kinds of lettering and they are deliberately different so
 * a student can tell at a glance what they are reading:
 *
 *   • shop signs      — a lit fascia over the shopfront: the *name* of a place
 *   • street blades   — enamel plates on the corner posts: the *name of a road*
 *   • pavement decals — road paint on the kerb: the same road name again, but
 *                       readable from the top-down camera without turning it
 *
 * That last one is the one that matters for the language: "go straight on Oak
 * Street" is only followable if the student can see, from above, which street
 * they are standing on.
 */

import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

function ctx2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext('2d')!];
}

function finish(cv: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Shrink a font until the text fits the given width. */
function fitFont(
  c: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  weight = 900,
  min = 16,
): number {
  let size = start;
  c.font = `${weight} ${size}px Nunito, Arial, sans-serif`;
  while (c.measureText(text).width > maxWidth && size > min) {
    size -= 2;
    c.font = `${weight} ${size}px Nunito, Arial, sans-serif`;
  }
  return size;
}

/* ------------------------------------------------------------------ *
 * Shop fascia                                                         *
 * ------------------------------------------------------------------ */

/**
 * The lit sign over a shopfront: a dark plate, a gold rule, a coloured badge
 * carrying the emoji, and the name in the same heavy face the HUD uses. The
 * badge takes the shop's own colour, so the sign and the building it belongs
 * to always read as one object.
 */
export function shopSignTexture(name: string, emoji: string, accent: string): CanvasTexture {
  // Drawn in a comfortable 768×176 coordinate space but rasterised at two
  // thirds of that. There is one of these per shop and the city has ninety of
  // them: at full size the canvases alone would cost fifty megabytes, and at
  // the size a fascia occupies on screen nobody can tell.
  const W = 768;
  const H = 176;
  const SCALE = 2 / 3;
  const [cv, c] = ctx2d(Math.round(W * SCALE), Math.round(H * SCALE));
  c.scale(SCALE, SCALE);

  const plate = c.createLinearGradient(0, 0, 0, H);
  plate.addColorStop(0, '#332a55');
  plate.addColorStop(0.55, '#241a44');
  plate.addColorStop(1, '#181031');
  c.fillStyle = plate;
  roundRect(c, 6, 6, W - 12, H - 12, 26);
  c.fill();

  // Gold rule inside the edge, then a hairline highlight along the top: the
  // two together are what make a flat rectangle look like a lit box.
  c.strokeStyle = '#ffd447';
  c.lineWidth = 7;
  roundRect(c, 12, 12, W - 24, H - 24, 21);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.22)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(36, 22);
  c.lineTo(W - 36, 22);
  c.stroke();

  // Emoji badge.
  const bx = 96;
  const by = H / 2;
  c.fillStyle = accent;
  c.beginPath();
  c.arc(bx, by, 54, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,.75)';
  c.lineWidth = 5;
  c.stroke();
  c.font = '58px serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(emoji, bx, by + 4);

  // Name.
  c.textAlign = 'center';
  const size = fitFont(c, name, W - 230, 62);
  c.fillStyle = 'rgba(0,0,0,.45)';
  c.fillText(name, (W + 150) / 2, by + 6);
  c.fillStyle = '#fff8e6';
  c.font = `900 ${size}px Nunito, Arial, sans-serif`;
  c.fillText(name, (W + 150) / 2, by + 2);

  return finish(cv);
}

/* ------------------------------------------------------------------ *
 * Street blades                                                       *
 * ------------------------------------------------------------------ */

/**
 * The enamel plate bolted to a corner post. Avenues get a blue plate and
 * streets a green one — a real convention, and a free extra cue for the
 * "turn left onto Victory Avenue" quests.
 */
export function streetBladeTexture(name: string, avenue: boolean): CanvasTexture {
  const W = 640;
  const H = 132;
  const [cv, c] = ctx2d(W, H);
  const base = avenue ? '#1c4f8a' : '#1d6b48';
  const lift = avenue ? '#2a6fb8' : '#288f60';

  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, lift);
  g.addColorStop(1, base);
  c.fillStyle = g;
  roundRect(c, 4, 4, W - 8, H - 8, 16);
  c.fill();

  c.strokeStyle = '#ffffff';
  c.lineWidth = 5;
  roundRect(c, 16, 14, W - 32, H - 28, 10);
  c.stroke();

  const upper = name.toUpperCase();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const size = fitFont(c, upper, W - 76, 62, 900, 22);
  c.fillStyle = 'rgba(0,0,0,.35)';
  c.fillText(upper, W / 2, H / 2 + 5);
  c.fillStyle = '#ffffff';
  c.font = `900 ${size}px Nunito, Arial, sans-serif`;
  c.fillText(upper, W / 2, H / 2 + 1);

  return finish(cv);
}

/* ------------------------------------------------------------------ *
 * Pavement lettering                                                  *
 * ------------------------------------------------------------------ */

/**
 * The street name painted along the kerb, road-marking style: a soft white
 * paint with a warm halo so it survives both the midday sun and the sodium
 * glow at night. Transparent everywhere else, so it lies on the paving
 * texture instead of covering it.
 */
export function pavementNameTexture(name: string): CanvasTexture {
  const W = 1024;
  const H = 160;
  const [cv, c] = ctx2d(W, H);
  const upper = name.toUpperCase();

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const size = fitFont(c, upper, W - 130, 108, 900, 30);
  c.font = `900 ${size}px Nunito, Arial, sans-serif`;

  // Halo first, letters on top: painted markings on a real pavement always
  // have a dirty edge, and it stops the text shimmering when the camera moves.
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(52,44,30,.38)';
  c.lineWidth = 14;
  c.strokeText(upper, W / 2, H / 2);
  c.fillStyle = 'rgba(255,252,240,.93)';
  c.fillText(upper, W / 2, H / 2);

  // Two chevrons, one at each end, pointing along the street.
  c.strokeStyle = 'rgba(255,252,240,.75)';
  c.lineWidth = 11;
  c.lineCap = 'round';
  for (const [x, dir] of [
    [56, 1],
    [W - 56, -1],
  ] as const) {
    c.beginPath();
    c.moveTo(x - 20 * dir, H / 2 - 30);
    c.lineTo(x + 18 * dir, H / 2);
    c.lineTo(x - 20 * dir, H / 2 + 30);
    c.stroke();
  }

  return finish(cv);
}

/* ------------------------------------------------------------------ *
 * Zone marker                                                         *
 * ------------------------------------------------------------------ */

/** The park entrance sign: a carved timber board on two posts. */
export function zoneSignTexture(name: string, emoji: string): CanvasTexture {
  const W = 768;
  const H = 208;
  const [cv, c] = ctx2d(W, H);

  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#8a6136');
  g.addColorStop(1, '#6b4826');
  c.fillStyle = g;
  roundRect(c, 8, 8, W - 16, H - 16, 22);
  c.fill();
  c.strokeStyle = '#f3e3bf';
  c.lineWidth = 8;
  roundRect(c, 22, 22, W - 44, H - 44, 14);
  c.stroke();

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '70px serif';
  c.fillText(emoji, 92, H / 2 + 2);

  const size = fitFont(c, name, W - 220, 66);
  c.fillStyle = 'rgba(0,0,0,.4)';
  c.fillText(name, (W + 140) / 2, H / 2 + 6);
  c.fillStyle = '#fdf3dc';
  c.font = `900 ${size}px Nunito, Arial, sans-serif`;
  c.fillText(name, (W + 140) / 2, H / 2 + 2);

  return finish(cv);
}

/* ------------------------------------------------------------------ *
 * Floating name plate                                                 *
 * ------------------------------------------------------------------ */

/** The label that floats over the nearest places. */
export function labelTexture(text: string): CanvasTexture {
  const W = 640;
  const H = 176;
  const [cv, c] = ctx2d(W, H);
  roundRect(c, 10, 10, W - 20, 116, 30);
  c.fillStyle = 'rgba(26,16,63,.9)';
  c.fill();
  c.strokeStyle = '#ffd447';
  c.lineWidth = 6;
  c.stroke();

  // A little tail, so the plate reads as a pin planted on the roof.
  c.beginPath();
  c.moveTo(W / 2 - 16, 124);
  c.lineTo(W / 2 + 16, 124);
  c.lineTo(W / 2, 156);
  c.closePath();
  c.fillStyle = 'rgba(26,16,63,.9)';
  c.fill();

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const size = fitFont(c, text, W - 60, 54);
  c.fillStyle = '#ffffff';
  c.font = `900 ${size}px Nunito, Arial, sans-serif`;
  c.fillText(text, W / 2, 68);
  return finish(cv);
}
