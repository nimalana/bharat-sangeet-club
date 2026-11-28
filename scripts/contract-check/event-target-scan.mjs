#!/usr/bin/env node
// Static scan kept from the Phase 1 and 2 review (issue P1-08): reports every read of `<event>.currentTarget`
// that comes after an `await` in the same function. React clears currentTarget when the handler returns, so a
// read after an await is null at runtime and the handler throws only in the browser.
//
//   node scripts/contract-check/event-target-scan.mjs [--frontend DIR]
//
// Scans the same files as extract.mjs (every file the tsconfig compiles, wherever it lives), exit 1 on a hit.
// Blind spot: only direct `.currentTarget` property reads in the function that awaits; an event object handed to
// another async function and read there is not followed.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const i = argv.indexOf("--frontend");
const FRONTEND = path.resolve((i >= 0 && argv[i + 1]) || process.env.FRONTEND || path.join(HERE, "..", ".."));
const ts = (() => { try { return createRequire(path.join(FRONTEND, "package.json"))("typescript"); } catch { return createRequire(import.meta.url)("typescript"); } })();
const configPath = ts.findConfigFile(FRONTEND, ts.sys.fileExists, "tsconfig.json");
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, { incremental: false, noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const program = ts.createProgram(parsed.fileNames, parsed.options);
const SKIP_TOP = new Set(["node_modules", "tests", "test", "scripts", "supabase", "docs", "public", "e2e", "dist", "out", "coverage"]);
let bad = 0, total = 0;
for (const sf of program.getSourceFiles()) {
  const r = path.relative(FRONTEND, sf.fileName).split(path.sep);
  if (sf.isDeclarationFile || r[0] === ".." || SKIP_TOP.has(r[0]) || r.some((p) => p.startsWith(".") || p === "__tests__") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(sf.fileName)) continue;
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const awaits = [], uses = [];
      const walk = (n) => {
        if (n !== node.body && ts.isFunctionLike(n)) return; // inner functions are checked on their own
        if (ts.isAwaitExpression(n)) awaits.push(n.getStart(sf));
        if (ts.isPropertyAccessExpression(n) && n.name.text === "currentTarget") uses.push(n);
        ts.forEachChild(n, walk);
      };
      walk(node.body);
      for (const u of uses) {
        total++;
        const firstAwait = awaits.length ? Math.min(...awaits) : Infinity;
        if (u.getStart(sf) > firstAwait) { bad++; const { line } = sf.getLineAndCharacterOfPosition(u.getStart(sf)); console.log(`AFTER AWAIT  ${path.relative(FRONTEND, sf.fileName)}:${line + 1}  ${u.getText(sf).slice(0, 80)}`); }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
console.log(`${total} currentTarget reads checked, ${bad} after an await`);
process.exit(bad ? 1 : 0);
