#!/usr/bin/env node
// Frontend side of the contract check: finds every Supabase call in the frontend with the
// real TypeScript type checker and writes them as JSON "facts" for check.mjs.
//
//   node scripts/contract-check/extract.mjs [--frontend DIR] [--out FILE]
//
// What it extracts
//   rpc      client.rpc(name, args)             name, argument names with their TS types and literal values
//   tables   client.from(table)...              select lists, insert/update/upsert/delete payload columns,
//                                               filter/order columns and the string literals compared with them
//   storage  client.storage.from(bucket).xxx()  bucket and method; and a call of a helper listed in config.json
//                                               "storageHelpers" (uploadWithProgress), read as the storage call it stands for
//   rest     "/rest/v1/<table>?select=..."      raw PostgREST URLs (fetch with the anon key)
//   shapes   TS row types named in config.json  property names and literal unions
//
// How calls are found (nothing depends on a file name, a folder or a variable name)
//   * Every source file of the project that tsconfig.json compiles is scanned, except node_modules, .next,
//     tests, scripts, supabase, docs, build output and *.test.* / *.spec.* files. Moving code between
//     folders, or into a new folder, keeps it in scope.
//   * A receiver counts as a Supabase client when its TYPE is SupabaseClient (or derives from it), so
//     `supabase`, `client`, `sb` and `this.db` are all found. Only if the type is `any` does it fall back to
//     the variable name (supabase, client, sb, db, admin) and mark the call "untyped".
//   * A query builder kept in a variable (`let q = client.from("x").select(); q = q.eq(...)`), returned from
//     a function, or passed to another function is followed (same file for variables; call sites for
//     returns), up to a small depth.
//   * A string that is not a literal in place (table name, rpc name, bucket, select list) is resolved with
//     the type checker, through unions, const variables and function parameters (all call sites).
//
// KNOWN BLIND SPOTS. Everything the extractor cannot resolve is listed in facts.unresolved with its
// file:line, and check.mjs prints the list and its count (and fails when the count grows). It is never
// skipped silently. What is NOT covered at all:
//   * Query builders that other code assembles from descriptions (a "plan" object applied by a generic helper,
//     e.g. `applyListPlan(query, plan)`): the call is reported as "builder passed to ...", the columns inside
//     the helper are not checked.
//   * Calls through anything that is not a SupabaseClient-typed value: raw fetch() to /rest/v1 is only
//     checked when the URL and the query string are readable in one function; a second client built from
//     another library, GraphQL, edge functions (functions.invoke is listed, not checked), realtime and auth.
//   * Which role makes the call. Every table and RPC call is checked as role `authenticated`; calls made
//     while signed out (role anon) are not told apart. Raw REST URLs are checked as `anon`.
//   * The values at runtime: only string literals visible to the type checker are compared with enums and
//     CHECK lists. A value computed at runtime, or typed as plain `string`, is not.
//   * RLS policy bodies: the check sees that a permissive policy exists for the command, not what it allows.
//   * Foreign tables, other schemas (`.schema(...)`), views with INSTEAD OF triggers.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const FRONTEND = path.resolve(opt("--frontend") || process.env.FRONTEND || path.join(HERE, "..", ".."));
const OUT = opt("--out");
const config = JSON.parse(fs.readFileSync(process.env.CONTRACT_CONFIG || path.join(HERE, "config.json"), "utf8"));

const ts = (() => { try { return createRequire(path.join(FRONTEND, "package.json"))("typescript"); } catch { return createRequire(import.meta.url)("typescript"); } })();
const configPath = ts.findConfigFile(FRONTEND, ts.sys.fileExists, "tsconfig.json");
if (!configPath) { console.error(`no tsconfig.json under ${FRONTEND}`); process.exit(2); }
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, { incremental: false, noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); } });
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

// ---- which files are "the frontend" ---------------------------------------
const SKIP_TOP = new Set(["node_modules", "tests", "test", "scripts", "supabase", "docs", "public", "e2e", "dist", "out", "coverage"]);
const SKIP_ANY = new Set(["__tests__", "__mocks__", "node_modules", ".next"]);
const rel = (f) => path.relative(FRONTEND, f).split(path.sep).join("/");
function inFrontend(sf) {
  if (sf.isDeclarationFile) return false;
  const r = rel(sf.fileName);
  if (r.startsWith("..") || path.isAbsolute(r)) return false;
  const parts = r.split("/");
  if (SKIP_TOP.has(parts[0]) || parts.some((p) => SKIP_ANY.has(p) || (p.startsWith(".") && p !== "."))) return false;
  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(r);
}
const files = program.getSourceFiles().filter(inFrontend);
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const storageHelpers = new Map((config.storageHelpers || []).map((h) => [h.name, h]));
const facts = { meta: { frontend: FRONTEND, typescript: ts.version, files: files.length }, rpc: [], tables: [], storage: [], rest: [], unresolved: [], notChecked: [], otherReceivers: {}, shapes: [] };
const unresolved = (kind, sf, node, what, why) => facts.unresolved.push({ kind, file: rel(sf.fileName), line: lineOf(sf, node), what, why });

// ---- type helpers -----------------------------------------------------------
function classify(type, out = new Set()) {
  if (type.isUnion()) { type.types.forEach((t) => classify(t, out)); return out; }
  const f = type.flags;
  if (f & ts.TypeFlags.StringLike) out.add("string");
  else if (f & ts.TypeFlags.NumberLike) out.add("number");
  else if (f & ts.TypeFlags.BigIntLike) out.add("bigint");
  else if (f & ts.TypeFlags.BooleanLike) out.add("boolean");
  else if (f & ts.TypeFlags.Null) out.add("null");
  else if (f & ts.TypeFlags.Undefined) out.add("undefined");
  else if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) out.add("any");
  else if (checker.isArrayType(type) || checker.isTupleType(type)) out.add("array");
  else if (f & ts.TypeFlags.Object) out.add("object");
  else out.add("other");
  return out;
}
function literalValues(type) {
  const vals = [];
  const walk = (t) => {
    if (t.isUnion()) return t.types.forEach(walk);
    if (t.isStringLiteral()) vals.push(t.value);
    else if (t.isNumberLiteral()) vals.push(t.value);
    else if (t.flags & ts.TypeFlags.BooleanLiteral) vals.push(t.intrinsicName === "true");
    else if (t.flags & ts.TypeFlags.Null) vals.push(null);
  };
  walk(type);
  return vals;
}
function stringLiteralSet(type) {
  const values = []; let complete = true;
  const walk = (t) => { if (t.isUnion()) t.types.forEach(walk); else if (t.isStringLiteral()) values.push(t.value); else complete = false; };
  walk(type);
  return { values: [...new Set(values)], complete: complete && values.length > 0 };
}
const describe = (node) => {
  const type = checker.getTypeAtLocation(node);
  return { type: checker.typeToString(type), kinds: [...classify(type)], literals: literalValues(type) };
};
const strip = (n) => { while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n))) n = n.expression; return n; };
const merge = (a, b) => ({ values: [...new Set([...a.values, ...b.values])], complete: a.complete && b.complete, why: a.why || b.why });

function derivesFrom(type, names, depth = 0) {
  if (!type || depth > 8) return false;
  if (type.isUnion() || type.isIntersection()) return type.types.some((t) => derivesFrom(t, names, depth + 1));
  if (type.symbol && names.includes(type.symbol.name)) return true;
  if (type.aliasSymbol && names.includes(type.aliasSymbol.name)) return true;
  const target = type.target || type;
  if (target.objectFlags & (ts.ObjectFlags.Class | ts.ObjectFlags.Interface)) {
    try { return checker.getBaseTypes(target).some((b) => derivesFrom(b, names, depth + 1)); } catch { return false; }
  }
  return false;
}
// "typed" when the type is a SupabaseClient, "untyped" for an `any` receiver named like a client, else null.
function clientKind(expr) {
  const t = checker.getNonNullableType(checker.getTypeAtLocation(expr));
  if (derivesFrom(t, ["SupabaseClient"])) return "typed";
  if (t.flags & ts.TypeFlags.Any && /(^|\.)(supabase|client|sb|db|admin)$/i.test(expr.getText())) return "untyped";
  return null;
}
const isStorageApi = (expr) => derivesFrom(checker.getNonNullableType(checker.getTypeAtLocation(expr)), ["StorageClient", "SupabaseStorageClient"]);

// ---- call sites, to resolve a function parameter through its callers --------
let callSiteMap = null;
function callSites(fnNode) {
  if (!callSiteMap) {
    callSiteMap = new Map();
    for (const sf of files) {
      const visit = (n) => {
        if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
          let decl; try { decl = checker.getResolvedSignature(n)?.declaration; } catch { decl = undefined; }
          if (decl) (callSiteMap.get(decl) || callSiteMap.set(decl, []).get(decl)).push(n);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  return callSiteMap.get(fnNode) || [];
}

// The string values an expression can take. complete=false when something is not a literal.
function stringsOf(node, depth = 0) {
  if (!node) return { values: [], complete: false, why: "argument missing" };
  const typed = stringLiteralSet(checker.getTypeAtLocation(node));
  const n = strip(node);
  // A parameter typed with a wide union (`table: TableName`) is narrower at its call sites: prefer them when they are all literal.
  if (ts.isIdentifier(n) && depth < 4) {
    const decl = checker.getSymbolAtLocation(n)?.valueDeclaration;
    if (decl && ts.isParameter(decl) && decl.parent && ts.isFunctionLike(decl.parent)) {
      const fn = decl.parent, index = fn.parameters.indexOf(decl), sites = callSites(fn);
      if (sites.length) {
        let acc = { values: [], complete: true };
        for (const site of sites) {
          const argNode = site.arguments?.[index];
          acc = merge(acc, argNode ? stringsOf(argNode, depth + 1) : decl.initializer ? stringsOf(decl.initializer, depth + 1) : { values: [], complete: false, why: "argument not passed" });
        }
        if (acc.complete) return acc;
        if (!typed.complete) return { values: [...new Set([...acc.values, ...typed.values])], complete: false, why: acc.why || `a call site of ${n.text} passes a non-literal` };
      } else if (!typed.complete) return { values: typed.values, complete: false, why: `parameter ${n.text} of a function with no call site in the scanned files` };
    }
  }
  if (typed.complete) return typed;
  let result = { values: typed.values, complete: false, why: `not a literal: ${n.getText().slice(0, 70)}` };
  if (ts.isConditionalExpression(n)) return merge(stringsOf(n.whenTrue, depth), stringsOf(n.whenFalse, depth));
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) return merge(stringsOf(n.left, depth), stringsOf(n.right, depth));
  if (ts.isCallExpression(n) && depth < 4) {
    let decl; try { decl = checker.getResolvedSignature(n)?.declaration; } catch { decl = undefined; }
    if (decl && ts.isFunctionLike(decl) && decl.body && !decl.getSourceFile().isDeclarationFile && inFrontend(decl.getSourceFile())) {
      const exprs = [];
      if (!ts.isBlock(decl.body)) exprs.push(decl.body);
      else { const walk = (m) => { if (ts.isFunctionLike(m) && m !== decl) return; if (ts.isReturnStatement(m) && m.expression) exprs.push(m.expression); ts.forEachChild(m, walk); }; walk(decl.body); }
      if (exprs.length) { const acc = exprs.map((e) => stringsOf(e, depth + 1)).reduce(merge); return { values: acc.values, complete: acc.complete, why: acc.complete ? undefined : `${n.expression.getText().slice(0, 40)}(...) returns a value that is not a literal: ${acc.why || ""}`.trim() }; }
    }
  }
  return result;
}

// ---- payload keys -------------------------------------------------------------
function allProps(type) {
  const out = new Map();
  const walk = (t) => { if (t.isUnion()) return t.types.forEach(walk); for (const p of checker.getPropertiesOfType(t)) if (!out.has(p.getName())) out.set(p.getName(), p); };
  walk(type);
  return [...out.values()];
}
function payloadKeys(sf, arg) {
  const keys = []; let resolved = true; let how = "literal";
  const addLiteral = (lit) => {
    for (const p of lit.properties) {
      if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
        if (ts.isComputedPropertyName(p.name)) { resolved = false; continue; }
        const name = p.name.getText(sf).replace(/^["']|["']$/g, "");
        keys.push({ name, ...describe(ts.isPropertyAssignment(p) ? p.initializer : p.name), line: lineOf(sf, p) });
      } else if (ts.isSpreadAssignment(p)) {
        const t = checker.getTypeAtLocation(p.expression);
        const props = allProps(checker.getNonNullableType(t));
        if (!props.length && (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) resolved = false;
        for (const prop of props) {
          const pt = checker.getTypeOfSymbolAtLocation(prop, p.expression);
          keys.push({ name: prop.getName(), type: checker.typeToString(pt), kinds: [...classify(pt)], literals: literalValues(pt), line: lineOf(sf, p), viaSpread: p.expression.getText(sf).slice(0, 40) });
        }
      } else if (!ts.isMethodDeclaration(p)) resolved = false;
    }
  };
  const fromType = (node) => {
    let t = checker.getNonNullableType(checker.getTypeAtLocation(node));
    if (checker.isArrayType(t) || checker.isTupleType(t)) t = checker.getNonNullableType(checker.getTypeArguments(t)[0] || t);
    if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || checker.getIndexInfosOfType(t).length) return false;
    const props = allProps(t);
    if (!props.length) return false;
    for (const prop of props) { const pt = checker.getTypeOfSymbolAtLocation(prop, node); keys.push({ name: prop.getName(), type: checker.typeToString(pt), kinds: [...classify(pt)], literals: literalValues(pt), line: lineOf(sf, node), viaType: true }); }
    how = "type";
    return true;
  };
  const n = strip(arg);
  if (!n) return { keys, resolved: false, how: "none", text: "" };
  if (ts.isObjectLiteralExpression(n)) addLiteral(n);
  else if (ts.isArrayLiteralExpression(n)) {
    const seen = new Set();
    for (const el of n.elements) {
      const e = strip(el);
      if (e && ts.isObjectLiteralExpression(e)) { const before = keys.length; addLiteral(e); for (let i = keys.length - 1; i >= before; i--) { if (seen.has(keys[i].name)) keys.splice(i, 1); else seen.add(keys[i].name); } }
      else resolved = false;
    }
    if (!resolved) { resolved = fromType(n); }
  } else if (ts.isIdentifier(n)) {
    const decl = checker.getSymbolAtLocation(n)?.valueDeclaration;
    const init = decl && ts.isVariableDeclaration(decl) && decl.initializer ? strip(decl.initializer) : null;
    if (init && ts.isObjectLiteralExpression(init)) {
      addLiteral(init); how = "identifier";
      const visit = (m) => {
        if (ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(m.left) && ts.isIdentifier(m.left.expression) && m.left.expression.text === n.text) keys.push({ name: m.left.name.text, ...describe(m.right), line: lineOf(sf, m), conditional: true });
        ts.forEachChild(m, visit);
      };
      visit(sf);
    } else resolved = fromType(n);
  } else resolved = fromType(n);
  return { keys, resolved, how, text: n.getText(sf).slice(0, 80) };
}

// ---- following a query builder -----------------------------------------------------
// climb(node): from `node`, take the `.method(...)` calls chained on it.
function climb(node) {
  const methods = []; let cur = node;
  for (;;) {
    const p = cur.parent;
    if (p && ts.isPropertyAccessExpression(p) && p.expression === cur && p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p) { methods.push({ name: p.name.text, call: p.parent }); cur = p.parent; } else break;
  }
  return { methods, top: cur };
}
const builderLike = (type) => !!type && !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) && ["eq", "select", "order", "upload"].some((m) => checker.getPropertyOfType(checker.getNonNullableType(type), m));

// trace(start, sink): applies sink.methods(sf, methods) to every chained method found by following the
// value `start` through variables, returns and call arguments; sink.escape(sf, node, why) when it flows
// somewhere the extractor cannot follow.
function trace(sf, start, sink, depth = 0, visited = new Set()) {
  const { methods, top } = climb(start);
  if (methods.length) sink.methods(sf, methods);
  settle(sf, top, sink, depth, visited);
}
function settle(sf, top, sink, depth, visited) {
  let n = top, p = n.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isSatisfiesExpression(p))) { n = p; p = p.parent; }
  if (!p || ts.isAwaitExpression(p)) return;
  if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)) return followSymbol(sf, p.name, sink, depth, visited);
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === n) {
    if (ts.isIdentifier(p.left)) return followSymbol(sf, p.left, sink, depth, visited);
    return sink.escape(sf, n, "stored in a property or element");
  }
  if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === n)) {
    const fn = ts.isReturnStatement(p) ? ts.findAncestor(p, ts.isFunctionLike) : p;
    const contextual = checker.getContextualType(n);
    if (contextual && !builderLike(contextual) && !(contextual.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.Any | ts.TypeFlags.Unknown))) return; // the consumer expects a promise, not a builder
    if (!fn || depth >= 3) return sink.escape(sf, n, "returned from a function (nesting too deep to follow)");
    const sites = callSites(fn);
    if (!sites.length) return builderLike(checker.getTypeAtLocation(n)) ? sink.escape(sf, n, "returned from a function whose callers are not in the scanned files") : undefined;
    for (const site of sites) trace(site.getSourceFile(), site, sink, depth + 1, visited);
    return;
  }
  if (ts.isCallExpression(p) && p.arguments.includes(n)) {
    // collecting requests in an array that is awaited later (`requests.push(client.from(..).insert(..))`, Promise.all) is a consumer, not an escape
    if (ts.isPropertyAccessExpression(p.expression) && ["push", "unshift", "all", "allSettled", "race", "resolve"].includes(p.expression.name.text)) return;
    const contextual = checker.getContextualType(n);
    if (!contextual || contextual.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.Any | ts.TypeFlags.Unknown) || builderLike(contextual)) return sink.escape(sf, n, `passed to ${p.expression.getText(sf).slice(0, 40)}(...), which may add filters or columns that are not seen`);
  }
}
function followSymbol(sf, ident, sink, depth, visited) {
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym || visited.has(sym)) return;
  visited.add(sym);
  const visit = (n) => {
    if (ts.isIdentifier(n) && n !== ident && n.text === ident.text && checker.getSymbolAtLocation(n) === sym) {
      const q = n.parent;
      const isAssignTarget = ts.isBinaryExpression(q) && q.left === n && q.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (!isAssignTarget && !ts.isVariableDeclaration(q)) trace(sf, n, sink, depth, visited);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// ---- recording ----------------------------------------------------------------------------
const FILTERS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "not", "contains", "containedBy", "overlaps", "match", "or", "filter", "textSearch", "rangeGt", "rangeGte", "rangeLt", "rangeLte", "rangeAdjacent", "likeAllOf", "likeAnyOf", "ilikeAllOf", "ilikeAnyOf", "isDistinct"]);
function columnArg(sf, call, arg, kind, fact) {
  const s = stringsOf(arg);
  if (!s.complete) unresolved(kind, sf, call, fact.label, s.why || "column name is not a literal");
  return s;
}
function orColumns(sf, call) {
  const arg = call.arguments[0]; const text = arg ? arg.getText(sf) : "";
  const cols = new Set();
  const lit = arg ? stringsOf(arg) : { values: [], complete: false };
  for (const v of lit.values) for (const m of v.matchAll(/(?:^|[,(])\s*(?:not\.)?([a-z_][a-z0-9_]*)\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|fts|plfts|phfts|wfts|sl|sr|nxl|nxr|adj)\./g)) cols.add(m[1]);
  if (!lit.complete) {
    // template string built from an array of column names: `${column}.ilike.%x%` over ["a","b"].map(...)
    const arr = text.match(/\[([^\]]*)\]/);
    const fromArray = arr ? [...arr[1].matchAll(/["']([a-z_][a-z0-9_]*)["']/g)].map((m) => m[1]) : [];
    for (const c of fromArray) cols.add(c);
    for (const m of text.matchAll(/(?:^|[`"',(])\s*([a-z_][a-z0-9_]*)\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd)\./g)) cols.add(m[1]);
    if (!cols.size) unresolved("or-filter", sf, call, "or(...)", `filter string is not readable: ${text.slice(0, 70)}`);
  }
  return [...cols];
}
function recordTableMethods(fact) {
  return (sf, methods) => {
    for (const { name, call } of methods) {
      const a = call.arguments; const line = lineOf(sf, call);
      if (name === "select") {
        const s = a.length ? stringsOf(a[0]) : { values: ["*"], complete: true };
        if (!s.complete) unresolved("select-list", sf, call, fact.label, s.why || "select list is not a literal");
        fact.selects.push({ columns: s.values, complete: s.complete, line, options: a[1] ? a[1].getText(sf).slice(0, 80) : null });
      } else if (["insert", "update", "upsert"].includes(name)) {
        const k = payloadKeys(sf, a[0]);
        if (!k.resolved) unresolved("write-payload", sf, call, `${fact.label}.${name}`, `payload columns not readable (${k.text})`);
        const w = { op: name, keys: k.keys, resolved: k.resolved, how: k.how, line };
        if (name === "upsert" && a[1]) {
          const o = a[1]; const ol = strip(o);
          if (ol && ts.isObjectLiteralExpression(ol)) for (const p of ol.properties) if (ts.isPropertyAssignment(p)) {
            const key = p.name.getText(sf).replace(/^["']|["']$/g, "");
            if (key === "ignoreDuplicates") w.ignoreDuplicates = p.initializer.kind === ts.SyntaxKind.TrueKeyword;
            if (key === "onConflict") { const s = stringsOf(p.initializer); w.onConflict = s.values.flatMap((v) => v.split(",").map((x) => x.trim())).filter(Boolean); }
          }
        }
        fact.writes.push(w);
      } else if (name === "delete") fact.writes.push({ op: "delete", keys: [], resolved: true, how: "none", line });
      else if (name === "order") { const s = columnArg(sf, call, a[0], "order-column", fact); for (const c of s.values) fact.order.push({ column: c, line }); }
      else if (name === "or") for (const c of orColumns(sf, call)) fact.filters.push({ method: "or", column: c, line, fromOr: true });
      else if (name === "match") {
        const ol = strip(a[0]);
        if (ol && ts.isObjectLiteralExpression(ol)) for (const p of ol.properties) { if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) fact.filters.push({ method: "match", column: p.name.getText(sf).replace(/^["']|["']$/g, ""), line, value: describe(ts.isPropertyAssignment(p) ? p.initializer : p.name) }); }
        else unresolved("filter-column", sf, call, fact.label, `match() argument is not an object literal (${a[0] ? a[0].getText(sf).slice(0, 60) : ""})`);
      } else if (FILTERS.has(name)) {
        const s = columnArg(sf, call, a[0], "filter-column", fact);
        const value = name === "not" || name === "filter" ? a[2] : a[1];
        for (const c of s.values) {
          const f = { method: name, column: c, line };
          if (value) { f.value = describe(value); const v = strip(value); if (v && ts.isArrayLiteralExpression(v)) f.value = { ...f.value, literals: v.elements.filter(ts.isStringLiteralLike).map((e) => e.text) }; }
          fact.filters.push(f);
        }
      } else fact.other.push(name);
    }
  };
}

// ---- walk -------------------------------------------------------------------------------------
const parentIsCallee = (n) => n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n;
const NOT_A_CLIENT_FROM = /^(Array|ArrayConstructor|Buffer|BufferConstructor|Uint8Array|Int8Array|Uint16Array|Int16Array|Uint32Array|Int32Array|Float32Array|Float64Array|Set|Map|Observable|Promise|Date|String|Object)(Constructor)?$|^typeof /;
for (const sf of files) {
  const visit = (node) => {
    // `const { from, rpc } = client` and `client[x]`: the call cannot be followed
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name) && node.name.elements.some((e) => ["from", "rpc", "storage"].includes((e.propertyName || e.name).getText(sf))) && clientKind(node.initializer)) unresolved("client-alias", sf, node, "destructured client", "from/rpc/storage taken out of the client; the calls made through them are not seen");
    if (ts.isElementAccessExpression(node) && clientKind(node.expression)) unresolved("client-alias", sf, node, "client[...]", "dynamic member of the client; the call is not seen");
    if (ts.isPropertyAccessExpression(node) && ["from", "rpc"].includes(node.name.text) && !parentIsCallee(node) && clientKind(node.expression)) unresolved("client-alias", sf, node, `client.${node.name.text}`, "referenced without being called here (bound or passed on); the calls made through it are not seen");
    if (ts.isPropertyAccessExpression(node) && node.name.text === "storage" && clientKind(node.expression) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === "from")) {
      const m = ts.isPropertyAccessExpression(node.parent) ? node.parent.name.text : "";
      if (!["listBuckets", "getBucket", "createBucket", "updateBucket", "deleteBucket", "emptyBucket"].includes(m)) unresolved("client-alias", sf, node, "client.storage", "storage client used without .from(bucket) here; calls made through it are not seen");
    }

    // a storage helper (config.json "storageHelpers"): its call is the storage call, its bucket argument the bucket
    if (ts.isCallExpression(node) && storageHelpers.size) {
      const callee = ts.isIdentifier(node.expression) ? node.expression : ts.isPropertyAccessExpression(node.expression) ? node.expression.name : null;
      const helper = callee && storageHelpers.get(callee.text);
      let decl; try { decl = helper ? checker.getResolvedSignature(node)?.declaration : undefined; } catch { decl = undefined; }
      if (helper && decl && inFrontend(decl.getSourceFile())) {
        const b = stringsOf(node.arguments[helper.bucketArg]), line = lineOf(sf, node);
        const fact = { file: rel(sf.fileName), line, buckets: b.values, bucketComplete: b.complete, calls: [{ method: helper.method, line, file: rel(sf.fileName) }], label: `${helper.name}(${b.values.join("|") || node.arguments[helper.bucketArg]?.getText(sf).slice(0, 40)})` };
        if (!b.complete) unresolved("bucket", sf, node, fact.label, b.why || "bucket is not a literal");
        facts.storage.push(fact);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const recv = node.expression.expression;
      if (method === "rpc" || method === "from") {
        const kind = clientKind(recv);
        const storageApiLike = (t) => ["upload", "remove", "createSignedUrl", "createSignedUrls", "download", "list", "getPublicUrl"].some((m) => checker.getPropertyOfType(t, m));
        // `x.storage.from(bucket)` where x is a SupabaseClient, or a structural stand-in whose from() returns a file API
        const storageRecv = method === "from" && ts.isPropertyAccessExpression(recv) && recv.name.text === "storage" && (clientKind(recv.expression) || isStorageApi(recv) || storageApiLike(checker.getNonNullableType(checker.getTypeAtLocation(node))));
        if (method === "rpc" && kind) {
          const name = stringsOf(node.arguments[0]);
          const k = node.arguments[1] ? payloadKeys(sf, node.arguments[1]) : { keys: [], resolved: true, how: "none" };
          const label = `rpc(${name.values.join("|") || node.arguments[0]?.getText(sf).slice(0, 40)})`;
          if (!name.complete) unresolved("rpc-name", sf, node, label, name.why || "function name is not a literal");
          if (!k.resolved) unresolved("rpc-args", sf, node, label, `argument names not readable (${k.text})`);
          for (const nm of name.values.length ? name.values : [null]) facts.rpc.push({ file: rel(sf.fileName), line: lineOf(sf, node), name: nm, nameComplete: name.complete, args: k.keys, argsResolved: k.resolved, argsHow: k.how, untyped: kind === "untyped" || undefined });
        } else if (method === "from" && storageRecv) {
          const b = stringsOf(node.arguments[0]);
          const fact = { file: rel(sf.fileName), line: lineOf(sf, node), buckets: b.values, bucketComplete: b.complete, calls: [], label: `storage.from(${b.values.join("|") || node.arguments[0]?.getText(sf).slice(0, 40)})` };
          if (!b.complete) unresolved("bucket", sf, node, fact.label, b.why || "bucket is not a literal");
          trace(sf, node, { methods: (s, ms) => { for (const m of ms) fact.calls.push({ method: m.name, line: lineOf(s, m.call), file: rel(s.fileName) }); }, escape: (s, n, why) => unresolved("builder-escape", s, n, fact.label, why) });
          if (!fact.calls.length) unresolved("builder-escape", sf, node, fact.label, "no method called on the bucket client here");
          facts.storage.push(fact);
        } else if (method === "from" && kind) {
          const t = stringsOf(node.arguments[0]);
          const fact = { file: rel(sf.fileName), line: lineOf(sf, node), table: t.values[0] ?? null, tables: t.values, tableComplete: t.complete, selects: [], writes: [], filters: [], order: [], other: [], untyped: kind === "untyped" || undefined, label: `from(${t.values.join("|") || node.arguments[0]?.getText(sf).slice(0, 40)})` };
          if (!t.complete) unresolved("table-name", sf, node, fact.label, t.why || "table name is not a literal");
          trace(sf, node, { methods: recordTableMethods(fact), escape: (s, n, why) => unresolved("builder-escape", s, n, fact.label, why) });
          facts.tables.push(fact);
        } else if (method === "from" || method === "rpc") {
          // not a SupabaseClient: only worth a line when it looks like one (rpc is distinctive; from() must return a query builder)
          const t = checker.typeToString(checker.getTypeAtLocation(recv));
          const looksLikeBuilder = method === "rpc" || builderLike(checker.getTypeAtLocation(node));
          if (looksLikeBuilder) unresolved("unrecognised-receiver", sf, node, `${method}(${node.arguments[0]?.getText(sf).slice(0, 30) || ""})`, `receiver of type ${t.slice(0, 60)} is not a SupabaseClient, so this call is not checked`);
          else if (!NOT_A_CLIENT_FROM.test(t)) facts.otherReceivers[t.slice(0, 60)] = (facts.otherReceivers[t.slice(0, 60)] || 0) + 1;
        }
      }
      if (method === "invoke" && ts.isPropertyAccessExpression(recv) && recv.name.text === "functions" && clientKind(recv.expression)) facts.notChecked.push({ kind: "functions.invoke", file: rel(sf.fileName), line: lineOf(sf, node), what: node.arguments[0]?.getText(sf).slice(0, 60) });
      if (method === "channel" && clientKind(recv)) facts.notChecked.push({ kind: "realtime channel", file: rel(sf.fileName), line: lineOf(sf, node), what: node.arguments[0]?.getText(sf).slice(0, 60) });
    }

    // raw PostgREST URLs: "/rest/v1/<table>?select=a,b&col=eq.x" (the public concert list uses one)
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const text = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map((s) => s.literal.text).join("") : node.text;
      const m = text.match(/\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) {
        const fact = { file: rel(sf.fileName), line: lineOf(sf, node), table: m[1], select: [], selectComplete: false, filterColumns: [], orderColumns: [] };
        const fromQuery = (qs) => { for (const part of qs.split("&")) { const [k, v = ""] = part.split("="); if (k === "select") { fact.select.push(...v.split(",").map((x) => x.trim()).filter(Boolean)); fact.selectComplete = true; } else if (k === "order") fact.orderColumns.push(...v.split(",").map((x) => x.split(".")[0]).filter(Boolean)); else if (k && !["limit", "offset", "apikey", "on_conflict", "columns"].includes(k)) fact.filterColumns.push(k); } };
        const q = text.indexOf("?"); if (q >= 0) fromQuery(text.slice(q + 1).replace(/\$\{[^}]*\}/g, ""));
        const fn = ts.findAncestor(node, ts.isFunctionLike) || sf;
        const scan = (n) => {
          if (ts.isNewExpression(n) && n.expression.getText(sf) === "URLSearchParams" && n.arguments?.[0] && ts.isObjectLiteralExpression(strip(n.arguments[0]))) {
            for (const p of strip(n.arguments[0]).properties) {
              if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
              const key = p.name.getText(sf).replace(/^["']|["']$/g, ""); const v = stringsOf(ts.isPropertyAssignment(p) ? p.initializer : p.name);
              if (key === "select") { fact.select.push(...v.values.flatMap((s) => s.split(",")).map((x) => x.trim()).filter(Boolean)); fact.selectComplete = v.complete; }
              else if (key === "order") fact.orderColumns.push(...v.values.flatMap((s) => s.split(",")).map((x) => x.split(".")[0]).filter(Boolean));
              else if (!["limit", "offset", "apikey"].includes(key)) fact.filterColumns.push(key);
            }
          }
          ts.forEachChild(n, scan);
        };
        scan(fn);
        if (!fact.selectComplete) unresolved("rest-select", sf, node, `rest/v1/${m[1]}`, "select list of the raw REST URL is not readable");
        facts.rest.push(fact);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---- TypeScript shapes the code assumes ----------------------------------------------------------
const wanted = new Set([...Object.keys(config.rowTypes || {}), ...(config.rpcShapes || []).map((s) => s.alias)]);
for (const sf of files) {
  for (const stmt of sf.statements) {
    if (!(ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) || !wanted.has(stmt.name.text)) continue;
    const t = checker.getTypeAtLocation(stmt.name);
    facts.shapes.push({
      alias: stmt.name.text, file: rel(sf.fileName), line: lineOf(sf, stmt),
      props: checker.getPropertiesOfType(t).map((p) => {
        const pt = checker.getTypeOfSymbolAtLocation(p, stmt);
        const lits = []; let pure = true;
        const walk = (x) => { if (x.isUnion()) x.types.forEach(walk); else if (x.isStringLiteral()) lits.push(x.value); else if (!(x.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))) pure = false; };
        walk(pt);
        return { name: p.getName(), optional: Boolean(p.flags & ts.SymbolFlags.Optional), type: checker.typeToString(pt), literals: pure && lits.length ? lits : null };
      }),
    });
  }
}

const json = JSON.stringify(facts, null, 1);
if (OUT) fs.writeFileSync(OUT, json); else process.stdout.write(json);
