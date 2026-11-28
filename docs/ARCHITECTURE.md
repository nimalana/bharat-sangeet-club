# Architecture

How the app is put together and where code goes. The refactor that moves the screens into this layout is Phase 2.5
(R2 to R5 in the implementation plan); until it is finished some code still lives in the old places (`app/*.tsx`,
`components/<area>/`). New code follows this page.

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

## Folders

| Folder | Holds |
|---|---|
| `app/` | routing, layout, the shell. `app/page.tsx` stays small |
| `features/<area>/components`, `features/<area>/hooks` | one folder per area: shell, calendar, announcements, groups, members, admin, recordings, resources, attendance, finance, public |
| `components/ui/` | primitives shared by every area |
| `lib/` | pure logic (dates, sections, permissions, format, errors, cache, request gate) and nothing that renders |
| `lib/api/<area>.ts` | every Supabase call of an area |
| `lib/hooks/` | hooks that are not about one area (`use-query`, `use-async-action`, `use-debounced`, `use-polling`) |
| `supabase/migrations/` | the database; applied migrations are never edited |
| `tests/` | see `tests/README.md` |

Files are kebab-case; a component file stays under about 600 lines.

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
