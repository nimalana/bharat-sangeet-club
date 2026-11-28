// Decides which file every rule goes to, and in which order the files are imported, so that the cascade stays the same.
//
// Every rule (entry) gets an AREA (classify.mjs); a file holds the rules of one area in their original relative order, and
// globals.css imports the files in some ORDER. Two rules that sit in different files swap places when the order puts the later one's
// file first; that is harmless only when they cannot conflict (conflicts.mjs). So:
//   * an EDGE A -> B joins two rules that may conflict, A written before B: A must still come before B;
//   * the ORDER of the areas is searched so that as few rules as possible have an edge pointing "backwards";
//   * a rule with an edge from a rule of a later area, or from a LATE rule, cannot stay with its area: it is LATE. Late rules go,
//     in their original relative order, to one file imported after all the others, so no edge points backwards any more.
import fs from "node:fs";
import { classify, SHARED } from "./classify.mjs";
import { mayConflict } from "./conflicts.mjs";
import { buildElementIndex } from "./elements.mjs";
import { scanSources } from "./sources.mjs";
import { readStylesheet } from "./stylesheet.mjs";

export { SHARED };

/** Names used by `animation` / `animation-name` declarations of a rule. */
function animationNames(entry) {
  const names = new Set();
  for (const d of entry.decls ?? []) {
    if (d.prop === "animation" || d.prop === "animation-name") for (const w of d.value.match(/[A-Za-z_][\w-]*/g) ?? []) names.add(w);
  }
  return names;
}

/** @keyframes: used by the live rules that name them (or a source file that mentions the name); used by none: dead. */
function classifyKeyframes(entries, usage) {
  for (const entry of entries) {
    if (entry.kind !== "keyframes") continue;
    const users = entries.filter((e) => e.kind === "rule" && !e.dead && animationNames(e).has(entry.name));
    const sourceAreas = usage.areasOf(entry.name);
    const areas = new Set([...users.map((u) => u.area), ...sourceAreas]);
    entry.users = users.map((u) => u.id);
    if (users.length === 0 && sourceAreas.size === 0) {
      entry.dead = true;
      entry.area = SHARED;
      entry.reason = "no live rule and no source file uses the animation";
    } else {
      entry.dead = false;
      entry.area = areas.size === 1 && !areas.has(SHARED) ? [...areas][0] : SHARED;
      entry.reason = `animation used by ${[...areas].join(", ")}`;
    }
    entry.deadSelectors = [];
    entry.contexts = [];
  }
}

/** Reads the stylesheet and the sources; returns { head, headEnd (offset), entries, live, preds, usage, index }. */
export function analyse({ root, cssPath, headNodes }) {
  const source = fs.readFileSync(cssPath, "utf8");
  const { head, headEnd, entries } = readStylesheet(source, { headNodes });
  const usage = scanSources(root);
  const index = buildElementIndex(root);
  classify(entries, usage, index);
  classifyKeyframes(entries, usage);
  const live = entries.filter((e) => !e.dead);
  const preds = new Map(live.map((e) => [e.id, []]));
  for (let j = 0; j < live.length; j += 1) {
    for (let i = 0; i < j; i += 1) if (mayConflict(live[i], live[j], index)) preds.get(live[j].id).push(live[i]);
  }
  return { head, headEnd, entries, live, preds, usage, index };
}

/** The rules that cannot stay in their area's file when the areas are imported in `order`. */
export function lateRules(live, preds, order) {
  const rank = new Map(order.map((a, i) => [a, i]));
  const late = new Set();
  for (const e of live) {
    if (preds.get(e.id).some((p) => late.has(p.id) || (p.area !== e.area && rank.get(p.area) > rank.get(e.area)))) late.add(e.id);
  }
  return late;
}

/** Finds the order of the areas that leaves the fewest rules late (hill climbing from a sensible start, deterministic). */
export function arrange(live, preds, preferred) {
  const areas = [...new Set(live.map((e) => e.area))];
  const rankPreferred = (a) => (preferred.indexOf(a) === -1 ? preferred.length : preferred.indexOf(a));
  let best = [...areas].sort((a, b) => rankPreferred(a) - rankPreferred(b) || a.localeCompare(b));
  const cost = (order) => lateRules(live, preds, order).size;
  const distance = (order) => order.reduce((n, a, i) => n + Math.abs(i - rankPreferred(a)), 0);
  let bestCost = cost(best);
  let bestDistance = distance(best);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length; i += 1) {
      for (let j = 0; j < best.length; j += 1) {
        if (i === j) continue;
        // move the area at i to position j
        const next = [...best];
        const [moved] = next.splice(i, 1);
        next.splice(j, 0, moved);
        const c = cost(next);
        const d = distance(next);
        if (c < bestCost || (c === bestCost && d < bestDistance)) {
          best = next;
          bestCost = c;
          bestDistance = d;
          improved = true;
        }
      }
    }
  }
  return { order: best, late: lateRules(live, preds, best) };
}
