#!/usr/bin/env node
// Lint ratchet: the number of ESLint errors and warnings may go down, never up.   npm run lint:ratchet
//
// Phase 1 and 2 left 26 errors and 14 warnings that Phase 2.5 (R5) and Phase 3 clear. Until then CI must not let a new
// one in, and must say when the count dropped so that the baseline is lowered and the gain cannot be given back.
//
//   npm run lint:ratchet              run eslint, compare with lint-baseline.json, exit 1 on any increase
//   npm run lint:ratchet -- --update  after a decrease, write the lower numbers to lint-baseline.json (never raises)
//   npm run lint:ratchet -- --from report.json   judge an existing `eslint --format json` file instead of running eslint
//
// Counts, not file names: moving or splitting a file does not change a baseline, only fixing or adding a problem does.
// Ignored: dist, .next and .claude (other worktrees live there); everything else is the eslint.config.mjs as it is.
// Exit codes: 0 same or lower, 1 higher, 2 eslint could not run.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "lint-baseline.json");
const argv = process.argv.slice(2);
const from = argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : null;
const IGNORES = ["dist", ".next", ".claude/**"];

let raw;
if (from) raw = fs.readFileSync(from, "utf8");
else {
  const eslint = path.join(path.dirname(createRequire(path.join(ROOT, "package.json")).resolve("eslint/package.json")), "bin", "eslint.js");
  const args = [eslint, ".", "--format", "json", ...IGNORES.flatMap((p) => ["--ignore-pattern", p])];
  try { raw = execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { raw = error.stdout; if (!raw || !raw.trim().startsWith("[")) { console.error(`lint-ratchet: eslint could not run (exit ${error.status}):\n${error.stderr || error.message}`); process.exit(2); } }
}
let results;
try { results = JSON.parse(raw); } catch { console.error("lint-ratchet: the eslint output is not JSON"); process.exit(2); }

const errors = results.reduce((n, f) => n + f.errorCount, 0);
const warnings = results.reduce((n, f) => n + f.warningCount, 0);
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const byRule = {};
for (const f of results) for (const m of f.messages) { const k = `${m.severity === 2 ? "error  " : "warning"} ${m.ruleId || "(parse error)"}`; byRule[k] = (byRule[k] || 0) + 1; }

console.log(`ESLint: ${errors} errors, ${warnings} warnings in ${results.length} files (baseline: ${baseline.errors} errors, ${baseline.warnings} warnings)`);
for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(3)}  ${rule}`);

const worse = [];
if (errors > baseline.errors) worse.push(`errors ${baseline.errors} -> ${errors}`);
if (warnings > baseline.warnings) worse.push(`warnings ${baseline.warnings} -> ${warnings}`);
if (worse.length) {
  console.error(`\nFAIL: lint got worse (${worse.join(", ")}). Fix the new problems; run \`npx eslint . --ignore-pattern dist --ignore-pattern .next --ignore-pattern ".claude/**"\` to see them.`);
  const added = results.filter((f) => f.errorCount || f.warningCount).map((f) => `${path.relative(ROOT, f.filePath)}: ${f.errorCount} errors, ${f.warningCount} warnings`);
  console.error(`Files with problems:\n  ${added.join("\n  ")}`);
  process.exit(1);
}
if (errors < baseline.errors || warnings < baseline.warnings) {
  if (argv.includes("--update")) { fs.writeFileSync(BASELINE, JSON.stringify({ errors, warnings }, null, 2) + "\n"); console.log(`\nlint-baseline.json lowered to ${errors} errors, ${warnings} warnings.`); }
  else console.log(`\nThe count dropped (errors ${baseline.errors} -> ${errors}, warnings ${baseline.warnings} -> ${warnings}): lower the baseline so it cannot creep back: npm run lint:ratchet -- --update, and commit lint-baseline.json.`);
} else console.log("\nok: no new lint problems.");
