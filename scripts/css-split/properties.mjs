// Which properties does a declaration set? A shorthand sets its longhands, so `margin` and `margin-left` overlap, `margin-left` and
// `margin-top` do not. A logical property (`margin-inline-start`) is taken to set both physical sides it may map to.
const SIDES = ["top", "right", "bottom", "left"];
const LOGICAL = {
  block: ["top", "bottom"],
  inline: ["left", "right"],
  "block-start": ["top"],
  "block-end": ["bottom"],
  "inline-start": ["left", "right"],
  "inline-end": ["left", "right"],
};
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

function sidesFamily(base, longhand = (side) => `${base}-${side}`) {
  const table = { [base]: SIDES.map(longhand) };
  for (const side of SIDES) table[`${base}-${side}`] = [longhand(side)];
  for (const [logical, sides] of Object.entries(LOGICAL)) table[`${base}-${logical}`] = sides.map(longhand);
  return table;
}

const BORDER_PARTS = ["width", "style", "color"];
const TABLE = {
  ...sidesFamily("margin"),
  ...sidesFamily("padding"),
  inset: SIDES,
  ...Object.fromEntries(Object.entries(LOGICAL).map(([k, v]) => [`inset-${k}`, v])),
  "scroll-margin": SIDES.map((s) => `scroll-margin-${s}`),
  "scroll-padding": SIDES.map((s) => `scroll-padding-${s}`),
  border: [...SIDES.flatMap((s) => BORDER_PARTS.map((p) => `border-${s}-${p}`)), "border-image"],
  "border-width": SIDES.map((s) => `border-${s}-width`),
  "border-style": SIDES.map((s) => `border-${s}-style`),
  "border-color": SIDES.map((s) => `border-${s}-color`),
  ...Object.fromEntries(SIDES.map((s) => [`border-${s}`, BORDER_PARTS.map((p) => `border-${s}-${p}`)])),
  ...Object.fromEntries(
    Object.entries(LOGICAL).flatMap(([k, v]) => [
      [`border-${k}`, v.flatMap((s) => BORDER_PARTS.map((p) => `border-${s}-${p}`))],
      ...BORDER_PARTS.map((p) => [`border-${k}-${p}`, v.map((s) => `border-${s}-${p}`)]),
    ]),
  ),
  "border-radius": CORNERS.map((c) => `border-${c}-radius`),
  outline: ["outline-width", "outline-style", "outline-color"],
  background: ["background-color", "background-image", "background-position", "background-size", "background-repeat", "background-origin", "background-clip", "background-attachment"],
  font: ["font-style", "font-variant", "font-weight", "font-stretch", "font-size", "line-height", "font-family"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  gap: ["row-gap", "column-gap"],
  "grid-gap": ["row-gap", "column-gap"],
  "grid-row-gap": ["row-gap"],
  "grid-column-gap": ["column-gap"],
  grid: ["grid-template-rows", "grid-template-columns", "grid-template-areas", "grid-auto-rows", "grid-auto-columns", "grid-auto-flow"],
  "grid-template": ["grid-template-rows", "grid-template-columns", "grid-template-areas"],
  "grid-area": ["grid-row-start", "grid-row-end", "grid-column-start", "grid-column-end"],
  "grid-row": ["grid-row-start", "grid-row-end"],
  "grid-column": ["grid-column-start", "grid-column-end"],
  overflow: ["overflow-x", "overflow-y"],
  transition: ["transition-property", "transition-duration", "transition-timing-function", "transition-delay", "transition-behavior"],
  animation: ["animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state"],
  "text-decoration": ["text-decoration-line", "text-decoration-style", "text-decoration-color", "text-decoration-thickness"],
  "list-style": ["list-style-type", "list-style-position", "list-style-image"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  columns: ["column-width", "column-count"],
  "-webkit-line-clamp": ["line-clamp"],
  "word-wrap": ["overflow-wrap"],
  all: ["*"],
};

/** The set of longhand keys a declaration of `prop` sets. */
export function longhands(prop) {
  const p = prop.toLowerCase();
  if (p.startsWith("--")) return [p];
  const bare = p.replace(/^-(webkit|moz|ms|o)-/, "");
  return TABLE[bare] ?? TABLE[p] ?? [bare];
}

/** Do two declaration lists set a property in common? (`all` overlaps everything.) */
export function propsOverlap(declsA, declsB) {
  const keysB = new Set(declsB.flatMap((d) => longhands(d.prop)));
  const hasAllB = keysB.has("*");
  for (const d of declsA) {
    for (const key of longhands(d.prop)) {
      if (key === "*" || hasAllB || keysB.has(key)) return true;
    }
  }
  return false;
}
