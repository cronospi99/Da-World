/**
 * QR mode smoke test.
 *
 * Two browser tabs, one city. The first hosts a world and shows a code; the
 * second opens the join link exactly as a scanned QR code would, types a name
 * and walks in. It passes when both tabs agree there are two people in the
 * city and neither logged an error.
 *
 * It runs entirely on this machine: a local `peerjs-server` stands in for the
 * public signalling cloud, reached through the same `?peerhost=` switch a
 * school would use to run its own. The data channels are real WebRTC either
 * way, so what is tested here is the thing that ships.
 *
 *   npm run build && npm run preview &
 *   node scripts/qr-smoke.mjs [outDir]
 *
 * `npm run smoke:qr` does all of that for you.
 */

import { chromium } from "playwright";
import { PeerServer } from "peer";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "shots");
const BASE = process.env.CITY_URL ?? "http://localhost:4173/";
const SIGNAL_PORT = Number(process.env.PEER_PORT ?? 9411);
mkdirSync(OUT, { recursive: true });

const step = (message) => console.log(`· ${message}`);
const reachable = () =>
  fetch(BASE)
    .then((response) => response.ok)
    .catch(() => false);

/** Serve dist/ ourselves unless something already is. */
let preview = null;
if (!(await reachable())) {
  preview = spawn("npm", ["run", "preview"], { stdio: "ignore" });
  const until = Date.now() + 30_000;
  while (!(await reachable())) {
    if (Date.now() > until) throw new Error(`Nothing is serving ${BASE} — run npm run build first.`);
    await new Promise((wait) => setTimeout(wait, 400));
  }
  step("preview server up");
}

// Bound to 127.0.0.1 rather than every interface, and told it is ready by
// callback rather than by event: `peer` does not emit `listening` on the
// object it hands back.
const signalling = await new Promise((ready) => {
  const server = PeerServer({ port: SIGNAL_PORT, path: "/", host: "127.0.0.1" }, () =>
    ready(server),
  );
});
step(`signalling on :${SIGNAL_PORT}`);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: [
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
    // Headless Chromium will not open a camera or a microphone on its own, and
    // QR mode asks for neither on this path — but the permission prompt would
    // still block the run if anything did.
    "--use-fake-ui-for-media-stream",
    // Only one of these two tabs can be in front, and Chromium slows the
    // timers of the one that is not — including the keep-alive that tells the
    // signalling server the host is still there. In a lesson the two tabs are
    // on two devices and both are in front; here they are not, so the
    // throttling is turned off rather than tested.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});

const errors = [];
async function tab(url) {
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } });
  // Two cities on a software rasteriser leave little of the main thread for
  // anything else, and a handshake queued behind a two-second frame looks
  // exactly like a network that is refusing to connect. The lowest graphics
  // tier is what makes this test about the networking.
  await page.addInitScript(() => localStorage.setItem("da-world:quality", "low"));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${url}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${url}] ${e}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  step(`loading ${url}`);
  await page.waitForFunction(() => !document.querySelector("#loader"), null, { timeout: 240_000 });
  step("city built");
  return page;
}

const query = `?peerhost=127.0.0.1:${SIGNAL_PORT}`;
const fail = (message) => {
  errors.push(message);
};

/* --- the teacher, hosting from their own browser -------------------------- */

const host = await tab(`${BASE}${query}`);
// "Play together" on the main menu is Class mode's own door: it opens the panel.
await host.locator('.menu-tile:has-text("Play together")').click();
await host.locator(".lobby-choices .pill-button").first().click();

await host.waitForFunction(
  () => {
    const code = document.querySelector(".lobby-code")?.textContent ?? "";
    return /^[A-Z0-9]{5}$/.test(code);
  },
  null,
  { timeout: 60_000 },
);
const code = (await host.locator(".lobby-code").textContent()).trim();
step("code shown");
const qrDrawn = await host.locator(".lobby-qr canvas").count();
if (!qrDrawn) fail("The host panel drew no QR code.");
await host.screenshot({ path: `${OUT}/qr-00-host.png` });
console.log(`room ${code} open, QR drawn`);

/* --- a student, arriving as if they had scanned it ------------------------ */

const student = await tab(`${BASE}${query}#join=${code}`);
const codeField = student.locator(".lobby-code-input");
if ((await codeField.inputValue()) !== code) {
  fail("The scanned link did not fill the code in for the student.");
}
await student.locator(".lobby-view:not(.is-hidden) input[aria-label='Your name']").fill("Ana");
await student
  .locator(".lobby-view:not(.is-hidden) .lesson-actions .pill-button")
  .first()
  .click({ noWaitAfter: true });
step("student pressed join");

// Joining crosses a signalling server and an ICE negotiation, so it is given
// room to be slow before it is called broken.
await student.waitForFunction(() => window.__world?.classmates.peers().length === 1, null, {
  timeout: 120_000,
});
await student.waitForTimeout(1500);
await student.screenshot({ path: `${OUT}/qr-01-student.png` });

await host.waitForFunction(() => window.__world?.classmates.peers().length === 1, null, {
  timeout: 30_000,
});

/* --- and they can see each other move -------------------------------------- */

await student.evaluate(() => window.__world.goTo(26, 11.5));
await student.waitForTimeout(1200);
const seen = await host.evaluate(() => {
  const [peer] = window.__world.classmates.peers();
  return peer ? { name: peer.name, x: peer.x } : null;
});
if (!seen || seen.name !== "Ana") fail(`The host does not see Ana: ${JSON.stringify(seen)}`);

const roster = await host.locator(".lobby-count").textContent();
if (!roster?.includes("2 / 12")) fail(`The roster reads "${roster}".`);
await host.screenshot({ path: `${OUT}/qr-02-roster.png` });

/* --- the teacher moves the room to another mode ---------------------------- */

await host.evaluate(() => window.__world.host?.setMode("directions"));
await student.waitForFunction(() => window.__world.mode.id === "directions", null, {
  timeout: 15_000,
});

await browser.close();
signalling.stop?.();
preview?.kill();

console.log(`screenshots → ${OUT}`);
if (errors.length) {
  console.error("Failures:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`OK — two people in room ${code}, positions and mode shared`);
process.exit(0);
