# Tests

Layers, from cheapest to most real. `npm test` runs the first two.

| Layer | Where | Run with | What it checks |
| --- | --- | --- | --- |
| Pure logic | `tests/*.test.mjs` | `npm run test:unit` (`node --test`) | Functions in `lib/` and the pure helpers next to the screens (`features/attendance/model.ts`): dates, section rules, request gates, bootstrap parsing, query planning, toast tone for the database's own messages, and the import rules (`boundaries.test.mjs`). No browser, no React. |
| Component and behaviour | `tests/component/*.test.tsx` | `npm run test:component` (Vitest + jsdom + Testing Library) | The real screens, rendered, clicked and typed into, against a fake Supabase client. Checks what the person sees and what is sent to the database, not how the code is written. |
| Database | `supabase/tests/*.test.sql` | `npm run test:db` | Constraints, triggers, functions and row-level security on a throwaway PostgreSQL. See `supabase/tests/README.md`. |
| Browser | `tests/browser/` (kept by the browser-test work, not part of `npm test`) | see that folder | The app in a real browser against a test Supabase project. |

`npm test` runs the pure-logic tests first, then the component tests; it fails if either fails. CI runs it in the "Unit tests" step.

## Tests of the shared pieces

Each piece in `lib/` and `components/ui/` that screens share has its own tests, written so that a screen can move onto it
without a screen test changing:

| Piece | Tests |
|---|---|
| `lib/format.ts`, `lib/permissions.ts`, `lib/errors.ts` (ApiError) | `tests/format.test.mjs` (the old private copies are the oracle, five time zones), `tests/permissions.test.mjs` (every cell of the plan 1.1 table), `tests/errors.test.mjs` |
| `lib/api/_core.ts` (`must`) | `tests/component/api-core.test.ts` (Vitest: it imports `../errors` without an extension, which `node --test` cannot resolve) |
| `lib/hooks/*` | `tests/component/hooks.test.tsx` (async action, debounce, polling), `tests/component/use-query.test.tsx` |
| `components/ui/{page-title,empty-state,loading-block,error-block}` | `tests/component/ui-blocks.test.tsx`: each compared with the markup the screens wrote by hand |
| `components/ui/dialog.tsx`, `confirm.tsx`, `confirm-dialog.tsx` | `tests/component/dialog.test.tsx` (role and name, focus in, trap, back, Escape, backdrop, nested dialogs, inert page, scroll lock, axe), `confirm.test.tsx` (`useConfirm`: true only on Confirm, focus on Cancel, queued questions, axe) |
| `lib/hooks/use-url-state.ts` | `tests/component/use-url-state.test.tsx` (reading, SSR and hydration, writing, Back and Forward, one entry per tick, the shell's own navigation next to it) |
| States: `error-block`, `skeleton`, `Button pending`, `use-query` error/retry, `use-async-action` exclusive | `tests/component/states.test.tsx` |
| `lib/api/_core.ts` `uploadWithProgress`, `components/ui/upload-progress.tsx` | `tests/component/upload-with-progress.test.ts` (the real supabase-js client and `uploadWithProgress` against one transport: the same URL, headers, body and answers), `upload-progress.test.tsx` |
| `components/ui/preview-dialog.tsx` | `tests/component/preview-dialog.test.tsx` |
| The accessibility base: focus ring, `.sr-only`, reduced motion, tap targets, `IconButton`, the 12px floor | `tests/component/a11y-base.test.tsx` (contrast computed from the tokens; the stylesheets read; no test can paint) |
| The test helpers themselves (`a11y.ts`, `keyboard.ts`) | `tests/component/test-support.test.tsx` |
| `components/ui/toast.tsx` | `tests/component/toast-provider.test.tsx` (the provider and its viewport), `toast-context-groups.test.tsx` (screens inside a provider show their toast in the viewport), `toast-spy.test.tsx` (the test spy itself), `toast-tone.test.tsx` (tone rules) |
| `scripts/check-boundaries.mjs` (import rules, no import cycle) | `tests/boundaries.test.mjs`: the repository itself is clean, the layer of each path, each allowed and refused pair, cycles through run-time imports and not through type imports. `npm run lint:boundaries:selftest` builds a throwaway tree with one violation per rule. |
| Screens that adopted a piece | the screen's own tests: `action-feedback.test.tsx` (announcement pin and delete, member access), `members-directory.test.tsx` (the `use-query` pilot), and the loading and failure cases in `attendance.test.tsx` and `finance.test.tsx` |

When a screen moves onto a shared piece, write the test that pins the old behaviour first and check that it passes on the old
code, then move the screen: the test is what shows the move changed nothing.

## Accessibility, keyboard, uploads and the address in a test

`tests/support/a11y.ts`: `await expectNoSeriousViolations(container)` runs axe-core and fails on a serious or critical violation (colour contrast is off in jsdom, and an iframe is audited as an element only).
`tests/support/keyboard.ts`: `keyboardUser()` (user-event; `{ fakeTimers: true }` under fake timers), `focusedName()`, `tabOrder(user, n)`.
`tests/support/fake-xhr.ts`: `installFakeXhr()` for code that uploads with progress. `tests/support/confirm.tsx`: `withConfirm(node)` / `ConfirmWrapper` for a screen that uses `useConfirm()`.
The address is the real jsdom one: `window.history.replaceState({}, "", "/?page=x")` before a render; `setup.ts` resets it, the env stubs and the globals after every test.
What these can and cannot prove, with examples: `docs/UI_PATTERNS.md` section 9.

## Running one file or one test

```bash
node --test tests/dates.test.mjs                        # one pure-logic file
npx vitest run tests/component/finance.test.tsx         # one component file
npx vitest run tests/component/finance.test.tsx -t "Mark paid"   # tests whose name contains the text
npx vitest tests/component/finance.test.tsx             # watch mode while writing
```

## Rules that keep the tests useful

- A test checks behaviour: what is on screen, which call reached the database, which toast was shown and with what tone. It does not read source files and does not match source text. A refactor that keeps the behaviour must not fail a test.
- A test imports the screen it exercises on one line and nothing else about where the screen lives. If a file moves, change that import line (and, for the shell, the import in `tests/support/portal.tsx`). Screens live in `features/<area>/components/`; the shell as a whole is `features/shell/components/home.tsx`, imported by `tests/support/portal.tsx` only. Tests are not subject to the import-boundary check (they import whatever they exercise), but a source file never imports a test.
- Every test must be shown to fail when the behaviour it protects is broken. When you add one, break the product code in a scratch copy (or temporarily), watch the test fail, then restore the code. A mutant that survives is a missing test or an equivalent change: say which.
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
- `notifySpy()` is the one way to read the toasts a screen shows. No screen, component or hook takes a `notify` prop any more: each reads `useToast()`. Call `notifySpy()` before rendering and `useToast()` answers that spy until the test ends; `notify.find("text").tone` is the tone the screen asked for: `"error"`, `"success"` or `undefined` (untagged), and `notify.messages()` / `notify.toasts()` list everything shown, in order. A failure that shows the database's own words must be tagged `"error"`, because those words say nothing about whether it failed. To prove that, script a database sentence that sounds cheerful ("Everything has been saved") and expect `"error"`.
  - How it works: `tests/component/setup.ts` mocks `components/ui/toast` for every test file with `withToastSpy` (`tests/support/toast-spy.ts`) and forgets the spy after each test. No test file mocks the toast module itself, and none passes a `notify`.
  - A test that makes no spy gets the real `useToast()`: a screen rendered inside the shell, or inside a `ToastProvider` the test renders, shows its toast in the real viewport (`toast-context-groups.test.tsx`, `toast-provider.test.tsx`). A screen rendered on its own with no spy and no provider throws "useToast must be used inside a ToastProvider": call `notifySpy()` first, even if the test does not read it.
- `advance(ms)` moves fake time (`vi.useFakeTimers()`) and lets pending promises run; `flush()` lets resolved promises run.
- `openPortal({ role, page, boot })` (`tests/support/portal.tsx`) signs a user in, scripts `get_portal_bootstrap` and renders the whole shell; `renderPortal()` renders it without scripting.

## Adding a component test

1. Create `tests/component/<screen>.test.tsx`. Import the screen on one line, plus `fake`, `ok`, `fail` and the helpers you need.
2. At the top, write what each old assertion or bug the file protects was, in a plain sentence each.
3. If you render a screen directly (not through the shell), call `setCacheOwner(userId)` first; the shell does it in production, and call `const notify = notifySpy()` before rendering (the screen reads `useToast()`; there is no `notify` prop). Pass the screen's props: `user` and the role flags it takes.
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
