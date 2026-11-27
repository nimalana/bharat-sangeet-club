#!/usr/bin/env node
// Deletes the storage objects the e2e suite left behind, through the Storage API (the only supported way: a
// delete in SQL removes the metadata but not the file). Run it BEFORE cleanup.sql, because some bucket
// policies only allow a delete while the row that refers to the file still exists.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=sb_publishable_... \
//   NODE_USE_ENV_PROXY=1 node scripts/e2e/cleanup.mjs [--paths orphans.json]
//
// It signs in as the e2e accounts, walks each account's folder in every bucket as an executive, and removes what
// it finds (as the executive, or as the owner when the executive is refused).
// --paths takes a JSON array of {"bucket": "finance-private", "path": "<uid>/<file>"}: files that no row refers
// to any more are invisible to every policy, so they cannot be listed. For those it registers the path again
// as a temporary finance_documents record, deletes the file as an executive, and drops the record. Get the list with
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
    if (bucket !== "finance-private") { stuck.push({ bucket, path }); continue; }
    const temp = await clients.execA.from("finance_documents").insert({ document_type: "other", title: "[e2e] temporary record to delete a file", storage_path: path, mime_type: "image/png", file_size_bytes: 1, uploaded_by: ids.execA }).select("id").single();
    if (temp.error) { stuck.push({ bucket, path, why: describeError(temp.error) }); continue; }
    const res = await clients.execA.storage.from(bucket).remove([path]);
    await clients.execA.from("finance_documents").delete().eq("id", temp.data.id);
    if (!res.error && (res.data || []).length) removed[bucket] = (removed[bucket] || 0) + 1; else stuck.push({ bucket, path, why: res.error ? describeError(res.error) : "nothing removed" });
  }
}

console.log("removed through the Storage API:", JSON.stringify(removed));
if (stuck.length) { console.log("could not be removed:", JSON.stringify(stuck, null, 1)); process.exitCode = 1; }
console.log("Now run cleanup.sql on the test project, then cleanup-check.sql to confirm nothing is left.");
