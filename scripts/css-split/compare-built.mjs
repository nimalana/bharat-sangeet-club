#!/usr/bin/env node
// Compares the CSS two builds produced, as a list of declarations in cascade order.   See scripts/css-split/README.md.
//
//   node scripts/css-split/compare-built.mjs <before> <after> [--removed] [--json out.json]
//
// <before> and <after> are a built CSS file or a build folder (`.next`: the CSS file with the Tailwind layers is found in
// static/chunks). Each stylesheet is flattened to one item per declaration: `@media ... || selector || property: value`, selector
// lists split, so that the minifier merging or splitting rules does not show. Then:
//   1. the items only one side has (added / removed);
//   2. for the items both have, whether the sequence is the same; if not, every pair whose order changed is checked: the pair is
//      harmless when the two items cannot disagree about one element (different specificity, no common property, or no element can
//      carry both: the same test the split used, scripts/css-split/conflicts.mjs). A changed pair that may conflict is reported.
// With --removed the items only `before` has must all need a class that no source file uses (the unused-rule commit).
// The exit code is 1 when anything was added, a conflicting pair changed order, or (with --removed) an item left that was not unused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { parseSelectors, splitSelectorList } from "./stylesheet.mjs";
import { selectorContext } from "./classify.mjs";
import { contextsOverlap } from "./conflicts.mjs";
import { buildElementIndex } from "./elements.mjs";
import { longhands } from "./properties.mjs";
import { compareSpec, mayShareElement, requiredNames, specificity } from "./selectors.mjs";
import { scanSources } from "./sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The CSS file of a build folder that holds the Tailwind layers (the biggest one), or the file itself. */
export function findCss(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return target;
  const candidates = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) candidates.push(full);
    }
  };
  walk(path.join(target, fs.existsSync(path.join(target, "static")) ? "static" : "."));
  const withLayers = candidates.filter((f) => fs.readFileSync(f, "utf8").includes("@layer theme"));
  if (withLayers.length !== 1) throw new Error(`expected one CSS file with the Tailwind layers under ${target}, found ${withLayers.length}`);
  return withLayers[0];
}

const squash = (s) => s.replace(/\s+/g, " ").trim();

/** Flattens a stylesheet to items { context, selector, prop, value, important, text }, in order. */
export function flatten(css) {
  const items = [];
  const walk = (nodes, context, parentSelector) => {
    for (const node of nodes) {
      if (node.type === "rule") {
        const selectors = splitSelectorList(node.selector).map((s) => (parentSelector ? (s.includes("&") ? s.replaceAll("&", parentSelector) : `${parentSelector} ${s}`) : s));
        for (const selector of selectors) {
          for (const child of node.nodes) {
            if (child.type === "decl") items.push({ context, selector: squash(selector), prop: child.prop.toLowerCase(), value: squash(child.value), important: Boolean(child.important) });
          }
        }
        const nested = node.nodes.filter((n) => n.type === "rule" || n.type === "atrule");
        if (nested.length) walk(nested, context, selectors.length === 1 ? selectors[0] : `:is(${selectors.join(",")})`);
      } else if (node.type === "atrule") {
        const name = node.name.toLowerCase();
        if (["keyframes", "-webkit-keyframes", "property", "font-face", "import", "charset", "namespace"].includes(name) || !node.nodes) {
          items.push({ context, selector: `@${name} ${squash(node.params)}`, prop: "*", value: squash(node.toString()), important: false, whole: true });
        } else {
          walk(node.nodes, `${context}@${name} ${squash(node.params)} `, parentSelector);
        }
      }
    }
  };
  walk(postcss.parse(css).nodes, "", null);
  return items;
}

const key = (item) => `${item.context}|${item.selector}|${item.prop}:${item.value}${item.important ? "!" : ""}`;

/** Per distinct selector text: its parsed form, specificity, context (elements it may match). Built lazily. */
function makeSelectorInfo(usage, index) {
  const cache = new Map();
  return (text) => {
    let info = cache.get(text);
    if (!info) {
      let parsed;
      try {
        parsed = parseSelectors(text)[0];
      } catch {
        parsed = null;
      }
      info = parsed ? { parsed, spec: specificity(parsed), ctx: selectorContext(parsed, usage, index) } : { parsed: null };
      cache.set(text, info);
    }
    return info;
  };
}

function mayConflictItems(a, b, infoOf, index) {
  if (a.whole || b.whole) return a.whole && b.whole && a.selector === b.selector;
  const ia = infoOf(a.selector);
  const ib = infoOf(b.selector);
  if (!ia.parsed || !ib.parsed) return true; // cannot read it: assume the worst
  if (compareSpec(ia.spec, ib.spec) !== 0) return false;
  if (!mayShareElement(ia.parsed, ib.parsed)) return false;
  return contextsOverlap(ia.ctx, ib.ctx, index);
}

/** The sequence of matched items: the k-th occurrence of an item in `before` is paired with the k-th in `after`. */
function pair(before, after) {
  const seen = new Map();
  const afterPositions = new Map();
  after.forEach((item, pos) => {
    const k = key(item);
    if (!afterPositions.has(k)) afterPositions.set(k, []);
    afterPositions.get(k).push(pos);
  });
  const matched = []; // { b: position in before, a: position in after }
  const removed = [];
  before.forEach((item, pos) => {
    const k = key(item);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    const list = afterPositions.get(k);
    if (list && n < list.length) matched.push({ b: pos, a: list[n] });
    else removed.push(item);
  });
  const used = new Set(matched.map((m) => m.a));
  const added = after.filter((_, pos) => !used.has(pos));
  return { matched, removed, added };
}

export function compare(beforeCss, afterCss, { usage, index, removedMode = false }) {
  const before = flatten(beforeCss);
  const after = flatten(afterCss);
  const { matched, removed, added } = pair(before, after);
  const report = { beforeItems: before.length, afterItems: after.length, matched: matched.length, removed: removed.length, added: added.length };

  // order: pairs of matched items whose order changed
  const byAfter = [...matched].sort((x, y) => x.b - y.b); // in before order, with their after position
  const sameOrder = byAfter.every((m, i) => i === 0 || byAfter[i - 1].a < m.a);
  report.sameOrder = sameOrder;
  const infoOf = makeSelectorInfo(usage, index);
  let inversions = 0;
  const conflicts = [];
  if (!sameOrder) {
    // group the matched items by the longhand properties they set: only items that share one can disagree
    const byProp = new Map();
    byAfter.forEach((m, i) => {
      const item = before[m.b];
      for (const k of item.whole ? [`whole:${item.selector}`] : longhands(item.prop)) {
        if (!byProp.has(k)) byProp.set(k, []);
        byProp.get(k).push(i);
      }
    });
    const seenPair = new Set();
    for (const list of byProp.values()) {
      for (let x = 0; x < list.length; x += 1) {
        for (let y = x + 1; y < list.length; y += 1) {
          const i = list[x];
          const j = list[y];
          if (byAfter[i].a < byAfter[j].a) continue;
          const id = i * 1e6 + j;
          if (seenPair.has(id)) continue;
          seenPair.add(id);
          inversions += 1;
          if (mayConflictItems(before[byAfter[i].b], before[byAfter[j].b], infoOf, index)) conflicts.push([before[byAfter[i].b], before[byAfter[j].b]]);
        }
      }
    }
  }
  report.movedPairsSharingAProperty = inversions;
  report.conflictingPairsReordered = conflicts.length;
  report.conflicts = conflicts.slice(0, 20).map(([a, b]) => `${key(a)}  <>  ${key(b)}`);

  // removed items must need a class no source file mentions
  const notUnused = [];
  if (removedMode) {
    for (const item of removed) {
      if (item.whole) continue;
      const info = infoOf(item.selector);
      const names = info.parsed ? requiredNames(info.parsed) : [];
      if (!names.some(({ name }) => usage.areasOf(name).size === 0)) notUnused.push(key(item));
    }
  }
  report.removedNotUnused = notUnused.slice(0, 20);
  report.removedNotUnusedCount = notUnused.length;
  report.addedSample = added.slice(0, 10).map(key);
  report.removedSample = removed.slice(0, 10).map(key);
  report.removedSelectors = [...new Set(removed.map((i) => i.selector))].length;
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  const removedMode = args.includes("--removed");
  const jsonIdx = args.indexOf("--json");
  if (files.length < 2) {
    console.error("usage: compare-built.mjs <before> <after> [--removed] [--json out.json]");
    process.exit(2);
  }
  const usage = scanSources(ROOT);
  const index = buildElementIndex(ROOT);
  const beforeFile = findCss(files[0]);
  const afterFile = findCss(files[1]);
  const report = compare(fs.readFileSync(beforeFile, "utf8"), fs.readFileSync(afterFile, "utf8"), { usage, index, removedMode });
  report.before = beforeFile;
  report.after = afterFile;
  report.beforeBytes = fs.statSync(beforeFile).size;
  report.afterBytes = fs.statSync(afterFile).size;
  console.log(JSON.stringify(report, null, 2));
  if (jsonIdx !== -1) fs.writeFileSync(args[jsonIdx + 1], JSON.stringify(report, null, 2));
  const bad = report.added > 0 || report.conflictingPairsReordered > 0 || (removedMode ? report.removedNotUnusedCount > 0 : report.removed > 0);
  process.exit(bad ? 1 : 0);
}
