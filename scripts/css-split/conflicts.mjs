// Can two rules disagree about the same element, so that their order matters?  Only when all of these hold:
//   1. a selector of each can match the same element: the subjects do not contradict (mayShareElement) and ONE element of the source
//      may carry every class both subjects name (elements.mjs: the className attributes; an element a screen hands to a ui primitive
//      carries both what the screen passes and what the primitive adds),
//   2. those two selectors have the same specificity (a stronger selector wins in any order),
//   3. the two rules set an overlapping property (the same property, or a shorthand and one of its longhands).
// Everything else (media queries, !important, the page's actual data) is ignored on purpose: the answer is "may conflict" whenever
// the check cannot prove otherwise.
import { propsOverlap } from "./properties.mjs";
import { compareSpec, mayShareElement, specificity } from "./selectors.mjs";

/** Can an element of area `inner` sit inside an element of area `outer`, or the other way round? */
function nestable(index, a, b) {
  return a === b || index.contain.get(a)?.has(b) || index.contain.get(b)?.has(a) || false;
}

/** Can the ancestors both selectors name be on one chain above one element of area `area` (null: any area)? */
function ancestorsFit(ca, cb, area, index) {
  const all = [...ca.ancestors, ...cb.ancestors];
  const insideOf = (anc) => [...anc.areas].some((a) => area === null || index.contain.get(a)?.has(area) || a === area);
  if (!all.every(insideOf)) return false;
  for (const x of ca.ancestors) {
    for (const y of cb.ancestors) {
      if (x.name === y.name) continue;
      if (![...x.areas].some((a) => [...y.areas].some((b) => nestable(index, a, b)))) return false;
    }
  }
  return true;
}

/** Can one element be matched by both selector contexts? (see selectorContext) */
export function contextsOverlap(ca, cb, index) {
  if (ca.elements && cb.elements) {
    const [small, big] = ca.elements.size <= cb.elements.size ? [ca.elements, cb.elements] : [cb.elements, ca.elements];
    for (const id of small) if (big.has(id) && ancestorsFit(ca, cb, index.elements[id].area, index)) return true;
    return false;
  }
  if (!ca.elements && !cb.elements) {
    if (!ca.chainAreas || !cb.chainAreas) return true;
    return [...ca.chainAreas].some((a) => cb.chainAreas.has(a));
  }
  // one subject names no class: it matches an element of its tag that lives under its chain, in one of the areas
  const [bare, classed] = ca.elements ? [cb, ca] : [ca, cb];
  for (const id of classed.elements) {
    const e = index.elements[id];
    if (bare.tag && e.tag && e.tag !== bare.tag) continue;
    if (!bare.chainAreas || bare.chainAreas.has(e.area) || e.area === "ui") return true;
  }
  return false;
}

/** True when the order of rule a and rule b can change what an element looks like. */
export function mayConflict(a, b, index) {
  if (a.kind === "keyframes" || b.kind === "keyframes") return a.kind === b.kind && a.name === b.name;
  if (a.layer || b.layer) return false; // a layered rule loses to every unlayered one (and the reverse for !important): order against them is moot
  if (!propsOverlap(a.decls, b.decls)) return false;
  for (let i = 0; i < a.parsed.length; i += 1) {
    if (a.deadSelectors?.includes(i)) continue;
    const sa = specificity(a.parsed[i]);
    for (let j = 0; j < b.parsed.length; j += 1) {
      if (b.deadSelectors?.includes(j)) continue;
      if (
        compareSpec(sa, specificity(b.parsed[j])) === 0 &&
        mayShareElement(a.parsed[i], b.parsed[j]) &&
        contextsOverlap(a.contexts[i], b.contexts[j], index)
      ) {
        return true;
      }
    }
  }
  return false;
}
