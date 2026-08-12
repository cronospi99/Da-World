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

// Stand in the street outside a door, facing the shop, and read its card.
await page.evaluate(() => window.__world.goTo(14.05, 8.6, Math.PI));
await page.waitForTimeout(900);
await page.keyboard.press("e");
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/05-place.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// A junction, to see the traffic and the lights.
await page.evaluate(() => window.__world.goTo(24.5, 13));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/06-junction.png` });

// After dark: street lamps, headlights and every window in the city.
await page.evaluate(() => window.__world.setHour(21.5));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/07-night.png` });
await page.evaluate(() => window.__world.setHour(9));
await page.waitForTimeout(600);

const stats = await page.evaluate(() => window.__world?.stats() ?? { note: "no debug handle" });

await browser.close();

console.log(`screenshots → ${OUT}`, stats);
if (errors.length) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("OK — no console errors");
