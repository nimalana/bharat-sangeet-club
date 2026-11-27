#!/usr/bin/env node
// Per-route bundle size report for a finished `next build` (Next 16, Turbopack).   npm run report:bundle
//
//   npm run build
//   npm run report:bundle                                       print the table
//   npm run report:bundle -- --json out.json                    also write it as JSON
//   npm run report:bundle -- --compare docs/bundle-baseline.json [--max-growth-kb 5]
//                                                               print the delta per route; exit 1 when a route grew
//
// Where the numbers come from (Next 16.2.6 no longer prints "First Load JS" in the build output):
//   * .next/diagnostics/route-bundle-stats.json is what `next build` itself computes: per route, the chunks a first
//     visit loads. If it is missing the same set is rebuilt from .next/server/app/**/page_client-reference-manifest.js
//     (entryJSFiles) plus build-manifest.json rootMainFiles, which gives the same chunks (checked on 16.2.6).
//   * Each chunk is read from .next/static/chunks and measured raw, gzip (level 9) and brotli (quality 11).
//   * CSS of a route is the union of entryCSSFiles of its client-reference manifests.
//   * "lazy" is JS in .next/static/chunks that no route loads on first visit (dynamic imports).
// Sizes depend on the NEXT_PUBLIC_* values inlined at build time: build with the CI placeholders
// (https://example.supabase.co / ci-placeholder) to compare with docs/bundle-baseline.json. kB = 1000 bytes, as Next prints.
//
// Options: --dir <distDir> (default .next)  --json <file>  --compare <file>  --max-growth-kb <n> (default 5)
//          --metric gzip|raw|brotli (what --compare judges, default gzip)  --source stats|manifests (default: stats if present)
// Exit codes: 0 ok, 1 a route grew by more than --max-growth-kb (JS or CSS), 2 no build output / unreadable input.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const DIST = path.resolve(opt("--dir", ".next"));
const JSON_OUT = opt("--json");
const COMPARE = opt("--compare");
const MAX_GROWTH = Number(opt("--max-growth-kb", "5"));
const METRIC = opt("--metric", "gzip");
const SOURCE = opt("--source");
if (!["gzip", "raw", "brotli"].includes(METRIC) || !Number.isFinite(MAX_GROWTH)) { console.error("usage: bundle-report.mjs [--dir .next] [--json out.json] [--compare before.json] [--max-growth-kb 5] [--metric gzip|raw|brotli] [--source stats|manifests]"); process.exit(2); }
const die = (message) => { console.error(`bundle-report: ${message}`); process.exit(2); };
if (!fs.existsSync(path.join(DIST, "BUILD_ID"))) die(`no finished build in ${DIST} (run npm run build first)`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sizeCache = new Map();
function sizes(rel) { // rel: path under the dist dir, e.g. static/chunks/abc.js
  if (!sizeCache.has(rel)) {
    const file = path.join(DIST, rel);
    if (!fs.existsSync(file)) die(`${rel} is listed by the build but missing in ${DIST}`);
    const buf = fs.readFileSync(file);
    sizeCache.set(rel, { raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length, brotli: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length });
  }
  return sizeCache.get(rel);
}
const sum = (list) => list.reduce((t, rel) => { const s = sizes(rel); return { raw: t.raw + s.raw, gzip: t.gzip + s.gzip, brotli: t.brotli + s.brotli }; }, { raw: 0, gzip: 0, brotli: 0 });
const underDist = (p) => { const i = p.indexOf("static/"); return i >= 0 ? p.slice(i) : p; }; // ".next/static/chunks/x.js" and "/_next/static/chunks/x.js" -> "static/chunks/x.js"

// ---- client reference manifests: entryCSSFiles / entryJSFiles per route ------------------------------------
function loadClientManifests() {
  const out = new Map(); // route -> { css:Set, js:Set }
  const appDir = path.join(DIST, "server", "app");
  const walk = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === "page_client-reference-manifest.js" ? [path.join(dir, e.name)] : []) : [];
  for (const file of walk(appDir)) {
    const sandbox = {}; sandbox.globalThis = sandbox; vm.createContext(sandbox);
    try { vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { timeout: 5000 }); } catch { continue; }
    for (const [key, value] of Object.entries(sandbox.__RSC_MANIFEST || {})) {
      const route = key.replace(/\/page$/, "") || "/";
      const entry = out.get(route) || out.set(route, { css: new Set(), js: new Set() }).get(route);
      for (const list of Object.values(value.entryCSSFiles || {})) for (const f of list) entry.css.add(underDist(typeof f === "string" ? f : f.path));
      for (const list of Object.values(value.entryJSFiles || {})) for (const f of list) entry.js.add(underDist(f));
    }
  }
  return out;
}

// ---- routes -----------------------------------------------------------------------------------------------------------
const manifests = loadClientManifests();
const statsFile = path.join(DIST, "diagnostics", "route-bundle-stats.json");
const useStats = SOURCE ? SOURCE === "stats" : fs.existsSync(statsFile);
const firstLoad = new Map(); // route -> js chunks (relative to dist dir)
let source;
if (useStats) {
  if (!fs.existsSync(statsFile)) die(`${statsFile} does not exist (try --source manifests)`);
  source = "route-bundle-stats";
  for (const r of readJson(statsFile)) firstLoad.set(r.route, r.firstLoadChunkPaths.map(underDist));
} else {
  source = "client-reference-manifests";
  const build = readJson(path.join(DIST, "build-manifest.json"));
  const root = build.rootMainFiles || [];
  const known = fs.existsSync(path.join(DIST, "app-path-routes-manifest.json")) ? new Set(Object.values(readJson(path.join(DIST, "app-path-routes-manifest.json")))) : null;
  // /_global-error is built but Next does not report it; leave it out so both sources list the same routes
  for (const [route, entry] of manifests) if ((!known || known.has(route)) && !route.startsWith("/_global-error")) firstLoad.set(route, [...new Set([...root, ...entry.js])]);
}
if (!firstLoad.size) die("the build lists no routes");

const routes = {};
for (const route of [...firstLoad.keys()].sort()) {
  const js = [...new Set(firstLoad.get(route))].sort();
  const css = [...(manifests.get(route)?.css || [])].sort();
  const j = sum(js), c = sum(css);
  routes[route] = { jsRaw: j.raw, jsGzip: j.gzip, jsBrotli: j.brotli, cssRaw: c.raw, cssGzip: c.gzip, cssBrotli: c.brotli, jsChunks: js.length, cssFiles: css.length };
}

// everything in .next/static/chunks, to separate first-load from lazy
const allChunks = fs.readdirSync(path.join(DIST, "static", "chunks")).filter((f) => f.endsWith(".js")).map((f) => `static/chunks/${f}`);
const loaded = new Set([...firstLoad.values()].flat());
const lazy = sum(allChunks.filter((f) => !loaded.has(f)));
const all = sum(allChunks);
const totals = { jsRawAll: all.raw, jsGzipAll: all.gzip, jsChunksAll: allChunks.length, lazyRaw: lazy.raw, lazyGzip: lazy.gzip, lazyBrotli: lazy.brotli, lazyChunks: allChunks.filter((f) => !loaded.has(f)).length };

const git = (...args) => { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const nextVersion = (() => { try { return readJson(path.join(path.dirname(DIST), "node_modules", "next", "package.json")).version; } catch { return ""; } })();
const report = {
  schema: 1,
  generated: new Date().toISOString(),
  commit: git("rev-parse", "--short", "HEAD") + (git("status", "--porcelain", "--untracked-files=no") ? "-dirty" : ""),
  branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  next: nextVersion,
  source,
  placeholderEnv: process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co" && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === "ci-placeholder",
  routes,
  totals,
};

// ---- output ---------------------------------------------------------------------------------------------------------------
const kb = (n) => (n / 1000).toFixed(1);
const signed = (n) => `${kb(n) === "-0.0" ? "+0.0" : n >= 0 ? "+" + kb(n) : kb(n)}`;
const pad = (s, n, left = false) => (left ? String(s).padStart(n) : String(s).padEnd(n));
function table(rows, head) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((cell, i) => pad(cell, widths[i], i > 0)).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}
console.log(`Bundle report (${report.source}; next ${report.next || "?"}; commit ${report.commit || "?"}; sizes in kB = 1000 bytes)\n`);
console.log(table(Object.entries(routes).map(([route, r]) => [route, kb(r.jsGzip), kb(r.jsBrotli), kb(r.jsRaw), r.jsChunks, kb(r.cssGzip), kb(r.cssRaw)]), ["Route", "JS gzip", "JS brotli", "JS raw", "chunks", "CSS gzip", "CSS raw"]));
console.log(`\nJS in .next/static/chunks: ${kb(totals.jsGzipAll)} kB gzip in ${totals.jsChunksAll} chunks; lazy (not on any first load): ${kb(totals.lazyGzip)} kB gzip, ${kb(totals.lazyRaw)} kB raw in ${totals.lazyChunks} chunks`);
if (!report.placeholderEnv) console.log("note: NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are not the CI placeholders; sizes include your values (compare only with a build made with the same ones)");
if (JSON_OUT) { fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true }); fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n"); console.log(`wrote ${JSON_OUT}`); }

// ---- compare --------------------------------------------------------------------------------------------------------------
if (COMPARE) {
  let before;
  try { before = readJson(COMPARE); } catch (error) { die(`cannot read ${COMPARE}: ${error.message}`); }
  const key = { gzip: ["jsGzip", "cssGzip"], raw: ["jsRaw", "cssRaw"], brotli: ["jsBrotli", "cssBrotli"] }[METRIC];
  console.log(`\nCompared with ${COMPARE} (commit ${before.commit || "?"}, ${String(before.generated || "").slice(0, 10)}); judged on ${METRIC} bytes; a route fails when its JS or CSS grew by more than ${MAX_GROWTH} kB`);
  if (before.next && report.next && before.next !== report.next) console.log(`warning: Next ${before.next} before, ${report.next} now: sizes are not directly comparable`);
  if (before.placeholderEnv !== report.placeholderEnv) console.log(`warning: the baseline was built ${before.placeholderEnv ? "with" : "without"} the CI placeholders and this build ${report.placeholderEnv ? "with" : "without"} them`);
  const rows = []; let grew = 0;
  for (const route of [...new Set([...Object.keys(before.routes), ...Object.keys(routes)])].sort()) {
    const a = before.routes[route], b = routes[route];
    if (!a) { rows.push([route, "-", `${kb(b[key[0]])}`, "new route", `${kb(b[key[1]])}`, "", ""]); continue; }
    if (!b) { rows.push([route, `${kb(a[key[0]])}`, "-", "route removed", "", "", ""]); continue; }
    const dj = b[key[0]] - a[key[0]], dc = b[key[1]] - a[key[1]];
    const bad = dj > MAX_GROWTH * 1000 || dc > MAX_GROWTH * 1000;
    if (bad) grew++;
    rows.push([route, kb(a[key[0]]), kb(b[key[0]]), signed(dj), `${kb(a[key[1]])} > ${kb(b[key[1]])}`, signed(dc), bad ? "GREW" : "ok"]);
  }
  console.log(table(rows, ["Route", `JS before`, "JS now", "JS delta", "CSS before > now", "CSS delta", ""]));
  const lazyDelta = totals.lazyGzip - (before.totals?.lazyGzip ?? totals.lazyGzip);
  console.log(`\nlazy JS (gzip): ${kb(before.totals?.lazyGzip ?? 0)} > ${kb(totals.lazyGzip)} kB (${signed(lazyDelta)}); not judged, shown so that code moved out of a first load is not mistaken for code removed`);
  if (grew) { console.error(`\nFAIL: ${grew} route(s) grew by more than ${MAX_GROWTH} kB`); process.exit(1); }
  console.log(`\nok: no route grew by more than ${MAX_GROWTH} kB`);
}
