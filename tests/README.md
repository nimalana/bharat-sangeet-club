# Tests

Layers, from cheapest to most real. `npm test` runs the first two.

| Layer | Where | Run with | What it checks |
| --- | --- | --- | --- |
| Pure logic | `tests/*.test.mjs` | `npm run test:unit` (`node --test`) | Functions in `lib/` and the pure helpers in `components/`: dates, section rules, request gates, bootstrap parsing, query planning, toast tone for the database's own messages. No browser, no React. |
| Component and behaviour | `tests/component/*.test.tsx` | `npm run test:component` (Vitest + jsdom + Testing Library) | The real screens, rendered, clicked and typed into, against a fake Supabase client. Checks what the person sees and what is sent to the database, not how the code is written. |
| Database | `supabase/tests/*.test.sql` | `npm run test:db` | Constraints, triggers, functions and row-level security on a throwaway PostgreSQL. See `supabase/tests/README.md`. |
| Browser | `tests/browser/` (kept by the browser-test work, not part of `npm test`) | see that folder | The app in a real browser against a test Supabase project. |

`npm test` runs the pure-logic tests first, then the component tests; it fails if either fails. CI runs it in the "Unit tests" step.

## Running one file or one test

```bash
node --test tests/dates.test.mjs                        # one pure-logic file
npx vitest run tests/component/finance.test.tsx         # one component file
npx vitest run tests/component/finance.test.tsx -t "Mark paid"   # tests whose name contains the text
npx vitest tests/component/finance.test.tsx             # watch mode while writing
```

## Rules that keep the tests useful

- A test checks behaviour: what is on screen, which call reached the database, which toast was shown and with what tone. It does not read source files and does not match source text. A refactor that keeps the behaviour must not fail a test.
- A test imports the screen it exercises on one line and nothing else about where the screen lives. If a file moves, change that import line (and, for the shell, the import in `tests/support/portal.tsx`).
- Every test must be shown to fail when the behaviour it protects is broken. When you add one, break the product code in a scratch copy (or temporarily), watch the test fail, then restore the code.
- The header of a test file says what each old assertion or past bug it replaces protected, so the reason for a test is not lost when the code around it changes.

## The fake Supabase client (`tests/support/fake-supabase.ts`)

Every screen imports `supabase` from `lib/supabase`. `tests/component/setup.ts` replaces that module with `fake.client`, so the real components run without a network. The setup file is the only place that knows where the client module lives. The fake is reset after every test.

It implements `from(...)` (the query builder, thenable and chainable), `rpc(...)`, `storage.from(bucket)` and `auth`, and records every call. Nothing in it knows about a particular screen.

Script answers before rendering:

```ts
import { fake, ok, fail, withCount, never, rejects, after, deferred } from "../support/fake-supabase";

fake.rpc("get_finance_summary").reply(ok({ available_cash: 120 }));
fake.from("finance_expenses").reply(ok([expenseRow]));                 // any operation on the table
fake.from("finance_documents", "insert").reply(ok({ id: 9 }));         // only inserts
fake.from("resources", "select").reply(withCount(120, rows));          // an answer with a count
fake.storage("finance-private", "remove").reply(ok([]));               // a delete that removed nothing
fake.rpc("pay_personal_reimbursement").replyOnce(fail("Already paid")); // the next call only
fake.rpc("slow").reply(after(20_000, ok(null)));                       // answers after 20 s of fake time
fake.rpc("hangs").reply(never);                                        // never answers
fake.rpc("offline").reply(rejects());                                  // rejects, like "Failed to fetch"
fake.rpc("x").reply((call) => ok(call.payload));                       // answer from the call itself
```

For a race, settle the answer by hand:

```ts
const older = deferred();
fake.rpc("get_x").replyOnce(older.reply);       // the first call waits
fake.rpc("get_x").replyOnce(ok("newer"));       // the second answers at once
// ... trigger both calls, then:
await act(async () => { older.resolve(ok("older")); });
```

Read what was sent:

```ts
const [call] = fake.from("resources", "insert").calls;
call.payload;                       // what the insert wrote
call.used("eq", "parent_id", 7);    // the chain used .eq("parent_id", 7)
call.uses("range");                 // the arguments of every .range(...)
fake.rpc("pay_personal_reimbursement").calls[0].args[0];   // the rpc arguments
fake.calls;                         // everything, in order (each call has a `seq`)
fake.unscripted;                    // calls nobody scripted (they got an empty answer)
```

`fake.signIn(user)` makes `auth.getSession` return a session; `fake.emitAuth("TOKEN_REFRESHED", session)` delivers an auth event to the shell's subscriber. `single()` and `maybeSingle()` unwrap an array answer, as the real client does. Storage errors reach the screen as `Error` instances, as with the real client.

## Helpers (`tests/support/helpers.ts`)

- `userOf(id)` is a signed-in user as a screen receives it.
- `notifySpy()` is the `notify` a screen is given. `notify.find("text").tone` is the tone the screen asked for: `"error"`, `"success"` or `undefined` (untagged). A failure that shows the database's own words must be tagged `"error"`, because those words say nothing about whether it failed. To prove that, script a database sentence that sounds cheerful ("Everything has been saved") and expect `"error"`.
- `advance(ms)` moves fake time (`vi.useFakeTimers()`) and lets pending promises run; `flush()` lets resolved promises run.
- `openPortal({ role, page, boot })` (`tests/support/portal.tsx`) signs a user in, scripts `get_portal_bootstrap` and renders the whole shell; `renderPortal()` renders it without scripting.

## Adding a component test

1. Create `tests/component/<screen>.test.tsx`. Import the screen on one line, plus `fake`, `ok`, `fail` and the helpers you need.
2. At the top, write what each old assertion or bug the file protects was, in a plain sentence each.
3. If you render a screen directly (not through the shell), call `setCacheOwner(userId)` first; the shell does it in production. Pass the screen's props: `user`, `notify` (use `notifySpy()`), and the role flags it takes.
4. Script every read the screen makes on load (the first run lists unscripted calls in `fake.unscripted`), render, then act as a person would: `fireEvent.click(screen.getByRole("button", { name: "Mark paid" }))`, `fireEvent.change(...)`, `fireEvent.submit(form)`. Query by role and visible text, not by class names or structure.
5. Assert on the screen (`screen.getByText`, `getByRole`), on the calls that were sent (`fake.rpc(...).calls`) and on the toasts (`notify.find(...).tone`).
6. Run it, then break the product code on purpose and check the test fails.

Things worth knowing:

- Real timers: use `await screen.findBy...` and `waitFor`. Fake timers (`vi.useFakeTimers()`, needed for polls, debounces and 15-second waits): use the synchronous `getBy...` and `await advance(ms)`. `findBy...` and `waitFor` wait on a timer that the fake clock never fires, so they hang.
- A poll registers its interval after its first load: `await advance(1)` before `await advance(10_000)`.
- A double click that must send one change: `act(() => { button.click(); button.click(); })`, so both clicks land before React re-renders and disables the button.
- jsdom keeps its own file list, so `setup.ts` replaces `FormData` with a version that reads file inputs. A test can put a file into an input with `fireEvent.change(input, { target: { files: [file] } })`.
- `window.confirm`, `prompt`, `alert` and `open` are mocks that answer yes, nothing and nothing. A screen that still calls them is a bug the attendance tests check for.
- wavesurfer.js and tone are mocked in the recording tests: jsdom has no canvas or audio.
