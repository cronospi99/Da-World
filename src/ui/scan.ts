import { closeButton, el } from "./dom";

/**
 * Pointing a phone at the board.
 *
 * A student can always join by reading the five letters off the projector and
 * typing them, and that path is never taken away — it needs no camera, no
 * permission and no particular browser. But typing is where a class loses five
 * minutes to `0` against `O`, so when the browser can do the scanning itself
 * this puts the camera inside the game: tap Scan, point at the board, and the
 * code fills itself in.
 *
 * It uses the platform's own `BarcodeDetector`, which is why it is thirty
 * lines rather than a computer-vision library — and also why it is not
 * everywhere. Chrome and Edge on Android and desktop have it; Firefox and
 * Safari, at the time of writing, do not. Where it is missing the button says
 * so and points at the two things that always work: the phone's own camera
 * app, which scans QR codes from the lock screen, and the code itself.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

const detectorClass = (): BarcodeDetectorConstructor | null =>
  (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null;

/** Whether this browser can scan a code itself. */
export function canScan(): boolean {
  return detectorClass() !== null && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/**
 * A code out of whatever was scanned.
 *
 * The QR on a teacher's screen holds a full join link, but a code typed into a
 * generator, or read off another copy of the game, is just five characters —
 * and either should work. Note that the link is only ever mined for its code:
 * scanning never navigates anywhere, so a code that arrives from somewhere
 * unexpected can do nothing more than fail to be a room.
 */
export function codeFrom(text: string): string | null {
  const link = /[#?&]join=([A-Za-z0-9]{4,8})\b/.exec(text);
  if (link) return link[1].toUpperCase();
  const bare = /^\s*([A-Za-z0-9]{4,8})\s*$/.exec(text);
  return bare ? bare[1].toUpperCase() : null;
}

/** How often frames are handed to the detector. Faster is wasted work. */
const SCAN_INTERVAL_MS = 120;

export class QrScanner {
  private readonly root: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly status: HTMLElement;
  private readonly canvas = document.createElement("canvas");
  private stream: MediaStream | null = null;
  private timer = 0;
  private running = false;
  private onFound: ((code: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.video = el("video", {
      class: "scan-video",
      playsinline: "true",
      muted: "true",
    }) as HTMLVideoElement;
    this.video.muted = true;
    this.video.playsInline = true;

    this.status = el("p", { class: "scan-status", text: "Point at the code on the board." });

    this.root = el("div", { class: "overlay scan-overlay", "aria-hidden": "true" }, [
      el("div", { class: "overlay-scrim" }),
      el("div", { class: "scan-frame" }, [
        this.video,
        el("div", { class: "scan-reticle" }),
        this.status,
        closeButton(() => this.stop(), "Stop scanning"),
      ]),
    ]);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.running;
  }

  /**
   * Open the camera and watch for a code.
   *
   * Resolves nothing: a scan either calls back with a code or is stopped by
   * the student. A camera that cannot be opened — no permission, no camera, a
   * page that is not on https — says so in the panel rather than throwing,
   * because the code can still be typed and the lesson carries on.
   */
  async start(onFound: (code: string) => void): Promise<void> {
    const Detector = detectorClass();
    if (!Detector) {
      this.fail("This browser cannot scan. Use your phone's camera app, or type the code.");
      return;
    }

    this.onFound = onFound;
    this.running = true;
    this.root.classList.add("is-open");
    this.root.setAttribute("aria-hidden", "false");
    this.status.className = "scan-status";
    this.status.textContent = "Point at the code on the board.";

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      this.fail(
        denied
          ? "The camera was blocked. Allow it in the address bar, or type the code instead."
          : "No camera we can use. Type the code instead.",
      );
      return;
    }
    if (!this.running) {
      // Stopped while the permission prompt was up.
      this.release();
      return;
    }

    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {
      /* autoplay refused: the frames below simply stay black. */
    });

    const detector = new Detector({ formats: ["qr_code"] });
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.timer = window.setInterval(() => {
      if (!this.running || !context) return;
      const { videoWidth: width, videoHeight: height } = this.video;
      if (!width || !height) return;
      this.canvas.width = width;
      this.canvas.height = height;
      context.drawImage(this.video, 0, 0, width, height);
      void detector
        .detect(this.canvas)
        .then((codes) => {
          if (!this.running) return;
          for (const found of codes) {
            const code = codeFrom(found.rawValue);
            if (code) {
              const callback = this.onFound;
              this.stop();
              callback?.(code);
              return;
            }
          }
        })
        .catch(() => {
          /* one bad frame is not worth a message; the next one is along. */
        });
    }, SCAN_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    this.root.classList.remove("is-open");
    this.root.setAttribute("aria-hidden", "true");
    this.release();
  }

  private release(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  private fail(reason: string): void {
    this.running = false;
    this.release();
    this.root.classList.add("is-open");
    this.root.setAttribute("aria-hidden", "false");
    this.status.className = "scan-status is-bad";
    this.status.textContent = reason;
    // Left on screen to be read, then dismissed on its own.
    window.setTimeout(() => this.stop(), 4200);
  }
}
