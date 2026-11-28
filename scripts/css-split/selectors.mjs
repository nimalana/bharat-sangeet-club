// What a selector needs and how strong it is, read from lightningcss's selector components.
// A selector is an array of components: { type: "class" | "id" | "type" | "universal" | "attribute" | "pseudo-class" |
// "pseudo-element" | "combinator" | "nesting", ... }.

/**
 * The classes and ids the selector REQUIRES an element of the page to carry (anywhere in the chain): those written directly in a
 * compound. Those inside :not(), :is(), :where(), :has() ... are not required (the page may well satisfy `:not(.x)` without `.x`).
 */
export function requiredNames(selector) {
  const names = [];
  for (const c of selector) {
    if (c.type === "class") names.push({ kind: "class", name: c.name });
    else if (c.type === "id") names.push({ kind: "id", name: c.name });
  }
  return names;
}

function addSpec(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function maxSpec(list) {
  return list.reduce((best, s) => (compareSpec(s, best) > 0 ? s : best), [0, 0, 0]);
}

export function compareSpec(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** [ids, classes + attributes + pseudo-classes, types + pseudo-elements]. */
export function specificity(selector) {
  let spec = [0, 0, 0];
  for (const c of selector) {
    switch (c.type) {
      case "id":
        spec = addSpec(spec, [1, 0, 0]);
        break;
      case "class":
      case "attribute":
        spec = addSpec(spec, [0, 1, 0]);
        break;
      case "type":
      case "pseudo-element":
        spec = addSpec(spec, [0, 0, 1]);
        break;
      case "pseudo-class":
        if (c.kind === "where") break;
        if (c.selectors) {
          // :not(), :is(), :has() count as their strongest argument; :nth-child(n of S) as a class plus its strongest S
          const inner = maxSpec(c.selectors.map(specificity));
          spec = addSpec(spec, c.kind === "nth-child" || c.kind === "nth-last-child" ? addSpec([0, 1, 0], inner) : inner);
        } else spec = addSpec(spec, [0, 1, 0]);
        break;
      default:
        break; // combinators, universal
    }
  }
  return spec;
}

/** The last compound of the selector (the subject: the element the rule styles), as { tag, ids, pseudoElement, hasPseudoElement }. */
export function subjectOf(selector) {
  let start = 0;
  for (let i = selector.length - 1; i >= 0; i -= 1) {
    if (selector[i].type === "combinator") {
      start = i + 1;
      break;
    }
  }
  const compound = selector.slice(start);
  const tag = compound.find((c) => c.type === "type")?.name ?? null;
  const ids = compound.filter((c) => c.type === "id").map((c) => c.name);
  const pseudoElements = compound.filter((c) => c.type === "pseudo-element").map((c) => c.kind ?? c.name ?? "?");
  const classes = compound.filter((c) => c.type === "class").map((c) => c.name);
  return { tag: tag ? tag.toLowerCase() : null, ids, pseudoElements, classes };
}

/**
 * Can one element (or one pseudo-element of an element) match both selectors? Conservative: true unless the subjects contradict
 * (two different tags, two different ids, different pseudo-elements). An ancestor chain never contradicts: a page can nest anything.
 */
export function mayShareElement(a, b) {
  const sa = subjectOf(a);
  const sb = subjectOf(b);
  if (sa.tag && sb.tag && sa.tag !== sb.tag) return false;
  if (sa.ids.length && sb.ids.length && sa.ids.join() !== sb.ids.join()) return false;
  if (sa.pseudoElements.join() !== sb.pseudoElements.join()) return false;
  return true;
}
