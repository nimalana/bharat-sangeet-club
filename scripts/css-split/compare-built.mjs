#!/usr/bin/env node
// Compares the CSS two builds produced, as a list of declarations in cascade order.   See scripts/css-split/README.md.
//
//   node scripts/css-split/compare-built.mjs <before> <after> [--removed] [--json out.json]
//
// <before> and <after> are a built CSS file or a build folder (`.next`: the CSS file with the Tailwind layers is found in
// static/chunks). Each stylesheet is flattened to one item per declaration: `@media ... || selector || property: value`, selector
// lists split, so that the minifier merging or splitting rules does not show. Then:
//   1. the items only one side has (added / removed);
//   2. items that need a class no source file mentions match nothing: they are compared as a set (--removed: they must all be gone,
//      otherwise none may be gone), the others in order: whether the sequence is the same; if not, every pair whose order changed is
//      checked: the pair is harmless when the two items cannot disagree about one element (different specificity, no common property,
//      or no element can carry both: the same test the split used, scripts/css-split/conflicts.mjs). A changed pair that may conflict
//      is reported.
// The exit code is 1 when a used item was added or removed, a conflicting pair changed order, an unused item appeared, or the unused
// items did not behave as asked (all kept without --removed; all gone with it).
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

/** Flattens a stylesheet to items { context, selector, prop, value, important }, in order (dropShadowed() then removes the dead ones). */
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

/**
 * A declaration that a later declaration of the same property in a rule with the same selector and context always overrides does
 * nothing, and the minifier removes it when the two rules end up next to each other. Both builds are normalised the same way, so that
 * a rule that stopped being adjacent to its twin does not look like an addition. (Applied to the used and the unused items apart.)
 */
export function dropShadowed(items) {
  const later = new Map(); // context|selector|prop -> { any, important }
  const keep = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.whole) {
      keep.push(item);
      continue;
    }
    const k = `${item.context}|${item.selector}|${item.prop}`;
    const seen = later.get(k);
    if (!(seen && (item.important ? seen.important : true))) keep.push(item);
    later.set(k, { important: Boolean(seen?.important) || item.important });
  }
  return keep.reverse();
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

export function compare(beforeCss, afterCss, { usage, index }) {
  const infoOf = makeSelectorInfo(usage, index);
  // An item whose selector needs a class that no source file mentions matches nothing: its place does not matter (the unused rules
  // sit wherever the split left them until they are removed). Those items are compared as a set, the others in order.
  const flatBefore = flatten(beforeCss);
  const flatAfter = flatten(afterCss);
  // an animation is unused when only unused rules (and no source file) name it
  const animated = new Set();
  const isUnusedSelector = (item) => {
    const info = infoOf(item.selector);
    return Boolean(info.parsed) && requiredNames(info.parsed).some(({ name }) => usage.areasOf(name).size === 0);
  };
  for (const item of [...flatBefore, ...flatAfter]) {
    if (!item.whole && (item.prop === "animation" || item.prop === "animation-name") && !isUnusedSelector(item)) {
      for (const w of item.value.match(/[A-Za-z_][\w-]*/g) ?? []) animated.add(w);
    }
  }
  const isUnused = (item) => {
    if (item.context.startsWith("@layer ")) return false; // Tailwind's own layers (and the one custom utilities rule): always compared
    if (item.whole) {
      const m = /^@(?:-webkit-)?keyframes (.+)$/.exec(item.selector);
      return Boolean(m) && !animated.has(m[1]) && usage.areasOf(m[1]).size === 0;
    }
    return isUnusedSelector(item);
  };
  const before = dropShadowed(flatBefore.filter((i) => !isUnused(i)));
  const after = dropShadowed(flatAfter.filter((i) => !isUnused(i)));
  // (which selector sets which property: the minifier may or may not have dropped an overridden value, and the order is moot)
  const unusedKey = (i) => `${i.context}|${i.selector}|${i.prop}`;
  const unusedBefore = [...new Set(flatBefore.filter(isUnused).map(unusedKey))].sort();
  const unusedAfter = [...new Set(flatAfter.filter(isUnused).map(unusedKey))].sort();
  const { matched, removed, added } = pair(before, after);
  const report = { beforeItems: before.length, afterItems: after.length, matched: matched.length, removed: removed.length, added: added.length };
  report.unusedItemsBefore = unusedBefore.length;
  report.unusedItemsAfter = unusedAfter.length;
  const afterSet = new Set(unusedAfter);
  const beforeSet = new Set(unusedBefore);
  report.unusedItemsRemoved = unusedBefore.filter((k) => !afterSet.has(k)).length;
  report.unusedItemsAdded = unusedAfter.filter((k) => !beforeSet.has(k)).length;

  // order: pairs of matched items whose order changed
  const byAfter = [...matched].sort((x, y) => x.b - y.b); // in before order, with their after position
  const sameOrder = byAfter.every((m, i) => i === 0 || byAfter[i - 1].a < m.a);
  report.sameOrder = sameOrder;
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
  const report = compare(fs.readFileSync(beforeFile, "utf8"), fs.readFileSync(afterFile, "utf8"), { usage, index });
  report.before = beforeFile;
  report.after = afterFile;
  report.beforeBytes = fs.statSync(beforeFile).size;
  report.afterBytes = fs.statSync(afterFile).size;
  console.log(JSON.stringify(report, null, 2));
  if (jsonIdx !== -1) fs.writeFileSync(args[jsonIdx + 1], JSON.stringify(report, null, 2));
  const bad =
    report.added > 0 ||
    report.removed > 0 ||
    report.conflictingPairsReordered > 0 ||
    report.unusedItemsAdded > 0 ||
    (removedMode ? report.unusedItemsAfter > 0 : report.unusedItemsRemoved > 0);
  process.exit(bad ? 1 : 0);
}
