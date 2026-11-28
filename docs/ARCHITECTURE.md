# Architecture

How the app is put together and where code goes. The screens now live in the layout below (Phase 2.5, R3: moved
without changing any code). Still to come in Phase 2.5: the per-area data layer (`lib/api/<area>.ts`), the extraction of the
large screen files, the CSS split. "Where things are today" below says what already exists.

## Data flow

```
database (Postgres, RLS, RPC)          supabase/migrations: the only source of what exists
        |
lib/database.types.ts                  GENERATED from the database; never edited by hand
        |
lib/db.ts                              Tables<"x">, TablesInsert, TablesUpdate, Enums<"x">, Functions<"rpc"> and the union
        |                              types derived from the enums (roles, statuses, scopes)
lib/supabase.ts                        the one place that creates the client: createClient<Database>
        |
lib/api/<area>.ts                      all Supabase access: plain async functions, literal table and RPC names, typed
        |                              arguments and returns, no React; a Supabase error is thrown as ApiError (lib/errors.ts)
lib/hooks/use-query.ts                 cached reads (lib/cache.ts + lib/request-gate.ts): last data shown while refreshing,
        |                              newest request wins, a failed refresh keeps the old data
features/<area>/{components,hooks}     screens; they never import the Supabase client
        |
components/ui/*                        primitives: button, dialog, toast, empty-state, page-title, loading-block, error-block
app/                                   routing, layout and the shell only
```

`friendlyError(error, fallback)` (lib/errors.ts) turns an error into the sentence the person sees; the wording of every
user-visible message stays where it is. `lib/toast.ts` decides a toast's tone, `components/ui/toast.tsx` shows it
(`useToast()` returns `{ notify }`). Who may do what is encoded once in `lib/permissions.ts`; components ask it instead of
comparing `role === "..."`. Dates, money and initials are formatted by `lib/format.ts`.

## Where things are today

Built and tested (R2-foundation): `lib/database.types.ts` with its drift check, `lib/db.ts` and the typed client,
`lib/format.ts`, `lib/permissions.ts`, `ApiError` / `toApiError` in `lib/errors.ts`, `must()` in `lib/api/_core.ts`,
`lib/hooks/{use-async-action,use-debounced,use-polling,use-query}.ts`, `components/ui/{page-title,empty-state,loading-block,error-block,toast}.tsx`.
Each has tests under `tests/` and is used by the screens where the old behaviour could be kept exactly:

| Piece | Used by | Not used (and why) |
|---|---|---|
| `format` | announcement-feed, subgroup-spaces, admin-page, members-page, resource-library, recording-workspace, finance-page | `lib/dates.ts` (club time zone), attendance's own `formatDateTime` (viewer time zone, other wording), `formatBytes` |
| `permissions` | the shell (`portal`), subgroup-spaces, group-people, attendance-page, finance-page, resource-library | labels such as "Administrator", the role counts on the Admin page, `lib/sections.ts` (a menu table, not a permission) |
| `use-async-action` | announcement pin and delete, member access | handlers that read `{ data, error }` and branch on rows changed, or that return early between the call and the flag |
| `use-debounced` | resources and recordings search boxes | |
| `use-polling` | attendance meeting poll | the beat animation and the recording timer (not polls) |
| `use-query` | the Members page (`features/members`, pilot) | every other screen: they key several reads together or have writes that clear the cache by prefix; each is moved when its area is |
| `ToastProvider` / `useToast` | the shell (`features/shell`: `Home` provides, `Portal` reads) | the screens still receive `notify` as a prop; it goes away area by area |
| `ui/*` blocks | the shell, admin-page, members-page, subgroup-spaces, public-site, attendance-page, finance-page | the finance title row, `section-boundary`'s empty state, recordings' own empty state |

Not built yet: the per-area `lib/api/<area>.ts` modules. Until they exist the screens (now under `features/`) still import
`lib/supabase` and call it directly (the contract check reads those calls); a few already wrap the answer in `must()`.

## Folders

```
app/                     routing only: layout.tsx, page.tsx (loads the public concerts on the server, renders Home),
                         error.tsx, globals.css, meetings/page.tsx (redirect), chatgpt-auth.ts (not imported by anything; R5 removes it)
features/<area>/         one folder per area; components/ holds the screens, hooks/ is created when an area gets one
  shell/                 Home (toast provider + Portal), Portal (auth, bootstrap, navigation state, layout, the lazy
                         screens), PortalPageMenu, SectionRefused, LoadingScreen, SetupScreen, BootstrapFailedScreen
  dashboard/             ClubDashboard, TalamMeasure (the Overview page)
  calendar/              CalendarView, EventModal
  announcements/         AnnouncementFeed, AnnouncementActions, AnnouncementEditor, ScopeFilterBar
  groups/                SubgroupSpaces, GroupPeople
  members/               MembersPage
  admin/                 AdminPage, AdminMemberEditor, MemberAccessActions, DeactivatedScreen
  recordings/            RecordingWorkspace, RecordingManageBar, NoteActions, ClubArchiveManager, ArchiveModal
  resources/             ResourceLibrary, ResourceActions (and resources.module.css)
  attendance/            AttendancePage, SessionCorrections and the other correction buttons; model.ts (pure helpers)
  finance/               FinancePage
  public/                PublicSite, LoginScreen, hero-photos.ts
components/ui/           primitives shared by every area (button, dialog, toast, empty-state, content-scope-label ...)
lib/                     pure logic and nothing that renders (dates, sections, permissions, format, errors, cache,
                         request gate); lib/portal-types.ts holds the row types several areas share
lib/api/<area>.ts        every Supabase call of an area (to come)
lib/hooks/               hooks that are not about one area (use-query, use-async-action, use-debounced, use-polling)
supabase/migrations/     the database; applied migrations are never edited
tests/                   see tests/README.md
```

Imports go one way: `app` -> `features/shell` -> the other features -> `components/ui` -> `lib`. A feature never imports
the shell or `app/`, and two features do not import each other, with one exception that exists today: `admin`, `groups`
and `dashboard` import the announcement components (`features/announcements`). The shell imports every feature (it is the
one place that knows them all). There were no import cycles when the files were moved; keep it so.
`features/shell/components/portal.tsx` loads attendance, finance, resources and the two recording screens with
`next/dynamic`, so each stays its own chunk: keep it that way when moving code.

Files are kebab-case; a component file stays under about 600 lines (three screens, `attendance-page`, `finance-page` and
`resource-library`, are at or just over it and are split by their area's refactor).

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
storage policies: `npm run test:contract` and `scripts/db-replay.sh` check those.
