# Bundle size baseline (Phase 2.5, R0)

R0 of the refactoring plan: bundle size per route is reported before and after every step, and "per-route bundles no larger
than before" is part of the definition of done (R7). This is the "before".

| | |
|---|---|
| Date | 27 November 2026 |
| Commit | `988b3b7` on `phase-2-5-r1-contract` (product code identical to `phase-2-latency` 4dc9c1a: R1 changes no file under `app/`, `components/`, `lib/`) |
| Next.js | 16.2.6, Turbopack (`next build`) |
| Built with | `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-placeholder` (the CI values; they are inlined into the bundle, so sizes differ by a few bytes with real values) |
| Data | `docs/bundle-baseline.json` |

| Route | First-load JS gzip | brotli | raw | JS chunks | CSS gzip | CSS raw |
|---|---:|---:|---:|---:|---:|---:|
| `/` (the whole portal) | 273.8 kB | 235.3 kB | 974.0 kB | 9 | 27.0 kB | 145.9 kB |
| `/meetings` | 146.2 kB | 125.5 kB | 516.7 kB | 6 | 27.0 kB | 145.9 kB |
| `/_not-found` | 146.2 kB | 125.5 kB | 516.7 kB | 6 | 27.0 kB | 145.9 kB |

kB = 1000 bytes, as Next prints. gzip is level 9, brotli quality 11. Also in the JSON: JS that no route loads on a first visit
("lazy"): 163.2 kB gzip, 583.0 kB raw, 7 chunks. That is the legacy-browser polyfill chunk, the Tone.js / wavesurfer.js chunk loaded
on demand by the recording player, and a few small split chunks.

What this means for the refactor: about 146 kB gzip of every route is Next/React and the shared layout, and the portal itself
adds 128 kB gzip on `/`. Splitting `app/page.tsx` (R3) should keep `/` at or below 273.8 kB; moving code behind `next/dynamic`
lowers `/` and raises "lazy", which the compare output shows separately so that moved code is not mistaken for removed code. All CSS
(`globals.css`, 145.9 kB raw, one file in every route) is shared by the three routes; R4 changes this number.

## How it is measured

Next 16 no longer prints "First Load JS" in the `next build` route table. `scripts/bundle-report.mjs` reads what the build leaves
behind: `.next/diagnostics/route-bundle-stats.json` (the chunks Next itself says a first visit loads, per route), falling back to
`.next/server/app/**/page_client-reference-manifest.js` plus `build-manifest.json` (same chunks, verified identical on 16.2.6;
`--source manifests` forces it), then measures every chunk raw, gzip and brotli, and CSS from `entryCSSFiles`.
A rebuild of the same commit gives byte-identical numbers; a build in another directory differs by under 40 bytes (module ids).

```bash
env NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-placeholder npm run build
npm run report:bundle                                            # the table
npm run report:bundle -- --json after.json                       # keep it
npm run report:bundle -- --compare docs/bundle-baseline.json     # delta per route; exit 1 if a route's JS or CSS grew by more than 5 kB
npm run report:bundle -- --compare docs/bundle-baseline.json --max-growth-kb 2 --metric raw
```

CI runs the compare after the build (job `app`). A refactor step that makes a route larger fails there; if the growth is
intended (new feature code), regenerate the baseline in the same pull request with `--json docs/bundle-baseline.json` and say why.
A step that makes a route smaller passes; lower the baseline when it is merged so that the gain cannot be given back unnoticed.
