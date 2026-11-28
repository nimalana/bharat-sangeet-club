// Which classes can sit together on ONE element? Read from the `className` of every JSX element (typescript's checker resolves a
// constant or a union of literal types to the strings it can hold).
//
// An ELEMENT here is one `className` attribute: { id, file, area, tag, words (classes it may carry), open }.
//   * a string, a template with literal parts, `cond ? "a" : "b"`, `cn("a", x && "b")`: the words are exactly the literals;
//   * `a-${status}` with `status` a union of literal types: the words are the expansions;
//   * anything the checker cannot bound (a plain `string`): the element is OPEN, it may carry any word of its area's files;
//   * `<Button className="finance-x">` on a ui primitive: one more element that carries the passed words AND the classes the
//     primitive puts on the element that receives its `className`.
// Two rules can match one element only if one element carries every class both subjects name (see conflicts.mjs).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { areaOfSource } from "./sources.mjs";

const WORD = /[A-Za-z0-9_-]+/g;
const MAX_COMBINATIONS = 400;

function wordsOf(text) {
  return text.match(WORD) ?? [];
}

/** Every string a piece of text can become when `${}` parts take their possible values: a list of strings, or null if unbounded. */
function product(parts) {
  let acc = [""];
  for (const options of parts) {
    if (options === null) return null;
    const next = [];
    for (const a of acc) for (const o of options) next.push(a + o);
    if (next.length > MAX_COMBINATIONS) return null;
    acc = next;
  }
  return acc;
}

function createProgram(root) {
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true, incremental: false } });
}

/** The possible string values of an expression, or null when the checker cannot bound them. */
function literalValues(checker, node) {
  const type = checker.getTypeAtLocation(node);
  const out = [];
  const visit = (t) => {
    if (t.isStringLiteral()) {
      out.push(t.value);
      return true;
    }
    if (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void | ts.TypeFlags.Never)) return true;
    if (t.flags & ts.TypeFlags.BooleanLiteral) return true;
    if (t.isUnion()) return t.types.every(visit);
    return false;
  };
  return visit(type) ? out : null;
}

/**
 * Possible class text of an expression: { values: string[] | null (whole strings it may take), unbounded: boolean }.
 * `values` null with `unbounded` true means: some part is a plain string the checker cannot bound.
 */
function candidates(checker, node, ctx) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression?.(node)) {
    return candidates(checker, node.expression, ctx);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    const parts = [[node.head.text]];
    for (const span of node.templateSpans) {
      parts.push(candidates(checker, span.expression, ctx));
      parts.push([span.literal.text]);
    }
    const result = product(parts);
    if (result === null) ctx.open = true;
    return result ?? parts.flatMap((p) => p ?? []);
  }
  if (ts.isConditionalExpression(node)) return [...candidates(checker, node.whenTrue, ctx), ...candidates(checker, node.whenFalse, ctx)];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return candidates(checker, node.right, ctx);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...candidates(checker, node.left, ctx), ...candidates(checker, node.right, ctx)];
    }
    if (op === ts.SyntaxKind.PlusToken) {
      const result = product([candidates(checker, node.left, ctx), candidates(checker, node.right, ctx)]);
      return result ?? [];
    }
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((e) => candidates(checker, e, ctx));
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    // cn(...), clsx(...), classNames(...), [..].filter(Boolean).join(" ")
    if (ts.isIdentifier(callee) && ["cn", "clsx", "classNames", "twMerge"].includes(callee.text)) {
      return node.arguments.flatMap((a) => candidates(checker, a, ctx));
    }
    if (ts.isPropertyAccessExpression(callee) && ["join", "filter", "trim"].includes(callee.name.text)) {
      return candidates(checker, callee.expression, ctx);
    }
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((p) => (p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) ? [p.name.text] : []));
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.TrueKeyword) return [];
  if (ts.isIdentifier(node) && node.text === "undefined") return [];
  // a CSS-module class (`styles.card`) is scoped to its file: it can never carry a global class
  if (isModuleStyle(checker, node)) return [];
  // the `className` parameter of a component: the callers' words are added at the call sites
  if (ts.isIdentifier(node) && node.text === "className") {
    ctx.receivesProp = true;
    return [];
  }
  const values = literalValues(checker, node);
  if (values) return values;
  // a `status` column typed `string`: one of the values the migrations allow (check (status in (...)))
  if (ctx.statusValues && (ts.isIdentifier(node) ? node.text === "status" : ts.isPropertyAccessExpression(node) && node.name.text === "status")) {
    const passed = ts.isIdentifier(node) ? propOfComponent(checker, node, ctx) : null;
    return passed ?? ctx.statusValues;
  }
  // a prop of a function component typed `string` (`function Badge({ status }: { status: string })`): what its callers pass
  const passed = propOfComponent(checker, node, ctx);
  if (passed) return passed;
  // a constant declared with a value (`const variants: Record<V, string> = { a: "x", b: "y" }`): everything it can hold
  const init = resolveInitializer(checker, node);
  if (init && (ctx.depth ?? 0) < 6) {
    ctx.depth = (ctx.depth ?? 0) + 1;
    const found = ts.isObjectLiteralExpression(unwrap(init))
      ? unwrap(init).properties.flatMap((p) => (ts.isPropertyAssignment(p) ? candidates(checker, p.initializer, ctx) : []))
      : candidates(checker, init, ctx);
    ctx.depth -= 1;
    return found;
  }
  ctx.open = true;
  return [];
}

/** Candidates of the expressions JSX callers pass for the destructured prop `node` names; null when it is not such a prop or unbounded. */
function propOfComponent(checker, node, ctx) {
  if (!ts.isIdentifier(node) || !ctx.usages || (ctx.depth ?? 0) >= 6) return null;
  const decl = checker.getSymbolAtLocation(node)?.valueDeclaration;
  if (!decl || !ts.isBindingElement(decl) || !ts.isObjectBindingPattern(decl.parent)) return null;
  const param = decl.parent.parent;
  const fn = param && ts.isParameter(param) ? param.parent : null;
  if (!fn || !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return null;
  const name = ts.isFunctionDeclaration(fn) ? fn.name?.text : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null;
  if (!name) return null;
  const attr = (decl.propertyName ?? decl.name).getText();
  const uses = (ctx.usages.get(name) ?? []).map((u) => u.get(attr)).filter(Boolean);
  if (!uses.length) return null;
  const inner = { open: false, usages: ctx.usages, statusValues: ctx.statusValues, depth: (ctx.depth ?? 0) + 1 };
  const out = uses.flatMap((expr) => candidates(checker, expr, inner));
  return inner.open ? null : out;
}

function unwrap(node) {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression?.(n)) n = n.expression;
  return n;
}

/** The initializer of the `const` an identifier (or `x[...]` / `x.y` rooted at one) names, in this or another file. */
function resolveInitializer(checker, node) {
  let base = node;
  while (ts.isElementAccessExpression(base) || ts.isPropertyAccessExpression(base)) base = base.expression;
  if (!ts.isIdentifier(base)) return null;
  let symbol = checker.getSymbolAtLocation(base);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const decl = symbol?.valueDeclaration;
  if (decl && ts.isVariableDeclaration(decl) && decl.initializer && decl.parent.flags & ts.NodeFlags.Const) return decl.initializer;
  return null;
}

function isModuleStyle(checker, node) {
  let n = node;
  while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = n.expression;
  if (!ts.isIdentifier(n)) return false;
  const symbol = checker.getSymbolAtLocation(n);
  const decl = symbol?.declarations?.[0];
  if (!decl || !ts.isImportClause(decl)) return false;
  const spec = decl.parent.moduleSpecifier.text;
  return spec.endsWith(".module.css");
}

/** The words of every `status in ('a', 'b')` list of the migrations: what a status column may hold. */
export function readStatusValues(root) {
  const dir = path.join(root, "supabase", "migrations");
  const values = new Set();
  if (!fs.existsSync(dir)) return [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".sql")) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    for (const m of text.matchAll(/status\s+in\s*\(([^)]*)\)/gi)) for (const w of m[1].match(/'([a-z_]+)'/g) ?? []) values.add(w.slice(1, -1));
  }
  return [...values].sort();
}

/** Builds the element index of the source tree under `root`. */
export function buildElementIndex(root, dirs = ["features", "components", "app"]) {
  const program = createProgram(root);
  const checker = program.getTypeChecker();
  const elements = [];
  const areaWords = new Map(); // area -> Set(word) for open elements
  const callSites = []; // { element index, target file }
  const contain = new Map(); // area -> Set(areas whose components may be rendered inside an element of this area)
  const allow = (outer, inner) => {
    if (!contain.has(outer)) contain.set(outer, new Set([outer]));
    contain.get(outer).add(inner);
  };

  const statusValues = readStatusValues(root);
  const usages = new Map();
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes("node_modules") || !/\.tsx$/.test(sf.fileName)) continue;
    const collect = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText();
        if (/^[A-Z]/.test(tag)) {
          const attrs = new Map();
          for (const a of node.attributes.properties) {
            if (!ts.isJsxAttribute(a) || !a.initializer) continue;
            attrs.set(a.name.getText(), ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer);
          }
          if (!usages.has(tag)) usages.set(tag, []);
          usages.get(tag).push(attrs);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);
  }

  const rel = (sf) => path.relative(root, sf.fileName).split(path.sep).join("/");
  const inScope = (r) => dirs.some((d) => r.startsWith(`${d}/`)) && /\.(tsx|ts)$/.test(r) && !r.endsWith(".d.ts");

  for (const sf of program.getSourceFiles()) {
    const file = rel(sf);
    if (!inScope(file)) continue;
    const area = areaOfSource(file);
    // words of the whole file: what an open element of the area may carry
    const known = areaWords.get(area) ?? new Set();
    areaWords.set(area, known);
    const importTarget = new Map();
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const spec = stmt.moduleSpecifier.text;
      const resolved = ts.resolveModuleName(spec, sf.fileName, program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved) continue;
      const target = path.relative(root, resolved).split(path.sep).join("/");
      const { name, namedBindings } = stmt.importClause;
      if (name) importTarget.set(name.text, target);
      if (namedBindings && ts.isNamedImports(namedBindings)) for (const el of namedBindings.elements) importTarget.set(el.name.text, target);
      // a file may render what it imports inside its own elements
      if (inScope(target)) allow(area, areaOfSource(target));
    }
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) for (const w of wordsOf(node.text)) known.add(w);
      // `<Dialog>...children...</Dialog>`: the component's elements contain what the caller puts between the tags
      if (ts.isJsxElement(node) && node.children.some((c) => !ts.isJsxText(c) || c.text.trim())) {
        const tagName = node.openingElement.tagName.getText().split(".")[0];
        const target = /^[A-Z]/.test(tagName) ? importTarget.get(tagName) : null;
        if (target && inScope(target)) allow(areaOfSource(target), area);
      }
      if (ts.isJsxAttribute(node) && node.name.getText() === "className" && node.initializer) {
        const opening = node.parent.parent;
        const tagName = opening.tagName.getText();
        const isComponent = /^[A-Z]/.test(tagName);
        const ctx = { open: false, receivesProp: false, usages, statusValues };
        let expr = node.initializer;
        if (ts.isJsxExpression(expr)) expr = expr.expression;
        const values = expr ? candidates(checker, expr, ctx) : [];
        const words = new Set(values.flatMap(wordsOf));
        const target = isComponent ? importTarget.get(tagName.split(".")[0]) : null;
        const id = elements.length;
        elements.push({ id, file, area, tag: isComponent ? null : tagName.toLowerCase(), words, open: ctx.open, receivesProp: ctx.receivesProp, ui: false });
        if (isComponent && target?.startsWith("components/ui/")) callSites.push({ id, target });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // `<Button className="x">`: the element that receives the prop carries the primitive's own classes too
  for (const { id, target } of callSites) {
    const own = elements.filter((e) => e.file === target && e.receivesProp);
    const pool = own.length ? own : elements.filter((e) => e.file === target);
    for (const e of pool) for (const w of e.words) elements[id].words.add(w);
    elements[id].ui = true;
  }

  // open elements may carry any class of their area
  for (const e of elements) if (e.open) for (const w of areaWords.get(e.area) ?? []) e.words.add(w);

  const carriers = new Map(); // class -> Set(element id)
  for (const e of elements) {
    for (const w of e.words) {
      let set = carriers.get(w);
      if (!set) carriers.set(w, (set = new Set()));
      set.add(e.id);
    }
  }
  // the shell and the root layout render every screen; ui primitives (dialogs, panels) wrap whatever a screen gives them
  const areas = [...new Set(elements.map((e) => e.area))];
  for (const outer of ["shell", "app", "ui"]) for (const inner of areas) allow(outer, inner);
  return { elements, carriers, areaWords, statusValues, contain };
}

export function describeIndex(index) {
  const open = index.elements.filter((e) => e.open);
  return `${index.elements.length} className attributes, ${open.length} open (${[...new Set(open.map((e) => e.file))].length} files)`;
}
