// Which class names do the source files use, and in which area?
//
// A class counts as USED when its name appears in any string of any source file under features/, components/, app/ or lib/:
// a string literal, a no-substitution template, the fixed parts of a template. Every word of every string counts (so the words of
// a sentence also "use" classes of that name): over-counting only keeps a rule that could have gone, it never removes a live one.
// A template such as `attendance-${status}` is dynamic: its fixed part directly touching `${}` is a PREFIX (or SUFFIX), and every
// class that starts (ends) with it is used too.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const SOURCE_DIRS = ["features", "components", "app", "lib"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

/** The area a source file belongs to: features/<area>/..., "ui" for components/ui, "app", "lib". */
export function areaOfSource(rel) {
  const parts = rel.split("/");
  if (parts[0] === "features") return parts[1];
  if (parts[0] === "components") return "ui";
  return parts[0];
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const WORD = /[A-Za-z0-9_-]+/g;

function addWords(text, add) {
  for (const word of text.match(WORD) ?? []) add(word);
}

/** The names a file imports from components/ui (by the `@/` alias or by a relative path). */
function uiImports(sf, fileName) {
  const names = new Set();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const spec = stmt.moduleSpecifier.text;
    const resolved = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(fileName), spec)) : "";
    if (!resolved.startsWith("components/ui")) continue;
    const { name, namedBindings } = stmt.importClause;
    if (name) names.add(name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) for (const el of namedBindings.elements) names.add(el.name.text);
  }
  return names;
}

/** The fixed text right before a `${}` ends in a prefix when it does not end in a space; the text right after starts a suffix. */
function edgeWords(text, before, after, addPrefix, addSuffix) {
  if (before && text.length > 0 && !/\s$/.test(text)) {
    const last = text.match(/[A-Za-z0-9_-]+$/);
    if (last) addPrefix(last[0]);
  }
  if (after && text.length > 0 && !/^\s/.test(text)) {
    const first = text.match(/^[A-Za-z0-9_-]+/);
    if (first) addSuffix(first[0]);
  }
}

/**
 * Reads one source text. Calls add(word[, area]) for every word of every string, addPrefix(p) / addSuffix(s) for the edges of a template
 * or a `"a-" + x` concatenation that meet a dynamic part.
 */
export function scanSourceText(text, fileName, add, addPrefix, addSuffix) {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const uiNames = uiImports(sf, fileName);
  const visit = (node) => {
    // `<Button className="finance-x">`: the words of a className given to a ui primitive also belong to `ui`, because the primitive
    // puts them on the same element as its own classes
    if (ts.isJsxAttribute(node) && /class/i.test(node.name.getText()) && node.initializer) {
      const owner = node.parent?.parent;
      const tag = owner && (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) ? owner.tagName.getText().split(".")[0] : "";
      if (uiNames.has(tag)) addWords(node.initializer.getText(), (w) => add(w, "ui"));
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      addWords(node.text, add);
      // `"attendance-" + status`: a string joined with something else is a prefix when it ends without a space (or a suffix when it starts so)
      const parent = node.parent;
      if (parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const other = parent.left === node ? parent.right : parent.left;
        if (!ts.isStringLiteral(other) && !ts.isNoSubstitutionTemplateLiteral(other)) {
          edgeWords(node.text, parent.right === other, parent.left === other, addPrefix, addSuffix);
        }
      }
    } else if (ts.isTemplateExpression(node)) {
      addWords(node.head.text, add);
      edgeWords(node.head.text, true, false, addPrefix, addSuffix);
      for (const span of node.templateSpans) {
        addWords(span.literal.text, add);
        const isLast = span === node.templateSpans[node.templateSpans.length - 1];
        edgeWords(span.literal.text, !isLast, true, addPrefix, addSuffix);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * Scans the source tree. Returns { areasOf(name): Set<string>, files, prefixes, suffixes } where areasOf(name) is the set of areas
 * with a file that uses the class `name` (a word, or a prefix/suffix match).
 */
export function scanSources(root, dirs = SOURCE_DIRS) {
  const words = new Map(); // word -> Set(area)
  const prefixes = new Map();
  const suffixes = new Map();
  const files = dirs.flatMap((d) => walk(path.join(root, d), []));
  const put = (map, key, area) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(area);
  };
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const area = areaOfSource(rel);
    scanSourceText(
      fs.readFileSync(file, "utf8"),
      rel,
      (w, as = area) => put(words, w, as),
      (p) => put(prefixes, p, area),
      (s) => put(suffixes, s, area),
    );
  }
  const areasOf = (name) => {
    const result = new Set(words.get(name) ?? []);
    for (const [p, areas] of prefixes) if (name.startsWith(p)) for (const a of areas) result.add(a);
    for (const [s, areas] of suffixes) if (name.endsWith(s)) for (const a of areas) result.add(a);
    return result;
  };
  return { areasOf, files: files.length, prefixes, suffixes, words };
}
