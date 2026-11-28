#!/usr/bin/env node
// Proves the types drift check catches what it claims to catch.   scripts/contract-check/run.sh --types-drift --selftest
//
// Needs a replayed cluster in PGHOST/PGPORT/PGUSER (run.sh provides it). The repository is never touched: every
// break is made in a temporary copy of lib/database.types.ts (the types side) or in a clone of the replayed database
// (the database side, `create database ... template postgres`). Which table, column, enum or function to break is
// read from the replayed database, so the test follows the schema and names none of them.
//
//   0. the file as it is passes
//   1. types side:    a column changes type, loses nullability, is dropped from Row, becomes optional in Insert; an
//                     enum loses a value (and the runtime Constants copy is edited by hand); a function disappears,
//                     an argument is renamed, becomes optional; a table is invented; a foreign key is dropped
//   2. database side: a column is dropped, added, loses NOT NULL; an enum gains a value; a function is dropped;
//                     a table is added; a foreign key is dropped
// Each break must be reported under its own key, and the check must exit 1. Exit 1 when one is not.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(process.env.FRONTEND || path.join(HERE, "..", ".."));
const TYPES = path.resolve(process.env.TYPES_FILE || path.join(FRONTEND, "lib", "database.types.ts"));
const ts = (() => { try { return createRequire(path.join(FRONTEND, "package.json"))("typescript"); } catch { return createRequire(import.meta.url)("typescript"); } })();
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "types-drift-selftest."));
const CLONE = `drift_selftest_${process.pid}`;
const psql = (q, db = "postgres") => execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", q], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ""} -c client_min_messages=warning` } }).trim();
const rows = (q) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${q}) t`));
process.on("exit", () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  try { psql(`drop database if exists ${CLONE}`); } catch { /* the cluster may be gone already */ }
});

const original = fs.readFileSync(TYPES, "utf8");
const run = (typesFile, db = "postgres") => {
  const result = spawnSync("node", [path.join(HERE, "types-drift.mjs"), "--types", typesFile], { encoding: "utf8", env: { ...process.env, PGDATABASE: db, FRONTEND } });
  const keys = [...result.stdout.matchAll(/^\[DRIFT\] ([^:]+(?::[^:\s]+)*):/gm)].map((m) => m[1]);
  return { status: result.status, keys, out: result.stdout + result.stderr };
};

// ---------------------------------------------------------------- what the replayed database has
const col = rows(`
  select c.relname as tbl, a.attname as col
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attidentity = '' and a.attgenerated = ''
    and a.atttypid = 'text'::regtype
    and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and a.attnum = any (k.conkey))
    and not exists (select 1 from pg_index i where i.indrelid = c.oid and a.attnum = any (i.indkey::int2[]))
  order by 1, 2 limit 1`)[0];
const nullableCol = rows(`
  select c.relname as tbl, a.attname as col
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and not a.attnotnull and not a.atthasdef
    and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and a.attnum = any (k.conkey))
    and not exists (select 1 from pg_index i where i.indrelid = c.oid and a.attnum = any (i.indkey::int2[]))
  order by 1, 2 limit 1`)[0];
const enumE = rows(`select t.typname as name, (array_agg(e.enumlabel order by e.enumsortorder))[1] as first from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' group by 1 order by 1 limit 1`)[0];
const fn = rows(`
  select p.proname as name, p.oid::regprocedure::text as sig, p.proargnames[1] as arg1, p.pronargdefaults as ndef, p.pronargs as nargs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.pronargs >= 1 and p.proargnames is not null
    and not exists (select 1 from pg_proc q where q.proname = p.proname and q.oid <> p.oid and q.pronamespace = p.pronamespace)
  order by (p.pronargdefaults = 0) desc, 1 limit 1`)[0];
const fk = rows(`
  select k.conname as name, c.relname as tbl from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid
  join pg_namespace n on n.oid = c.relnamespace join pg_namespace rn on rn.oid = r.relnamespace where k.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public' order by 1 limit 1`)[0];
if (!col || !nullableCol || !enumE || !fn || !fk) { console.error("types drift selftest needs a NOT NULL text column, a nullable column, an enum, a function with arguments and a foreign key in the replayed schema"); process.exit(2); }

// ---------------------------------------------------------------- editing the types by position, not by text
function nodeAt(text, ...route) {
  const sf = ts.createSourceFile("t.ts", text, ts.ScriptTarget.Latest, true);
  let current;
  for (const s of sf.statements) if (ts.isTypeAliasDeclaration(s) && s.name.text === "Database") current = s.type;
  let found;
  for (const step of ["public", ...route]) {
    found = (current && ts.isTypeLiteralNode(current) ? current.members : []).find((x) => ts.isPropertySignature(x) && (x.name.text ?? x.name.getText(sf)) === step);
    if (!found) throw new Error(`selftest: ${["public", ...route].join(".")} not found in the types (stopped at ${step})`);
    current = found.type;
  }
  return { member: found, sf };
}
const splice = (text, start, end, replacement) => text.slice(0, start) + replacement + text.slice(end);
const replaceMember = (text, route, edit) => { const { member, sf } = nodeAt(text, ...route); return splice(text, member.getStart(sf), member.end, edit(member.getText(sf))); };
const removeMember = (text, route) => { const { member } = nodeAt(text, ...route); return splice(text, member.getFullStart(), member.end, ""); };

// ---------------------------------------------------------------- the checks
let failures = 0;
const report = (name, ok, detail) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`); if (!ok) failures++; };
const expectDrift = (name, result, key) => report(name, result.status === 1 && result.keys.includes(key), `expected exit 1 with ${key}; got exit ${result.status}, keys [${result.keys.join(", ")}]\n${result.out.split("\n").slice(0, 4).join("\n")}`);

console.log("types drift selftest");
const base = run(TYPES);
report("the generated file as it is matches the replayed database", base.status === 0 && base.keys.length === 0, base.out);

let n = 0;
const mutated = (text) => { const file = path.join(SCRATCH, `types-${++n}.ts`); fs.writeFileSync(file, text); return file; };
const typesBreak = (name, text, key) => expectDrift(`types: ${name}`, run(mutated(text)), key);
const rowRoute = (t, c) => ["Tables", t, "Row", c];

typesBreak(`${col.tbl}.${col.col} changes type`, replaceMember(original, rowRoute(col.tbl, col.col), (t) => t.replace(/: string/, ": number")), `column-type:${col.tbl}.${col.col}`);
typesBreak(`${col.tbl}.${col.col} becomes nullable in Row`, replaceMember(original, rowRoute(col.tbl, col.col), (t) => `${t} | null`), `column-type:${col.tbl}.${col.col}`);
typesBreak(`${col.tbl}.${col.col} is dropped from Row`, removeMember(original, rowRoute(col.tbl, col.col)), `column-missing:${col.tbl}.${col.col}`);
typesBreak(`${col.tbl}.${col.col} becomes optional in Insert`, replaceMember(original, ["Tables", col.tbl, "Insert", col.col], (t) => t.replace(/^(\w+)\??:/, "$1?:")), `column-insert-optional:${col.tbl}.${col.col}`);
typesBreak(`${nullableCol.tbl}.${nullableCol.col} loses null in Row`, replaceMember(original, rowRoute(nullableCol.tbl, nullableCol.col), (t) => t.replace(/ \| null$/, "")), `column-type:${nullableCol.tbl}.${nullableCol.col}`);
typesBreak("a column is invented", replaceMember(original, ["Tables", col.tbl, "Row"], (t) => t.replace(/\{/, "{ zz_invented: string;")), `column-extra:${col.tbl}.zz_invented`);
typesBreak(`enum ${enumE.name} loses its first value`, replaceMember(original, ["Enums", enumE.name], (t) => t.replace(new RegExp(`\\|?\\s*"${enumE.first}"\\s*\\|?`), (m) => (m.trim().startsWith("|") && m.trim().endsWith("|") ? " | " : " "))), `enum-values:${enumE.name}`);
typesBreak(`Constants.${enumE.name} is edited by hand`, original.replace(new RegExp(`(\\n\\s+${enumE.name}: \\[\\s*)"${enumE.first}",?\\s*`), "$1"), `enum-constants:${enumE.name}`);
typesBreak(`function ${fn.name} is removed`, removeMember(original, ["Functions", fn.name]), `function-missing:${fn.name}`);
typesBreak(`function ${fn.name}: argument ${fn.arg1} is renamed`, replaceMember(original, ["Functions", fn.name, "Args"], (t) => t.replace(new RegExp(`\\b${fn.arg1}\\b`), "zz_renamed")), `function-arg-missing:${fn.name}.${fn.arg1}`);
typesBreak(`function ${fn.name}: argument ${fn.arg1} flips optional`, replaceMember(original, ["Functions", fn.name, "Args"], (t) => t.replace(new RegExp(`\\b${fn.arg1}(\\??):`), (m, q) => `${fn.arg1}${q ? "" : "?"}:`)), `function-arg-optional:${fn.name}.${fn.arg1}`);
typesBreak("a table is invented", original.replace(/(\n {4}Tables: \{)/, "$1\n      zz_invented: { Row: { id: number }; Insert: { id?: number }; Update: { id?: number }; Relationships: [] }"), "table-extra:zz_invented");
typesBreak(`foreign key ${fk.name} is dropped`, replaceMember(original, ["Tables", fk.tbl, "Relationships"], (t) => t.replace(new RegExp(`\\{[^{}]*foreignKeyName: "${fk.name}"[^{}]*\\},?`), "")), `fk-missing:${fk.tbl}.${fk.name}`);

// database side: one clone per break
const clone = (name, statements, key) => {
  psql(`drop database if exists ${CLONE}`);
  psql(`create database ${CLONE} template postgres`);
  try { for (const s of statements) psql(s, CLONE); } catch (error) { report(`database: ${name}`, false, `could not apply the break: ${String(error.stderr || error.message).split("\n")[0]}`); return; }
  expectDrift(`database: ${name}`, run(TYPES, CLONE), key);
  psql(`drop database ${CLONE}`);
};
clone(`column ${col.tbl}.${col.col} is dropped`, [`alter table public.${col.tbl} drop column ${col.col} cascade`], `column-extra:${col.tbl}.${col.col}`);
clone(`column ${col.tbl}.zz_added is added`, [`alter table public.${col.tbl} add column zz_added integer`], `column-missing:${col.tbl}.zz_added`);
clone(`column ${col.tbl}.${col.col} loses NOT NULL`, [`alter table public.${col.tbl} alter column ${col.col} drop not null`], `column-type:${col.tbl}.${col.col}`);
clone(`column ${col.tbl}.${col.col} becomes integer`, [`alter table public.${col.tbl} alter column ${col.col} type integer using 0`], `column-type:${col.tbl}.${col.col}`);
clone(`column ${nullableCol.tbl}.${nullableCol.col} becomes NOT NULL`, [`alter table public.${nullableCol.tbl} alter column ${nullableCol.col} set not null`], `column-type:${nullableCol.tbl}.${nullableCol.col}`);
clone(`enum ${enumE.name} gains a value`, [`alter type public.${enumE.name} add value 'zz_added'`], `enum-values:${enumE.name}`);
clone(`function ${fn.name} is dropped`, [`drop function ${fn.sig}`], `function-extra:${fn.name}`);
clone("a function is added", [`create function public.zz_added(p_x integer) returns integer language sql as 'select 1'`], "function-missing:zz_added");
clone("a table is added", [`create table public.zz_added (id integer)`], "table-missing:zz_added");
clone(`foreign key ${fk.name} is dropped`, [`alter table public.${fk.tbl} drop constraint ${fk.name}`], `fk-extra:${fk.tbl}.${fk.name}`);

console.log(failures ? `\ntypes drift selftest: ${failures} break(s) NOT caught` : "\ntypes drift selftest: every break was caught");
process.exit(failures ? 1 : 0);
