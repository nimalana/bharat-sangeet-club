#!/usr/bin/env node
// Deletes the storage objects the e2e suite left behind, through the Storage API (the only supported way: a
// delete in SQL removes the metadata but not the file). Run it BEFORE cleanup.sql, because the recordings, notations and
// resources bucket policies only allow a delete while the row that refers to the file still exists.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=sb_publishable_... \
//   NODE_USE_ENV_PROXY=1 node scripts/e2e/cleanup.mjs [--paths orphans.json]
//
// finance-private is the other way round (20261127050200): a file that still has a finance_documents record can only be
// removed through remove_finance_document, which refuses decided requests, so the receipts of the suite's reimbursements
// stay until cleanup.sql has removed their records. Then run this script a SECOND time: the file is unregistered, an
// executive sees it and may delete it. The script says so when it meets such files.
//
// It signs in as the e2e accounts, walks each account's folder in every bucket as an executive, and removes what
// it finds (as the executive, or as the owner when the executive is refused).
// --paths takes a JSON array of {"bucket": "<bucket>", "path": "<uid>/<file>"}: files to try by name, for a file the
// walk could not list. Get the list with
//   select bucket_id as bucket, name as path from storage.objects
//   where owner_id in (select id::text from auth.users where email like 'e2e-%@example.com');
import { readFileSync } from "node:fs";
import { loadConfig } from "./lib/config.mjs";
import { newClient } from "./lib/ctx.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { describeError } from "./lib/assert.mjs";

const BUCKETS = ["recordings", "recording-notations", "club-resources", "club-archive", "attendance-excuses", "finance-private"];
const args = process.argv.slice(2);
const pathsFile = args.includes("--paths") ? args[args.indexOf("--paths") + 1] : null;
const cfg = loadConfig();

const clients = {};
const ids = {};
for (const key of Object.keys(ACCOUNTS)) {
  const client = newClient(cfg);
  const { data, error } = await client.auth.signInWithPassword({ email: ACCOUNTS[key].email, password: cfg.passwords[key] || "" });
  if (error || !data.user) { console.log(`(cannot sign in as ${key}: ${error?.message || "no user"})`); continue; }
  clients[key] = client; ids[key] = data.user.id;
}
if (!clients.execA) throw new Error("execA could not sign in, so nothing can be cleaned up through the API. Run the setup SQL (gen-setup-sql.mjs) first.");

async function walk(client, bucket, prefix, found) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) { console.log(`  list ${bucket}/${prefix}: ${describeError(error)}`); return; }
    for (const entry of data || []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.metadata == null) await walk(client, bucket, path, found); // a folder
      else found.push(path);
    }
    if (!data || data.length < 1000) return;
  }
}

const removed = {};
const stuck = [];
for (const bucket of BUCKETS) {
  const found = new Set();
  for (const key of ["execA", "execB"]) {
    if (!clients[key]) continue;
    for (const uid of Object.values(ids)) {
      const list = [];
      await walk(clients[key], bucket, uid, list);
      list.forEach((p) => found.add(p));
    }
  }
  for (const path of found) {
    let done = false;
    const owner = Object.entries(ids).find(([, uid]) => path.startsWith(`${uid}/`))?.[0];
    for (const key of ["execA", owner].filter(Boolean)) {
      const res = await clients[key].storage.from(bucket).remove([path]);
      if (!res.error && (res.data || []).length) { done = true; break; }
    }
    if (done) removed[bucket] = (removed[bucket] || 0) + 1; else stuck.push({ bucket, path });
  }
}

if (pathsFile) {
  const list = JSON.parse(readFileSync(pathsFile, "utf8"));
  for (const { bucket, path } of list) {
    const owner = Object.entries(ids).find(([, uid]) => path.startsWith(`${uid}/`))?.[0];
    let done = false;
    for (const key of ["execA", owner].filter(Boolean)) {
      const res = await clients[key].storage.from(bucket).remove([path]);
      if (!res.error && (res.data || []).length) { done = true; break; }
    }
    if (done) removed[bucket] = (removed[bucket] || 0) + 1; else stuck.push({ bucket, path, why: "not removed (still registered by a row, or not visible to the executive or the owner)" });
  }
}

const financeLeft = stuck.filter((x) => x.bucket === "finance-private");
if (financeLeft.length) console.log(`${financeLeft.length} file(s) in finance-private still have a finance_documents record: run cleanup.sql, then run this script again.`);
console.log("removed through the Storage API:", JSON.stringify(removed));
const other = stuck.filter((x) => x.bucket !== "finance-private" || !financeLeft.includes(x));
if (other.length) { console.log("could not be removed:", JSON.stringify(other, null, 1)); process.exitCode = 1; }
else if (financeLeft.length) process.exitCode = 1;
console.log("Now run cleanup.sql on the test project, then cleanup-check.sql to confirm nothing is left.");
