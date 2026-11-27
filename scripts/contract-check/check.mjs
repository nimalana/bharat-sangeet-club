#!/usr/bin/env node
// Database side of the contract check: compares the frontend facts (extract.mjs) with the replayed database.
//
//   PGHOST=<socket dir> PGPORT=<port> PGUSER=postgres node scripts/contract-check/check.mjs facts.json [--json report.json]
//
// A FAIL is something the running app would hit as an error, a refused write or an empty result:
//   * a table, view, column, RPC, RPC argument name, enum value / CHECK value or storage bucket the frontend
//     uses that does not exist in the replayed database;
//   * a write (insert / update / upsert / delete) to a table, or a column, that role `authenticated` has no
//     privilege for (the least-privilege migration made most tables SELECT-only), or a table whose RLS has no
//     permissive policy for that command;
//   * an RPC that `authenticated` cannot EXECUTE, an argument set no overload accepts, a missing required argument;
//   * a storage call for which no storage.objects policy mentions the bucket for that command.
// WARN is worth reading and does not fail. INFO is context. ACCEPTED is a FAIL listed in config.json "accepted"
// with its reason. UNRESOLVED lists what the extractor could not read (see the blind spots in extract.mjs); their
// count may not exceed config.json "maxUnresolved". Exit code 1 on any FAIL.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const factsPath = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--json") || "facts.json";
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
const config = JSON.parse(fs.readFileSync(process.env.CONTRACT_CONFIG || path.join(HERE, "config.json"), "utf8"));

function sql(query) {
  try {
    return execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", process.env.PGDATABASE || "postgres", "-c", query], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    console.error(`cannot read the replayed database (PGHOST=${process.env.PGHOST} PGPORT=${process.env.PGPORT}): ${String(error.stderr || error.message).trim().split("\n")[0]}`);
    process.exit(2);
  }
}
const sqlJson = (query) => JSON.parse(sql(`select coalesce(json_agg(t), '[]'::json) from (${query}) t`));

const findings = [];
const add = (level, key, where, message) => findings.push({ level, key, where, message });
const FAIL = "FAIL", WARN = "WARN", INFO = "INFO";

// ---------------------------------------------------------------- catalog
const fns = sqlJson(`
  select p.oid::int as oid, p.proname as name, p.pronargdefaults as ndefaults, p.proisstrict as strict, p.prosecdef as secdef,
         pg_get_function_result(p.oid) as result, pg_get_function_identity_arguments(p.oid) as ident,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         (select json_agg(json_build_object('name', n, 'type', format_type(tt, null), 'mode', coalesce(m::text, 'i'), 'pos', o) order by o)
            from unnest(coalesce(p.proallargtypes, string_to_array(p.proargtypes::text, ' ')::oid[]), coalesce(p.proargnames, array[]::text[]), coalesce(p.proargmodes, array[]::"char"[])) with ordinality as u(tt, n, m, o)) as params
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prokind = 'f'`);
const fnByName = new Map();
for (const f of fns) (fnByName.get(f.name) || fnByName.set(f.name, []).get(f.name)).push(f);

const cols = sqlJson(`
  select c.table_name as tbl, c.column_name as col, c.data_type as dtype, c.udt_name as udt, c.is_nullable = 'YES' as nullable,
         c.column_default is not null as has_default, c.is_identity = 'YES' as identity, c.is_generated <> 'NEVER' as generated,
         has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'INSERT') as can_insert,
         has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'UPDATE') as can_update,
         has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'SELECT') as can_select,
         has_column_privilege('anon', format('public.%I', c.table_name)::regclass, c.column_name, 'SELECT') as anon_select
  from information_schema.columns c where c.table_schema = 'public'`);
const tableCols = new Map();
for (const c of cols) (tableCols.get(c.tbl) || tableCols.set(c.tbl, new Map()).get(c.tbl)).set(c.col, c);
const tablePriv = new Map(sqlJson(`
  select c.relname as tbl, c.relkind as kind, c.relrowsecurity as rls,
    has_table_privilege('authenticated', c.oid, 'select') or has_any_column_privilege('authenticated', c.oid, 'select') as select,
    has_table_privilege('authenticated', c.oid, 'insert') or has_any_column_privilege('authenticated', c.oid, 'insert') as insert,
    has_table_privilege('authenticated', c.oid, 'update') or has_any_column_privilege('authenticated', c.oid, 'update') as update,
    has_table_privilege('authenticated', c.oid, 'delete') as delete,
    has_table_privilege('anon', c.oid, 'select') or has_any_column_privilege('anon', c.oid, 'select') as anon_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m','p')`).map((r) => [r.tbl, r]));
const policies = sqlJson(`select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage')`);
const enums = new Map();
for (const r of sqlJson(`select t.typname as typ, array_agg(e.enumlabel order by e.enumsortorder) as vals from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`)) enums.set(r.typ, r.vals);
const checks = sqlJson(`select c.relname as tbl, pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and k.contype = 'c'`);
const fks = sqlJson(`
  select k.conname as name, c.relname as tbl, r.relname as ref,
         (select array_agg(a.attname order by u.o) from unnest(k.conkey) with ordinality u(n, o) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n) as cols
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid join pg_namespace n on n.oid = c.relnamespace
  where k.contype = 'f' and n.nspname = 'public'`);
const buckets = new Set(sql(`select name from storage.buckets`).split("\n").filter(Boolean));

// ---------------------------------------------------------------- type compatibility
const NUMERIC = /^(smallint|integer|bigint|numeric|real|double precision|int2|int4|int8)$/;
function pgFamily(t) {
  if (/\[\]$/.test(t)) return "array";
  if (NUMERIC.test(t)) return "number";
  if (/^(text|character varying|character|citext|uuid|name)$/.test(t)) return "string";
  if (/^(timestamp with time zone|timestamp without time zone|date|time.*)$/.test(t)) return "string";
  if (t === "boolean") return "boolean";
  if (/^json/.test(t)) return "any";
  return "string";
}
function compat(kinds, family, nullable) {
  const k = new Set(kinds.filter((x) => x !== "null" && x !== "undefined"));
  const problems = [];
  if (kinds.includes("undefined")) problems.push("can be undefined (key is dropped from the JSON body)");
  if (kinds.includes("null") && !nullable) problems.push("can be null but the target is NOT NULL / strict");
  if (k.has("any") || family === "any" || !k.size) return problems;
  for (const [fam, label] of [["number", "numeric"], ["string", "text-like"], ["boolean", "boolean"], ["array", "array"]]) if (family === fam && [...k].some((x) => x !== fam)) problems.push(`passes ${[...k].join("|")} to a ${label} parameter`);
  return problems;
}

// ---------------------------------------------------------------- value sets (enum / CHECK) and policies
function valueSetFor(table, column) {
  const c = tableCols.get(table)?.get(column);
  if (!c) return null;
  if (c.dtype === "USER-DEFINED" && enums.has(c.udt)) return { source: `enum ${c.udt}`, vals: enums.get(c.udt) };
  for (const k of checks.filter((x) => x.tbl === table)) {
    const m = k.def.match(new RegExp(`\\(?${column}\\)?(?:::text)? = ANY \\(\\(?ARRAY\\[([^\\]]*)\\]`));
    if (m) return { source: `check ${k.def.slice(0, 90)}`, vals: [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) };
  }
  return null;
}
const polCovers = (table, cmd, role = "authenticated") => policies.filter((p) => p.schemaname === "public" && p.tablename === table && (p.cmd === cmd || p.cmd === "ALL") && p.permissive === "PERMISSIVE" && (p.roles.includes(role) || p.roles.includes("public")));
const OP_CMD = { select: "SELECT", insert: "INSERT", update: "UPDATE", delete: "DELETE" };

// ---------------------------------------------------------------- RPC
const rpcSeen = new Set();
for (const call of facts.rpc) {
  if (!call.name) continue; // unresolved name, listed under UNRESOLVED
  const where = `${call.file}:${call.line} rpc ${call.name}`;
  rpcSeen.add(call.name);
  const candidates = fnByName.get(call.name);
  if (!candidates) { add(FAIL, `rpc-missing:${call.name}`, where, `no function public.${call.name} exists`); continue; }
  if (!candidates.some((f) => f.auth_exec)) { add(FAIL, `rpc-exec:${call.name}`, where, `role authenticated has no EXECUTE on ${call.name}(${candidates.map((f) => f.ident).join(") / (")}): PostgREST answers 404 PGRST202`); continue; }
  const given = new Set(call.args.map((a) => a.name));
  const typeDerived = call.argsHow === "type";
  let matches = candidates;
  if (call.argsResolved && !typeDerived) {
    matches = candidates.filter((f) => {
      const input = (f.params || []).filter((p) => ["i", "b", "v"].includes(p.mode));
      const optional = new Set(input.slice(input.length - f.ndefaults).map((p) => p.name));
      const all = new Set(input.map((p) => p.name));
      return [...given].every((g) => all.has(g)) && input.every((p) => given.has(p.name) || optional.has(p.name));
    });
    if (!matches.length) {
      const accepts = (f) => (f.params || []).filter((p) => ["i", "b", "v"].includes(p.mode)).map((p) => p.name);
      const unknown = [...given].filter((g) => !candidates.some((f) => accepts(f).includes(g)));
      const why = unknown.length ? `unknown argument name${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}` : `required argument missing or argument set matches no overload`;
      add(FAIL, `rpc-args:${call.name}:${[...given].sort().join(",")}`, where, `${why}; the call sends {${[...given].join(", ")}}. Available: ${candidates.map((f) => `(${f.ident})`).join(" | ")}. PostgREST would answer PGRST202.`);
      continue;
    }
    if (matches.length > 1) add(WARN, `rpc-ambiguous:${call.name}`, where, `${matches.length} overloads match this argument set; PostgREST answers PGRST203 (ambiguous): ${matches.map((f) => `(${f.ident})`).join(" | ")}`);
  } else if (typeDerived) {
    const names = new Set(candidates.flatMap((f) => (f.params || []).map((p) => p.name)));
    for (const g of given) if (!names.has(g)) add(WARN, `rpc-arg-name:${call.name}:${g}`, where, `argument ${g} comes from a TypeScript type (the object is not written out here) and no overload of ${call.name} has that parameter`);
  }
  const fn = matches[0];
  if (!fn.auth_exec) add(FAIL, `rpc-exec:${call.name}`, where, `role authenticated has no EXECUTE on ${call.name}(${fn.ident})`);
  if (fn.anon_exec) add(INFO, `rpc-anon:${call.name}`, where, `anon can also execute ${call.name} (callable without sign-in)`);
  const optionalNames = (f) => { const input = (f.params || []).filter((p) => ["i", "b", "v"].includes(p.mode)); return new Set(input.slice(input.length - f.ndefaults).map((p) => p.name)); };
  for (const arg of call.args) {
    const param = (fn.params || []).find((p) => p.name === arg.name);
    if (!param) continue;
    for (const prob of compat(arg.kinds, pgFamily(param.type), !fn.strict)) {
      const dropped = prob.includes("undefined"), nullToStrict = prob.includes("NOT NULL");
      if (dropped && optionalNames(fn).has(arg.name)) continue; // a dropped optional argument takes its default
      add(dropped || nullToStrict ? FAIL : WARN, `rpc-arg-type:${call.name}:${arg.name}:${prob.split(" ")[0]}`, where, `argument ${arg.name} (${param.type}) from ${arg.viaSpread ? "spread " + arg.viaSpread : arg.viaType ? "its TypeScript type" : "line " + arg.line}: JS type ${arg.type} ${prob}`);
    }
  }
  fn.def ||= sql(`select pg_get_functiondef(${fn.oid})`);
  for (const arg of call.args) {
    const param = (fn.params || []).find((p) => p.name === arg.name);
    if (!param) continue;
    const lits = (arg.literals || []).filter((v) => typeof v === "string");
    if (!lits.length) continue;
    const typ = param.type.replace(/^public\./, "");
    if (enums.has(typ)) { for (const l of lits) if (!enums.get(typ).includes(l)) add(FAIL, `rpc-enum:${call.name}:${arg.name}:${l}`, where, `argument ${arg.name} can be '${l}' but enum ${typ} only has ${enums.get(typ).join(", ")}`); }
    else if (param.type === "text") { for (const l of lits) if (!fn.def.includes(`'${l}'`)) add(WARN, `rpc-text-literal:${call.name}:${arg.name}:${l}`, where, `argument ${arg.name} can be '${l}' but the function source never mentions that literal (value may be rejected or ignored)`); }
  }
}
const unusedCallable = [...fnByName.keys()].filter((n) => !rpcSeen.has(n) && fnByName.get(n).some((f) => f.auth_exec && !f.anon_exec));
add(INFO, "summary-rpc", "summary", `${rpcSeen.size} distinct functions are called by the frontend; ${unusedCallable.length} other public functions are executable by authenticated and not called: ${unusedCallable.join(", ")}`);

// ---------------------------------------------------------------- selects (columns and embedded relations)
function splitTop(s) { const out = []; let depth = 0, cur = ""; for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map((x) => x.trim()).filter(Boolean); }
function checkSelect(table, list, where, keyPrefix, role = "authenticated") {
  const known = tableCols.get(table);
  const canSel = (ci) => (role === "anon" ? ci.anon_select : ci.can_select);
  for (let raw of splitTop(list)) {
    raw = raw.replace(/^\.\.\./, "");
    const m = raw.match(/^(?:([A-Za-z0-9_]+):)?([A-Za-z0-9_]+)((?:![A-Za-z0-9_]+)*)\((.*)\)$/s);
    if (m) { // embedded relation: [alias:]table[!hint][!inner](columns)
      const [, , rel, hints, inner] = m;
      if (/^(count|sum|avg|min|max)$/.test(rel) && !inner) continue;
      if (!tableCols.has(rel)) { add(FAIL, `embed-missing:${table}:${rel}`, where, `select embeds ${rel}(...) but no table or view public.${rel} exists`); continue; }
      const hint = hints.split("!").filter((h) => h && h !== "inner" && h !== "left");
      const links = fks.filter((f) => (f.tbl === table && f.ref === rel) || (f.tbl === rel && f.ref === table));
      const hinted = hint.length ? links.filter((f) => hint.includes(f.name) || f.cols.some((c) => hint.includes(c))) : links;
      if (!links.length) add(FAIL, `embed-fk:${table}:${rel}`, where, `select embeds ${rel}(...) but there is no foreign key between ${table} and ${rel} (PostgREST PGRST200)`);
      else if (hint.length && !hinted.length) add(FAIL, `embed-hint:${table}:${rel}:${hint.join(",")}`, where, `hint ${hint.join("!")} matches no foreign key between ${table} and ${rel}: ${links.map((f) => f.name).join(", ")}`);
      else if (hinted.length > 1) add(WARN, `embed-ambiguous:${table}:${rel}`, where, `${hinted.length} foreign keys link ${table} and ${rel} (${hinted.map((f) => f.name).join(", ")}); PostgREST answers PGRST201 unless a hint is given`);
      if (!tablePriv.get(rel)?.[role === "anon" ? "anon_select" : "select"]) add(FAIL, `table-priv:${rel}:select`, where, `role ${role} has no SELECT privilege on embedded ${rel}`);
      checkSelect(rel, inner || "*", where, keyPrefix, role);
      continue;
    }
    if (raw === "*") continue;
    if (raw.includes("(")) { add(INFO, `select-fn:${table}`, where, `select item ${raw} is an aggregate or function; not checked`); continue; }
    const name = raw.includes(":") && !raw.includes("::") ? raw.split(":")[1] : raw;
    const colName = name.split("::")[0].split("->")[0].trim();
    const ci = known.get(colName);
    if (!ci) add(FAIL, `${keyPrefix}-col:${table}:${colName}`, where, `column ${table}.${colName} does not exist`);
    else if (!canSel(ci)) add(FAIL, `${keyPrefix}-col-priv:${table}:${colName}`, where, `${role} cannot SELECT column ${table}.${colName}`);
  }
}

// ---------------------------------------------------------------- tables
let tableChecks = 0;
for (const t of facts.tables) {
  if (!t.tables.length) continue; // unresolved table name
  for (const table of t.tables) {
    tableChecks++;
    const where = `${t.file}:${t.line} from(${table})`;
    const known = tableCols.get(table);
    if (!known) { add(FAIL, `table-missing:${table}`, where, `table or view public.${table} does not exist`); continue; }
    const priv = tablePriv.get(table);
    // privileges the call needs
    const needs = new Map(); // op -> why
    for (const w of t.writes) {
      if (w.op === "upsert") { needs.set("insert", "upsert"); if (!w.ignoreDuplicates) needs.set("update", "upsert (ON CONFLICT DO UPDATE)"); }
      else needs.set(w.op, w.op);
    }
    if (t.selects.length || !t.writes.length || t.filters.length) needs.set("select", t.selects.length ? "select()" : t.writes.length ? "filter on the written rows" : "read");
    for (const [op, why] of needs) {
      if (!priv[op]) add(FAIL, `table-priv:${table}:${op}`, where, `role authenticated has no ${op.toUpperCase()} privilege on ${table} (needed by ${why})${t.writes.length && op !== "select" ? ": PostgREST answers 42501 permission denied" : ""}`);
      else if (priv.rls && !polCovers(table, OP_CMD[op]).length) add(FAIL, `table-policy:${table}:${op}`, where, `${table} has RLS on and no permissive ${OP_CMD[op]} policy for authenticated: every ${op} is refused or returns zero rows`);
    }
    for (const s of t.selects) if (s.complete) checkSelect(table, s.columns.join(","), `${t.file}:${s.line} select ${table}`, "select");
    // writes
    for (const w of t.writes) {
      const ww = `${t.file}:${w.line} ${w.op} ${table}`;
      for (const k of w.keys) {
        const ci = known.get(k.name);
        if (!ci) { add(FAIL, `write-col:${table}:${k.name}`, ww, `payload column ${table}.${k.name} does not exist`); continue; }
        // (a table without the privilege at all is reported once above, not once per column)
        if (w.op !== "update" && priv.insert && !ci.can_insert) add(FAIL, `write-col-priv:${table}:insert:${k.name}`, ww, `authenticated has no INSERT privilege on column ${table}.${k.name}`);
        if ((w.op === "update" || (w.op === "upsert" && !w.ignoreDuplicates)) && priv.update && !ci.can_update) add(FAIL, `write-col-priv:${table}:update:${k.name}`, ww, `authenticated has no UPDATE privilege on column ${table}.${k.name}`);
        if (ci.generated || ci.identity) add(WARN, `write-generated:${table}:${k.name}`, ww, `column ${table}.${k.name} is generated/identity`);
        const fam = pgFamily(ci.dtype === "ARRAY" ? "x[]" : ci.dtype === "USER-DEFINED" ? ci.udt : ci.dtype);
        for (const prob of compat(k.kinds, fam, ci.nullable)) add(WARN, `write-type:${table}:${k.name}:${prob.split(" ")[0]}`, ww, `${table}.${k.name} (${ci.dtype === "USER-DEFINED" ? ci.udt : ci.dtype}): JS type ${k.type} ${prob}`);
        const vs = valueSetFor(table, k.name);
        if (vs) for (const lit of (k.literals || []).filter((v) => typeof v === "string")) if (!vs.vals.includes(lit)) add(FAIL, `write-value:${table}.${k.name}:${lit}`, ww, `${table}.${k.name} = '${lit}' is not allowed (${vs.source}; allowed: ${vs.vals.join(", ")})`);
      }
      if (w.op === "upsert") for (const c of w.onConflict || []) if (!known.has(c)) add(FAIL, `write-col:${table}:${c}`, ww, `onConflict column ${table}.${c} does not exist`);
      if (w.op === "insert" && w.resolved && w.how !== "type") {
        const given = new Set(w.keys.map((k) => k.name));
        const missing = [...known.values()].filter((c) => !c.nullable && !c.has_default && !c.identity && !c.generated && !given.has(c.col));
        if (missing.length) add(WARN, `insert-missing:${table}`, ww, `insert omits NOT NULL columns without a default: ${missing.map((c) => c.col).join(", ")} (a trigger may fill them; check)`);
      }
      if (["update", "delete"].includes(w.op) && !t.filters.some((f) => ["eq", "in", "match"].includes(f.method))) add(WARN, `write-unfiltered:${table}:${w.op}`, ww, `${w.op} with no eq/in filter`);
    }
    // filters and order
    for (const f of t.filters) {
      const ww = `${t.file}:${f.line} ${f.method} ${table}`;
      const ci = known.get(f.column);
      if (!ci) { add(FAIL, `filter-col:${table}:${f.column}`, ww, `${f.fromOr ? "or() " : "filter "}column ${table}.${f.column} does not exist`); continue; }
      if (!ci.can_select) add(FAIL, `filter-col-priv:${table}:${f.column}`, ww, `authenticated cannot SELECT column ${table}.${f.column}, which PostgREST needs to filter on it`);
      const vs = valueSetFor(table, f.column);
      if (vs && f.value) for (const lit of (f.value.literals || []).filter((v) => typeof v === "string")) if (!vs.vals.includes(lit)) add(FAIL, `filter-value:${table}.${f.column}:${lit}`, ww, `${table}.${f.column} compared with '${lit}', which is not a possible value (${vs.source}; possible: ${vs.vals.join(", ")})`);
    }
    for (const o of t.order) if (!known.has(o.column)) add(FAIL, `order-col:${table}:${o.column}`, `${t.file}:${o.line} order ${table}`, `order column ${table}.${o.column} does not exist`);
  }
}

// ---------------------------------------------------------------- raw REST URLs (anon)
for (const r of facts.rest) {
  const where = `${r.file}:${r.line} rest/v1/${r.table}`;
  const known = tableCols.get(r.table);
  if (!known) { add(FAIL, `table-missing:${r.table}`, where, `table or view public.${r.table} does not exist`); continue; }
  const priv = tablePriv.get(r.table);
  if (!priv.anon_select) add(FAIL, `rest-priv:${r.table}`, where, `role anon has no SELECT privilege on ${r.table}, but this URL is read with the anon key`);
  else if (priv.rls && !polCovers(r.table, "SELECT", "anon").length) add(FAIL, `rest-policy:${r.table}`, where, `${r.table} has RLS on and no permissive SELECT policy for anon: the public read returns no rows`);
  checkSelect(r.table, r.select.join(","), where, "rest-select", "anon");
  for (const c of [...r.filterColumns, ...r.orderColumns]) { const ci = known.get(c); if (!ci) add(FAIL, `rest-col:${r.table}:${c}`, where, `URL filters/orders by ${r.table}.${c}, which does not exist`); else if (!ci.anon_select) add(FAIL, `rest-col-priv:${r.table}:${c}`, where, `anon cannot SELECT ${r.table}.${c}`); }
}

// ---------------------------------------------------------------- storage
const storagePolicies = policies.filter((p) => p.schemaname === "storage" && p.tablename === "objects");
const storageOps = { upload: "INSERT", remove: "DELETE", createSignedUrl: "SELECT", createSignedUrls: "SELECT", download: "SELECT", list: "SELECT", update: "UPDATE", move: "UPDATE", copy: "INSERT" };
const bucketCmds = new Map();
for (const b of buckets) {
  const set = new Set();
  for (const p of storagePolicies) {
    const text = `${p.qual || ""} ${p.with_check || ""}`;
    // only PERMISSIVE policies grant access; a RESTRICTIVE one (e.g. "Active members only", on every bucket) can only narrow it
    if (p.permissive === "PERMISSIVE" && (p.roles.includes("authenticated") || p.roles.includes("public")) && text.includes(`'${b}'`)) set.add(p.cmd);
  }
  bucketCmds.set(b, set);
}
// buckets a dynamic `storage.from(x)` can reach: every value some *bucket column of a table is allowed to hold
const dynamicBuckets = new Set();
for (const [table, cs] of tableCols) for (const col of cs.keys()) if (/bucket/.test(col)) { const vs = valueSetFor(table, col); if (vs) vs.vals.forEach((v) => dynamicBuckets.add(v)); }
let storageChecks = 0;
for (const s of facts.storage) {
  const names = new Set(s.buckets);
  if (!s.bucketComplete) for (const b of dynamicBuckets) names.add(b);
  for (const c of s.calls) {
    if (!Object.hasOwn(storageOps, c.method)) continue;
    storageChecks++;
    const where = `${c.file}:${c.line} storage.from(${s.bucketComplete ? s.buckets.join("|") : "dynamic"}).${c.method}`;
    for (const b of names) {
      if (!buckets.has(b)) { add(FAIL, `bucket-missing:${b}`, where, `bucket '${b}' does not exist (exists: ${[...buckets].join(", ")})`); continue; }
      const need = storageOps[c.method], have = bucketCmds.get(b);
      if (!have.has(need) && !have.has("ALL")) add(FAIL, `bucket-policy:${b}:${need}`, where, `no storage.objects policy for ${need} mentions bucket '${b}' for authenticated (policies for this bucket: ${[...have].join(", ") || "none"}): the call is refused by RLS`);
    }
  }
}
if (dynamicBuckets.size) add(INFO, "summary-buckets", "summary", `dynamic bucket names are checked against every value a *bucket column may hold (${[...dynamicBuckets].join(", ")}) plus the literals seen`);

// ---------------------------------------------------------------- TypeScript row types and RPC result shapes
const shapesByAlias = new Map();
for (const s of facts.shapes) (shapesByAlias.get(s.alias) || shapesByAlias.set(s.alias, []).get(s.alias)).push(s);
for (const [alias, { table, clientOnly = [] }] of Object.entries(config.rowTypes)) {
  const found = shapesByAlias.get(alias);
  if (!found) { add(WARN, `row-type-missing:${alias}`, `type ${alias}`, `row type ${alias} (config.json rowTypes -> ${table}) is not declared anywhere in the frontend any more; remove or rename its entry`); continue; }
  const known = tableCols.get(table);
  if (!known) { add(FAIL, `table-missing:${table}`, `type ${alias}`, `config.json maps ${alias} to ${table}, which does not exist`); continue; }
  for (const shape of found) {
    const where = `${shape.file}:${shape.line} type ${alias}`;
    for (const prop of shape.props) {
      if (clientOnly.includes(prop.name)) continue;
      const ci = known.get(prop.name);
      if (!ci) { add(prop.optional ? WARN : FAIL, `row-type-col:${alias}:${prop.name}`, where, `TS property '${prop.name}' is not a column of ${table}; reading it gives undefined`); continue; }
      if (!ci.can_select) add(FAIL, `row-type-col-priv:${alias}:${prop.name}`, where, `authenticated cannot SELECT ${table}.${prop.name}`);
      const vs = valueSetFor(table, prop.name);
      const synthetic = config.syntheticValues?.[`${alias}.${prop.name}`] || [];
      if (prop.literals && vs) {
        for (const l of prop.literals) if (!vs.vals.includes(l) && !synthetic.includes(l)) add(FAIL, `row-type-value:${alias}.${prop.name}:${l}`, where, `${prop.name} can be '${l}' in TS but ${table}.${prop.name} only allows ${vs.vals.join(", ")}`);
        for (const v of vs.vals) if (!prop.literals.includes(v)) add(INFO, `row-type-union:${alias}.${prop.name}:${v}`, where, `${table}.${prop.name} may be '${v}' but the TS union omits it (UI may mislabel it)`);
      }
      if (!prop.optional && ci.nullable && !/null|undefined/.test(prop.type)) add(INFO, `row-type-null:${alias}.${prop.name}`, where, `${table}.${prop.name} is nullable in the database but TS declares ${prop.type}`);
    }
  }
}
const defCache = new Map();
for (const { fn, alias, section } of config.rpcShapes || []) {
  const shapes = shapesByAlias.get(alias) || [];
  if (!fnByName.has(fn)) { add(WARN, `rpc-shape-fn:${fn}`, `${fn}.${section}`, `rpcShapes names function ${fn}, which does not exist`); continue; }
  if (!defCache.has(fn)) defCache.set(fn, sql(`select pg_get_functiondef('public.${fn}'::regproc)`));
  const def = defCache.get(fn); const idx = def.indexOf(`'${section}'`);
  if (idx < 0) { add(WARN, `rpc-shape-section:${fn}.${section}`, `${fn}.${section}`, `section '${section}' not found in the source of ${fn}`); continue; }
  const seg = def.slice(idx, idx + 1600);
  const end = seg.search(/\n {4}'[a-z_]+', coalesce/);
  const sqlKeys = new Set([...seg.slice(0, end > 0 ? end : seg.length).matchAll(/'([a-z_]+)',/g)].map((m) => m[1]));
  sqlKeys.delete(section);
  for (const shape of shapes) {
    const where = `${shape.file}:${shape.line} type ${alias} vs ${fn}.${section}`;
    for (const prop of shape.props) if (!prop.optional && !sqlKeys.has(prop.name)) add(FAIL, `rpc-shape:${alias}:${fn}.${section}:${prop.name}`, where, `TypeScript expects property '${prop.name}' but ${fn} does not return it`);
    for (const k of sqlKeys) if (!shape.props.some((p) => p.name === k)) add(INFO, `rpc-shape-extra:${alias}:${fn}.${section}:${k}`, where, `${fn} returns '${k}' which the TS type does not declare`);
  }
}

// ---------------------------------------------------------------- coverage, unresolved, accepted findings
for (const [what, n] of [["rpc", facts.rpc.filter((r) => r.name).length], ["tables", tableChecks], ["storage", facts.storage.length]]) {
  const floor = config.floors?.[what] || 0;
  if (n < floor) add(FAIL, `coverage:${what}`, "extractor", `only ${n} ${what} calls were found, below the floor of ${floor} in config.json: the extractor has stopped seeing the code (or the floor must be lowered on purpose)`);
}
const unresolved = facts.unresolved;
const maxUnresolved = config.maxUnresolved ?? 0;
if (unresolved.length > maxUnresolved) add(FAIL, "unresolved-count", "extractor", `${unresolved.length} calls could not be resolved statically, config.json allows ${maxUnresolved}: the new ones are not checked. Make them literal, or raise maxUnresolved with a reason`);
else if (unresolved.length < maxUnresolved) add(INFO, "unresolved-count", "extractor", `${unresolved.length} unresolved calls, config.json allows ${maxUnresolved}: lower maxUnresolved`);
for (const n of facts.notChecked) add(INFO, `not-checked:${n.kind}`, `${n.file}:${n.line}`, `${n.kind} ${n.what || ""} is not part of the contract check`);

const accepted = new Map((config.accepted || []).map((a) => [a.key, a]));
const usedAccepted = new Set();
for (const f of findings) if (f.level === FAIL && accepted.has(f.key)) { usedAccepted.add(f.key); f.level = "ACCEPTED"; f.message += `  [accepted: ${accepted.get(f.key).reason}]`; }
for (const key of accepted.keys()) if (!usedAccepted.has(key)) add(WARN, `stale-accepted:${key}`, "config.json", `accepted finding ${key} no longer occurs; remove it from config.json`);

// ---------------------------------------------------------------- output
const order = { FAIL: 0, ACCEPTED: 1, WARN: 2, INFO: 3 };
findings.sort((a, b) => order[a.level] - order[b.level] || a.where.localeCompare(b.where));
const verbose = Boolean(process.env.VERBOSE);
for (const f of findings) if (verbose || f.level !== INFO) console.log(`[${f.level}] ${f.where}: ${f.message}`);
if (unresolved.length) {
  console.log(`\nUNRESOLVED: ${unresolved.length} call(s) the extractor could not read statically (not checked, or only partly); allowed: ${maxUnresolved}`);
  for (const u of unresolved) console.log(`  [${u.kind}] ${u.file}:${u.line} ${u.what}: ${u.why}`);
}
const n = (l) => findings.filter((f) => f.level === l).length;
console.log(`\nChecked ${facts.rpc.length} rpc calls, ${facts.tables.length} table calls (${tableChecks} table checks), ${facts.storage.length} storage clients (${storageChecks} calls), ${facts.rest.length} raw REST urls, ${facts.shapes.length} TS row types in ${facts.meta.files} files.`);
console.log(`FAIL ${n(FAIL)}  ACCEPTED ${n("ACCEPTED")}  WARN ${n(WARN)}  INFO ${n(INFO)}  UNRESOLVED ${unresolved.length}${verbose ? "" : "   (INFO lines: VERBOSE=1)"}`);
const jsonOut = opt("--json");
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ findings, unresolved, counts: { rpc: facts.rpc.length, tables: facts.tables.length, storage: facts.storage.length, rest: facts.rest.length } }, null, 1));
process.exit(n(FAIL) ? 1 : 0);
