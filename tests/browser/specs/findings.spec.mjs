// Product problems the browser suite found. Each test describes the CORRECT behaviour and is marked test.fixme while the product
// does not have it, so a normal run skips it (and shows it as skipped in the report), and the day the product is fixed the test is
// switched on by deleting the one `knownProblem(...)` line at its top.
//
//   E2E_RUN_FIXME=1 npm run test:browser     runs them anyway, to see them fail (or pass, once fixed)
//
// The write-up of each problem (severity, evidence, suggested fix) is in tests/browser/README.md, "Product problems found"; the ids
// below (F1, F2, ...) are the ones used there.
import { test, expect } from "../support/test.mjs";
import { landmarks, openScreen } from "../support/screens.mjs";
import { fx } from "../support/smoke.mjs";

// test.fixme(condition, reason): skipped while the condition holds; E2E_RUN_FIXME=1 makes it false.
const knownProblem = (reason) => test.fixme(process.env.E2E_RUN_FIXME !== "1", reason);

const channel = (css) => {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a: a === undefined ? 1 : a }; }
  const s = css.match(/color\(srgb ([^)]+)\)/);
  if (s) { const [r, g, b, a] = s[1].split(/[ /]+/).filter(Boolean).map(Number); return { r: r * 255, g: g * 255, b: b * 255, a: a === undefined ? 1 : a }; }
  return null;
};
const luminance = ({ r, g, b }) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test.describe("member", () => {
  test.use({ role: "member" });

  test("F1: the Check in button's label can be read against its background", async ({ page }) => {
    knownProblem("F1: the Check in button is white text on a white background (the primary Button's !text-white beats the text-[var(--ink)] the attendance screen passes), so a member cannot see the label");
    await openScreen(page, "attendance");
    const button = page.locator(".attendance-checkin").getByRole("button", { name: "Check in" });
    await expect(button).toBeVisible();
    const { color, background } = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, background: style.backgroundColor };
    });
    const ratio = contrast(channel(color), channel(background));
    expect(ratio, `label ${color} on ${background}: contrast ${ratio.toFixed(2)} to 1 (WCAG asks for 4.5 for normal text)`).toBeGreaterThanOrEqual(4.5);
  });

  test("F2: on a phone the check-in code field and button stay inside their card", async ({ page }) => {
    knownProblem("F2: at 390 px wide the code input and the Check in button are wider than the card and stick out of its right edge");
    await page.setViewportSize({ width: 390, height: 844 });
    await openScreen(page, "attendance");
    const card = page.locator(".attendance-checkin");
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    for (const control of [card.getByLabel("Attendance code"), card.getByRole("button", { name: "Check in" })]) {
      const inner = await control.boundingBox();
      expect(inner.x + inner.width, "the right edge of a control against the right edge of its card").toBeLessThanOrEqual(box.x + box.width + 0.5);
      expect(inner.x, "the left edge of a control against the left edge of its card").toBeGreaterThanOrEqual(box.x - 0.5);
    }
  });
});

test.describe("member, first paint and requests", () => {
  test.use({ role: "member" });

  test("F3: a signed-in visit to / never paints the public landing page before the portal", async ({ page }, testInfo) => {
    knownProblem("F3: the prerendered public landing page is what a signed-in person sees first, for about 0.1 to 0.2 seconds, before the loading screen and then the portal");
    await page.addInitScript(() => {
      // What is on top at the middle of the page, frame by frame (only the changes are kept).
      const frames = [];
      window.__top = frames;
      const tick = () => {
        const t = Math.round(performance.now());
        const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 3);
        const top = !el ? "none" : el.closest(".public-site") ? "public" : el.closest(".loading-screen") ? "loading" : el.closest(".portal-shell") ? "portal" : "other";
        if (!frames.length || frames[frames.length - 1].top !== top) frames.push({ t, top });
        if (t < 5000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome back,/ })).toBeVisible();
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => window.__top);
    await testInfo.attach("what was on top, and from when (ms)", { body: JSON.stringify(frames), contentType: "application/json" });
    expect(frames.map((f) => f.top), `on top while "/" starts: ${JSON.stringify(frames)}`).not.toContain("public");
  });

  test("F4: opening My Groups asks for each list once", async ({ page, guard }) => {
    knownProblem("F4: opening My Groups sends GET subgroup_memberships twice, in the same wave");
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome back,/ })).toBeVisible();
    await page.waitForTimeout(800);
    guard.reset();
    await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My Groups", exact: true }).click();
    for (const { locator } of landmarks(page, "groups", "member", fx())) await expect(locator).toBeVisible();
    await page.waitForTimeout(1200);
    const counts = {};
    for (const request of guard.requests) counts[request.label] = (counts[request.label] || 0) + 1;
    const repeated = Object.entries(counts).filter(([, n]) => n > 1).map(([label, n]) => `${label} x${n}`);
    expect(repeated, "requests sent more than once for one screen").toEqual([]);
  });

  test("F5: the first open of Recordings sends its data request without waiting for a third of a second", async ({ page, guard }) => {
    knownProblem("F5: the first open of Attendance, Recordings, Resources and Finances sends its first data request 335 to 365 ms after the click, although the screen's script has arrived after 60 to 90 ms and the main thread is idle");
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome back,/ })).toBeVisible();
    await page.waitForTimeout(800);
    guard.reset();
    const clicked = Date.now();
    await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Recordings", exact: true }).click();
    await expect.poll(() => guard.requests.find((r) => r.label === "GET recordings")?.started ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
    const waited = guard.requests.find((r) => r.label === "GET recordings").started - clicked;
    expect(waited, "ms from the click to the first data request of the Recordings screen").toBeLessThan(200);
  });

  test("F6: a second visit to My Groups shows the groups at once, while the refresh is still on its way", async ({ page }) => {
    knownProblem("F6: My Groups is the one screen the per-account cache does not serve on a revisit: it waits for its five requests every time (about 250 ms here, as long as the network makes it)");
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome back,/ })).toBeVisible();
    const menu = page.getByRole("navigation", { name: "Portal navigation" });
    const group = page.getByRole("button", { name: new RegExp(fx().titles.groupA.replace(/[[\]]/g, "\\$&")) });
    await menu.getByRole("button", { name: "My Groups", exact: true }).click();
    await expect(group).toBeVisible();
    await menu.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome back,/ })).toBeVisible();
    // From now on the groups come back slowly: a screen that shows what it has already read does not care.
    await page.route(/\/rest\/v1\/(subgroups|subgroup_memberships)\?/, async (route) => { await new Promise((resolve) => setTimeout(resolve, 2500)); await route.continue(); });
    await menu.getByRole("button", { name: "My Groups", exact: true }).click();
    await expect(group).toBeVisible({ timeout: 1000 });
  });
});
