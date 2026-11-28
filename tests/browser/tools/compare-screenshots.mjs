#!/usr/bin/env node
// Compares two folders of screenshots (default: the committed baseline against the last run) and prints the share of pixels that differ,
// per screen and width. It never fails a run on its own: it reports. For R4 (the CSS split) run it before and after a change on the
// SAME fixtures (E2E_REUSE=1), then look at anything above the tolerance.
//
//   node tests/browser/tools/compare-screenshots.mjs [baselineDir] [currentDir] [--tolerance 0.002] [--fail-over 0.01] [--json out.json]
//
// No image library: Chromium (the one Playwright already has) decodes both pictures and compares them in a canvas. A pixel counts as
// different when any colour channel differs by more than 24 of 255, which ignores JPEG noise. A size difference counts as 100 %.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { BASELINE_DIR, OUT } from "../support/config.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const baselineDir = positional[0] ? path.resolve(positional[0]) : BASELINE_DIR;
const currentDir = positional[1] ? path.resolve(positional[1]) : path.join(OUT, "shots");
const tolerance = Number(flag("--tolerance", "0.002"));
const failOver = flag("--fail-over", null);

if (!existsSync(baselineDir)) throw new Error(`No baseline at ${baselineDir}. Create it with: npm run test:browser:update`);
if (!existsSync(currentDir)) throw new Error(`No current screenshots at ${currentDir}. Run: npm run test:browser`);
const names = readdirSync(baselineDir).filter((f) => /\.(jpe?g|png)$/.test(f)).sort();

const executablePath = process.env.E2E_CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage();
const mime = (f) => (f.endsWith(".png") ? "image/png" : "image/jpeg");
const rows = [];
for (const name of names) {
  const current = path.join(currentDir, name);
  if (!existsSync(current)) { rows.push({ name, status: "missing", ratio: null }); continue; }
  const a = `data:${mime(name)};base64,${readFileSync(path.join(baselineDir, name)).toString("base64")}`;
  const b = `data:${mime(name)};base64,${readFileSync(current).toString("base64")}`;
  const result = await page.evaluate(async ([left, right]) => {
    const load = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
    const [x, y] = await Promise.all([load(left), load(right)]);
    if (x.width !== y.width || x.height !== y.height) return { sizeDiffers: true, sizes: [`${x.width}x${x.height}`, `${y.width}x${y.height}`] };
    const draw = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const p = draw(x); const q = draw(y);
    let different = 0;
    let [x0, y0, x1, y1] = [x.width, x.height, -1, -1];
    for (let i = 0; i < p.length; i += 4) {
      if (Math.abs(p[i] - q[i]) > 24 || Math.abs(p[i + 1] - q[i + 1]) > 24 || Math.abs(p[i + 2] - q[i + 2]) > 24) {
        different += 1;
        const px = (i / 4) % x.width; const py = Math.floor(i / 4 / x.width);
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
    }
    return { ratio: different / (p.length / 4), pixels: p.length / 4, box: different ? `${x0},${y0} to ${x1},${y1}` : null };
  }, [a, b]);
  rows.push(result.sizeDiffers ? { name, status: "size", ratio: 1, note: result.sizes.join(" vs ") } : { name, status: result.ratio > tolerance ? "differs" : "same", ratio: result.ratio, note: result.box ? `differing pixels lie within ${result.box}` : undefined });
}
for (const name of readdirSync(currentDir).filter((f) => /\.(jpe?g|png)$/.test(f))) if (!names.includes(name)) rows.push({ name, status: "new", ratio: null });
await browser.close();

console.log(`baseline ${baselineDir}\ncurrent  ${currentDir}\ntolerance ${(tolerance * 100).toFixed(2)} % of pixels\n`);
for (const row of rows) console.log(`${row.status.padEnd(8)} ${row.ratio === null ? "   n/a" : `${(row.ratio * 100).toFixed(2).padStart(6)} %`}  ${row.name}${row.note ? `  (${row.note})` : ""}`);
const worst = Math.max(0, ...rows.map((r) => r.ratio ?? 0));
console.log(`\n${rows.filter((r) => r.status === "same").length} same, ${rows.filter((r) => ["differs", "size"].includes(r.status)).length} different, ${rows.filter((r) => r.status === "missing").length} missing, ${rows.filter((r) => r.status === "new").length} new; worst ${(worst * 100).toFixed(2)} %`);
if (flag("--json", null)) writeFileSync(flag("--json"), JSON.stringify(rows, null, 1));
if (failOver !== null && worst > Number(failOver)) process.exitCode = 1;
