// Reads a stylesheet into an ordered list of ENTRIES: one per style rule (a rule inside @media becomes an entry of its own that
// remembers its media query), one per @keyframes, one per `@layer utilities` rule. The order of the list is the order of the cascade.
import postcss from "postcss";
import { transform } from "lightningcss";

/** Parses one selector text with lightningcss: an array of complex selectors, each an array of components. */
export function parseSelectors(selectorText) {
  let selectors = null;
  transform({
    filename: "selector.css",
    code: Buffer.from(`${selectorText}{a:b}`),
    visitor: {
      Rule: {
        style(rule) {
          selectors = rule.value.selectors;
        },
      },
    },
  });
  if (!selectors) throw new Error(`cannot parse selector: ${selectorText}`);
  return selectors;
}

/** Splits a selector list at its top-level commas (a comma inside parentheses or brackets stays). */
export function splitSelectorList(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

function declarations(rule) {
  return rule.nodes
    .filter((n) => n.type === "decl")
    .map((d) => ({ prop: d.prop.toLowerCase(), value: d.value, important: Boolean(d.important) }));
}

/**
 * Entries in source order. Each: { id, kind: "rule" | "keyframes", selectorText, selectors[] (texts), parsed[] (ASTs), decls[],
 * media (params text or null), layer ("utilities" or null), comment (raw text of the comments right before it, or ""),
 * raw (the exact source text of the rule alone), line, name (keyframes) }.
 * `head` holds the nodes before the first entry that is not Tailwind's import or @theme / @layer base (they stay in globals.css).
 */
export function readStylesheet(src, { headNodes }) {
  const root = postcss.parse(src);
  const nodes = root.nodes;
  const head = nodes.slice(0, headNodes).map((n) => src.slice(n.source.start.offset, n.source.end.offset));
  const entries = [];
  let comment = "";
  const textOf = (n) => src.slice(n.source.start.offset, n.source.end.offset);
  const push = (entry) => {
    entry.id = entries.length;
    entry.comment = comment;
    comment = "";
    entries.push(entry);
  };
  const styleRule = (rule, media, layer) => {
    const selectorText = rule.selector;
    const list = splitSelectorList(selectorText);
    push({
      kind: "rule",
      selectorText,
      selectors: list,
      parsed: list.map(parseSelectors).map((p) => p[0]),
      decls: declarations(rule),
      media,
      layer,
      raw: textOf(rule),
      line: rule.source.start.line,
    });
  };
  for (const node of nodes.slice(headNodes)) {
    if (node.type === "comment") {
      comment += `${textOf(node)}\n`;
    } else if (node.type === "rule") {
      styleRule(node, null, null);
    } else if (node.type === "atrule" && node.name === "media") {
      for (const child of node.nodes) {
        if (child.type === "comment") comment += `${textOf(child)}\n`;
        else if (child.type === "rule") styleRule(child, node.params, null);
        else throw new Error(`unexpected ${child.type} inside @media at line ${child.source.start.line}`);
      }
    } else if (node.type === "atrule" && node.name === "layer" && node.nodes) {
      for (const child of node.nodes) {
        if (child.type === "rule") styleRule(child, null, node.params);
        else throw new Error(`unexpected ${child.type} inside @layer at line ${child.source.start.line}`);
      }
    } else if (node.type === "atrule" && node.name === "keyframes") {
      push({
        kind: "keyframes",
        name: node.params,
        selectorText: `@keyframes ${node.params}`,
        selectors: [],
        parsed: [],
        decls: [],
        media: null,
        layer: null,
        raw: textOf(node),
        line: node.source.start.line,
      });
    } else {
      throw new Error(`unexpected top-level ${node.type} ${node.name ?? ""} at line ${node.source.start.line}`);
    }
  }
  const headEnd = headNodes > 0 ? nodes[headNodes - 1].source.end.offset : 0;
  return { head, headEnd, entries, trailingComment: comment };
}

/** The text of an entry as written into a file (its comment first, then the rule inside its @media / @layer). */
export function entryText(entry) {
  let text = entry.raw;
  if (entry.layer) text = `@layer ${entry.layer}{${text}}`;
  if (entry.media) text = `@media ${entry.media}{${text}}`;
  return text;
}
