// The visual baseline: a full-page JPEG of a screen per role at two widths. Never an assertion (dates and live data change);
// scripts compare two folders afterwards (tools/compare-screenshots.mjs).
//
// Volatile regions are painted over before the picture is taken, and the run's random id is replaced by zeros in the text, so a
// second run against the same fixtures (E2E_REUSE=1) looks the same. To mask another region, add a selector to MASKS (painted over,
// the size stays); a region whose height changes goes to HIDDEN (taken out of the page).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SHOT_DIR, WIDTHS } from "./config.mjs";

const MASKS = [
  ".dashboard-measure",          // a random talam pattern with a running beat animation
  ".toast",                     // a notification that has a timer
  "time",                       // dates and times that depend on today
  ".calendar-grid .today",      // today's cell moves every day
  ".attendance-live-code",      // the check-in code
];

// Regions whose HEIGHT changes with every run (a list that grows with each run's audit rows): painting over them would still move
// everything below, so they are taken out of the page for the picture.
const HIDDEN = [
  ".audit-panel",               // "Recent admin activity": the last 20 admin actions, which every run adds to
];

async function normalise(page, run) {
  await page.evaluate((id) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue.includes(id)) node.nodeValue = node.nodeValue.split(id).join("00000000");
    for (const input of document.querySelectorAll("input, textarea")) if (typeof input.value === "string" && input.value.includes(id)) input.value = input.value.split(id).join("00000000");
  }, run);
}

export async function shoot(page, { role, screen, run, extraMasks = [], extraHidden = [] }) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const original = page.viewportSize();
  const taken = [];
  try {
    for (const size of WIDTHS) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await normalise(page, run);
      await page.addStyleTag({ content: [...HIDDEN, ...extraHidden].map((selector) => `${selector} { display: none !important; }`).join("\n") });
      const masks = [...MASKS, ...extraMasks].map((selector) => page.locator(selector));
      const file = path.join(SHOT_DIR, `${role}__${screen}__${size.name}.jpg`);
      await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 35, animations: "disabled", caret: "hide", mask: masks, maskColor: "#ff00ff" });
      taken.push(file);
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
  return taken;
}
