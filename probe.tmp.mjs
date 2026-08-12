import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "/tmp/claude-0/-home-user-Da-World/93217097-c25a-50f4-bc11-1db00fd204a1/scratchpad/mobile";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({
  ...devices["Pixel 7"],
  viewport: { width: 412, height: 870 },
  hasTouch: true,
  isMobile: true,
});
const errs = [];
page.on("pageerror", (e) => { errs.push(String(e)); console.log("PAGEERROR", String(e)); });
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForFunction(() => !document.querySelector("#loader"), null, { timeout: 240000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/01-menu.png` });

await page.locator(".menu-start").click();
await page.waitForTimeout(1500);
console.log("touch layer on:", await page.locator(".touch-layer.is-on").count());
await page.screenshot({ path: `${OUT}/02-play.png` });

// Drive with the on-screen stick.
const box = await page.locator(".stick-zone").boundingBox();
const before = await page.evaluate(() => ({ x: window.__world.player.position.x, z: window.__world.player.position.z }));
await page.mouse.move(box.x + 100, box.y + 150);
await page.mouse.down();
await page.mouse.move(box.x + 100, box.y + 80, { steps: 6 });
await page.waitForTimeout(600);
console.log("held:", await page.locator(".stick-base.is-held").count());
console.log("top element at stick:", await page.evaluate(([x, y]) => {
  const e = document.elementFromPoint(x, y);
  return e ? `${e.tagName}.${e.className}` : "none";
}, [box.x + 100, box.y + 150]));
console.log("diagnostics:", await page.evaluate(([x, y]) => {
  const li = document.elementFromPoint(x, y);
  const menu = document.querySelector(".menu-screen");
  const zone = document.querySelector(".stick-zone");
  const path = [];
  for (let e = li; e && path.length < 6; e = e.parentElement) path.push(`${e.tagName}.${e.className}`);
  return JSON.stringify({
    menuClass: menu?.className,
    menuPE: menu ? getComputedStyle(menu).pointerEvents : "-",
    liPE: li ? getComputedStyle(li).pointerEvents : "-",
    zonePE: zone ? getComputedStyle(zone).pointerEvents : "-",
    zoneRect: zone ? zone.getBoundingClientRect().toJSON() : null,
    path,
  }, null, 1);
}, [box.x + 100, box.y + 150]));
await page.screenshot({ path: `${OUT}/03-stick.png` });
await page.waitForTimeout(2500);
await page.mouse.up();
const after = await page.evaluate(() => ({ x: window.__world.player.position.x, z: window.__world.player.position.z }));
console.log(`stick moved the player: ${before.x.toFixed(2)},${before.z.toFixed(2)} -> ${after.x.toFixed(2)},${after.z.toFixed(2)}`);

// A conversation on a phone.
await page.evaluate(() => window.__world.talkTo("Sofía"));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/04-talk.png` });
console.log(errs.length ? "ERRORS" : "no page errors");
await browser.close();
