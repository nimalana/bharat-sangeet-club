/* eslint-disable react-hooks/rules-of-hooks, no-empty-pattern -- Playwright fixtures are written as async ({ ...dependencies }, use): "use" is Playwright's callback, not a React hook, and the first argument may be an empty dependency object. */
// The test object every spec uses: a page that is already signed in as a role, and a guard that fails the test on a console error, an
// uncaught page error, a failed request, or an HTTP 4xx/5xx from Supabase or the app that the test did not list as expected.
import { test as base, expect } from "@playwright/test";
import { SESSION_KEY, TEST_PROJECT_REF } from "./config.mjs";
import { loadState } from "./state.mjs";
import { heroPhotos } from "../../../features/public/hero-photos.ts";

// role name -> e2e account key. `manager` is a plain member who manages group A; `deactivated` is deactivated after sign-in.
export const ROLES = {
  anon: null,
  admin: "admin",
  executive: "execA",
  manager: "manager",
  member: "member1",
  deactivated: "victim",
};

// 1x1 transparent PNG, used in place of the third-party hero photo of the public site so the network policy and the
// photo host cannot influence a run or a screenshot.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// The security headers every page of the app must come with (next.config.ts, tests/security-headers.test.mjs pins their values).
const REQUIRED_HEADERS = ["content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options", "permissions-policy", "cross-origin-opener-policy"];

// The only pictures a page may load from an origin that is neither the app nor the test project: the third-party photographs that
// features/public/hero-photos.ts still names (docs/ASSETS.md). Self-hosted, the list is empty and any other origin is a failure.
const THIRD_PARTY_PICTURES = heroPhotos.map((photo) => photo.src).filter((src) => /^https?:\/\//.test(src));

// securitypolicyviolation events of every frame of a context, sent to Node as they happen (they survive the navigation that follows).
const cspViolations = new WeakMap();

export function labelRequest(method, rawUrl) {
  const url = new URL(rawUrl);
  const p = url.pathname;
  let m;
  if ((m = p.match(/^\/rest\/v1\/rpc\/(.+)$/))) return `rpc ${m[1]}`;
  if ((m = p.match(/^\/rest\/v1\/(.+)$/))) return `${method} ${m[1]}`;
  if ((m = p.match(/^\/storage\/v1\/object\/sign\/([^/]+)\//))) return `storage sign ${m[1]}`;
  if ((m = p.match(/^\/storage\/v1\/object\/([^/]+)\//))) return `storage ${method} ${m[1]}`;
  if (p.startsWith("/auth/v1/")) return `auth ${method} ${p.slice(9)}`;
  return `${method} ${p}`;
}

export function createGuard(page, appOrigin) {
  const problems = [];
  const allowances = [];
  const requests = [];
  const pending = new Map();
  const isSupabase = (u) => { try { return new URL(u).hostname.endsWith(".supabase.co"); } catch { return false; } };
  const isApp = (u) => { try { return new URL(u).origin === appOrigin; } catch { return false; } };

  const violations = cspViolations.get(page.context()) || [];
  const isAllowedOrigin = (u) => {
    try {
      const url = new URL(u);
      // Addresses that never leave the browser: inline data, blobs, and the browser's own pages (the error page of a blocked frame,
      // the resources of its built-in PDF viewer when a signed PDF is shown in a frame).
      if (["data:", "blob:", "about:", "chrome-error:", "chrome:", "chrome-extension:", "chrome-untrusted:", "devtools:"].includes(url.protocol)) return true;
      return url.origin === appOrigin || url.hostname === `${TEST_PROJECT_REF}.supabase.co` || THIRD_PARTY_PICTURES.includes(url.origin + url.pathname);
    } catch { return false; }
  };
  const documents = [];

  page.on("console", (message) => {
    // A malformed Permissions-Policy or Content-Security-Policy is only a warning to the browser; here it is a failure.
    if (message.type() === "warning" && /Permissions-Policy|Content Security Policy|Content-Security-Policy/i.test(message.text())) {
      problems.push({ kind: "console", text: message.text(), url: message.location().url || "" });
      return;
    }
    if (message.type() !== "error") return;
    problems.push({ kind: "console", text: message.text(), url: message.location().url || "" });
  });
  page.on("pageerror", (error) => problems.push({ kind: "pageerror", text: error.message, url: "" }));
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "failed";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(reason)) return; // a navigation or a closed dialog cancelled it
    problems.push({ kind: "requestfailed", text: `${request.method()} ${request.url()} ${reason}`, url: request.url() });
    const entry = pending.get(request);
    if (entry) { entry.failed = reason; entry.ended = Date.now(); }
  });
  page.on("request", (request) => {
    // Nothing leaves for a third party (P3-03): the app, its Supabase project and the named hero picture are all a page may ask.
    if (!isAllowedOrigin(request.url())) problems.push({ kind: "origin", text: `${request.method()} ${request.url()} goes to an origin that is not the app or its Supabase project`, url: request.url() });
    if (!isSupabase(request.url())) return;
    const entry = { method: request.method(), url: request.url(), label: labelRequest(request.method(), request.url()), started: Date.now(), ended: null, status: null, failed: null, body: request.postData() || "" };
    pending.set(request, entry);
    requests.push(entry);
  });
  page.on("response", (response) => {
    const entry = pending.get(response.request());
    if (entry) entry.status = response.status();
    const status = response.status();
    // Every page the app serves carries the security headers (next.config.ts), also an answer that redirects.
    if (response.request().resourceType() === "document" && isApp(response.url())) {
      const headers = response.headers();
      documents.push({ url: response.url(), status, headers });
      const missing = REQUIRED_HEADERS.filter((name) => !headers[name]);
      if (missing.length) problems.push({ kind: "headers", text: `${response.url()} answered without ${missing.join(", ")}`, url: response.url() });
      const csp = headers["content-security-policy"] || "";
      if (csp && (/unsafe-eval/.test(csp) || !/object-src 'none'/.test(csp) || !/frame-ancestors 'none'/.test(csp))) problems.push({ kind: "headers", text: `${response.url()} has a weaker Content-Security-Policy than next.config.ts writes: ${csp}`, url: response.url() });
    }
    if (status >= 400 && (isSupabase(response.url()) || isApp(response.url()))) {
      problems.push({ kind: "http", status, text: `${response.request().method()} ${response.url()} -> ${status}`, url: response.url(), method: response.request().method() });
    }
  });
  page.on("requestfinished", (request) => { const entry = pending.get(request); if (entry) entry.ended = Date.now(); });

  const matches = (allowance, problem) => {
    if (allowance.kind && allowance.kind !== problem.kind) return false;
    if (allowance.status && allowance.status !== problem.status) return false;
    if (allowance.url && !allowance.url.test(problem.url || "")) return false;
    if (allowance.text && !allowance.text.test(problem.text || "")) return false;
    if (allowance.method && allowance.method !== problem.method) return false;
    return true;
  };

  return {
    requests,
    problems,
    // An expected refusal or message. Every allowance needs a reason (what the app is doing and why the answer is right).
    allow(allowance) {
      if (!allowance.reason) throw new Error("an allowance needs a reason");
      allowances.push({ ...allowance, hits: 0 });
    },
    // Every securitypolicyviolation of every frame and tab of this test, enforced or report-only: a screen that works only because the
    // browser reported (and did not block) a load is still a violation.
    cspViolations: violations,
    documents,
    unexpected() {
      const all = [...problems, ...violations.map((v) => ({ kind: "csp", text: `${v.disposition} ${v.effectiveDirective}: blocked ${v.blockedURI} (${v.sourceFile || v.documentURI}${v.lineNumber ? `:${v.lineNumber}` : ""}${v.sample ? `, sample ${JSON.stringify(v.sample)}` : ""})`, url: v.blockedURI }))];
      return all.filter((problem) => {
        for (const allowance of allowances) {
          if (matches(allowance, problem)) { allowance.hits += 1; return false; }
          // The browser logs every failed load as "Failed to load resource: ... status of N": it belongs to the HTTP entry that was allowed.
          if (problem.kind === "console" && /^Failed to load resource/.test(problem.text) && allowance.kind === "http"
            && (!allowance.url || allowance.url.test(problem.url)) && (!allowance.status || problem.text.includes(String(allowance.status)))) { allowance.hits += 1; return false; }
        }
        return true;
      });
    },
    unusedAllowances: () => allowances.filter((a) => a.hits === 0),
    mark: () => requests.length,
    since: (index) => requests.slice(index),
    reset: () => { requests.length = 0; },
  };
}

// Signs a browser context in as a role (without touching the app) and keeps it on the test project.
export async function prepareContext(context, role) {
  const state = loadState();
  const account = ROLES[role];
  if (role !== "anon" && !account) throw new Error(`unknown role ${role}`);
  // The same place the app's client reads: localStorage "sb-<ref>-auth-token" (persistSession). The app is not touched.
  if (account) {
    const session = state.sessions[account];
    if (!session) throw new Error(`no session for ${account} in the run state`);
    await context.addInitScript(({ key, value }) => {
      try { if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value); } catch { /* an opaque origin */ }
    }, { key: SESSION_KEY, value: JSON.stringify(session) });
  }
  // Content-Security-Policy violations of every page and frame of the context, as they happen (the guard of each test fails on any).
  if (!cspViolations.has(context)) {
    const violations = [];
    cspViolations.set(context, violations);
    await context.exposeBinding("__reportCspViolation", (source, violation) => { violations.push({ ...violation, frameUrl: source.frame.url() }); });
    await context.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__reportCspViolation({
          effectiveDirective: event.effectiveDirective, violatedDirective: event.violatedDirective, blockedURI: event.blockedURI, disposition: event.disposition,
          documentURI: event.documentURI, sourceFile: event.sourceFile, lineNumber: event.lineNumber, sample: event.sample,
        });
      });
    });
  }
  // Defence in depth: the browser must only ever talk to the test project.
  await context.route((url) => url.hostname.endsWith(".supabase.co") && url.hostname !== `${TEST_PROJECT_REF}.supabase.co`, (route) => {
    console.error(`BLOCKED a request to a Supabase project that is not the test project: ${route.request().url()}`);
    return route.abort("blockedbyclient");
  });
  await context.route(/asianartsagency\.co\.uk|wixstatic\.com/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
}

export const test = base.extend({
  role: ["anon", { option: true }],

  baseURL: async ({}, use) => { await use(loadState().baseURL); },

  context: async ({ context, role }, use) => {
    await prepareContext(context, role);
    await use(context);
  },

  // Auto: attached to every page of the test; fails the test at the end when something unexpected was logged.
  guard: [async ({ page, baseURL }, use, testInfo) => {
    const guard = createGuard(page, new URL(baseURL).origin);
    await use(guard);
    const bad = guard.unexpected();
    if (bad.length) {
      await testInfo.attach("unexpected-browser-problems.json", { body: JSON.stringify(bad, null, 2), contentType: "application/json" });
      if (testInfo.status === "passed" || testInfo.status === undefined) {
        throw new Error(`The browser reported ${bad.length} problem(s) nobody listed as expected:\n${bad.map((p) => `  [${p.kind}] ${p.text.slice(0, 400)}`).join("\n")}`);
      }
    }
  }, { auto: true }],
});

export { expect };
