/**
 * Smoke test + screenshot tool.
 *
 * Boots the production build in headless Chromium with a software WebGL
 * context, walks the character down a street, looks around, and writes
 * screenshots. Any console error or unhandled rejection fails the run, which
 * makes this usable in CI as a "does the city still start?" check.
 *
 *   node scripts/screenshot.mjs [outDir]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "shots");
const URL_BASE = process.env.CITY_URL ?? "http://localhost:4173/";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL_BASE, { waitUntil: "networkidle" });
// The models are several megabytes and SwiftShader is slow: give the city time.
await page.waitForFunction(() => !document.querySelector("#loader"), null, { timeout: 180_000 });
await page.waitForTimeout(2500);
// The menu is the first thing anybody sees, so it is the first shot.
await page.screenshot({ path: `${OUT}/00-menu.png` });
// The main menu leads with Play; the mode list behind it has its own Start.
//
// Generous, and `noWaitAfter`, because of what this is running on: a city at
// full quality on a software rasteriser leaves the main thread busy enough that
// dispatching one click can take twenty seconds, and Playwright's default
// budget is thirty. That is the machine, not the game.
await page
  .locator(".menu-start")
  .first()
  .click({ noWaitAfter: true, timeout: 180_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-start.png` });

/** Hold a key for a while, then let go and settle. */
async function walk(key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(500);
}

// Walk down the pavement and look around with the drag-to-look fallback
// (pointer lock is not available to a synthetic click in headless Chromium).
await walk("w", 1600);
await page.screenshot({ path: `${OUT}/02-street.png` });

await page.mouse.move(550, 340);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(550 + i * 55, 340 - i * 4);
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03-look.png` });

// Sprint, so the field of view opens and the boom lengthens.
await page.keyboard.down("Shift");
await walk("w", 1400);
await page.keyboard.up("Shift");
await page.screenshot({ path: `${OUT}/04-sprint.png` });

// Walk up to a lost tourist and open the conversation she is waiting to have.
await page.evaluate(() => window.__world.talkTo("Sofía"));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/05-talk.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// The mission list: the whole reason to keep walking.
await page.keyboard.press("m");
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/06-missions.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// A crossing, to see the traffic and the lights. Only pavements and crossings
// are walkable now, so a teleport into the carriageway is snapped to the kerb.
await page.evaluate(() => window.__world.goTo(24.5, 9.9));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/07-junction.png` });

// After dark: street lamps, headlights and every window in the city.
await page.evaluate(() => window.__world.setHour(21.5));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/08-night.png` });
await page.evaluate(() => window.__world.setHour(9));
await page.waitForTimeout(600);

// --- both bodies are the size of a person -----------------------------------
//
// The check this file did not have when it was needed. The robot went out
// scaled to 0.008 — four centimetres of correctly animated, correctly coloured
// character standing at the player's feet, about twelve pixels tall on a phone
// — and every screenshot above was taken with the person on, so nothing in the
// build said a word about it.
//
// The band is deliberately wide. What is being caught is a character off by a
// factor of thirty, and a band tight enough to argue about a hat would only
// ever fail for the wrong reason: a wave puts an arm over the robot's head, a
// sun hat is legitimately taller than the person wearing it.
const HEIGHT_MIN = 1.0;
const HEIGHT_MAX = 1.6;
const heights = {};
for (const body of ["human", "robot"]) {
  await page.evaluate((kind) => window.__world.wear(kind), body);
  // The robot is a download; the person keeps walking until it lands.
  await page
    .waitForFunction(
      (kind) => window.__world.playerHeight() > 0 && (kind === "human" || window.__world.robotReady()),
      body,
      { timeout: 120_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
  heights[body] = await page.evaluate(() => window.__world.playerHeight());
  await page.screenshot({ path: `${OUT}/09-body-${body}.png` });
}
await page.evaluate(() => window.__world.wear("human"));

const wrong = Object.entries(heights).filter(
  ([, h]) => !(h >= HEIGHT_MIN && h <= HEIGHT_MAX),
);

const stats = await page.evaluate(() => window.__world?.stats() ?? { note: "no debug handle" });

await browser.close();

console.log(`screenshots → ${OUT}`, stats);
console.log(
  "character heights:",
  Object.entries(heights)
    .map(([body, h]) => `${body} ${h.toFixed(3)}`)
    .join(", "),
);
if (wrong.length) {
  console.error(
    "Wrong size:\n" +
      wrong
        .map(([body, h]) => `  the ${body} draws ${h.toFixed(3)} units, not ${HEIGHT_MIN}–${HEIGHT_MAX}`)
        .join("\n"),
  );
  process.exit(1);
}
if (errors.length) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("OK — no console errors, both bodies the right size");
