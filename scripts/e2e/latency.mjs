#!/usr/bin/env node
// Latency of the screen-loading calls, as a member and as an executive, against the TEST project.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=sb_publishable_... \
//   NODE_USE_ENV_PROXY=1 node scripts/e2e/latency.mjs [--runs 10] [--json out.json]
//
// Each call is made through supabase-js exactly as the app makes it (the same select, filters, order and range),
// one warm-up call that is not counted, then N timed runs one after another. The network floor is
// GET auth/v1/health, which does no database work: it is the cost of reaching Supabase from this machine.
// "net" is the median of the call minus the median of the floor.
//
// Run it on a project that does not hold the seed data to measure the empty-database cost; run
// cleanup.mjs + cleanup.sql first so that leftovers from the functional suite are not in the way.
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "./lib/config.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { applyListPlan, buildListPlan } from "../../lib/resources-query.ts";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const RUNS = Number(flag("--runs") || 10);
const jsonPath = flag("--json");
const cfg = loadConfig();

const RESOURCE_FIELDS = "id,node_kind,media_kind,title,description,parent_id,subgroup_id,visibility,storage_bucket,storage_path,external_url,original_filename,mime_type,byte_size,checksum_sha256,event_id,occurred_on,season_label,status,is_pinned,import_id,created_by,created_at,updated_at";

// The gateway reports how long the upstream (PostgREST plus the database, or GoTrue for the health check) took to
// answer, in whole milliseconds, in the x-envoy-upstream-service-time response header. It is the server-side share of
// each call, so the difference between the call and this figure is the network and the client.
let lastUpstream = null;
const timedFetch = async (input, init) => {
  const response = await fetch(input, init);
  const value = response.headers.get("x-envoy-upstream-service-time");
  lastUpstream = value == null ? null : Number(value);
  return response;
};

// Nearest-rank percentile: with 10 runs, p95 is the slowest run.
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const median = (sorted) => (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

async function signIn(key) {
  const client = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: timedFetch } });
  const { error } = await client.auth.signInWithPassword({ email: ACCOUNTS[key].email, password: cfg.passwords[key] });
  if (error) throw new Error(`sign-in as ${key} failed: ${error.message}`);
  return client;
}

// The calls, in the order the screens make them. Each returns the supabase-js promise.
const CALLS = [
  ["get_portal_bootstrap", (c) => c.rpc("get_portal_bootstrap")],
  ["get_attendance_workspace", (c) => c.rpc("get_attendance_workspace", { p_scope: "all", p_subgroup_id: null })],
  ["get_finance_summary", (c) => c.rpc("get_finance_summary")],
  ["recordings list (page 1 of 24, count)", (c) => c.from("recordings").select("*", { count: "exact" }).eq("status", "published").order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 23)],
  ["resources list (top level, 100, count)", (c) => applyListPlan(c.from("resources").select(RESOURCE_FIELDS, { count: "exact" }), buildListPlan({ folderId: null, scope: "all", tab: "all", search: "", sort: "updated", archived: false, offset: 0, limit: 100 }))],
  ["members list (active, 2000)", (c) => c.from("profiles").select("id,full_name,email,role,phone,class_year,specialty,joined_at").eq("status", "active").order("full_name").limit(2000)],
];

async function time(fn) {
  lastUpstream = null;
  const started = performance.now();
  const res = await fn();
  const ms = performance.now() - started;
  if (res && res.error) throw new Error(res.error.message || JSON.stringify(res.error));
  return { ms, upstream: lastUpstream, rows: Array.isArray(res?.data) ? res.data.length : res?.data ? 1 : 0, bytes: JSON.stringify(res?.data ?? null).length };
}

// Each timed run of a call is paired with a health-check run made just before it, so slow moments on the network
// hit both and the "net" figure (call minus floor) is not thrown off by drift between two separate batches.
async function measure(label, fn, floorFn) {
  const first = await time(fn); // warm-up, reported separately
  await time(floorFn);
  const runs = []; const floors = []; const upstream = [];
  let rows = first.rows; let bytes = first.bytes;
  for (let i = 0; i < RUNS; i++) {
    floors.push((await time(floorFn)).ms);
    const r = await time(fn);
    runs.push(r.ms); if (r.upstream != null) upstream.push(r.upstream); rows = r.rows; bytes = r.bytes;
  }
  const sorted = [...runs].sort((a, b) => a - b);
  const floorSorted = [...floors].sort((a, b) => a - b);
  const up = [...upstream].sort((a, b) => a - b);
  return {
    label, warmup: Math.round(first.ms), median: Math.round(median(sorted)), p95: Math.round(percentile(sorted, 95)), min: Math.round(sorted[0]), max: Math.round(sorted[sorted.length - 1]),
    floorMedian: Math.round(median(floorSorted)), floorP95: Math.round(percentile(floorSorted, 95)),
    serverMedian: up.length ? median(up) : null, serverP95: up.length ? percentile(up, 95) : null, rows, bytes, runs: runs.map((x) => Math.round(x)), floorRuns: floors.map((x) => Math.round(x)), serverRuns: upstream,
  };
}

const health = () => timedFetch(`${cfg.url}/auth/v1/health`, { headers: { apikey: cfg.key } }).then((r) => { if (!r.ok) throw new Error(`health returned ${r.status}`); return r.arrayBuffer(); }).then(() => ({ error: null, data: [] }));

console.log(`Latency against ${cfg.ref}: ${RUNS} timed runs per call after one warm-up, one call at a time, each run paired with a health-check run.`);
const result = { project: cfg.ref, runs: RUNS, measuredAt: new Date().toISOString(), floor: await measure("network floor: GET auth/v1/health", health, health), roles: {} };
for (const [role, key] of [["member", "member1"], ["executive", "execA"]]) {
  const client = await signIn(key);
  result.roles[role] = [];
  for (const [label, fn] of CALLS) result.roles[role].push(await measure(label, () => fn(client), health));
}

const pad = (v, n) => String(v).padEnd(n);
console.log(`\nnetwork floor (GET auth/v1/health, alone): median ${result.floor.median} ms, p95 ${result.floor.p95} ms, min ${result.floor.min} ms, max ${result.floor.max} ms (gateway upstream time median ${result.floor.serverMedian} ms)`);
for (const [role, rows] of Object.entries(result.roles)) {
  console.log(`\n${role}`);
  console.log(`${pad("call", 42)}${pad("median", 8)}${pad("p95", 7)}${pad("floor med", 11)}${pad("net median", 12)}${pad("net p95", 9)}${pad("server med/p95", 16)}${pad("rows", 6)}${pad("kB", 7)}warm-up`);
  for (const r of rows) {
    r.netMedian = r.median - r.floorMedian; r.netP95 = r.p95 - r.floorMedian;
    console.log(`${pad(r.label, 42)}${pad(r.median, 8)}${pad(r.p95, 7)}${pad(r.floorMedian, 11)}${pad(r.netMedian, 12)}${pad(r.netP95, 9)}${pad(`${r.serverMedian ?? "?"} / ${r.serverP95 ?? "?"}`, 16)}${pad(r.rows, 6)}${pad((r.bytes / 1024).toFixed(1), 7)}${r.warmup}`);
  }
}
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(result, null, 2));
