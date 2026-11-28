#!/usr/bin/env node
// Import boundaries: which folder may import which, and no import cycles.   npm run lint:boundaries
//
// The layers, from the top (docs/ARCHITECTURE.md, "Dependency rules"):
//
//   app/                    routing, layout; the page renders features/shell and nothing else of features/
//   features/shell/         the one place that knows every feature (session, navigation, layout)
//   features/<area>/        a screen area; imports its own folder, `ui`, `lib` and the shared feature `announcements` only
//   components/ui/          primitives; imports `lib` and itself only
//   lib/                    logic, data layer (lib/api), hooks; imports itself only
//
// A violation is a line of the form `file:line  rule  import`. The same rules run in `npm run lint:ratchet` (CI's lint step), so a
// bad import fails CI. Tests are not checked (they import whatever they exercise); neither are scripts/.
//
//   node scripts/check-boundaries.mjs              check the repository, exit 1 on a violation
//   node scripts/check-boundaries.mjs --selftest   also prove, on a throwaway tree, that each rule catches its violation
//
// Imports are read as text (`import ... from "x"`, `export ... from "x"`, `import("x")`, `require("x")`), resolved the way
// tsconfig does (relative paths and the `@/` alias); packages are ignored. `import type` counts for the layer rules (a layer must
// not even know the name of a type from above) but not for the cycle check (it is erased at build time).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED = ["app", "features", "lib", "components"];
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];
/** Feature areas that other features may import: a domain component shared by several screens. Everything else is imported by the shell only. */
export const SHARED_FEATURES = ["announcements"];

const IMPORT_FROM = /\b(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']/g;
const IMPORT_CALL = /\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

/** Where a repository path sits: { layer: "app" | "shell" | "feature" | "ui" | "lib" | "other", area? }. */
export function layerOf(rel) {
  const [top, second] = rel.split("/");
  if (top === "app") return { layer: "app" };
  if (top === "features") return second === "shell" ? { layer: "shell" } : { layer: "feature", area: second };
  if (top === "components") return { layer: "ui" };
  if (top === "lib") return { layer: "lib" };
  return { layer: "other" };
}

/** The rule a file at `from` breaks by importing `to`, or null. Rule names are stable: the selftest and the docs name them. */
export function violation(from, to) {
  const a = layerOf(from);
  const b = layerOf(to);
  if (b.layer === "other") return null;
  switch (a.layer) {
    case "lib":
      return b.layer === "lib" ? null : "lib-imports-up (lib/ imports only lib/)";
    case "ui":
      return b.layer === "lib" || b.layer === "ui" ? null : "ui-imports-up (components/ui imports only lib/ and itself)";
    case "feature":
      if (b.layer === "lib" || b.layer === "ui") return null;
      if (b.layer === "shell") return "feature-imports-shell (nothing imports features/shell but app/)";
      if (b.layer === "app") return "feature-imports-app (features do not import app/)";
      if (b.area === a.area || SHARED_FEATURES.includes(b.area)) return null;
      return `feature-imports-feature (features/${a.area} may import features/${SHARED_FEATURES.join(", features/")} only; the shell is what combines features)`;
    case "shell":
      return b.layer === "app" ? "shell-imports-app (features do not import app/)" : null;
    case "app":
      if (b.layer === "feature") return "app-imports-feature (app/ renders features/shell only)";
      return null;
    default:
      return null;
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full, out); }
    else if (EXTENSIONS.includes(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function resolveSpec(root, fromFile, spec) {
  let base;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else return null;
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => path.join(base, "index" + ext))];
  const hit = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return path.relative(root, hit ?? base).split(path.sep).join("/");
}

/** Every import of every scanned file: { file, line, spec, target, typeOnly } with repository-relative paths. */
export function readImports(root = ROOT) {
  const imports = [];
  for (const top of SCANNED) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    for (const full of walk(dir, [])) {
      const text = fs.readFileSync(full, "utf8");
      const file = path.relative(root, full).split(path.sep).join("/");
      const lineAt = (index) => text.slice(0, index).split("\n").length;
      for (const match of text.matchAll(IMPORT_FROM)) {
        const target = resolveSpec(root, full, match[3]);
        if (target) imports.push({ file, line: lineAt(match.index), spec: match[3], target, typeOnly: Boolean(match[2]) });
      }
      for (const match of text.matchAll(IMPORT_CALL)) {
        const target = resolveSpec(root, full, match[1]);
        if (target) imports.push({ file, line: lineAt(match.index), spec: match[1], target, typeOnly: false });
      }
    }
  }
  return imports;
}

/** Strongly connected components with more than one file (or a file importing itself): the import cycles. */
export function findCycles(imports) {
  const graph = new Map();
  for (const item of imports) {
    if (item.typeOnly) continue;
    if (!graph.has(item.file)) graph.set(item.file, new Set());
    graph.get(item.file).add(item.target);
  }
  let counter = 0;
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [], cycles = [];
  function visit(node) {
    index.set(node, counter); low.set(node, counter); counter += 1; stack.push(node); onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) { visit(next); low.set(node, Math.min(low.get(node), low.get(next))); }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
    }
    if (low.get(node) === index.get(node)) {
      const group = [];
      let member;
      do { member = stack.pop(); onStack.delete(member); group.push(member); } while (member !== node);
      if (group.length > 1 || graph.get(node)?.has(node)) cycles.push(group.sort());
    }
  }
  for (const node of [...graph.keys()]) if (!index.has(node)) visit(node);
  return cycles;
}

/** Check a tree: { problems: string[], files, imports }. */
export function checkBoundaries(root = ROOT) {
  const imports = readImports(root);
  const problems = [];
  for (const item of imports) {
    const rule = violation(item.file, item.target);
    if (rule) problems.push(`${item.file}:${item.line}  ${rule}  imports "${item.spec}" (${item.target})`);
  }
  for (const cycle of findCycles(imports)) problems.push(`import cycle  ${cycle.join(" <-> ")}`);
  return { problems, files: new Set(imports.map((item) => item.file)).size, imports: imports.length };
}

// The selftest builds a small tree with one example of every rule and checks that each is reported, and that the allowed imports are not.
function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boundaries-"));
  const write = (rel, text = "export const x = 1;\n") => { const full = path.join(dir, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text); };
  try {
    write("lib/a.ts"); write("lib/b.ts", 'import { x } from "./a";\nexport const y = x;\n');
    write("components/ui/button.tsx", 'import { x } from "../../lib/a";\nexport const B = x;\n');
    write("features/shell/components/portal.tsx", 'import { P } from "../../people/components/p";\nimport { N } from "../../announcements/components/n";\nimport { B } from "../../../components/ui/button";\nexport const S = [P, N, B];\n');
    write("features/people/components/p.tsx", 'import { N } from "../../announcements/components/n";\nimport { b } from "../model";\nexport const P = [N, b];\n');
    write("features/people/model.ts", "export const b = 1;\n");
    write("features/announcements/components/n.tsx", 'import { x } from "@/lib/a";\nexport const N = x;\n');
    write("app/page.tsx", 'import { S } from "../features/shell/components/portal";\nexport default S;\n');
    const clean = checkBoundaries(dir);
    const expectations = [
      ["the allowed imports pass", clean.problems.length === 0, clean.problems.join("; ")],
    ];
    const cases = [
      ["lib-imports-up", "lib/c.ts", 'import { B } from "../components/ui/button";\nexport const c = B;\n'],
      ["lib-imports-up", "lib/d.ts", 'import type { P } from "../features/people/components/p";\nexport type D = typeof P;\n'],
      ["ui-imports-up", "components/ui/dialog.tsx", 'import { N } from "../../features/announcements/components/n";\nexport const D = N;\n'],
      ["feature-imports-shell", "features/people/components/q.tsx", 'import { S } from "../../shell/components/portal";\nexport const Q = S;\n'],
      ["feature-imports-feature", "features/announcements/components/m.tsx", 'import { P } from "../../people/components/p";\nexport const M = P;\n'],
      ["feature-imports-app", "features/people/components/r.tsx", 'import Page from "../../../app/page";\nexport const R = Page;\n'],
      ["shell-imports-app", "features/shell/components/t.tsx", 'import Page from "../../../app/page";\nexport const T = Page;\n'],
      ["app-imports-feature", "app/other.tsx", 'import { P } from "../features/people/components/p";\nexport default P;\n'],
      ["lib-imports-up", "lib/e.ts", 'export const e = () => import("../features/people/model");\n'],
    ];
    for (const [rule, rel, text] of cases) {
      write(rel, text);
      const result = checkBoundaries(dir);
      expectations.push([`${rule} is reported for ${rel}`, result.problems.some((problem) => problem.startsWith(`${rel}:`) && problem.includes(rule)), result.problems.join("; ")]);
      fs.rmSync(path.join(dir, rel));
    }
    write("lib/x.ts", 'import { y } from "./y";\nexport const x2 = y;\n'); write("lib/y.ts", 'import { x2 } from "./x";\nexport const y = x2;\n');
    expectations.push(["a cycle is reported", checkBoundaries(dir).problems.some((problem) => problem.startsWith("import cycle") && problem.includes("lib/x.ts") && problem.includes("lib/y.ts")), ""]);
    write("lib/y.ts", 'import type { x2 } from "./x";\nexport const y = 1 as unknown as typeof x2;\n');
    expectations.push(["a cycle that goes through a type import only is not reported", checkBoundaries(dir).problems.length === 0, checkBoundaries(dir).problems.join("; ")]);
    let failed = 0;
    for (const [name, pass, detail] of expectations) { console.log(`${pass ? "ok  " : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`); if (!pass) failed += 1; }
    return failed === 0;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, files, imports } = checkBoundaries();
  if (problems.length) {
    console.error(`Import boundaries: ${problems.length} problem(s) in ${files} files\n  ${problems.join("\n  ")}\n\nThe rules are in docs/ARCHITECTURE.md ("Dependency rules").`);
    process.exitCode = 1;
  } else console.log(`Import boundaries ok: ${imports} imports in ${files} files, no layer rule broken, no import cycle.`);
  if (process.argv.includes("--selftest") && !selftest()) { console.error("Boundary selftest failed."); process.exitCode = 1; }
}
