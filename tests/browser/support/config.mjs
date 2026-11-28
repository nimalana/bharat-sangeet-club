// Where things are, which project the browser suite may talk to, and the guard that enforces it.
//
// The suite signs in as synthetic accounts and CREATES AND DELETES ROWS, so it refuses every project
// except the one test project (decision D7). That is stricter than scripts/e2e/lib/config.mjs, which only
// refuses the known production refs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../scripts/e2e/lib/config.mjs";

export const TEST_PROJECT_REF = "bldytniesexkwbtyinsi";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const BROWSER_DIR = path.join(ROOT, "tests/browser");
// Run output: state, server log, traces, screenshots of the current run. Override with E2E_OUT.
export const OUT = process.env.E2E_OUT ? path.resolve(process.env.E2E_OUT) : path.join(BROWSER_DIR, ".out");
export const STATE_FILE = path.join(OUT, "state.json");
// The committed visual baseline (written by `npm run test:browser:update`).
export const BASELINE_DIR = path.join(BROWSER_DIR, "__screenshots__");
export const SHOT_DIR = process.env.E2E_SHOTS === "update" ? BASELINE_DIR : path.join(OUT, "shots");

export const WIDTHS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

// SUPABASE_URL / SUPABASE_KEY, or the NEXT_PUBLIC_ pair the app itself reads. Returns the e2e config
// (url, key, ref, passwords) after the project guard has passed. Throws, never falls back.
export function browserConfig() {
  process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  process.env.SUPABASE_KEY ||= process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const cfg = loadConfig(); // refuses the production refs and a missing key or secrets file
  const url = new URL(cfg.url);
  if (url.protocol !== "https:" || url.hostname !== `${TEST_PROJECT_REF}.supabase.co`) {
    throw new Error(`Refusing to run: SUPABASE_URL is ${cfg.url}. The browser suite only runs against https://${TEST_PROJECT_REF}.supabase.co (the test project).`);
  }
  if (cfg.ref !== TEST_PROJECT_REF) throw new Error(`Refusing to run against project ${cfg.ref}.`);
  return cfg;
}

export const SESSION_KEY = `sb-${TEST_PROJECT_REF}-auth-token`;
