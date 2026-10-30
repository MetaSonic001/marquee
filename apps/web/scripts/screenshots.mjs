// Captures the Devpost gallery at 1440×960 (3:2).  node scripts/screenshots.mjs [baseUrl] [apiUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3010";
const API = process.argv[3] || "http://localhost:8010";
const OUT = new URL("../../../docs/screenshots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

const samples = await (await fetch(`${API}/samples`)).json();
// feature the comedy night (Cedric the Entertainer & co.) and the Dodgers watch party
const comedy = samples.find((s) => s.name === "Laugh Track Live") || samples[0];
const dodgers = samples.find((s) => s.name === "Blue Heaven Watch Party") || samples[1] || samples[0];
const id = comedy.id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("marquee.coach", "done");
  } catch {}
});
const page = await ctx.newPage();
const shot = async (name) => {
  await page.waitForTimeout(1600); // let the split-flap board settle
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log("saved", name);
};
const go = async (path, selector) => {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90_000 });
  if (selector) await page.waitForSelector(selector, { timeout: 90_000 });
};

await go("/", "[data-testid=sample-card]");
await shot("01-landing");

await go(`/events/${id}`, "[data-testid=brand-card]");
await shot("02-shortlist");

await page.locator("section[aria-labelledby=shelf-hidden] [data-testid=brand-card] button[data-open]").first().click();
await page.waitForSelector("[role=dialog]", { timeout: 15_000 });
await page.waitForTimeout(800);
await shot("03-brand-drawer");
await page.keyboard.press("Escape");

await go(`/events/${dodgers.id}?tab=slots`, "[data-testid=slot-card]");
await page.locator('[data-slot="Official beverage partner"]').scrollIntoViewIfNeeded();
await page.mouse.wheel(0, -220);
await shot("04-sponsor-slots");

await go(`/events/${id}?tab=crowd`, "figure svg");
await page.mouse.wheel(0, 380);
await shot("05-crowd");

await go(`/events/${dodgers.id}?tab=check`, "[data-testid=check-card]");
await page.mouse.wheel(0, 380);
await shot("06-check-brand");

await go("/portfolio", "[data-testid=portfolio-grid]");
await shot("07-portfolio");

await go(`/events/${id}?tab=llm`, "[data-testid=llm-compare]");
await page.waitForSelector("[data-testid=llm-compare] ol li", { timeout: 90_000 }).catch(() => {});
await page.mouse.wheel(0, 380);
await shot("08-llm-compare");

const ev = await (await fetch(`${API}/events/${id}`)).json();
await go(`/events/${id}/runs/${ev.latest_run_id}`);
await page.waitForSelector("text=Open the shortlist", { timeout: 120_000 }).catch(() => {});
await shot("09-soundcheck");

await go("/events/new");
await page.fill("[data-testid=event-name]", "Laugh Track Live");
await page.fill("[data-testid=event-city]", "St. Louis");
await page.locator("select").first().selectOption("comedy");
await page.locator("input[inputmode=numeric]").fill("2500");
await page.locator("textarea").fill("A one-night stand-up show in St. Louis, ~2,500 seats. Lineup: Cedric the Entertainer, Steve Harvey, D.L. Hughley, Kevin Hart. Looking for a presenting sponsor.");
await shot("10-intake");

await browser.close();
