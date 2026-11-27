// Real load numbers from a real browser (run with `npm run test:browser:timings`; it is not part of `npm run test:browser`).
// For each role and screen, 5 runs of each of two kinds, a fresh browser context every time (empty HTTP cache, only the saved sign-in):
//   load  the address is opened ("/?page=finances"), as a bookmark or a reload does it
//   nav   the shell is already up on the Overview and the person clicks the navigation entry
// Per run: time until the screen's content is visible, the Supabase requests (which, how many, in how many waves), the browser's navigation timing, and
// what is on top while the page starts (the public landing page, the loading screen, the portal: see "first paint" below).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OUT } from "../support/config.mjs";
import { test } from "../support/test.mjs";
import { createGuard, prepareContext } from "../support/test.mjs";
import { loadState } from "../support/state.mjs";
import { SCREEN_PATH, landmarks, profileKind } from "../support/screens.mjs";

const RUNS = Number(process.env.E2E_TIMING_RUNS || 5);
const LABEL = { home: "Overview", groups: "My Groups", calendar: "Calendar", members: "Members", attendance: "Attendance", recordings: "Recordings", documents: "Resources", finances: "Finances", admin: "Admin" };
const SCREENS = {
  member: ["home", "groups", "calendar", "members", "attendance", "recordings", "documents", "finances"],
  manager: ["home", "groups", "attendance", "finances"],
  executive: ["home", "groups", "calendar", "members", "attendance", "recordings", "documents", "finances"],
  admin: ["home", "groups", "calendar", "members", "attendance", "recordings", "documents", "finances", "admin"],
};

// Records, frame by frame, what is on top at the middle of the page: the prerendered public site, the loading screen or the portal.
// Only changes are kept: [{ t: ms since the navigation started, top }].
const TOP_SCRIPT = () => {
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
};

// A group manager is a plain member, but not the member the fixture requests and meetings belong to: for them the Finances and
// Attendance screens are proven by their own heading and form (the content of "my reimbursements" is member1's).
async function waitLandmarks(page, role, screen, state) {
  const only = role === "manager" ? ({ finances: 1, attendance: 2 }[screen] ?? Infinity) : Infinity;
  for (const { locator } of landmarks(page, screen, profileKind(role), state.fx).slice(0, only)) await locator.waitFor({ state: "visible", timeout: 30_000 });
}

async function oneRun(browser, role, screen, mode, results) {
  const state = loadState();
  const context = await browser.newContext({ baseURL: state.baseURL, locale: "en-US", timezoneId: "America/New_York", viewport: { width: 1280, height: 800 } });
  await prepareContext(context, role);
  const page = await context.newPage();
  const guard = createGuard(page, new URL(state.baseURL).origin);
  const waitContent = () => waitLandmarks(page, role, screen, state);
  let started;
  if (mode === "load") {
    started = Date.now();
    await page.goto(SCREEN_PATH[screen], { waitUntil: "commit" });
  } else {
    await page.goto("/", { waitUntil: "commit" });
    await page.getByRole("heading", { level: 1, name: /^Welcome back,/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800); // let anything the Overview still sends finish before the click
    guard.reset();
    const entry = page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: LABEL[screen], exact: true });
    started = Date.now();
    await entry.click();
  }
  await waitContent();
  const contentMs = Date.now() - started;
  const requestsAtContent = guard.requests.length;
  await page.waitForTimeout(1200); // late requests (a second wave, a poll that starts at once) still count
  const requests = guard.requests.map((r) => ({ label: r.label, status: r.status, ms: r.ended ? r.ended - r.started : null, startMs: r.started - started }));
  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0];
    const paint = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
    return { ttfb: Math.round(entry.responseStart), domContentLoaded: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd), firstContentfulPaint: paint["first-contentful-paint"] ?? null, transferKB: Math.round(performance.getEntriesByType("resource").reduce((t, r) => t + (r.transferSize || 0), 0) / 1024) };
  });
  const duplicates = Object.entries(requests.reduce((acc, r) => ({ ...acc, [r.label]: (acc[r.label] || 0) + 1 }), {})).filter(([, n]) => n > 1).map(([label, n]) => `${label} x${n}`);
  results.push({
    role, screen, mode, contentMs, requestsAtContent, requestCount: requests.length, requests, duplicates, nav,
    problems: guard.unexpected().map((p) => `[${p.kind}] ${p.text.slice(0, 160)}`),
  });
  await context.close();
}

const results = [];

for (const role of ["member", "manager", "executive", "admin"]) {
  test(`timings: ${role}`, async ({ browser }) => {
    test.setTimeout(30 * 60_000);
    for (const screen of SCREENS[role]) for (const mode of ["load", "nav"]) {
      if (mode === "nav" && screen === "home") continue; // the Overview is the entry point of every nav run
      for (let run = 0; run < RUNS; run += 1) await oneRun(browser, role, screen, mode, results);
    }
  });
}

test("timings: deactivated member", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const state = loadState();
  for (let run = 0; run < RUNS; run += 1) {
    const context = await browser.newContext({ baseURL: state.baseURL, locale: "en-US", timezoneId: "America/New_York" });
    await prepareContext(context, "deactivated");
      const page = await context.newPage();
    const guard = createGuard(page, new URL(state.baseURL).origin);
    const started = Date.now();
    await page.goto("/", { waitUntil: "commit" });
    await page.getByRole("heading", { name: "Your access has been deactivated" }).waitFor({ timeout: 30_000 });
    const contentMs = Date.now() - started;
    await page.waitForTimeout(1200);
      results.push({ role: "deactivated", screen: "notice", mode: "load", contentMs, requestCount: guard.requests.length, requestsAtContent: guard.requests.length, requests: guard.requests.map((r) => ({ label: r.label, status: r.status, ms: r.ended ? r.ended - r.started : null })), duplicates: [], nav: null, problems: guard.unexpected().map((p) => p.text.slice(0, 160)) });
    await context.close();
  }
});

// What a person who is already signed in sees while "/" starts: which of the three things is on top, and from when, 5 runs per role.
for (const role of ["member", "manager", "executive", "admin"]) {
  test(`timings: first paint of a signed-in visit (${role})`, async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const state = loadState();
    for (let run = 0; run < RUNS; run += 1) {
      const context = await browser.newContext({ baseURL: state.baseURL, locale: "en-US", timezoneId: "America/New_York", viewport: { width: 1280, height: 800 } });
      await prepareContext(context, role);
      await context.addInitScript(TOP_SCRIPT);
      const page = await context.newPage();
      await page.goto("/", { waitUntil: "commit" });
      await page.getByRole("heading", { level: 1, name: /^Welcome back,/ }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(300);
      const frames = await page.evaluate(() => window.__top);
      const at = (top) => frames.find((f) => f.top === top)?.t ?? null;
      const next = (top) => { const i = frames.findIndex((f) => f.top === top); return i >= 0 && frames[i + 1] ? frames[i + 1].t : null; };
      results.push({ role, screen: "home", mode: "paint", frames, publicFrom: at("public"), publicUntil: next("public"), loadingFrom: at("loading"), loadingUntil: next("loading"), portalFrom: at("portal"), contentMs: at("portal") ?? 0, requestCount: 0, requestsAtContent: 0, requests: [], duplicates: [], nav: null, problems: [] });
      await context.close();
    }
  });
}

// "Revisiting a screen is instant" (the goal of Phase 2): open the screen from the navigation, go back to the Overview, open it again.
// Records how long the second visit takes to show the content and what it sends. One browser context per run, so the first visit is cold.
async function oneRevisit(browser, role, screen, results) {
  const state = loadState();
  const context = await browser.newContext({ baseURL: state.baseURL, locale: "en-US", timezoneId: "America/New_York", viewport: { width: 1280, height: 800 } });
  await prepareContext(context, role);
  const page = await context.newPage();
  const guard = createGuard(page, new URL(state.baseURL).origin);
  const menu = page.getByRole("navigation", { name: "Portal navigation" });
  const welcome = page.getByRole("heading", { level: 1, name: /^Welcome back,/ });
  await page.goto("/", { waitUntil: "commit" });
  await welcome.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  guard.reset();
  let started = Date.now();
  await menu.getByRole("button", { name: LABEL[screen], exact: true }).click();
  await waitLandmarks(page, role, screen, state);
  const firstMs = Date.now() - started;
  await page.waitForTimeout(1500);
  await menu.getByRole("button", { name: LABEL.home, exact: true }).click();
  await welcome.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  guard.reset();
  started = Date.now();
  await menu.getByRole("button", { name: LABEL[screen], exact: true }).click();
  await waitLandmarks(page, role, screen, state);
  const contentMs = Date.now() - started;
  await page.waitForTimeout(1500);
  const requests = guard.requests.map((r) => ({ label: r.label, status: r.status, ms: r.ended ? r.ended - r.started : null, startMs: r.started - started }));
  results.push({ role, screen, mode: "revisit", firstMs, contentMs, requestsAtContent: 0, requestCount: requests.length, requests, duplicates: [], nav: null, problems: guard.unexpected().map((p) => `[${p.kind}] ${p.text.slice(0, 160)}`) });
  await context.close();
}

for (const role of ["member", "executive"]) {
  test(`timings: revisiting a screen (${role})`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    for (const screen of ["groups", "members", "attendance", "recordings", "documents", "finances"]) for (let run = 0; run < RUNS; run += 1) await oneRevisit(browser, role, screen, results);
  });
}

// What a screen keeps sending while it is only open (the attendance screen polls; the plan counts the poll in its "8 requests to 1").
// One run per role: the screen is opened, then left alone for IDLE_SECONDS and every Supabase request in that time is listed with when it left.
const IDLE_SECONDS = Number(process.env.E2E_IDLE_SECONDS || 35);
for (const role of ["executive", "member"]) {
  test(`timings: what the open attendance screen sends by itself (${role})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const state = loadState();
    const context = await browser.newContext({ baseURL: state.baseURL, locale: "en-US", timezoneId: "America/New_York", viewport: { width: 1280, height: 800 } });
    await prepareContext(context, role);
    const page = await context.newPage();
    const guard = createGuard(page, new URL(state.baseURL).origin);
    await page.goto(SCREEN_PATH.attendance, { waitUntil: "commit" });
    for (const { locator } of landmarks(page, "attendance", profileKind(role), state.fx)) await locator.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1500);
    guard.reset();
    const started = Date.now();
    await page.waitForTimeout(IDLE_SECONDS * 1000);
    const requests = guard.requests.map((r) => ({ label: r.label, status: r.status, ms: r.ended ? r.ended - r.started : null, atSecond: Math.round((r.started - started) / 100) / 10 }));
    results.push({ role, screen: "attendance", mode: "idle", idleSeconds: IDLE_SECONDS, contentMs: 0, requestCount: requests.length, requestsAtContent: 0, requests, duplicates: [], nav: null, problems: guard.unexpected().map((p) => `[${p.kind}] ${p.text.slice(0, 160)}`) });
    await context.close();
  });
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, process.env.E2E_TIMINGS_FILE || "timings.json"), JSON.stringify({ at: new Date().toISOString(), runs: RUNS, results }, null, 1));
});
