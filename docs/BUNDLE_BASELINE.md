# Bundle size baseline (Phase 2.5, R0; reset in R5, R4 and Phase 3)

R0 of the refactoring plan: bundle size per route is reported before and after every step, and "per-route bundles no larger
than before" is part of the definition of done (R7). The first baseline (R0, commit `988b3b7`) had `/` at 273.8 kB gzip. After the data
layer and the file moves (R2, R3) `/` was at 280.4 kB; the R5 bundle diet (below) brought it to 265.5 kB, and this file now holds that
number, so the gain cannot be given back unnoticed. The R4 CSS split removed the unused rules and took the CSS from 27.0 to 23.0 kB gzip. Phase 3 (accessible dialogs, toasts, confirm, upload progress, previews, URL state, the account menu, the sign-up queue) took `/` to 270.0 kB gzip (+4.5, inside the 5 kB rule; the screens that grew most are lazy: JS that no first load needs went from 171.6 to 199.6 kB) and the CSS to 24.9 kB (12px text floor, 44px targets, focus rings).

| | |
|---|---|
| Date | 28 November 2026 |
| Commit | `1a5a616` on `phase-2-5-r5-clean` (R5 bundle diet, on top of the refactored `phase-2-5-r3`; the R0 numbers were taken at `988b3b7`) |
| Next.js | 16.2.6, Turbopack (`next build`) |
| Built with | `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-placeholder` (the CI values; they are inlined into the bundle, so sizes differ by a few bytes with real values) |
| Data | `docs/bundle-baseline.json` |

| Route | First-load JS gzip | brotli | raw | JS chunks | CSS gzip | CSS raw |
|---|---:|---:|---:|---:|---:|---:|
| `/` (the whole portal) | 270.0 kB | 231.9 kB | 950.2 kB | 9 | 24.9 kB | 134.3 kB |
| `/meetings` | 146.2 kB | 125.5 kB | 516.7 kB | 6 | 24.9 kB | 134.3 kB |
| `/_not-found` | 146.2 kB | 125.5 kB | 516.7 kB | 6 | 24.9 kB | 134.3 kB |

kB = 1000 bytes, as Next prints. gzip is level 9, brotli quality 11. Also in the JSON: JS that no route loads on a first visit
("lazy"): 171.6 kB gzip, 609.8 kB raw, 8 chunks. That is the legacy-browser polyfill chunk, the Tone.js / wavesurfer.js chunk loaded
on demand by the recording player, the attendance, finance and resources screens, and a few small split chunks (the R0 value was 163.2 kB
in 7 chunks: the data layer and hooks of R2/R3 add code to the screens that were already loaded on demand).

What this means for the refactor: about 146 kB gzip of every route is Next/React and the shared layout, and the portal itself
adds 119 kB gzip on `/`. Moving code behind `next/dynamic` lowers `/` and raises "lazy", which the compare output shows
separately so that moved code is not mistaken for removed code. All CSS (122.9 kB raw after R4 split `globals.css` into one file per area and removed 275 unused rules, one bundle in every route) is shared
by the three routes.

### R5 bundle diet: where the bytes were and what was done

After R2/R3 the first load of `/` had grown from 273.8 to 280.4 kB. A sourcemap build (`productionBrowserSourceMaps`, per-module bytes
of the first-load chunks, compared with the same build of `988b3b7`) showed: the portal's own code had grown by 5.7 kB gzip (the data
layer, hooks and smaller files), everything from packages was within 1 kB of before, and `framer-motion` was 36 kB gzip of the first load
(`motion-dom` 27 kB, `framer-motion` 8 kB), used only by the beat strip of the dashboard (`features/dashboard/components/talam-measure.tsx`,
`animate` and `transition` on a few spans). That component now uses `m` under `LazyMotion features={domMin}` (the animation set without layout,
drag and gestures): `/` 280.4 to 265.5 kB (-14.9 kB), identical animation at every step of a fake clock (tests/component/talam-measure*.test.tsx).
What is still in the first load: Next and React about 147 kB, the Supabase client about 55 kB (auth 27, realtime 15, storage 5, postgrest 4, the rest 4),
framer-motion about 21 kB, the portal about 36 kB.

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
