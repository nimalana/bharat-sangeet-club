# Browser smoke tests

A real Chromium opens the real, built portal and walks it as each kind of person. It exists so that the refactors of Phase 2.5
(types and data layer, file moves, CSS split) can be checked against what a person actually sees, which the unit tests, the SQL
suites and the API-level suite (`scripts/e2e`) cannot show.

It is **not** part of `npm test`. It talks to the real **test** Supabase project (`bharat-sangeet-test`, ref `bldytniesexkwbtyinsi`),
signs in as the synthetic e2e accounts, creates and deletes rows there, runs `next build` and `next start`, and takes a few minutes.

```
npm run test:browser            # the whole suite: 39 tests, plus 6 skipped known-problem tests (see the end); about 3 minutes
npm run test:browser:update     # same, and writes the screenshot baseline to tests/browser/__screenshots__
npm run test:browser:compare    # pixel-diff ratio of the last run's screenshots against the baseline (never fails by itself)
npm run test:browser:timings    # real load numbers, 5 runs per role and screen, then prints the tables (about 25 minutes)
```

## What you need

* `SUPABASE_URL` and `SUPABASE_KEY` of the **test** project (or the `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pair).
  The key is the publishable one. Nothing secret is stored in the repository.
* The generated passwords of the e2e accounts: `E2E_SECRETS` (default `/tmp/claude-0/e2e/secrets.json`), written by
  `scripts/e2e/gen-setup-sql.mjs`. The accounts and their SQL setup are described in `scripts/e2e/README.md`.
* Chromium. The container has one at `/opt/pw-browsers/chromium` (the config uses it; do not run `playwright install`).
  `E2E_CHROMIUM` points at another binary. Behind the agent proxy the config tells Chromium about `HTTPS_PROXY` and bypasses it for
  `localhost`; the Node side needs `NODE_USE_ENV_PROXY=1`, which the npm scripts set.
* `@playwright/test` 1.63.0 (a devDependency, pinned to the version the container ships).

## What a run does

1. **Guard.** Refuses to start unless `SUPABASE_URL` is `https://bldytniesexkwbtyinsi.supabase.co` (stricter than `scripts/e2e`, which only
   refuses the two production refs). While tests run, every browser context also aborts a request to any other `*.supabase.co` project.
2. **Accounts.** Signs in the e2e accounts once through the API (the sign-in endpoint is rate limited, so a run never signs in per test),
   promotes the two executives if needed, and **deactivates** the "victim" account for the deactivated-member tests.
3. **Fixtures.** Seeds, through the API and with the app's own calls, everything the screens show (listed below), every title carrying
   `[e2e]` and the run id.
4. **Build and serve.** Deletes `.next`, runs `next build` with the test project's URL and key (the landing page is prerendered with the
   seeded public concert, so the data must exist first, and Next's fetch cache must not carry a concert over from an earlier build), then
   `next start` on a free port, bound to 127.0.0.1.
5. **Tests**, one worker, in this order: admin, deactivated, executive, findings, manager, member, public, then the journeys (last, because
   they change the fixtures).
6. **Teardown**, always, also after a failure: the victim is **reactivated**, and what the app is allowed to delete is deleted through
   the API (events, announcements, resources and recordings with their files, archive items), unless `E2E_KEEP=1`.

### How it signs in without touching the app

supabase-js keeps its session in `localStorage` under `sb-<ref>-auth-token` (`persistSession`). `support/test.mjs` adds an init script
to the browser context that writes the session obtained in step 2 under that key before any page script runs. The portal then starts
exactly as it does for a returning user: it reads the stored session, asks `get_portal_bootstrap`, and renders. The app has no test hook
and nothing under `app/`, `components/` or `lib/` was changed for the suite.

A session stays valid after a deactivation (the database, not the token, refuses a deactivated member); the deactivated tests rely on that.

### The guard on every page

Each test gets a `guard` (auto fixture). The test **fails** on: a `console.error`, an uncaught page error, a failed request, or any
HTTP 4xx/5xx from Supabase or from the app, unless the test listed it with `guard.allow({ ..., reason })`. An allowance must say why the
answer is the right one (for example "the deactivated member's direct read is answered 401 by the database"). An allowance nobody hit is
reported by `guard.unusedAllowances()`, so a stale one shows.

The two third-party hero photos of the public site are replaced by a 1x1 PNG, so the network policy and the photo hosts cannot change a run.

## Roles

| Name in the specs | Account | What it is |
|---|---|---|
| `admin` | e2e-admin | Administrator |
| `executive` | e2e-exec-a | Executive (promoted through `admin_change_member_role` by the setup) |
| `manager` | e2e-manager | Plain member who manages group A (the club role gives nothing; the group does) |
| `member` | e2e-member1 | Plain member of group A |
| `deactivated` | e2e-victim | Member who is deactivated before the tests and reactivated after |
| `anon` | none | A visitor |

## What the tests check

For every role and screen (`support/smoke.mjs`, `support/screens.mjs`): the screen is opened by its address; **content** (not just the
heading, several screens print the heading first and load data later) is visible; the navigation lists exactly what the role may open;
what the role must not see is absent (no Admin entry, no ledger, no "New group", no date editing, ...); and the guard stays quiet.

| File | Tests | Would catch |
|---|---|---|
| `specs/admin.spec.mjs` | Admin screen (members, audit, deactivated hidden by default), the administrator's navigation, every other screen with the "Admin view" label | A role gate that stops working; the Admin screen failing to load its three lists |
| `specs/executive.spec.mjs` | The 8 screens as an executive, the navigation | A screen that stops loading its data, a console error, a 4xx/5xx, a missing landmark |
| `specs/manager.spec.mjs` | Navigation, the waiting request and group settings in their group, no club-wide management, a member's finances and calendar | A group manager gaining or losing group powers, or gaining club powers |
| `specs/member.spec.mjs` | The 8 screens as a member, the navigation | A member seeing the club ledger, an executive's expense, an Admin entry, a posting button |
| `specs/deactivated.spec.mjs` | Only the deactivated notice, no data request; no screen reachable by address; direct reads answered with nothing | A deactivated member reaching anything; a data request being sent before the status is known |
| `specs/public.spec.mjs` | Landing page with the public archive and nothing from members; a public concert's signed link is requested in `club-archive`; sign-in screen; an old `/meetings` link | The public archive leaking a members-only item; a broken public page; a data request on the public site |
| `specs/write-journeys.spec.mjs` | 10 journeys, listed below | A journey breaking in the browser while every API test still passes |
| `specs/findings.spec.mjs` | Six product problems (F1 to F6), `test.fixme`, see the end | Nothing until fixed, then the problem coming back |
| `specs/timings.spec.mjs` | Not in the default run; see `docs/BROWSER_TIMINGS.md` | Nothing: it measures |

The 10 journeys (each runs once, as the role that does it, and proves the effect outside the screen where that matters):

1. member checks in to the open attendance session with its code, and the history shows it
2. member submits a reimbursement with a receipt upload
3. member uploads a recording, publishes it with a notation text note, and the note is there when it is opened
4. member removes their own extra receipt: the toast reports success and the file is gone from `finance-private` storage
5. group manager approves a join request and the member appears in the group
6. executive marks an approved reimbursement paid through the confirm dialog
7. executive creates a funding claim from an unclaimed expense
8. executive removes a member's extra receipt: the toast reports success and the file is gone from storage
9. executive deletes a resource: storage's own answer to the delete lists the file, the file's delete is sent before the row's, then the library no longer lists it (once the row is gone nobody can read the orphaned object, so "gone from storage" cannot be asked of storage afterwards)
10. executive voids a club expense with a reason: it stays listed as voided and loses its actions

The tests assert on rendered output (visible text, roles, labels, CSS class names the screens already use) and on calls made. They never
read source files, so they keep passing while R3 moves files. A CSS class is part of what the screens render; if R4 renames one, the
single place to update is `support/screens.mjs`.

## Fixtures (`support/fixtures.mjs`)

All titles are `[e2e] BR <name> <run id>` (`mark()` of `scripts/e2e/lib/ctx.mjs`), which is what `cleanup.sql` matches.

* **groups**: "BR Group A" (approval): manager, leader, members member1 and victim, two waiting join requests (nohist's is approved by a
  journey, hist's stays so the manager screen always has one); "BR Open Group" (open)
* **calendar**: a club date today, a group-A date in three days, a date next month; a pinned club announcement and a group-A announcement
* **recordings**: one published group-A take by member1 with a text note
* **resources**: a folder with a link and a PDF inside, two top-level PDFs (one a journey deletes, one that stays)
* **attendance**: a closed group-A meeting with marks, and an open group-A meeting whose check-in code is kept in the state
* **finance**: member1's requests (two submitted with two receipts each, one approved to pay, one paid), club expenses (one to claim,
  one to void, one on the fixture funding claim), the claim, recorded income
* **archive**: a public concert and a members-only recording

## Flags

| Variable | Effect |
|---|---|
| `E2E_KEEP=1` | Teardown keeps the fixtures (the victim is still reactivated) |
| `E2E_REUSE=1` | Reuses the fixtures of the previous run (`OUT/state.json`) instead of seeding; needs `E2E_KEEP=1` before, and no journeys before (a journey consumes its fixture) |
| `E2E_JOURNEYS=0` | Leaves out `write-journeys.spec.mjs`, so kept fixtures stay usable |
| `E2E_SKIP_BUILD=1` | Serves the existing `.next` instead of building |
| `E2E_SHOTS=update` | Screenshots go to `tests/browser/__screenshots__` (the baseline) instead of `OUT/shots` |
| `E2E_SUITE=timings` | Selects the timings spec (the npm script sets it) |
| `E2E_TIMING_RUNS` | Runs per role and screen in the timings (default 5) |
| `E2E_RUN_FIXME=1` | Runs the `test.fixme` known-problem tests anyway |
| `E2E_TRACE` | Overrides the trace mode (`retain-on-failure` by default, `off` to record nothing) |
| `E2E_WORKERS` | Worker count (default 1: the tests share fixtures and one rate-limited sign-in) |
| `E2E_OUT` | Output directory (default `tests/browser/.out`, git-ignored): state, logs, report, traces, the current screenshots |
| `E2E_CHROMIUM` | Path of the Chromium binary |

Output after a run: `OUT/report.json`, `OUT/results/<test>/` (trace and screenshot of a failing test, open a trace with
`npx playwright show-trace`), `OUT/build.log`, `OUT/server.log`, `OUT/shots/`.

## Visual baseline

`npm run test:browser:update` writes one full-page JPEG per role and screen at 1280x800 and 390x844 (44 files, about 2.3 MB, tracked in
git) to `tests/browser/__screenshots__/`. `npm run test:browser:compare` compares the last run's pictures with it and prints, per
file, the share of pixels that differ (a pixel differs when a colour channel moves by more than 24 of 255, which ignores JPEG noise) and the box the differing pixels lie in. A picture of another size counts as 100 %.
It is a report, not an assertion: dates and live data change. `--tolerance 0.002` sets what counts as the same, `--fail-over 0.01` makes
the exit code non-zero for a script, `--json file` writes the rows, and two folders can be given instead of the defaults.

For a before/after comparison of a refactor (R4's CSS split): take the baseline and the second set on the **same data**, screens only:

```
E2E_JOURNEYS=0 E2E_KEEP=1 npm run test:browser:update            # seeds and keeps the fixtures, writes the baseline
# ... change the code ...
E2E_JOURNEYS=0 E2E_KEEP=1 E2E_REUSE=1 npm run test:browser       # rebuilds, same fixtures, pictures go to OUT/shots
npm run test:browser:compare
```

On the same data two unchanged runs give 0.00 % for every file (checked: 44 of 44). Between runs on different data (other rows left by
other runs in the attendance history, say), pictures differ for reasons that are not the code, so take both on a project that was just
cleaned.

**Masking volatile regions.** Before each picture `support/shots.mjs` (a) replaces the run id in all text and inputs by `00000000`,
(b) paints a flat magenta box over every element matching `MASKS` (the beat animation, toasts, `<time>`, today's calendar cell, the
check-in code) and (c) removes elements matching `HIDDEN` from the page (regions whose *height* changes with every run, for now the admin
audit list, because painting over them would still move everything below). Add a selector to the right list, or pass
`extraMasks` / `extraHidden` to one `shoot()` call, then regenerate the baseline.

## Cleaning up

A run leaves behind what the app never hard-deletes (finance, attendance, groups, audit rows). In this order (full text in
`scripts/e2e/README.md`, "Cleaning up"):

1. `node scripts/e2e/cleanup.mjs` (storage objects)
2. `scripts/e2e/cleanup.sql` in the SQL editor of the **test** project
3. `node scripts/e2e/cleanup.mjs` again (the `finance-private` files can only go once their rows are gone)
4. `scripts/e2e/cleanup-check.sql`: every count zero except `auth.users` (10 accounts)

The suite never touches the accounts, except the two role changes and the victim's deactivation and reactivation.

## Product problems found

The browser suite is the first real check of Phases 1 and 2, and it found these. Each is a finding, not a fix (R1 changes no product code), and each has
a `test.fixme` in `specs/findings.spec.mjs` that states the CORRECT behaviour: a normal run skips it, `E2E_RUN_FIXME=1` runs it (and shows it fail today).
When the product is fixed, delete the `knownProblem(...)` line of its test. Evidence is under `/tmp/claude-0/r1-browser/evidence/` (pictures and traces of
the run that found them; the numbers are in `docs/BROWSER_TIMINGS.md`).

| Id | Severity | Screen / role | Problem | Evidence | Suggested fix |
|---|---|---|---|---|---|
| F1 | major | Attendance, member (the check-in card) | The **Check in** button is white text on a white background, so the label cannot be seen (contrast 1.00 to 1), on desktop and phone. The primary `Button` sets `!text-white`, which wins over the `text-[var(--ink)]` that `app/attendance.tsx` passes. | `F1-checkin-button-desktop.png`, `F1-F2-checkin-phone.png` | Use the `secondary` variant for this button, or pass `!text-[var(--ink)]` (and the hover colour) the way the primary variant does. |
| F2 | minor | Attendance, member, phone (390 px) | The code field and the button are wider than the check-in card and stick out of its right edge (387 px against a card edge of 370 px). | `F1-F2-checkin-phone.png` | Let the field shrink (`min-width: 0`) and let the row wrap on narrow screens. |
| F3 | minor | `/`, every signed-in role | A signed-in person sees the prerendered **public landing page** first (on top from about 80 to 240 ms, 5 of 5 runs), then the "Opening the club archive..." loading screen until about 660 ms, then the portal. | `F3-first-paint-before-javascript-runs.png` | Decide before first paint: a small inline script that checks for the stored session key and hides the public site (or shows the loading screen) when it exists. |
| F4 | minor | My Groups, every role | The screen sends `GET subgroup_memberships` **twice** in the same wave (5 requests instead of 4). | `timings*.json` rows `groups` | Read memberships once and share the result between the two parts of the screen. |
| F5 | minor | Attendance, Recordings, Resources, Finances, first open | The first Supabase request leaves 335 to 365 ms after the click, although the screen's script arrived after 60 to 90 ms and nothing is busy: first open costs 0.85 s (click) or 1.0 to 1.5 s (address) against 0.2 s for Groups. A revisit is 75 ms. | `docs/BROWSER_TIMINGS.md`, "Where real behaviour differs", point 1 | Profile the wait (suspected: React's 300 ms Suspense reveal throttle after the "Loading..." fallback). Load these scripts in the background once the Overview is up, or open the screen in a transition. |
| F6 | minor | My Groups, every role | The one screen the per-account cache does not serve on a revisit: it waits for its requests every time (250 ms here, as long as the network makes it) while every other screen shows its last data within 75 to 105 ms. | `docs/BROWSER_TIMINGS.md`, revisit table | Put the Groups data through `lib/cache.ts` as the other screens do. |

What the suite did **not** find is as important: no unexpected console error, page error, failed request or 4xx/5xx in any of the 39 default tests or the 275 timed runs, no role seeing
what it must not see (Admin entry, club ledger, "New group", date editing, another member's expense), the deactivated member reaching nothing, and all 10 journeys working through the real UI with their effects
confirmed outside the screen (files really gone from storage, the toast reporting success).
