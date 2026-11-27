// Helpers for the source-reading tests (not a test file itself).
//
// A pattern that is meant to hold inside one component must be matched against that
// component's own text. Matched against the whole file, a lazy `[\s\S]*?` happily runs
// on into the next component, so the test passes when only one of two components has
// the thing it checks for.

const TOP_LEVEL_FUNCTION = /^(?:export (?:default )?)?(?:async )?function (\w+)/gm;

// The text of the top-level function `name`: from its `function` keyword to the start of
// the next top-level function (or the end of the file). Nested functions are indented
// and stay inside it.
export function functionSource(source, name) {
  const starts = [...source.matchAll(TOP_LEVEL_FUNCTION)].map((match) => ({ name: match[1], index: match.index }));
  const at = starts.findIndex((start) => start.name === name);
  if (at < 0) throw new Error(`no top-level function ${name}`);
  const end = at + 1 < starts.length ? starts[at + 1].index : source.length;
  return source.slice(starts[at].index, end);
}

// Reads from just after an opening bracket to its matching close; returns the text between.
// Strings and template literals are skipped so a bracket inside one does not count.
export function bracketed(source, openIndex) {
  const open = source[openIndex];
  const close = { "(": ")", "[": "]", "{": "}" }[open];
  if (!close) throw new Error("not an opening bracket");
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      let end = i + 1;
      while (end < source.length && source[end] !== char) end += source[end] === "\\" ? 2 : 1;
      i = end;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) { depth -= 1; if (depth === 0) return source.slice(openIndex + 1, i); }
  }
  throw new Error("unbalanced brackets");
}

// Splits at commas that are not inside brackets or strings; each part is trimmed.
export function topLevelParts(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' || char === "'" || char === "`") {
      let end = i + 1;
      while (end < text.length && text[end] !== char) end += text[end] === "\\" ? 2 : 1;
      current += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) { parts.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
