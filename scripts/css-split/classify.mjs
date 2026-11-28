// Gives every entry an area, and says which selectors can never match anything.
import { requiredNames, subjectOf } from "./selectors.mjs";

export const SHARED = "shared";

/** The areas whose elements carry the class (or, for a class no element carries, the areas whose files mention it). */
export function areasOfClass(name, usage, index) {
  const carried = index.carriers.get(name);
  if (carried && carried.size) return new Set([...carried].map((id) => index.elements[id].area));
  return usage.areasOf(name);
}

/**
 * The elements that may carry the class. A class that no className can produce (a word that only appears in other strings, such as
 * an event name) is on no element, so no rule needing it can match anything, and the order of such a rule is moot.
 */
function carriersOf(name, index) {
  return index.carriers.get(name) ?? new Set();
}

/**
 * For one selector: { elements: Set of element ids that may match its subject (null: any element of the tag), tag,
 * chainAreas: areas of the page the subject may live in when the subject itself names no class (null: anywhere) }.
 */
export function selectorContext(selector, usage, index) {
  const subject = subjectOf(selector);
  // a class no element carries anywhere in the chain: the selector matches nothing
  if (requiredNames(selector).some(({ name }) => !(index.carriers.get(name)?.size > 0))) {
    return { elements: new Set(), tag: subject.tag, chainAreas: null, ancestors: [] };
  }
  if (subject.classes.length) {
    let set = null;
    for (const name of subject.classes) {
      const carried = carriersOf(name, index);
      set = set === null ? new Set(carried) : new Set([...set].filter((id) => carried.has(id)));
    }
    if (subject.tag) {
      set = new Set([...set].filter((id) => index.elements[id].tag === null || index.elements[id].tag === subject.tag));
    }
    return { elements: set, tag: subject.tag, chainAreas: null, ancestors: ancestorsOf(selector, usage, index) };
  }
  const chain = requiredNames(selector);
  let areas = null;
  for (const { name } of chain) {
    const here = areasOfClass(name, usage, index);
    areas = areas === null ? new Set(here) : new Set([...areas].filter((a) => here.has(a)));
  }
  return { elements: null, tag: subject.tag, chainAreas: areas && areas.size ? areas : null, ancestors: [] };
}

/** The classes written before the subject compound (its ancestors and siblings), each with the areas that carry it. */
function ancestorsOf(selector, usage, index) {
  let start = 0;
  for (let i = selector.length - 1; i >= 0; i -= 1) {
    if (selector[i].type === "combinator") {
      start = i;
      break;
    }
  }
  return requiredNames(selector.slice(0, start)).map(({ name }) => ({ name, areas: areasOfClass(name, usage, index) }));
}

/**
 * The area of one selector: the area whose elements carry all of its classes that are NOT common (a class carried in two or more
 * areas, such as `primary` or `modal`, is common). A selector whose classes are all common, that names no class, or whose own
 * classes belong to different areas has no area (null): it is shared.
 */
function selectorArea(selector, usage, index) {
  let set = null;
  for (const { name } of requiredNames(selector)) {
    const areas = areasOfClass(name, usage, index);
    if (areas.size >= 2) continue; // common
    set = set === null ? new Set(areas) : new Set([...set].filter((a) => areas.has(a)));
  }
  return set && set.size === 1 ? [...set][0] : null;
}

/**
 * For each entry sets:
 *   entry.area           the one area its selectors belong to, or SHARED (ambiguous rules stay shared)
 *   entry.deadSelectors  indexes of selectors that need a class no source file mentions
 *   entry.dead           true when every selector of a rule is dead
 *   entry.contexts       per selector, selectorContext(...)
 *   entry.reason         short text: how the area was decided
 * Keyframes are classified by the caller (they have no selectors).
 */
export function classify(entries, usage, index) {
  for (const entry of entries) {
    if (entry.kind === "keyframes") continue;
    entry.contexts = entry.parsed.map((selector) => selectorContext(selector, usage, index));
    entry.deadSelectors = [];
    entry.parsed.forEach((selector, i) => {
      if (requiredNames(selector).some(({ name }) => usage.areasOf(name).size === 0)) entry.deadSelectors.push(i);
    });
    entry.dead = entry.deadSelectors.length === entry.parsed.length;
    if (entry.dead) {
      entry.area = SHARED;
      entry.reason = "no class of any selector is used";
      continue;
    }
    const live = entry.parsed.filter((_, i) => !entry.deadSelectors.includes(i));
    const areas = live.map((selector) => selectorArea(selector, usage, index));
    const first = areas[0];
    if (first && areas.every((a) => a === first)) {
      entry.area = first;
      entry.reason = "its own classes are carried by one area";
    } else {
      entry.area = SHARED;
      entry.reason = areas.some((a) => a === null)
        ? "a selector uses only classes several areas carry, or none"
        : `selectors of different areas (${[...new Set(areas)].join(", ")})`;
    }
  }
  return entries;
}
