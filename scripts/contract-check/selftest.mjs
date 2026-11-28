#!/usr/bin/env node
// Proves the contract check catches what it claims to catch.   scripts/contract-check/run.sh --selftest
//
// Works on temporary copies of the frontend (the repository is never touched). Needs a replayed cluster in
// PGHOST/PGPORT/PGUSER (run.sh provides it). Every expectation is computed from the replayed database, so the
// test follows the schema and does not name a table, a column or a source file.
//
//   1. baseline   the copy as it is: its FAIL keys and unresolved count are the reference
//   2. control    + a module of VALID calls written in every style the extractor supports: nothing new may be reported
//   3. injected   + a module in a deeply nested new folder, using a client with an unusual name, that holds one
//                 deliberate break per rule: each must be reported under its own key
//   4. real code  small regex mutations of the real frontend files, found by content (not by file name):
//                 a wrong column, a wrong RPC argument name, a write to a SELECT-only table, a missing RPC
// Exit 1 when a break is not reported or when the control reports something new.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(process.env.FRONTEND || path.join(HERE, "..", ".."));
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "contract-selftest."));
process.on("exit", () => fs.rmSync(SCRATCH, { recursive: true, force: true }));
const psql = (q) => execFileSync("psql", ["-X", "-At", "-d", "postgres", "-c", q], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const rows = (q) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${q}) t`));

// ---------------------------------------------------------------- what the replayed database allows
const tables = rows(`
  select c.relname as name,
    has_table_privilege('authenticated', c.oid, 'select') as sel, has_table_privilege('authenticated', c.oid, 'insert') as ins,
    has_table_privilege('authenticated', c.oid, 'update') as upd, has_any_column_privilege('authenticated', c.oid, 'update') as upd_any,
    has_table_privilege('authenticated', c.oid, 'delete') as del,
    (select json_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`);
const readable = tables.filter((t) => t.sel && t.cols.includes("id"));
const R = readable.find((t) => t.name === "events") || readable[0];                      // any readable table with an id column
const W = tables.find((t) => t.sel && t.ins && t.upd && t.del);                           // a table authenticated may write
const S = tables.find((t) => t.sel && !t.ins && !t.upd_any && !t.del);
const A = rows(`select c.relname as name, (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('anon', c.oid, a.attnum, 'select') order by a.attnum limit 1) as col
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and has_any_column_privilege('anon', c.oid, 'select') order by 1`)[0]; // a table the anon key may read                   // a SELECT-only table
const colPriv = rows(`select c.relname as tbl, a.attname as col from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and has_any_column_privilege('authenticated', c.oid, 'update') and not has_table_privilege('authenticated', c.oid, 'update')
    and not has_column_privilege('authenticated', c.oid, a.attnum, 'update') and has_column_privilege('authenticated', c.oid, a.attnum, 'select') order by 1, 2`)[0]; // a column authenticated may read but not update, in a table it may partly update
const enumCol = rows(`select c.table_name as tbl, c.column_name as col from information_schema.columns c join pg_class k on k.relname = c.table_name join pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
  where c.table_schema = 'public' and c.data_type = 'USER-DEFINED' and k.relkind = 'r' and has_column_privilege('authenticated', k.oid, c.column_name, 'select') and has_table_privilege('authenticated', k.oid, 'select') order by 1, 2`)[0];
const fns = rows(`select p.proname as name, p.pronargdefaults as ndef, p.pronargs as nargs, p.proargnames as names, p.oid::regprocedure::text as sig,
    (select array_agg(format_type(t, null) order by o) from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) with ordinality u(t, o)) as types,
    (select array_agg(case when e.oid is not null then (select array_agg(l.enumlabel order by l.enumsortorder) from pg_enum l where l.enumtypid = e.oid)::text end order by o) from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) with ordinality u(t, o) left join pg_type e on e.oid = u.t and e.typtype = 'e') as enum_labels,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.proargnames is not null and p.pronargs > 0 and not exists (select 1 from pg_proc q where q.proname = p.proname and q.oid <> p.oid and q.pronamespace = p.pronamespace)
    and p.prorettype <> 'trigger'::regtype order by 1`);
const callable = fns.filter((f) => f.auth_exec && f.nargs === f.names.length);
const fnTwoRequired = callable.find((f) => f.ndef === 0 && f.nargs >= 2);
const fnEnum = callable.find((f) => f.enum_labels?.some(Boolean));
const fnNoExec = rows(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
  and not has_function_privilege('authenticated', p.oid, 'execute') and not exists (select 1 from pg_proc q where q.proname = p.proname and q.oid <> p.oid) order by 1`)[0];
const fkPair = rows(`select c.relname as a, r.relname as b from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid join pg_namespace n on n.oid = c.relnamespace
  where k.contype = 'f' and n.nspname = 'public' and c.relname <> r.relname and has_table_privilege('authenticated', c.oid, 'select') and has_table_privilege('authenticated', r.oid, 'select')
  and (select count(*) from pg_constraint k2 where k2.contype = 'f' and ((k2.conrelid = c.oid and k2.confrelid = r.oid) or (k2.conrelid = r.oid and k2.confrelid = c.oid))) = 1 order by 1, 2`)[0];
const noFkPair = (() => { const names = readable.map((t) => t.name); const linked = new Set(rows(`select c.relname || '>' || r.relname as p from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid where k.contype = 'f'`).flatMap((x) => { const [a, b] = x.p.split(">"); return [`${a}>${b}`, `${b}>${a}`]; }));
  for (const a of names) for (const b of names) if (a < b && !linked.has(`${a}>${b}`)) return { a, b }; return null; })();
const bucketGap = (() => {
  const policies = rows(`select cmd, roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') as text from pg_policies where schemaname = 'storage' and tablename = 'objects'`);
  const bucketNames = psql("select name from storage.buckets order by 1").split("\n").filter(Boolean);
  const method = { INSERT: "upload", SELECT: "createSignedUrl", DELETE: "remove", UPDATE: "update" };
  for (const b of bucketNames) for (const [cmd, m] of Object.entries(method)) if (!policies.some((p) => (p.cmd === cmd || p.cmd === "ALL") && (p.roles.includes("authenticated") || p.roles.includes("public")) && p.text.includes(`'${b}'`))) return { bucket: b, method: m, need: cmd };
  return null;
})();
if (!R || !W || !S) { console.error(`selftest needs a readable table, a writable table and a SELECT-only table in the replayed schema (found ${R?.name}, ${W?.name}, ${S?.name})`); process.exit(2); }

const jsValue = (type, labels) => labels ? JSON.stringify(labels.replace(/^\{|\}$/g, "").split(",")[0].replace(/^"|"$/g, "")) : /\[\]$/.test(type) ? "[]" : /^(smallint|integer|bigint|numeric|real|double precision)$/.test(type) ? "1" : type === "boolean" ? "true" : /^jsonb?$/.test(type) ? "{}" : '"x"';
const argsFor = (f, skip = []) => f.names.map((n, i) => (skip.includes(n) ? null : `${n}: ${jsValue(f.types[i], f.enum_labels?.[i])}`)).filter(Boolean).join(", ");

// ---------------------------------------------------------------- copies of the frontend
const EXCLUDE_TOP = new Set(["node_modules", ".next", ".git", ".claude", ".vercel", "supabase", "docs", "public", "scripts", "tests", "dist", "out"]);
function copyFrontend(name) {
  const dir = path.join(SCRATCH, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(FRONTEND)) if (!EXCLUDE_TOP.has(entry)) fs.cpSync(path.join(FRONTEND, entry), path.join(dir, entry), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(FRONTEND, "node_modules")), path.join(dir, "node_modules"));
  return dir;
}
function run(dir) {
  const facts = path.join(dir, "..", `${path.basename(dir)}.facts.json`), report = path.join(dir, "..", `${path.basename(dir)}.report.json`);
  const ex = spawnSync(process.execPath, [path.join(HERE, "extract.mjs"), "--frontend", dir, "--out", facts], { encoding: "utf8" });
  if (ex.status !== 0) throw new Error(`extract failed in ${dir}: ${ex.stderr}`);
  const ck = spawnSync(process.execPath, [path.join(HERE, "check.mjs"), facts, "--json", report], { encoding: "utf8" });
  if (!fs.existsSync(report)) throw new Error(`check failed in ${dir}: ${ck.stderr || ck.stdout}`);
  const r = JSON.parse(fs.readFileSync(report, "utf8"));
  return { keys: new Set(r.findings.filter((f) => f.level === "FAIL").map((f) => f.key)), all: r.findings, unresolved: r.unresolved.length };
}

const results = [];
const record = (group, name, ok, detail = "") => results.push({ group, name, ok, detail });
const t0 = Date.now();

// ---------------------------------------------------------------- 1. baseline and 2. control
const base = run(copyFrontend("baseline"));
const control = `import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const warehouse = createClient("http://localhost:54321", "selftest-key");
async function readOnly(client: SupabaseClient, table: string) { return client.from(table).select("${R.cols[0]}"); }
type AnyTable = ${readable.map((t) => JSON.stringify(t.name)).join(" | ")};
async function readAny(table: AnyTable) { return warehouse.from(table).select("${R.cols.find((c) => readable.some((t) => !t.cols.includes(c))) || R.cols[0]}"); } // narrowed by its call site, not by the wide type
function buildQuery() { return warehouse.from("${R.name}").select("${R.cols.slice(0, 2).join(",")}"); }
export async function control() {
  await warehouse.from("${R.name}").select("${R.cols.slice(0, 3).join(", ")}").order("${R.cols[0]}").limit(5);
  let q = warehouse.from("${R.name}").select("${R.cols[0]}"); q = q.eq("${R.cols[0]}", 1);
  await q;
  await buildQuery().order("${R.cols[0]}");
  await readOnly(warehouse, "${R.name}");
  await readAny("${R.name}");
  await warehouse.from("${W.name}").insert([{ ${W.cols.find((c) => c !== "id")}: "x" }]);
  await warehouse.from("${W.name}").update({ ${W.cols.find((c) => c !== "id")}: "x" }).eq("id", 1);
  await warehouse.from("${W.name}").delete().eq("id", 1);
  ${fnTwoRequired ? `await warehouse.rpc("${fnTwoRequired.name}", { ${argsFor(fnTwoRequired)} });` : ""}
  ${fkPair ? `await warehouse.from("${fkPair.a}").select("*, ${fkPair.b}(*)");` : ""}
  ${A ? `await fetch("http://localhost/rest/v1/${A.name}?select=${A.col}&order=${A.col}.desc");` : ""}
}
`;
{
  const dir = copyFrontend("control");
  fs.mkdirSync(path.join(dir, "features/area/deep"), { recursive: true });
  fs.writeFileSync(path.join(dir, "features/area/deep/control.ts"), control);
  const r = run(dir);
  const fresh = [...r.keys].filter((k) => !base.keys.has(k));
  record("control", "valid calls in every supported style produce no new FAIL", fresh.length === 0, fresh.join(", "));
  record("control", "valid calls produce no new UNRESOLVED", r.unresolved === base.unresolved, `${r.unresolved} vs ${base.unresolved}`);
}

// ---------------------------------------------------------------- 3. injected breaks
const cases = []; // [name, source line(s), expected key]
const add = (name, code, key) => cases.push({ name, code, key });
add("wrong column in select()", `await warehouse.from("${R.name}").select("id,zz_no_col");`, `select-col:${R.name}:zz_no_col`);
add("wrong column in a filter", `await warehouse.from("${R.name}").select("id").eq("zz_no_filter", 1);`, `filter-col:${R.name}:zz_no_filter`);
add("wrong column in order()", `await warehouse.from("${R.name}").select("id").order("zz_no_order");`, `order-col:${R.name}:zz_no_order`);
add("wrong column in or()", `await warehouse.from("${R.name}").select("id").or("zz_or_col.eq.1,id.eq.2");`, `filter-col:${R.name}:zz_or_col`);
add("wrong column in match()", `await warehouse.from("${R.name}").select("id").match({ zz_match_col: 1 });`, `filter-col:${R.name}:zz_match_col`);
add("wrong column in an insert payload", `await warehouse.from("${W.name}").insert([{ zz_arr_col: 1 }]);`, `write-col:${W.name}:zz_arr_col`);
add("wrong column in an update payload built in a variable", `const body = { zz_var_col: 1 }; await warehouse.from("${W.name}").update(body).eq("id", 1);`, `write-col:${W.name}:zz_var_col`);
add("wrong column in a query kept in a variable", `let q = warehouse.from("${R.name}").select("id"); q = q.eq("zz_var_filter", 1); await q;`, `filter-col:${R.name}:zz_var_filter`);
add("wrong column added to a query returned by a function", `function build() { return warehouse.from("${R.name}").select("id"); }\n  await build().order("zz_returned_order");`, `order-col:${R.name}:zz_returned_order`);
add("wrong column behind a wrapper that takes the table as a parameter", `async function read(table: string) { return warehouse.from(table).select("zz_wrapper_col"); }\n  await read("${R.name}");`, `select-col:${R.name}:zz_wrapper_col`);
add("wrong column on a client passed as a parameter", `async function viaParam(client: SupabaseClient) { return client.from("${R.name}").select("zz_param_col"); }\n  await viaParam(warehouse);`, `select-col:${R.name}:zz_param_col`);
add("missing table", `await warehouse.from("zz_no_table").select("id");`, "table-missing:zz_no_table");
add("missing RPC", `await warehouse.rpc("zz_no_function", { p_x: 1 });`, "rpc-missing:zz_no_function");
if (fnTwoRequired) {
  const [first, ...rest] = fnTwoRequired.names;
  add("wrong RPC argument name", `await warehouse.rpc("${fnTwoRequired.name}", { ${[`zz_bad_arg: 1`, ...rest.map((n, i) => `${n}: ${jsValue(fnTwoRequired.types[i + 1], fnTwoRequired.enum_labels?.[i + 1])}`)].join(", ")} });`, `rpc-args:${fnTwoRequired.name}:${[...rest, "zz_bad_arg"].sort().join(",")}`);
  add("required RPC argument left out", `await warehouse.rpc("${fnTwoRequired.name}", { ${argsFor(fnTwoRequired, [first])} });`, `rpc-args:${fnTwoRequired.name}:${rest.slice().sort().join(",")}`);
}
if (fnEnum) { const i = fnEnum.enum_labels.findIndex(Boolean); add("enum value that does not exist, passed to an RPC", `await warehouse.rpc("${fnEnum.name}", { ${fnEnum.names.map((n, j) => `${n}: ${j === i ? '"zz_bad_value"' : jsValue(fnEnum.types[j], fnEnum.enum_labels[j])}`).join(", ")} });`, `rpc-enum:${fnEnum.name}:${fnEnum.names[i]}:zz_bad_value`); }
if (enumCol) add("enum value that does not exist, compared in a filter", `await warehouse.from("${enumCol.tbl}").select("id").eq("${enumCol.col}", "zz_bad_value");`, `filter-value:${enumCol.tbl}.${enumCol.col}:zz_bad_value`);
if (fnNoExec) add("RPC that authenticated cannot EXECUTE", `await warehouse.rpc("${fnNoExec.name}", {});`, `rpc-exec:${fnNoExec.name}`);
add("insert into a SELECT-only table", `await warehouse.from("${S.name}").insert({ ${S.cols.find((c) => c !== "id")}: "x" });`, `table-priv:${S.name}:insert`);
add("update of a SELECT-only table", `await warehouse.from("${S.name}").update({ ${S.cols.find((c) => c !== "id")}: "x" }).eq("id", 1);`, `table-priv:${S.name}:update`);
add("delete from a SELECT-only table", `await warehouse.from("${S.name}").delete().eq("id", 1);`, `table-priv:${S.name}:delete`);
add("upsert into a SELECT-only table", `await warehouse.from("${S.name}").upsert({ ${S.cols.find((c) => c !== "id")}: "x" });`, `table-priv:${S.name}:insert`);
if (colPriv) add("update of a column authenticated may not write", `await warehouse.from("${colPriv.tbl}").update({ ${colPriv.col}: "x" }).eq("id", "u");`, `write-col-priv:${colPriv.tbl}:update:${colPriv.col}`);
add("missing storage bucket", `await warehouse.storage.from("zz-no-bucket").upload("a", new Blob());`, "bucket-missing:zz-no-bucket");
if (bucketGap) add(`storage call without a policy (${bucketGap.need} on ${bucketGap.bucket})`, `await warehouse.storage.from("${bucketGap.bucket}").${bucketGap.method}("a"${bucketGap.method === "remove" ? "" : ""} as never);`, `bucket-policy:${bucketGap.bucket}:${bucketGap.need}`);
if (fkPair) add("wrong column inside an embedded relation", `await warehouse.from("${fkPair.a}").select("id, ${fkPair.b}(zz_emb_col)");`, `select-col:${fkPair.b}:zz_emb_col`);
if (noFkPair) add("embedded relation without a foreign key", `await warehouse.from("${noFkPair.a}").select("id, ${noFkPair.b}(id)");`, `embed-fk:${noFkPair.a}:${noFkPair.b}`);
if (A) add("wrong column in a raw REST url", `await fetch("http://localhost/rest/v1/${A.name}?select=${A.col},zz_rest_col");`, `rest-select-col:${A.name}:zz_rest_col`);
add("raw REST url of a table the anon key may not read", `await fetch("http://localhost/rest/v1/${R.name}?select=id");`, `rest-priv:${R.name}`);
const injected = `import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const warehouse = createClient("http://localhost:54321", "selftest-key");
export async function injected() {
${cases.map((c) => `  { // ${c.name}\n  ${c.code}\n  }`).join("\n")}
  // dynamic: cannot be read statically and must be LISTED, not skipped
  const dynamicTable = String(process.env.ZZ_TABLE);
  await warehouse.from(dynamicTable).select("id");
  const { from } = warehouse; void from;
}
`;
{
  const dir = copyFrontend("injected");
  fs.mkdirSync(path.join(dir, "features/area/deep/er"), { recursive: true });
  fs.writeFileSync(path.join(dir, "features/area/deep/er/zz-injected.ts"), injected);
  const r = run(dir);
  for (const c of cases) record("injected", c.name, r.keys.has(c.key), r.keys.has(c.key) ? "" : `expected ${c.key}`);
  record("injected", "a table name that is not a literal is listed as UNRESOLVED (count rises)", r.unresolved >= base.unresolved + 2, `${r.unresolved} vs ${base.unresolved}`);
  record("injected", "a count of unresolved calls above the allowed one fails the check", r.keys.has("unresolved-count"), "");
}

// ---------------------------------------------------------------- 4. mutations of the real code
function mutateReal(name, regex, replace, expect) {
  const dir = copyFrontend(`real-${name.replace(/\W+/g, "-")}`);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (["node_modules", ".next"].includes(e.name) ? [] : walk(path.join(d, e.name))) : /\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [path.join(d, e.name)] : []);
  for (const file of walk(dir)) {
    // The first place that is code: an example in a comment (lib/api/_core.ts shows one) is not a call, so mutating it proves nothing.
    const text = fs.readFileSync(file, "utf8");
    const m = [...text.matchAll(new RegExp(regex.source, "g"))].find((hit) => !/^\s*(\/\/|\/\*|\*)/.test(text.slice(text.lastIndexOf("\n", hit.index) + 1, hit.index)));
    if (!m) continue;
    fs.writeFileSync(file, text.slice(0, m.index) + m[0].replace(regex, replace) + text.slice(m.index + m[0].length));
    const { key, prefix } = expect(m);
    const r = run(dir);
    const hit = key ? r.keys.has(key) : [...r.keys].some((k) => k.startsWith(prefix) && !base.keys.has(k));
    record("real code", `${name}  (${path.relative(dir, file)}: ${m[0].slice(0, 60)})`, hit, hit ? "" : `expected ${key || prefix + "*"}; new FAIL keys: ${[...r.keys].filter((k) => !base.keys.has(k)).join(", ") || "none"}`);
    return;
  }
  record("real code", name, false, "no place in the frontend matches this mutation any more (adapt the pattern in selftest.mjs)");
}
mutateReal("wrong column in a real select()", /\.from\("([a-z_]+)"\)\.select\("([a-z_]+)/, '.from("$1").select("$2_zz', (m) => ({ key: `select-col:${m[1]}:${m[2]}_zz` }));
mutateReal("wrong RPC argument name in a real call", /\.rpc\("([a-z_]+)", \{ (p_[a-z_]+):/, '.rpc("$1", { $2_zz:', (m) => ({ prefix: `rpc-args:${m[1]}:` }));
mutateReal("missing RPC in a real call", /\.rpc\("([a-z_]+)"/, '.rpc("$1_zz"', (m) => ({ key: `rpc-missing:${m[1]}_zz` }));
mutateReal("write to a SELECT-only table in a real call", /\.from\("([a-z_]+)"\)(\s*)\.insert\(/, `.from("${S.name}")$2.insert(`, () => ({ key: `table-priv:${S.name}:insert` }));

// ---------------------------------------------------------------- report
const width = Math.max(...results.map((r) => r.name.length)) + 2;
let group = "";
for (const r of results) { if (r.group !== group) { group = r.group; console.log(`\n${group}`); } console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}${r.detail ? "  " + r.detail : ""}`); }
const failed = results.filter((r) => !r.ok);
console.log(`\nselftest: ${results.length - failed.length}/${results.length} as expected in ${Math.round((Date.now() - t0) / 1000)}s (baseline FAIL keys: ${base.keys.size}, unresolved ${base.unresolved}); tables used: read ${R.name}, write ${W.name}, select-only ${S.name}${fnTwoRequired ? ", rpc " + fnTwoRequired.name : ""}`);
process.exit(failed.length ? 1 : 0);
