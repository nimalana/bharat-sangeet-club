// Runs once before the suite: guard, sign in the e2e accounts, seed the fixtures, build and start the app, deactivate the
// deactivated-member account. Returns the teardown (Playwright runs it after the last test, also when tests failed).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { STATE_FILE, OUT, SHOT_DIR, browserConfig } from "./support/config.mjs";
import { createContext, RUN } from "../../scripts/e2e/lib/ctx.mjs";
import { ACCOUNT_KEYS } from "../../scripts/e2e/accounts.mjs";
import { deactivateVictim, prepareAccounts, reactivateVictim, removeWhatTheAppMayDelete, seed } from "./support/fixtures.mjs";
import { build, freePort, start, stop } from "./support/server.mjs";

export default async function globalSetup() {
  const cfg = browserConfig();
  mkdirSync(OUT, { recursive: true });
  mkdirSync(SHOT_DIR, { recursive: true });
  const log = (message) => console.log(`[browser suite] ${message}`);
  const reuse = process.env.E2E_REUSE === "1" && existsSync(STATE_FILE);

  log(`project ${cfg.ref}, run ${RUN}${reuse ? " (reusing the fixtures of the previous run)" : ""}`);
  const ctx = await createContext(cfg);
  let fx;
  let victimDeactivated = false;
  let server = null;
  const teardown = async () => {
    const results = [];
    try { results.push(`victim ${await reactivateVictim(ctx)}`); } catch (error) { results.push(`VICTIM NOT REACTIVATED: ${error.message}`); process.exitCode = 1; }
    if (process.env.E2E_KEEP !== "1") {
      try {
        const done = await removeWhatTheAppMayDelete(ctx);
        results.push(`removed through the API: ${JSON.stringify(done)}`);
      } catch (error) { results.push(`API cleanup incomplete: ${error.message}`); }
    } else results.push("E2E_KEEP=1: fixtures kept");
    stop(server?.child);
    log(`teardown: ${results.join("; ")}`);
    log("Finance, attendance, group and audit rows stay until the cleanup scripts run (scripts/e2e/README.md, \"Cleaning up\").");
  };
  try {
    await prepareAccounts(ctx);
    if (reuse) {
      const previous = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      fx = previous.fx;
      if (previous.ref !== cfg.ref) throw new Error("The kept state belongs to another project.");
    } else {
      log("seeding fixtures through the API ...");
      fx = await seed(ctx);
    }
    const status = ctx.c.admin ? (await ctx.c.admin.from("profiles").select("status").eq("id", ctx.id.victim).single()).data?.status : null;
    if (status !== "deactivated") { await deactivateVictim(ctx); victimDeactivated = true; }

    const sessions = {};
    for (const key of ACCOUNT_KEYS) {
      const { data } = await ctx.c[key].auth.getSession();
      if (!data.session) throw new Error(`no session for ${key}`);
      sessions[key] = data.session;
    }

    const port = await freePort();
    if (process.env.E2E_SKIP_BUILD === "1") log("E2E_SKIP_BUILD=1: serving the existing .next build");
    else { log("next build ... (the landing page is prerendered with the seeded public concert)"); build(cfg, port); }
    server = await start(cfg, port);
    log(`serving ${server.url} (next start, pid ${server.child.pid})`);

    const state = { baseURL: server.url, ref: cfg.ref, run: fx.run, userIds: ctx.id, sessions, fx, victimDeactivated, supabaseUrl: cfg.url, supabaseKey: cfg.key, startedAt: new Date().toISOString() };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    process.env.E2E_BASE_URL = server.url;
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
