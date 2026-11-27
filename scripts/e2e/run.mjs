#!/usr/bin/env node
// Runs the API-level end-to-end suite against a Supabase TEST project.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=sb_publishable_... \
//   NODE_USE_ENV_PROXY=1 node scripts/e2e/run.mjs [--only groups,finance] [--json out.json]
//
// See scripts/e2e/README.md.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { createContext, RUN } from "./lib/ctx.mjs";
import { Runner } from "./lib/runner.mjs";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = (flag("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const jsonPath = flag("--json");

const SECTIONS = [
  "./tests/00-accounts.mjs",
  "./tests/10-groups.mjs",
  "./tests/20-calendar-announcements.mjs",
  "./tests/30-recordings.mjs",
  "./tests/40-resources.mjs",
  "./tests/50-attendance.mjs",
  "./tests/60-finance.mjs",
  "./tests/70-deactivation.mjs",
  "./tests/80-anon-public.mjs",
  "./tests/90-admin-delete.mjs",
];

const cfg = loadConfig();
console.log(`E2E run ${RUN} against ${cfg.ref}`);
const t = new Runner({ only });
const ctx = await createContext(cfg);
console.log(`signed in as ${Object.keys(ctx.c).length} accounts`);

for (const file of SECTIONS) {
  if (!existsSync(fileURLToPath(new URL(file, import.meta.url)))) { console.log(`(missing ${file}, skipped)`); continue; }
  const mod = await import(file);
  try {
    await mod.default(t, ctx);
  } catch (error) {
    t.record({ name: `${file} aborted`, status: "fail", error: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

const summary = t.summary();
console.log(`\n${summary.pass} passed, ${summary.fail} failed, ${summary.skip} skipped, ${summary.observation} observations (${summary.total} total)`);
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ run: RUN, project: cfg.ref, finishedAt: new Date().toISOString(), summary, results: t.results }, null, 2));
process.exit(summary.fail ? 1 : 0);
