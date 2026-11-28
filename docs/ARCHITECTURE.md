# Architecture

How the app is put together and where code goes. The browser talks to Supabase directly (row-level security decides what a
person may read and write); the only server-side read is the public concert list that `app/page.tsx` fetches with the anon key.
Everything else is client code, laid out by area.

State of the code: Phase 2.5 (R2, R3, R4) is done: generated database types, a data layer per area (`lib/api/<area>.ts`), shared
hooks and UI blocks, the screens moved into `features/<area>/` and split into hooks and components, the toast taken from a
context, the global stylesheet split into one file per area (see "CSS"); the Cloudflare/vinext/Drizzle starter that the app never
used is gone, and `npm run knip` keeps dead code out.

## Data flow

```
database (Postgres, RLS, RPC)          supabase/migrations: the only source of what exists
        |
lib/database.types.ts                  GENERATED from the database; never edited by hand
        |
lib/db.ts                              Tables<"x">, TablesInsert, TablesUpdate, RpcArgs/RpcReturns<"rpc">, the union types
        |                              derived from the enums (roles, statuses), and the row shapes the screens share (Subgroup,
        |                              ClubEvent, Profile, ArchiveItem ...: tables narrowed with Pick)
lib/supabase.ts                        the one place that creates the client: createClient<AppDatabase> (null without a URL and key)
        |
lib/api/<area>.ts                      all Supabase access: plain async functions, literal table, RPC and bucket names, typed
        |                              arguments and returns, no React, no texts; a Supabase error is thrown as ApiError
lib/hooks/use-query.ts, lib/cache.ts,  cached reads: last data shown while refreshing, newest request wins, a failed refresh
lib/request-gate.ts                    keeps the old data
        |
features/<area>/hooks/use-*.ts         what a screen reads and does: state, loads, the order of a multi-step action, the toasts
        |
features/<area>/components/*.tsx       what is drawn; never imports lib/supabase
        |
components/ui/*                        primitives: button, dialog, toast, empty-state, page-title, loading-block, error-block ...
app/                                   routing and layout; page.tsx renders features/shell
```

`friendlyError(error, fallback)` (lib/errors.ts) turns an error into the sentence the person sees; the wording of every
user-visible message lives in the screens and hooks, not in `lib/api`. `lib/toast.ts` decides a toast's tone and
`components/ui/toast.tsx` shows it. Who may do what is encoded once in `lib/permissions.ts`; components ask it instead of
comparing `role === "..."`. Dates, money, initials and the value of a date-time input are formatted by `lib/format.ts`
(viewer's time zone); `lib/dates.ts` writes instants in the club's time zone.

## Folders

```
app/                     routing only: layout.tsx, page.tsx (loads the public concerts on the server, renders Home), error.tsx,
                         globals.css (Tailwind, tokens, base rules, the stylesheet imports), meetings/page.tsx (redirect)
features/<area>/         one folder per area (below); each has components/, and hooks/, model.ts, <area>.css and other files as it needs them
components/ui/           primitives shared by every area (and ui.css, their rules)
styles/                  shared.css (rules several areas use) and late.css (rules that must come last); see "CSS"
lib/                     logic that renders nothing (below)
lib/api/<area>.ts        every Supabase call (below)
lib/hooks/               hooks that are not about one area
supabase/migrations/     the database; applied migrations are never edited
supabase/tests/          SQL suites (scripts/db-replay.sh)
scripts/                 contract-check/, e2e/, db-replay.sh, bundle-report.mjs, lint-ratchet.mjs, check-boundaries.mjs
tests/                   see tests/README.md
docs/                    this file, CONTRACT_CHECK.md, BUNDLE_BASELINE.md, KNOWN_GAPS.md ...
```

### features/<area>

Inside an area: `components/` holds the screens and their parts (kebab-case, one component or one small family per file, none over
about 600 lines); `hooks/use-*.ts` holds data loading, state and multi-step actions (named after what they do); `model.ts` is
pure logic of that area (no React, no Supabase, so `node --test` can load it); other small files (`types.ts`, `constants.ts`,
`display.ts` ...) hold what several files of the area share.

| Area | What it is | Main files |
|---|---|---|
| `shell` | The signed-in frame: session and bootstrap, navigation, the lists every page reads, the layout, the screens it picks | `home.tsx` (toast provider + `Portal`), `portal.tsx` (composes the hooks and picks the page), `portal-header`, `portal-page-menu`, `portal-footer`, `section-refused`, `loading-screen`, `setup-screen`, `bootstrap-failed-screen`, `membership-screens` (`PendingScreen`, `RejectedScreen`: a sign-up waiting for an executive, a declined one), `lazy-screens.tsx` (the five heavy screens behind `next/dynamic`); hooks `use-auth-session`, `use-portal-session` (the state machine: loading, ready, failed, deactivated, pending, rejected; also the count of sign-ups waiting), `use-portal-data` (archive, events, announcements, groups, memberships, resource count), `use-portal-navigation` (the page in the address bar) |
| `dashboard` | The Overview page | `club-dashboard`, `talam-measure` |
| `calendar` | The club's dates | `calendar-page`, `calendar-view`, `event-modal`, `calendar-dialogs`, `scope-filter-bar`; `use-calendar-page`; `model.ts` (`matchesScope`, `eventsInScope`, `scopeName`) |
| `announcements` | The announcement feed and its controls, shared by three screens (see the rules below) | `announcement-feed`, `announcement-actions` (`AnnouncementActions`, `AnnouncementEditor`) |
| `groups` | My Groups: the list, Discover, one group's page, its people and settings | `subgroup-spaces` (the page), `group-list`, `discover-groups`, `group-detail`, `group-people` and its panels (`roster-list`, `join-requests-panel`, `group-confirm-dialogs`, `group-settings-dialog`, `add-member-dialog`), `create-group-dialog`, `group-update-dialog`; `use-group-spaces`, `use-group-roster`; `model.ts` |
| `members` | The member directory | `members-page`, `member-card`, `contact-dialog`; `use-member-directory` (a pilot of `use-query`) |
| `admin` | The Admin page and a member's access | `admin-page`, `admin-stats`, `admin-members-panel`, `admin-member-editor`, `admin-announcements-panel`, `admin-audit-panel`, `member-access` (`MemberAccessActions`, `DeactivatedScreen`), `signup-requests-panel` and `signup-requests-page` (the queue of people waiting for approval: Approve, Decline; the same panel is on the Admin page and is the Sign-up requests page for executives); `use-admin-data`, `use-signup-requests` |
| `recordings` | Group recordings and the club archive | `recording-workspace` (list and controls), `recording-list`, `recording-studio` (+ `studio-capture`, `studio-form`), `recording-detail`, `recording-notes`, `recording-manage` (`RecordingManageBar`, `NoteActions`), `waveform-player`, `shruthi-companion`, `club-archive-manager`, `archive-modal`; `use-recordings-list`, `use-recording-detail`, `use-recording-fields`, `use-recording-media`, `use-recording-save`; `model.ts` |
| `resources` | The document library | `resource-library` (composes the hooks), `resource-toolbar`, `resource-list`, `resource-composer`, `resource-upload-panel`, `resource-detail-panel`, `resource-actions`, `resource-icon`, `resources.module.css`; `use-resource-list`, `-breadcrumb`, `-counts`, `-folder`, `-forms`, `-selection`, `-uploads`; `model.ts`, `types.ts`, `thumbnails.ts`, `upload-batch.ts` |
| `attendance` | Meetings, check-in, absence forms, flags | `attendance-page` and one component per tab and card (`overview-tab`, `meetings-tab`, `excuses-tab`, `member-view`, `session-roster`, `live-session-card`, `check-in-card`, `absence-form-dialog`, `action-dialogs`, `new-meeting-dialog`, `attendance-corrections` ...); `use-attendance-data`, `use-attendance-poll`, `use-attendance-actions` (with `use-live-check-in`, `use-attendance-dialogs`, `use-absence-form`, `use-exclusive`); `model.ts`, `display.ts`, `action-dialog.ts` |
| `finance` | The finance ledger, reimbursements and funding claims | `finance-page` and one component per section (`finance-overview`, `summary-cards`, `expense-register`, `payment-ledger`, `reimbursement-list`, `funding-claims`, the dialogs); `use-finance-data`, `use-finance-forms`, `use-action-runner`, `use-one-click-changes`, `use-finance-corrections`, `use-finance-documents`; `model.ts`, `forms.ts`, `corrections.ts`, `refusal.ts`, `types.ts`, `constants.ts` |
| `public` | The signed-out pages | `public-site`, `login-screen`, `hero-photos.ts`, `constants.ts` (the sign-up name key the shell also reads) |

`features/shell/components/lazy-screens.tsx` loads attendance, finance, resources, the recording workspace and the club archive
manager with `next/dynamic`, so each stays its own chunk: keep it that way when moving code (`tests/component/shell-code-split.test.tsx`).

### lib/

Logic that renders nothing. Pure files are loadable by `node --test` (type-only imports from `lib/db.ts`).

| File | What it does |
|---|---|
| `database.types.ts`, `db.ts`, `supabase.ts` | The generated types, the app's view of them, the client (see "Data flow") |
| `errors.ts` | `ApiError`, `toApiError`, `friendlyError(error, fallback)` |
| `toast.ts` | The tone rules of a toast (a failure never wears the tick of a success) |
| `permissions.ts`, `sections.ts` | Who may do what; which screens exist, which roles open them, what the address bar calls them |
| `format.ts`, `dates.ts` | Dates (viewer's zone), money, initials, `toLocalInputValue`; days and instants in the club's zone |
| `cache.ts`, `request-gate.ts`, `single-flight.ts`, `refresh.ts`, `bounded-wait.ts` | Per-account in-memory cache; newest request wins; one action at a time; what a failed refresh keeps; waiting for a refresh, but not for ever |
| `bootstrap.ts`, `chunk-errors.ts`, `public-concerts.ts` | The shell's reading of `get_portal_bootstrap`; telling a failed code-split load from a bug; the server's public concert read |
| `resources-query.ts`, `archive-sharing.ts`, `finance-load.ts`, `finance-upload.ts`, `storage-remove.ts`, `storage.ts` | Pure rules behind the library's list requests, the archive's sharing, the finance refresh and upload, and reading the answer of a storage delete |
| `utils.ts` | `cn` |

### lib/api/

One module per data area. A function is a plain `async` function: literal table, RPC and bucket names (the contract check
reads them), typed arguments and results, no React, no toast, no sentence. A Supabase error is thrown as `ApiError`; where a
screen branches on `{ data, error }` it wraps the call in `attempt()` (below).

| Module | What it is |
|---|---|
| `_core.ts` | `must()` (an answer becomes its data or throws), `safeFileName()` (the one rule for a file name inside a storage path) |
| `attempt.ts` | `attempt(() => apiCall())` gives back `{ data, error }` for a handler that branches on the failure |
| `settle.ts` | `settle(read)` for several reads in a `Promise.all` that may fail separately |
| `auth.ts` | `supabase.auth`: who is signed in, hearing of a change, signing out, `isSupabaseConfigured` |
| `portal.ts` | The shell's own reads: the bootstrap, the lists it keeps for every page, the sign-up name |
| `events.ts` | The calendar's dates: read, add, change, remove |
| `announcements.ts` | Create, edit, pin and delete one announcement |
| `groups.ts` | Group lists, memberships, a roster, joining, leaving, reviewing requests, settings, a group's announcements |
| `members.ts` | The member directory, a member's own contact details, the people a group can add |
| `admin.ts` | The Admin page's reads and administrator-only changes (role, profile, deactivate, reactivate, delete, announcement), and the sign-up queue (`listPendingMembers`, `reviewPendingMember`) |
| `recordings.ts` | The recordings list and notation, their buckets, the club archive |
| `resources.ts` | Library rows, upload batches, the `club-resources` bucket, visibility and archive state |
| `attendance.ts` | Overview, roster and poll reads, check-in, meetings and corrections, marks, absence forms and proofs, follow-ups, eligibility, thresholds |
| `finance.ts` | The eleven reads of the load wave, every finance RPC, the `finance-private` bucket (`uploadFinanceDocument`: upload, register, link) |
| `public.ts` | The signed-out pages: Google sign-in, the public concert archive read on the client |

The `client()` helper at the top of several modules throws `ApiError("Supabase is not configured")` in some and
`ApiError("The portal is not connected.")` in others; the texts differ, so they were not merged.

## Shared pieces and where each is used

| Piece | What | Used by |
|---|---|---|
| `lib/format.ts` | `formatDate`, `formatDateOrNone`, `formatMoney`, `initials`, `toLocalInputValue` | admin, announcements, attendance, calendar, finance, groups, members, recordings, resources |
| `lib/permissions.ts` | The role and group permission table | attendance, finance, groups, resources, shell |
| `lib/hooks/use-async-action.ts` | The pending flag, the failure sentence and the toast of a "press a button, wait for the database" handler; takes `notify` as its argument | admin, announcements, resources |
| `lib/hooks/use-debounced.ts` | A search box that asks the database after a pause | recordings, resources |
| `lib/hooks/use-polling.ts` | A poll that pauses on a hidden page | attendance |
| `lib/hooks/use-query.ts` | A cached read | members (the pilot; the other screens key several reads together or clear the cache by prefix) |
| `lib/api/attempt.ts`, `lib/api/settle.ts` | `{ data, error }` for a handler; independent reads | attempt: attendance, recordings; settle: admin, groups, members |
| `components/ui/toast.tsx` | `ToastProvider`, `useToast()`, `ToastViewport` | every area that notifies |
| `components/ui/{empty-state,page-title,loading-block,error-block,load-error}` | The repeated blocks | empty-state: finance, groups, members, public, shell; page-title: admin, calendar, groups, members, public; loading-block: admin, attendance, calendar, finance, groups, members, public, shell; error-block: attendance; load-error: finance, members, recordings, resources |
| `components/ui/{button,dialog,confirm-dialog,form-dialog,input,textarea,badge}` | Primitives | most areas |
| `components/ui/content-scope-label.tsx` | "Club-wide" or the group's name, as a tag | admin (the calendar writes its own `<small class="calendar-scope">`, with "Group" as the fallback word, which its tests pin) |
| `components/ui/section-boundary.tsx` | Catches a screen that fails to render or load | shell |

Not merged on purpose: attendance's `formatDateTime` (`features/attendance/display.ts`: the viewer's time zone, "Date unavailable"
for a bad value) and `lib/dates.ts` `formatDateTime` (the club's time zone, empty for a bad value); attendance's
`localDateTime()` (the input value for "now") next to `toLocalInputValue(value)` (same result for "now").

### Toasts

`Home` (features/shell) renders `ToastProvider`; the `ToastViewport` is drawn inside the shell's `<main>`. Anything that tells the
person something calls `const { notify } = useToast()`; there is no `notify` prop or argument anywhere (only `useAsyncAction(notify?)`
takes the function, as an injection point of a shared hook). `notify(message, "error")` for a failure, always for text that comes
from the database; an untagged message is a fixed sentence read for the ordinary words of a failure (`lib/toast.ts`). In tests,
`notifySpy()` (tests/support/helpers.ts) is what `useToast()` answers.

## CSS

The styling is plain global class rules in stylesheets that sit next to the code that uses them. `app/globals.css` is the entry (the
only app stylesheet `app/layout.tsx` imports, besides the font files): it holds Tailwind's `@import "tailwindcss"`, `@theme`,
`@layer base`, the colour tokens (`:root`), the base element rules, and then one `@import` per stylesheet, in a set order. `features/resources` also has a CSS module
(`components/resources.module.css`, imported by its components), which is scoped and outside this scheme.

| File | What is in it |
|---|---|
| `app/globals.css` | Tailwind, tokens, base rules, the `@import` list below |
| `styles/shared.css` | Rules several areas use: brand mark, buttons, modals, page titles, card grids, base elements the first block does not cover; a rule whose area is unclear stays here |
| `components/ui/ui.css` | Rules of the primitives in `components/ui` |
| `features/<area>/<area>.css` | The rules of the classes that area's components write: `shell`, `public`, `dashboard`, `calendar`, `groups`, `members`, `admin`, `announcements`, `recordings`, `resources`, `attendance`, `finance` |
| `styles/late.css` | The 49 rules that must stay after another area's rule (see below), in their original order, grouped under `/* area */` comments |

The order of the `@import` lines is the order of the rules: Tailwind inlines each file where its `@import` stands, so two rules of equal
specificity are decided by which file comes later. That is why the order is `shared`, `ui`, `shell`, `public`, `dashboard`, `calendar`,
`groups`, `members`, `admin`, `announcements`, `recordings`, `resources`, `attendance`, `finance`, `late`, and why a file is never moved
in that list on a hunch. The custom rule that fixes the member check-in button is in `@layer utilities` (in the attendance file); the
minifier merges it into Tailwind's `utilities` layer, so it ends up after Tailwind's utilities wherever it is written.

Adding or changing styles:

1. A class one area uses goes in that area's file, named so that no other area could pick it up (prefix it with the area or the
   component: `calendar-event-row`, not `row`). Keep one rule per line like its neighbours and add it next to the rules of the same block.
2. A class two areas use goes in `styles/shared.css`; one a `components/ui` primitive writes goes in `components/ui/ui.css`.
3. Do not make a rule depend on the file order across areas. If a rule must beat another of equal specificity, give it more
   specificity (`.page .thing`), or put it in the same file after the other. A new rule that really needs to come after a rule of
   another area goes at the end of `styles/late.css` under its area's comment.
4. A new area file is added to the `@import` list at the position its rules need (before `late.css`, after any file whose rules it must
   override); say so in the commit.
5. A class no file under `features/`, `components/`, `app/` or `lib/` mentions (not even as the fixed part of a template such as
   `` `status-${x}` ``) styles nothing: delete its rule.
6. After moving rules or changing the order, build before and after and compare the CSS the build produces:
   `node scripts/css-split/compare-built.mjs <before .next> <after .next>` lists every declaration only one side has and every pair that
   changed order and could disagree about one element. The tool and what it assumes are in `scripts/css-split/README.md`; it is the
   proof the split was made with (an exact pixel check is `npm run test:browser:compare`).

## Dependency rules

Imports go one way, and `scripts/check-boundaries.mjs` enforces it (`npm run lint:boundaries`; `npm run lint:ratchet`, the CI lint
step, runs it too; `--selftest` proves each rule catches its violation on a throwaway tree):

| Folder | May import | Rule broken otherwise |
|---|---|---|
| `lib/` | `lib/` only | `lib-imports-up` |
| `components/ui/` | `lib/` and itself | `ui-imports-up` |
| `features/<area>/` | its own folder, `components/ui`, `lib`, and `features/announcements` | `feature-imports-feature` |
| `features/shell/` | every feature, `components/ui`, `lib` | `shell-imports-app` (not `app/`) |
| `app/` | `features/shell`, `components/ui`, `lib` | `app-imports-feature` |
| nothing but `app/` | may import `features/shell` | `feature-imports-shell` |

There are no import cycles (the script finds them: run-time imports only, `import type` does not count). The shell is the one
place that knows every feature. `announcements` is the one feature other features may import, because `AnnouncementActions` and
`AnnouncementEditor` (post, edit, pin, delete) are a domain component used by three screens: the dashboard (`AnnouncementFeed`),
the group page and the Admin page. Keep it a leaf: it imports nothing of another feature. A component used by one area belongs in
that area (the audience picker of the calendar is `features/calendar/components/scope-filter-bar.tsx`); something two areas need
that is not announcements moves to `components/ui` (if it renders) or `lib` (if it does not), or is combined by the shell. A
constant the shell and a feature both read is not read out of a component file (`pendingSignupNameKey` is `features/public/constants.ts`).

Tests are not checked by the script; they import what they exercise.

## Adding a screen or a feature

1. Data: for each new table or RPC, a function in `lib/api/<area>.ts` with literal names (add the file if the area is new), throwing
   `ApiError`; run `npm run test:contract` and write a test against the fake client (`tests/component/api-*.test.ts`).
2. Pure rules (what to show, how to total, how to validate) in `features/<area>/model.ts`, tested with `node --test` or Vitest.
3. State and actions in `features/<area>/hooks/use-<what-it-does>.ts` (loads through `lib/cache.ts` and `lib/request-gate.ts`, or
   `use-query`; toasts through `useToast()`; errors through `friendlyError`).
4. The screen in `features/<area>/components/<screen>.tsx`, split into parts when it grows; primitives from `components/ui`; roles from
   `lib/permissions.ts`; no `lib/supabase` import (the boundary script and a grep both catch it).
5. Wire it in: a section in `lib/sections.ts` (roles, address, menu), a case in `features/shell/components/portal.tsx`; heavy screens
   (audio, large forms) go in `lazy-screens.tsx`. Check `npm run report:bundle -- --compare docs/bundle-baseline.json`.
6. Tests: a component test that renders the screen against the fake client (tests/README.md), asserting what the person sees and what
   was sent; then break the code on purpose and watch it fail.

A new area is a new `features/<area>/` folder; if another area needs to render part of it, either the shell combines them or the part
moves to `components/ui` / `lib`, not an import between features.

## Database types

`lib/database.types.ts` is the output of Supabase's TypeScript generator, kept in the repository so the app and CI do
not need the Supabase CLI or a network. It is never edited by hand. `lib/db.ts` is the only file the app imports it
through. The header of the file says which project and which migration it matches.

After a migration that changes a table, a column, an enum or a function:

1. Apply the migration to the test project (bharat-sangeet-test, ref `bldytniesexkwbtyinsi`).
2. Generate the types from that project, either with the Supabase MCP tool `generate_typescript_types` for it, or with
   `npx supabase gen types typescript --project-id bldytniesexkwbtyinsi --schema public > /tmp/types.ts`
   (needs `supabase login`).
3. Replace everything in `lib/database.types.ts` below the header comment with the output, and update the header's
   migration name (the last file in `supabase/migrations`).
4. Run `npm run test:types-drift`. It replays the migrations on a throwaway local PostgreSQL 16 and compares tables,
   columns, enums, foreign keys and functions with the file; it fails on any difference. Then `npx tsc --noEmit`: a
   column or argument the app used and the migration removed is now a compile error, which is the point.

CI runs `npm run test:types-drift:selftest` in the `contract` job, so a migration without regenerated types cannot
merge. See `docs/CONTRACT_CHECK.md` for what the check compares.

Types describe tables, columns, enums and function signatures. They do not describe grants, row-level security or
storage policies: `npm run test:contract` and `scripts/db-replay.sh` check those. A row shape a screen needs is written once in
`lib/db.ts` (`Pick<Tables<"x">, ...>`); a screen that needs fewer columns narrows that (`GroupOption`, `EventOption`) instead of
declaring its own copy.

## Tests and commands

Layers, cheapest first (details and how to write a test: `tests/README.md`):

| Layer | Where | Run with |
|---|---|---|
| Pure logic | `tests/*.test.mjs` | `npm run test:unit` (`node --test`) |
| Component and behaviour | `tests/component/*.test.ts(x)` against the fake Supabase client | `npm run test:component` (Vitest, jsdom) |
| Database | `supabase/tests/*.test.sql` | `npm run test:db` (`scripts/db-replay.sh`) |
| Browser | `tests/browser/`, a real browser on the test Supabase project | `npm run test:browser` (not part of `npm test`) |

Before merging, CI and a reviewer expect all of these to pass:

```bash
npx tsc --noEmit                                              # types
npm test                                                      # pure logic + component tests (includes the boundary test)
npm run lint:ratchet                                          # lint count may not rise; import boundaries (lint:boundaries)
npm run knip                                                  # no unused file, export, type or dependency (knip.jsonc: what is kept on purpose, and why)
npm run build                                                 # NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY as in CI
npm run report:bundle -- --compare docs/bundle-baseline.json  # no route more than 5 kB gzip larger
npm run test:contract:selftest                                # every table, column, RPC, bucket the frontend uses exists (docs/CONTRACT_CHECK.md)
npm run test:types-drift:selftest                             # lib/database.types.ts matches the migrations
npm run lint:boundaries:selftest                              # the boundary check catches each kind of violation
```
