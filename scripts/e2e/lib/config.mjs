// Configuration. Nothing secret lives in the repository:
//   SUPABASE_URL   https://<ref>.supabase.co  (the TEST project)
//   SUPABASE_KEY   the publishable key (sb_publishable_...) or the legacy anon key
//   E2E_SECRETS    path of the JSON file holding the generated test-account passwords
//                  (default /tmp/claude-0/e2e/secrets.json, see gen-setup-sql.mjs)
import { existsSync, readFileSync } from "node:fs";

// Project refs that must never be tested against. The suite creates and deletes rows.
const FORBIDDEN_REFS = ["zykujvpioxkktqppeqpu", "sjttgtgansczssmyprlf"];

export function loadConfig() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_KEY || "";
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_KEY (the publishable key of the TEST project).");
  const ref = new URL(url).hostname.split(".")[0];
  if (FORBIDDEN_REFS.includes(ref)) throw new Error(`Refusing to run against ${ref}: that is not a test project.`);
  if (process.env.E2E_PROJECT_REF && process.env.E2E_PROJECT_REF !== ref) {
    throw new Error(`E2E_PROJECT_REF=${process.env.E2E_PROJECT_REF} does not match SUPABASE_URL (${ref}).`);
  }
  const secretsPath = process.env.E2E_SECRETS || "/tmp/claude-0/e2e/secrets.json";
  if (!existsSync(secretsPath)) throw new Error(`Secrets file ${secretsPath} not found. Run scripts/e2e/gen-setup-sql.mjs first.`);
  const secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
  return { url, key, ref, passwords: secrets.passwords || {}, secretsPath };
}
