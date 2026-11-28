#!/usr/bin/env node
// Splits app/globals.css into per-area stylesheets without changing the cascade. See scripts/css-split/README.md.
//
//   node scripts/css-split/split.mjs plan  --base <rev>               print the area of every rule, the file table, the late and dead rules
//   node scripts/css-split/split.mjs apply --base <rev> --through <n> write the files of the first n groups (n = 0 .. groups + 2:
//                                                                     groups + 1 moves the late rules and parks the unused ones,
//                                                                     groups + 2 deletes the unused ones)
//
// <rev> is the commit whose app/globals.css is the original (the analysis always starts from it, so the script can be run again at
// any stage). The class usage is read from the working tree (features/, components/, app/, lib/).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { renderEntries } from "./emit.mjs";
import { analyse, arrange, SHARED } from "./plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The first feature rule of globals.css: everything before it (Tailwind's import, @theme, @layer base, the tokens and base rules) stays in globals.css. */
const FIRST_FEATURE_RULE = ".topbar";
/** The areas in the order the files are imported when nothing forces another one (the search starts here). */
const PREFERRED = ["shared", "ui", "shell", "public", "dashboard", "announcements", "calendar", "groups", "members", "admin", "recordings", "resources", "attendance", "finance"];
/** Groups of areas, one commit each; the groups follow the import order. */
export const GROUPS = [["shared", "ui", "shell"], ["public", "dashboard", "calendar", "groups", "members"], ["admin", "announcements", "recordings", "resources"], ["attendance", "finance"]];

export function fileOfArea(area) {
  if (area === "shared") return "styles/shared.css";
  if (area === "ui") return "components/ui/ui.css";
  if (area === "late") return "styles/late.css";
  if (area === "unused") return "styles/unused.css";
  return `features/${area}/${area}.css`;
}

const TITLES = {
  shared: "Rules several areas use: the brand mark, buttons, modals, page titles, card grids, the base elements that the first block of globals.css does not cover.",
  ui: "Rules of the primitives in components/ui.",
  late: "Rules that must stay AFTER rules of other areas: each one has an equal-specificity rule written before it, in another file, that sets the same property on an element both can match. Kept in their original order, imported last.",
  unused: "Rules no source file uses (transitional: removed by the next commit).",
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[(i += 1)];
    else args._.push(argv[i]);
  }
  return args;
}

function originalCss(base) {
  const text = base ? execFileSync("git", ["show", `${base}:app/globals.css`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }) : fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "css-split-")), "globals.css");
  fs.writeFileSync(file, text);
  return { text, file };
}

/** { headText, plan, order, late, files: Map(file -> entries[]) } */
export function buildSplit(base) {
  const { text, file } = originalCss(base);
  const headNodes = postcss.parse(text).nodes.findIndex((n) => n.type === "rule" && n.selector === FIRST_FEATURE_RULE);
  if (headNodes < 1) throw new Error(`no top-level rule ${FIRST_FEATURE_RULE} in the original stylesheet`);
  const plan = analyse({ root: ROOT, cssPath: file, headNodes });
  const { order, late } = arrange(plan.live, plan.preds, PREFERRED);
  const headText = text.slice(0, plan.headEnd).trimEnd();
  const files = new Map();
  for (const area of order) files.set(area, []);
  files.set("late", []);
  files.set("unused", []);
  for (const entry of plan.entries) {
    if (entry.dead) files.get("unused").push(entry);
    else if (late.has(entry.id)) files.get("late").push(entry);
    else files.get(entry.area).push(entry);
  }
  return { headText, plan, order, late, files, text };
}

function header(area) {
  return `/* ${area}: ${TITLES[area] ?? `Rules of the ${area} area.`}\n   Imported by app/globals.css; the import order decides ties between rules of equal specificity (docs/ARCHITECTURE.md, "CSS"). */\n`;
}

const IMPORT_NOTE = "/* Feature stylesheets, next to the code that uses them. Order matters: rules of equal specificity are decided by the order they come in\n   (docs/ARCHITECTURE.md, \"CSS\"). Add a new area's file at the position its rules need, never at random. */";

/** A rule with only some dead selectors, written with the live ones only. */
function withoutDeadSelectors(entry) {
  if (entry.dead || !entry.deadSelectors?.length || entry.kind !== "rule") return entry;
  const live = entry.selectors.filter((_, i) => !entry.deadSelectors.includes(i));
  return { ...entry, raw: `${live.join(",")}${entry.raw.slice(entry.raw.indexOf("{"))}` };
}

/**
 * The files of stage `through`: groups 1..through are extracted, through = groups + 1 also moves the late rules and parks the unused
 * ones, through = groups + 2 deletes the unused rules (and the dead selectors of rules that have live ones too).
 */
export function stage(split, through) {
  const { headText, plan, order } = split;
  const removing = through > GROUPS.length + 1;
  const files = removing ? new Map([...split.files].map(([area, list]) => [area, list.map(withoutDeadSelectors)])) : split.files;
  const extractedAreas = new Set(GROUPS.slice(0, Math.min(through, GROUPS.length)).flat());
  // the extracted files come first, in the import order: the groups must be a prefix of it
  const prefix = order.slice(0, extractedAreas.size);
  if (!prefix.every((a) => extractedAreas.has(a))) throw new Error(`GROUPS do not follow the import order: ${order.join(", ")}`);
  const out = new Map();
  const importOrder = [];
  for (const area of order) {
    if (!extractedAreas.has(area)) continue;
    out.set(fileOfArea(area), `${header(area)}${renderEntries(files.get(area))}\n`);
    importOrder.push(area);
  }
  const moved = new Set(importOrder.flatMap((a) => files.get(a).map((e) => e.id)));
  let remainderEntries = plan.entries.filter((e) => !moved.has(e.id));
  if (through > GROUPS.length) {
    out.set(fileOfArea("late"), `${header("late")}${renderEntries(files.get("late"), { annotate: true })}\n`);
    importOrder.push("late");
    if (!removing) {
      out.set(fileOfArea("unused"), `${header("unused")}${renderEntries(files.get("unused"))}\n`);
      importOrder.push("unused");
    }
    remainderEntries = [];
  }
  const imports = importOrder.map((a) => `@import "${path.posix.relative("app", fileOfArea(a))}";`).join("\n");
  const parts = [headText];
  if (imports) parts.push(`${IMPORT_NOTE}\n${imports}`);
  if (remainderEntries.length) parts.push(renderEntries(remainderEntries));
  out.set("app/globals.css", `${parts.join("\n\n")}\n`);
  return out;
}

const bytes = (entries) => entries.reduce((n, e) => n + Buffer.byteLength(e.raw), 0);

function printPlan(split) {
  const { plan, order, late, files } = split;
  console.log(`rules: ${plan.entries.length} (live ${plan.live.length}, unused ${plan.entries.length - plan.live.length}); conflict edges: ${[...plan.preds.values()].reduce((n, l) => n + l.length, 0)}`);
  console.log(`import order: ${order.join(" > ")} > late > unused`);
  console.log("\nfile table (rules / bytes of rule text)");
  for (const area of [...order, "late", "unused"]) {
    const list = files.get(area);
    console.log(`  ${fileOfArea(area).padEnd(36)} ${String(list.length).padStart(5)} ${String(bytes(list)).padStart(8)}`);
  }
  console.log("\narea of every rule (id, line, area, media, selector)");
  for (const e of plan.entries) {
    const where = e.dead ? "UNUSED" : late.has(e.id) ? `LATE(${e.area})` : e.area;
    console.log(`${String(e.id).padStart(4)} L${String(e.line).padEnd(4)} ${where.padEnd(18)} ${(e.media ?? "").padEnd(34)} ${e.selectorText.slice(0, 110)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const [command] = args._;
  const split = buildSplit(args.base);
  if (command === "plan") {
    printPlan(split);
  } else if (command === "apply") {
    const through = Number(args.through);
    if (!Number.isInteger(through) || through < 0 || through > GROUPS.length + 2) throw new Error(`--through must be 0..${GROUPS.length + 2}`);
    for (const [file, content] of stage(split, through)) {
      fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, file), content);
      console.log(`wrote ${file} (${Buffer.byteLength(content)} bytes)`);
    }
  } else {
    console.error("usage: split.mjs plan|apply --base <rev> [--through <n>]");
    process.exit(2);
  }
}
export { SHARED };
