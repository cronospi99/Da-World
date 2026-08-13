import qrcode from "qrcode-generator";

/**
 * The code on the board.
 *
 * A room of students joining by scanning is the whole point of QR mode, and a
 * QR code that will not scan from the back row is worse than no QR code at
 * all. So this draws it as flat black squares on a canvas at whole-pixel
 * boundaries rather than scaling an image up: a blurred module is a module a
 * phone camera has to guess at, and the guess is what makes a scan take twenty
 * seconds instead of one.
 *
 * Error correction is M — the middle setting — which tolerates a fingerprint
 * on the screen or a projector's hot spot without making the code so dense it
 * needs the phone held closer.
 */

interface QrOptions {
  /** Pixels per module. The code sizes itself from this. */
  cell?: number;
  /** Quiet zone in modules. Four is the spec's minimum, and it matters. */
  margin?: number;
  dark?: string;
  light?: string;
}

export function qrCanvas(text: string, options: QrOptions = {}): HTMLCanvasElement {
  const { cell = 8, margin = 4, dark = "#1d1a16", light = "#ffffff" } = options;

  // Type number 0 lets the library pick the smallest version the text fits in.
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();

  const modules = code.getModuleCount();
  const size = (modules + margin * 2) * cell;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser will not draw a QR code.");
  context.scale(ratio, ratio);
  context.fillStyle = light;
  context.fillRect(0, 0, size, size);
  context.fillStyle = dark;
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (code.isDark(row, col)) {
        context.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
      }
    }
  }
  return canvas;
}

/** The same code as a PNG, for a teacher who wants to paste it into slides. */
export function qrDataUrl(text: string, options: QrOptions = {}): string {
  return qrCanvas(text, options).toDataURL("image/png");
}
