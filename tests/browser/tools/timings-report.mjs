#!/usr/bin/env node
// Turns OUT/timings.json (written by `npm run test:browser:timings`) into the tables of docs/BROWSER_TIMINGS.md.
//   node tests/browser/tools/timings-report.mjs [timings.json] > table.md
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { OUT } from "../support/config.mjs";

// With no argument: every OUT/timings*.json (a second file holds the extra measurements run with E2E_TIMINGS_FILE=timings-extra.json).
const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(OUT).filter((f) => /^timings.*\.json$/.test(f)).sort().map((f) => path.join(OUT, f));
const data = { results: files.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).results) };
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2); };
const groups = new Map();
for (const row of data.results.filter((r) => r.mode === "load" || r.mode === "nav")) {
  const key = `${row.role}|${row.screen}|${row.mode}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const summarise = (rows) => {
  const counts = rows.map((r) => r.requestCount);
  const names = [...new Set(rows.flatMap((r) => r.requests.map((q) => q.label)))];
  const per = names.map((name) => { const n = median(rows.map((r) => r.requests.filter((q) => q.label === name).length)); return n > 1 ? `${name} x${n}` : name; });
  return {
    n: rows.length,
    contentMedian: median(rows.map((r) => r.contentMs)), contentWorst: Math.max(...rows.map((r) => r.contentMs)),
    requestsMedian: median(counts), requestsWorst: Math.max(...counts),
    waves: median(rows.map((r) => new Set(r.requests.map((q) => Math.round(q.startMs / 150))).size)),
    which: per.join(", "),
    duplicates: [...new Set(rows.flatMap((r) => r.duplicates))].join(", "),
    ttfb: median(rows.map((r) => r.nav?.ttfb ?? 0)), fcp: median(rows.map((r) => r.nav?.firstContentfulPaint ?? 0)), load: median(rows.map((r) => r.nav?.load ?? 0)),
    problems: rows.reduce((t, r) => t + r.problems.length, 0),
  };
};
const out = [];
for (const mode of ["load", "nav"]) {
  out.push(`### ${mode === "load" ? "Opening the address (full page load, empty cache)" : "Clicking the navigation entry (shell already open)"}\n`);
  out.push("| Role | Screen | Content visible, median / worst (ms) | Supabase requests, median / worst | Waves | Requests (median) | Repeated requests | First contentful paint (median ms) | Problems |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const [key, rows] of groups) {
    const [role, screen, m] = key.split("|");
    if (m !== mode) continue;
    const s = summarise(rows);
    out.push(`| ${role} | ${screen} | ${s.contentMedian} / ${s.contentWorst} | ${s.requestsMedian} / ${s.requestsWorst} | ${s.waves} | ${s.which || "none"} | ${s.duplicates || "-"} | ${mode === "load" ? s.fcp : "n/a"} | ${s.problems} |`);
  }
  out.push("");
}
const revisits = data.results.filter((r) => r.mode === "revisit");
if (revisits.length) {
  out.push("### Opening a screen a second time from the navigation (the Overview in between)\n");
  out.push("| Role | Screen | First visit, median (ms) | Second visit, median / worst (ms) | Requests on the second visit (median) | Which |");
  out.push("|---|---|---|---|---|---|");
  const keys = [...new Set(revisits.map((r) => `${r.role}|${r.screen}`))];
  for (const key of keys) {
    const rows = revisits.filter((r) => `${r.role}|${r.screen}` === key);
    const names = [...new Set(rows.flatMap((r) => r.requests.map((q) => q.label)))];
    const which = names.map((name) => { const n = median(rows.map((r) => r.requests.filter((q) => q.label === name).length)); return n > 1 ? `${name} x${n}` : name; }).filter((x) => !x.startsWith("undefined"));
    out.push(`| ${key.split("|")[0]} | ${key.split("|")[1]} | ${median(rows.map((r) => r.firstMs))} | ${median(rows.map((r) => r.contentMs))} / ${Math.max(...rows.map((r) => r.contentMs))} | ${median(rows.map((r) => r.requestCount))} | ${which.join(", ") || "none"} |`);
  }
  out.push("");
}
const idle = data.results.filter((r) => r.mode === "idle");
if (idle.length) {
  out.push(`### What the open attendance screen sends by itself (${idle[0].idleSeconds} seconds, nobody touching it)\n`);
  out.push("| Role | Supabase requests in that time | Which, and at what second |\n|---|---|---|");
  for (const r of idle) out.push(`| ${r.role} | ${r.requestCount} | ${r.requests.map((q) => `${q.label} @${q.atSecond}s`).join(", ") || "none"} |`);
  out.push("");
}
const paints = data.results.filter((r) => r.mode === "paint");
if (paints.length) {
  out.push("### First paint of a signed-in visit to / (what is on top, ms since the navigation started)\n");
  out.push("| Role | Public landing page on top from / until (median) | Loading screen from / until (median) | Portal from (median) | Runs with the public page painted first |");
  out.push("|---|---|---|---|---|");
  const roles = [...new Set(paints.map((r) => r.role))];
  for (const role of roles) {
    const rows = paints.filter((r) => r.role === role);
    const m = (key) => { const v = rows.map((r) => r[key]).filter((x) => x !== null); return v.length ? median(v) : "-"; };
    out.push(`| ${role} | ${m("publicFrom")} / ${m("publicUntil")} | ${m("loadingFrom")} / ${m("loadingUntil")} | ${m("portalFrom")} | ${rows.filter((r) => r.publicFrom !== null).length} of ${rows.length} |`);
  }
}
console.log(out.join("\n"));
