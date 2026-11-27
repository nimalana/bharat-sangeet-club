// The run state written by global-setup and read by the test workers: base URL, user ids, signed-in sessions, fixture ids and titles.
import { existsSync, readFileSync } from "node:fs";
import { STATE_FILE } from "./config.mjs";

let cached = null;
export function loadState() {
  if (cached) return cached;
  if (!existsSync(STATE_FILE)) throw new Error(`No run state at ${STATE_FILE}. Run the suite with \`npm run test:browser\` (global setup creates it).`);
  cached = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return cached;
}
