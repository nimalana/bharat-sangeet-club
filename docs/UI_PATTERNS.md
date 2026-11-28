# UI patterns (Phase 3)

The shared pieces of Phase 3 (feedback, safety, accessibility) and how a screen uses them. Written for the people and agents who apply
them to the areas: you only apply, you do not rebuild. Each piece says what it is, its props, a short example, and what a screen must do.
Where a piece is missing something, say `needs: ...` in your report instead of copying the piece into your area.

Everything here lives in `components/ui/*` (the pieces and `ui.css`), `lib/toast.ts`, `lib/hooks/*`, `lib/api/_core.ts`, `styles/shared.css`
and `tests/support/*`. Nothing is used by a screen yet unless a section says so.

- [1. Toast](#1-toast)
- [2. Dialog](#2-dialog) (and the list of every dialog in the portal, with who migrates it)
- [3. Confirm](#3-confirm) (and how every destructive action confirms today)
- [4. States and mutations](#4-states-and-mutations): errors with Try again, loading, pending buttons, forms
- [5. Upload progress](#5-upload-progress): `uploadWithProgress`, `UploadProgress`, and why it is a real progress bar
- [6. Preview](#6-preview): `PreviewDialog` for an image, a PDF, a recording, a video
- [7. State in the address](#7-state-in-the-address): `useUrlState` for the open tab, folder, selected group, month, filter
- [8. Accessibility base](#8-accessibility-base): the focus ring, `.sr-only`, reduced motion, 44px tap targets, `IconButton`, the 12px floor
- [9. Testing a screen](#9-testing-a-screen): axe, the keyboard, a fake upload, and what a test here cannot prove
- [10. Checklist for an area](#10-checklist-for-an-area): what to do in each area, in order, and what to report

---

## 1. Toast

`components/ui/toast.tsx`, `lib/toast.ts`. A screen still calls `const { notify } = useToast()` and `notify(message, tone?)`; the tone
rules of `lib/toast.ts` are unchanged (a failure is ALWAYS `notify(text, "error")` when the text comes from the database).

What changed in Phase 3.1:

| | before | now |
|---|---|---|
| A confirmation (`success`) | one toast, 2.8 s | fades after 2.8 s, unchanged |
| A failure (`error`) | 6 s | stays until the person presses its Dismiss button (`aria-label="Dismiss message"`, 44 px) or the next failure replaces it |
| Several at once | the newer replaced the older | they stack; at most 3 on screen; a failure replaces the failure before it; the same confirmation again replaces its copy; past 3 the oldest confirmation goes first |
| Announced | `role="status"` / `role="alert"` on a toast added to the page | the same roles, inside a polite live region (`.toast-stack`, `aria-live="polite"`) that is in the page before the first message |

```tsx
const { notify } = useToast();
notify("Saved");                                        // fades
notify(friendlyError(error, "It could not be saved."), "error");   // stays until dismissed
```

Rules for a screen:

- Say what to do next in a failure; it stays on screen, so the sentence must still make sense a minute later.
- Do not clear a form or close a dialog because a failure toast exists: the toast stays, the person fixes the input and tries again (see
  "Forms" in section 4 once it is there).
- In a test: `notifySpy()` as before; to see the real stack render `<ToastProvider>...<ToastViewport /></ToastProvider>`. The `.toast` element
  (class `toast success|error`, `role`, text `✓ message` / `! message`) is unchanged; its Dismiss button is its next sibling inside `.toast-item`.

Markup: `.toast-stack` (fixed, bottom right, a column) > `.toast-item` > `.toast.<tone>` [+ `button.toast-close`].

---

## 2. Dialog

`components/ui/dialog.tsx`. The one modal; `ConfirmDialog`, `FormDialog` and `PreviewDialog` are built on it and every area dialog should be.

```tsx
<Dialog open={open} onClose={() => setOpen(false)} labelledBy="edit-title" describedBy="edit-help" className="max-w-[520px]">
  <h2 id="edit-title">Edit the date</h2>
  <p id="edit-help">Changes show for everyone at once.</p>
  <form onSubmit={save}>...<Button type="submit">Save</Button></form>
</Dialog>
```

Props: `open`, `onClose`, `children`, `className` (the panel; default `max-w-[700px]`), `label` (aria-label for a dialog with no visible
title), `labelledBy` / `describedBy` (ids), `dismissible` (default `true`; `false`: neither Escape nor the backdrop closes it: a dialog that
is busy or must be answered), `closeOnBackdrop` (default = `dismissible`; `false` keeps Escape but ignores the backdrop: use it for a
form), `initialFocus` (a ref to the element that gets the focus; default the first control).

What it does, so you do not: `role="dialog"` `aria-modal="true"`; the accessible name is `label`, else `labelledBy`, else the first
`h1`/`h2`/`h3`/`[data-dialog-title]` inside (it gets an id); focus moves in on open and Tab / Shift+Tab wrap inside; Escape closes (calls
`onClose`); a click on the backdrop closes (a drag that started in the panel does not); focus returns to the element that opened it when
that element still exists; the page cannot scroll while it is open; everything else on the page is `inert` while it is open, except a
live region (the toasts); with several open only the topmost answers the keyboard. Nothing is rendered while `open` is false. It renders
where it is written (no portal).

A screen must:

- give every dialog a name (`labelledBy` or a heading; `label` for one with no heading);
- pass `dismissible={false}` (or `onClose` that ignores it) while the action it holds is running, never leave the dialog open and clickable
  to close in the middle of a save;
- keep `closeOnBackdrop` for a plain confirmation and use `closeOnBackdrop={false}` for a form with fields;
- put a visible Cancel / close control inside (Escape is not the only way out);
- never use `<div className="modal-backdrop">` again.

Moving a hand-rolled `.modal-backdrop` dialog onto `Dialog` (the finance `ModalShell` is the example: `<Dialog open onClose={onClose} className="modal finance-modal">`
with a `Button className="modal-close" aria-label="Close"`): replace the `modal-backdrop` div and the `onMouseDown` close by `<Dialog>`, keep the
`<form className="modal ...">` content and classes inside it (give the panel the class `modal` so its rules still apply, and drop the
second `.modal` box if it would double the border), and name it with its `<h2>`.

### Every dialog in the portal today

Shared (done): `components/ui/dialog.tsx`, `confirm-dialog.tsx`, `form-dialog.tsx`: all on the new primitive; their props and look are unchanged.
`FormDialog` now names itself from its title, describes itself from its description and no longer closes on a click beside it when it
has fields.

Already on `Dialog`, `ConfirmDialog` or `FormDialog` (they get the new behaviour with no change; the area still gives each a name where it
uses `Dialog` directly and checks the checklist above):

| Area | Where |
|---|---|
| attendance | `attendance-corrections.tsx` (`Dialog` edit meeting, void; `ConfirmDialog` delete meeting, clear mark, withdraw form), `action-dialogs.tsx` (`FormDialog`, `ConfirmDialog`) |
| admin | `admin-member-editor.tsx` (`Dialog`), `member-access.tsx` (`Dialog` deactivate; `ConfirmDialog` reactivate, delete account), `signup-requests-panel.tsx` (`FormDialog` decline) |
| announcements | `announcement-actions.tsx` (`Dialog` editor; `ConfirmDialog` delete) |
| recordings | `recording-detail.tsx`, `recording-studio.tsx`, `recording-manage.tsx` (`Dialog` edit recording and notation; `ConfirmDialog` archive, restore, delete recording, delete notation), `club-archive-manager.tsx` (`Dialog` edit, shared delete; `ConfirmDialog` delete) |
| finance | `modal-shell.tsx` (`Dialog`; used by `purchase-dialogs`, `income-dialog`, `document-dialogs`, `claim-dialogs`), `change-dialogs.tsx` (`ConfirmDialog` pay, submit; `FormDialog`) |
| resources | `resource-actions.tsx` (`Dialog` edit; `ConfirmDialog` visibility, archive, restore, delete) |
| groups | `group-confirm-dialogs.tsx` (4 `ConfirmDialog`: decline, remove, leave, archive), `add-member-dialog.tsx`, `group-settings-dialog.tsx` (`Dialog`) |

Hand-rolled, NOT on the primitive: no role, no name, no focus trap, no Escape, no focus return. **To migrate by the agent that owns the area:**

| Area | File | What it is |
|---|---|---|
| attendance | `absence-form-dialog.tsx` | absence form (`.modal-backdrop`, no backdrop or Escape handling) |
| attendance | `new-meeting-dialog.tsx` | new meeting (same) |
| calendar | `event-modal.tsx` | add or edit a date (`.modal-backdrop`, `onMouseDown` closes) |
| groups | `create-group-dialog.tsx` | create a group (same) |
| groups | `group-update-dialog.tsx` | post a group announcement (same) |
| members | `contact-dialog.tsx` | edit contact information (same) |
| recordings | `archive-modal.tsx` | add to the club archive (same; the shell mounts it from `portal.tsx` line 92: `ArchiveModal`) |
| resources | `resource-composer.tsx`, `resource-detail-panel.tsx` | side panels with their own scrim, `role="dialog"` and Escape handling (`resources.module.css`): they have a role; check name, focus trap, focus return, inert page, and move them onto `Dialog` with a panel class if the look allows (a slide-in panel may keep its own markup if it meets the same rules) |

Nothing in `features/shell` or `components/ui` is hand-rolled any more. The tests of the primitive are `tests/component/dialog.test.tsx`.

---

## 3. Confirm

One way to ask "are you sure?" for a destructive or hard-to-undo action. Three pieces, one dialog underneath (`Dialog` > `ConfirmDialog`):

| You need | Use |
|---|---|
| A yes or a no, then the screen runs the action | `useConfirm()` (`components/ui/confirm.tsx`) |
| A yes or a no, and the action runs INSIDE the dialog (a "Working..." button, the failure shown before it closes) | `ConfirmDialog` (`components/ui/confirm-dialog.tsx`), controlled: `open`, `busy`, `onConfirm`, `onCancel` |
| A reason or a few values with the yes | `FormDialog` (`components/ui/form-dialog.tsx`); with no fields it is a plain confirmation |

```tsx
const { confirm } = useConfirm();
const sure = await confirm({ title: "Delete this announcement?", message: "It disappears for everyone.", confirmLabel: "Delete announcement", tone: "destructive" });
if (!sure) return;
await save.run(() => deleteAnnouncement(id), { success: "Announcement deleted" });
```

`confirm({ title, message, confirmLabel?, tone? })` returns `Promise<boolean>`: `true` only on Confirm; Cancel, Escape and a click on the backdrop are
`false`. `message` is a string or any node (say what happens and what is kept); `confirmLabel` names the action ("Delete announcement", not
"OK"; default "Confirm"); `tone: "destructive"` makes Confirm the danger button (default `"default"`). Focus starts on Cancel for every tone, so
Enter never confirms by accident; focus goes back to the button that asked. Two questions asked together are asked one after the other. The
dialog is closed before the promise resolves: show the pending state on the button that asked (section 4).

`ConfirmProvider` is mounted once, in `features/shell/components/home.tsx` next to `ToastProvider`. `useConfirm()` outside a provider throws.
In a test render the screen with `withConfirm(<Screen />)` (`tests/support/confirm.tsx`), then click the Confirm button by its label.

Rules for a screen:

- Every action that deletes, removes, voids, archives, declines, deactivates, moves money or cannot be undone asks first, with the wording of what
  happens ("It cannot be undone", "Its expenses are released"). An action that only changes a setting and can be changed back does not.
- Name the action on the Confirm button; do not use "OK" or "Yes".
- Never use `window.confirm`, `window.alert` or `window.prompt` (tests stub them to say yes).

### How every destructive action confirms today

Checked in the code (`lib/api/*` functions that delete, remove, void, decline, archive, deactivate, clear, withdraw, cancel, leave, and where the
screens call them). "ok" = it asks with the shared dialogs already (they get the new Dialog behaviour for free); the area keeps the call site
and may move a plain yes/no onto `useConfirm()` where that is shorter, but does not have to.

**Replace (not on the shared dialogs):**

| Area | Action | Where | Today | To do |
|---|---|---|---|---|
| calendar | Remove a date | `features/calendar/hooks/use-calendar-page.ts` `remove()` | `window.confirm("Remove this date from the calendar?")` (the only one in the portal) | `useConfirm()`: title "Remove this date from the calendar?", `tone: "destructive"` |
| admin | Change a member's role (a `<select>`, `admin-page.tsx` `changeRole` -> `changeMemberRole`) | `features/admin/components/admin-page.tsx`, `admin-members-panel.tsx` | changes at once, no question; the person's access changes | ask first, at least for a change to or from administrator or executive; say what the role may do |

**Ok (they ask, with `ConfirmDialog`, `FormDialog` or a `Dialog` with a reason):**

| Area | Actions | Where |
|---|---|---|
| admin | deactivate a member (`Dialog` with a reason), reactivate, delete an account (`ConfirmDialog`), decline a sign-up (`FormDialog` with a reason) | `member-access.tsx`, `signup-requests-panel.tsx` |
| announcements | delete an announcement | `announcement-actions.tsx` |
| attendance | delete a meeting, clear a mark, withdraw an absence form (`ConfirmDialog`); void a meeting (`Dialog` with a reason); close or cancel a session, review an absence form, set eligibility (`FormDialog`, `ConfirmDialog` through `use-attendance-dialogs.ts`) | `attendance-corrections.tsx`, `action-dialogs.tsx` |
| finance | pay a reimbursement, mark a claim submitted (`ConfirmDialog`: `use-one-click-changes.ts`); void a payment, expense or funding claim, withdraw or decline a reimbursement, remove a claim expense or a document, record a claim decision (`FormDialog`: `corrections.ts` with `danger` and a reason where the person must say why) | `change-dialogs.tsx`, `corrections.ts` |
| groups | decline a request, remove a member, leave, archive or restore a group (`ConfirmDialog`) | `group-confirm-dialogs.tsx` |
| recordings | archive, restore, delete a recording; delete a notation; delete a club-archive item (`ConfirmDialog`) | `recording-manage.tsx`, `club-archive-manager.tsx` |
| resources | change visibility, archive, restore, delete or discard a file (`ConfirmDialog`) | `resource-actions.tsx` |

**One click, not destructive (no question needed):** pin or unpin an announcement; approve or waitlist a group request; approve a sign-up; mark a
claim ready or back to editing (`updateClaimStatus`); sign out (`use-portal-session.ts`; plan 3.2 turns it into an account menu).

A `ConfirmDialog` that is open while its action runs (`busy`) cannot be dismissed; its failure is a toast that stays (section 1), the dialog
stays open for another try or Cancel.

---

## 4. States and mutations

What a screen shows while it waits, when a load fails, and while a button's action runs. Plan 3.1: "error state with Retry instead of the empty
state on failed loads; skeleton rows; every mutation button disabled while pending (P2-11); forms keep contents on failure".

### 4.1 A read: loading, failed, empty, data

Four different things; never show one for another. A failed first load is NOT the empty state ("No members yet" for a database that did not
answer is a lie).

| State | Show | With |
|---|---|---|
| First read on the way | `SkeletonRows` (a list) or `LoadingBlock` (a line) | `loading` of `useQuery`, or your own flag |
| First read failed | `ErrorBlock` with Try again | `failed && data === undefined`, `retry()` |
| A refresh failed, rows on screen | the rows, plus `LoadErrorBanner` (it exists) | `failed && data !== undefined` |
| Read fine, nothing there | `EmptyState` | `data.length === 0` |

```tsx
const { data, loading, failed, retry } = useQuery({ userId: user.id, key: "members", load });
if (failed && data === undefined) return <ErrorBlock message="The members could not be loaded." onRetry={() => void retry()} role="alert" />;
if (loading) return <SkeletonRows rows={5} label="Loading the members" />;
if (!data?.length) return <EmptyState title="No members yet" text="..." />;
```

- `ErrorBlock({ message, onRetry, className?, role?, busy? })` (`components/ui/error-block.tsx`): the message and a small Try again button (it
  exists; the markup without `role` and `busy` is unchanged). `role="alert"` announces it when it replaces the content; `busy` disables the button
  while the retry runs. Say what failed and what the person can do ("could not be loaded"), not the raw error.
- `LoadingBlock({ children, role? })`: the line of text; `role="status"` for a placeholder that should be announced. Unchanged.
- `SkeletonRows({ rows = 3, label = "Loading", className? })` and `Skeleton({ className })` (`components/ui/skeleton.tsx`): bars of the shape of the
  content, pure CSS (`.skeleton`, 56 px rows; size a `Skeleton` with a class), the sweep stops under `prefers-reduced-motion`. The bars are
  `aria-hidden`; a screen reader hears one polite `role="status"` with `label`. Give `label` the screen's name for what is loading.
- `EmptyState({ title, text, className? })`: unchanged.
- `useQuery` (`lib/hooks/use-query.ts`), additions only: `error` (what `load` threw; `undefined` after a good read) and `retry()`. `retry()` clears `failed`
  and `error` at once, sets `loading` again when there is nothing to show (so the skeleton replaces the error while it tries), keeps the
  rows of a failed refresh on screen, reads, and resolves when the read has settled. `refetch()` is as before.
- A screen that reads without `useQuery` (several reads keyed together, `settle`): give its own `failed` state the same treatment: an ErrorBlock
  whose `onRetry` loads again, `busy` while it does.

### 4.2 A mutation: pending, exclusive, toast

```tsx
const { notify } = useToast();
const save = useAsyncAction(notify, { exclusive: true });
<Button pending={save.pending} onClick={() => save.run(() => saveThing(values), { fallback: "It could not be saved.", success: "Saved" })}>Save</Button>
```

- `Button` gets `pending` (`components/ui/button.tsx`): the button is `disabled` and `aria-busy="true"`, and looks as a disabled button does (opacity,
  no pointer). A second click cannot be sent. Do not change the label to a spinner; keep the words.
- `useAsyncAction(notify?, { exclusive? })` (`lib/hooks/use-async-action.ts`): `{ pending, error, run(action, { fallback?, success? }), clearError }` as before.
  New: `exclusive: true` makes a `run()` that starts while another is running do nothing (the action is not called, no toast; it returns
  `{ ok: false, skipped: true, message: "" }`), so a double click that lands before the button has re-rendered sends one request. Leave it off
  for one hook that serves a list of rows (overlapping runs are allowed, `pending` stays up until the last one settles).
- A run that fails sends the friendly sentence to `notify(..., "error")`: that toast STAYS (section 1); a success sends `success` and fades.
- A screen that tracks which row is busy (a key, `pendingKey`) keeps doing so and passes `pending={pendingKey === key}` to that row's button.

Where this applies (plan P2-11 names these): attendance (create a session, mark, roster changes), groups (roster changes, requests), finance (the several
actions), every dialog's submit button: each shows the pending state on the button that was pressed and blocks a second press.

### 4.3 A form: keep what was typed

The rule: **a failure never clears a form or closes its dialog. Only a success does.** Pending while it runs; on failure the values are
exactly as typed, the button works again, and the error toast stays (it does not fade, the person can read it and fix the input).

- Never `form.reset()`, `setValues(initial)` or `close()` in a `catch`, in an `if (error)` branch or before the call has answered. Reset and close
  after the outcome is `ok`: `const outcome = await save.run(...); if (outcome.ok) { reset(); close(); }`.
- Read `FormData` before the first `await` (a handler that awaits loses `event.currentTarget`; keep a reference to the form element).
- Uncontrolled fields (`defaultValue`, `FormData`) keep their text across a failed submit as long as the dialog or form stays mounted; do not
  re-key it (`key={...}`) from the failure path.
- A dialog that holds the form stays open on failure (`dismissible={!save.pending}`); Escape and Cancel still close it when nothing is running.
- Checked in the code today: the only `form.reset()` calls are in success paths (`attendance/hooks/use-absence-form.ts` after the form was
  saved, `admin/components/admin-page.tsx` after the announcement was published). Look for the same in your area: a `setX("")` or a
  `close()` that runs before the result is known.
- No `useFormDraft` helper was added: with uncontrolled fields and this rule nothing is lost, and the screens that hold values in state
  already keep them. If an area finds a form that needs a draft kept across a reload, report it as `needs:`.

`tests/component/states.test.tsx` has the pattern as a test ("a form: pending, the values kept on a failure, the failure toast stays").


---

## 5. Upload progress

supabase-js uploads through `fetch`, and a browser's `fetch` does not say how many bytes of the request have left. A 40 MB recording shows
nothing for a minute. Two options were weighed (plan 3.1):

- **A. `uploadWithProgress`**: send the SAME request through `XMLHttpRequest`, which has `upload.onprogress`.
- **B.** No bytes: a per-file status list (waiting, uploading, done, failed with Retry).

**Decision: A, and the status list of B is the same component** (`UploadProgress` shows the status words for every row and adds the bar when
bytes are known), so nothing is lost if an area prefers to show status only. The brief said to pick A only if A is verifiably the same request
and testable; both are shown:

- What supabase-js sends (read in `node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts` `uploadOrUpdate` and
  `supabase-js/src/lib/fetch.ts` `fetchWithAuth`): `POST {url}/storage/v1/object/{bucket}/{path}`; headers `apikey` (the publishable key),
  `Authorization: Bearer <the session's access token, or the key when nobody is signed in>`, `x-upsert`, and `X-Client-Info` (the SDK version);
  a `FormData` body with `cacheControl` and the file as the unnamed part (the browser writes the content type and the boundary).
- `tests/component/upload-with-progress.test.ts` runs the **real supabase-js client** and `uploadWithProgress` against one scripted transport and
  compares URL, method, every header, every part of the body, the returned `{ path, id, fullPath }`, and the error for a refused upload (409, 413,
  a policy refusal, an answer with a code, an answer that is a page not JSON) and for a dropped connection (same message, same status, same code,
  same `friendlyError` sentence). The one difference is `X-Client-Info`, which is only telemetry (the test names it). **If an upgrade of
  supabase-js changes the request, this test fails**: that is the guard against the two drifting apart.
- It is testable without a network: `tests/support/fake-xhr.ts` (below). 27 one-line mutations of `uploadWithProgress` were each caught by the tests.

Not verified here (no real browser, no real storage): a real upload against Supabase, the CORS preflight (the header set is the same as
fetch's minus `x-client-info`, a subset of what the preflight already allows), a real browser's `lengthComputable`. The first area that adopts it
should upload one real file and watch the bar move.

### `uploadWithProgress` (`lib/api/_core.ts`)

```ts
uploadWithProgress(client, bucket, path, file, options?, onProgress?): Promise<UploadAnswer>
//   client      the Supabase client (only its session is read: client.auth.getSession())
//   bucket      a LITERAL, at the call site: "recordings" (the contract check reads it, see below)
//   path        the storage path, as for .upload()
//   file        a File or Blob
//   options     { upsert?: boolean (default false), cacheControl?: string (default "3600"), signal?: AbortSignal }
//   onProgress  ({ loaded, total }) => void   bytes sent / size of the request body (a few bytes more than the file)
// resolves, never throws:
//   { data: { path, id, fullPath }, error: null }   or   { data: null, error: ApiError }
```

It is a drop-in for `client.storage.from(bucket).upload(path, file, { upsert })`: the answer has the same two sides, so the call site changes by one line and
the line after it stays:

```ts
// before
const upload = await client.storage.from("recordings").upload(path, file, { contentType: file.type, upsert: false });
if (upload.error) throw toApiError(upload.error);
// after
const upload = await uploadWithProgress(client, "recordings", path, file, { upsert: false }, onProgress);
if (upload.error) throw upload.error;   // toApiError(upload.error) also works: an ApiError is returned as it is
```

- `contentType` is not passed: supabase-js ignores that option for a `File` body too (the file part carries `file.type`). `uploadResourceFile` takes a
  `contentType` argument that therefore never reached the server; if a file can have an empty `file.type`, build `new File([file], file.name, { type })`
  before the upload.
- The project URL and key come from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, the two variables `lib/supabase.ts`
  reads. Without them it sends nothing and answers `error.message === "The portal is not connected."`.
- Errors: a refusal carries the server's own message and HTTP status (`error.status`), so `friendlyError(error)` says what it said for the raw
  error. A dropped connection has the message `Failed to fetch` (so `friendlyError` gives its "connection dropped" sentence, as for supabase-js).
  A cancelled upload (`options.signal.abort()`) has `error.code === "aborted"` and the message "The upload was cancelled.": do not show a
  failure toast for it.
- `onProgress` runs for every `progress` event of the browser (often several a second): put it in state, not in a toast. When `loaded >= total`
  all bytes have left and the server is still storing the file; `UploadProgress` says "Saving" then, and reaches "Uploaded" only on the answer.
- In development, `lib/supabase.ts`'s request log (`__supabaseRequests()`) does not list these uploads: they do not go through its `fetch`.

**The contract check still sees the bucket.** `scripts/contract-check/config.json` has `"storageHelpers": [{ "name": "uploadWithProgress", "bucketArg": 1,
"method": "upload" }]`: the extractor reads a call of that function as `storage.from(<argument 1>).upload`, checks the bucket exists and has an INSERT policy for
authenticated, and lists a bucket that is not a literal as UNRESOLVED (the allowance is 5, so pass a literal or `npm run test:contract` fails).
`scripts/contract-check/selftest.mjs` has the control (a valid call: nothing new) and the injected breaks (a missing bucket) for it. A new helper of this
kind goes into that list, not around it.

### `UploadProgress` (`components/ui/upload-progress.tsx`)

```tsx
type UploadItem = { id: string; name: string; status: "waiting" | "uploading" | "done" | "failed"; loaded?: number; total?: number; error?: string };
<UploadProgress items={uploads} onRetry={(id) => send(id)} label="Recordings being uploaded" />
```

The screen owns the list (the file's header has the whole pattern: `patch(id, { loaded, total })` from `onProgress`, `{ status: "done" }` or
`{ status: "failed", error: friendlyError(answer.error) }` from the answer; the pattern is a test in `tests/component/upload-progress.test.tsx`).
`uploadPercent(item)` is exported for a screen that wants the number.

- It renders nothing for an empty list; otherwise a list named `label` (default "Uploads"), a row per file.
- Each row: the name; a state that is a polite `role="status"` and changes only when the STATE changes (Waiting, Uploading, Saving, Uploaded,
  `Failed: <the sentence>`), never at every percent; while uploading a `role="progressbar"` named "Uploading <name>" with `aria-valuemin=0`,
  `aria-valuemax=100`, `aria-valuenow` and `aria-valuetext` ("42%", or "Saving"); the percent in text for the eye (`aria-hidden`).
- The percent is 0 to 99 while bytes are on the way. **100 means uploaded and only the answer says it.** A bar that sits at 100% while the file
  is still being stored is a bar that lies.
- A failed row has a `Retry` button named "Retry <name>" when `onRetry` is given; Retry calls `onRetry(id)`; the screen sets the row back to
  `uploading` and sends the same file again. Keep the file object for it (a `Map` or a ref keyed by `id`).
- A failure still goes to the toast as before (section 1: it stays); the row says which file failed.
- The bar has its own border (its track alone, `--line` on `--ivory`, is 1.5:1); text colours on `--ivory` are 4.9:1 (state, percent), 8.1:1 (failed) and
  7.2:1 (uploaded). The width change does not animate for a person who asked for less motion.

Where this applies, as the areas adopt it: recordings (a take, a notation file, an archive upload: the large files), resources (`resource-upload-panel`), finance
documents, attendance excuse proofs. The six upload call sites are in `lib/api/<area>.ts`: `uploadRecordingTake`, `uploadNotationFile`, `uploadClubArchiveFile` (recordings),
`uploadResourceFile` (resources), `uploadFinanceDocument` (finance), `uploadExcuseProof` (attendance). None was changed here. Each takes a progress
callback from the screen that calls it, so an adopting area adds an optional `onProgress` parameter to its upload function and passes it through.

### Testing an upload (`tests/support/fake-xhr.ts`)

```ts
const xhr = installFakeXhr();                      // replaces XMLHttpRequest, sets the two public env variables; setup.ts undoes both after every test
const done = uploadWithProgress(client, "recordings", "u/take.mp3", file, {}, onProgress);
await xhr.waitForRequest();                        // the request goes out after the session was read, not in the same tick
xhr.last.progress(500, 1000);                      // -> onProgress({ loaded: 500, total: 1000 })
xhr.last.respond(200, { Id: "1", Key: "recordings/u/take.mp3" });   // or respond(413, { message: "..." }), or networkError()
await done;
xhr.last.url / .method / .headers / .body          // what was sent
```

Through a screen, the client is the fake client of `tests/support/fake-supabase.ts`: script `fake.signIn(...)` if the test needs a token (without a session the
key is the bearer token, as in production).


---

## 6. Preview

`components/ui/preview-dialog.tsx`: a stored file shown in the portal's `Dialog` instead of leaving the page (resources, recordings, finance documents,
attendance proofs).

```tsx
<PreviewDialog
  open={previewing !== null} onClose={() => setPreviewing(null)} title={previewing?.title ?? ""}
  load={async () => ({ url: await signedUrl(previewing!.path), mime: previewing!.mime, name: previewing!.fileName })}
/>
```

- `load(): Promise<{ url, mime, name }>` is the area's own signed-link function (`signResourceFile`, `signRecordingUrl`, ...). A function that answers
  `string | null` is wrapped so that `null` throws: `const url = await sign(path); if (!url) throw new Error("The file could not be opened."); return {...}`
  (an answer with an empty `url` is treated as a failure too). It runs **each time the dialog opens**, and again on Try again, so a link that expired
  while the dialog was closed is never shown. It does not run again when the screen renders again (the latest function is used when it does run).
  Under React's StrictMode (development) it runs twice at an opening, and only the answer of the last one is shown.
- Shown with the browser's own elements and nothing else, as the platform's Content-Security-Policy expects (the storage origin in `img-src`,
  `media-src`, `frame-src`): `<img alt={name}>` for an image, `<iframe title="{name} (PDF)">` for a PDF, `<audio controls>` / `<video controls>` named
  after the file for a recording or a video, and for any other file a sentence with a `Download {name}` link. No script fetches the file and there is no
  `blob:` URL. `previewKind(mime, name)` (exported) says which: the type decides, and only an empty or `application/octet-stream` type falls back to the
  extension. A screen can use it to show "Preview" only for a file that can be previewed and "Download" for the rest.
- Every shown file has the link **Open in a new tab** (`target="_blank" rel="noopener noreferrer"`).
- States: **Loading the preview…** is a polite status. A failure is `role="alert"` with the sentence of the error (`friendlyError`, fallback "The file could
  not be opened.") and **Try again**. An image or a recording that does not load from its link (an expired or refused link) is the same alert, "The file
  could not be shown.", and Try again asks `load()` for a fresh link. A PDF in an iframe cannot report that, so a refused PDF link shows the browser's own
  error page inside the frame.
- It is a `Dialog`: named by `title`, Escape / Close / the backdrop close it, focus starts on **Close** and goes back to the button that opened it, the page
  behind is inert and cannot scroll.

Not verified here (no real browser): that a real browser plays an `<audio>` with a signed link, renders a PDF in the frame, and how Tab moves into and out of
a PDF viewer (jsdom has no frames; axe audits the iframe element and its title but not what is inside). Check one PDF by keyboard in a real browser: Tab from
Close should enter the PDF, and Shift+Tab / Tab should reach Close and Open in a new tab again.

An `<a download>` on a cross-origin signed link is ignored by browsers (they navigate instead): for files that only download, "Open in a new tab" is the
dependable link, and `Download {name}` works when the storage answers with a `Content-Disposition`.


---

## 7. State in the address

`lib/hooks/use-url-state.ts`: one shared way to keep a piece of screen state in the address bar, so a reload keeps it, a link opens it and Back
and Forward move through it (plan 3.2, P2-10: the selected group, the open folder, the finance tab, the calendar month, filters).

```tsx
const TABS = ["overview", "meetings", "excuses"] as const;
const [tab, setTab] = useUrlState("tab", { parse: oneOf(TABS), defaultValue: "overview", history: "push" });
const [groupId, setGroupId] = useUrlState("group", { parse: positiveInteger, defaultValue: null, history: "push" });
const [search, setSearch] = useUrlState("q", { defaultValue: "", history: "replace" });
```

`useUrlState<T>(key, { defaultValue, history, parse?, serialize? }): [value, setValue]`

| option | meaning |
|---|---|
| `defaultValue` | the value when the parameter is absent or invalid; **a constant** (it is compared by `serialize`, and an object made fresh at each render is a new value each time) |
| `history` | **required**: `"push"` adds a history entry (Back returns to the previous value: a tab, a folder, a selection), `"replace"` overwrites the current one (a filter typed letter by letter: Back should leave the screen, not undo a letter) |
| `parse(raw)` | text of the parameter to a value; return `undefined` (or `null`) for text that is not valid; it may throw. Default: the text itself. Helpers: `oneOf(["a","b"] as const)` and `positiveInteger` (an id: `7` yes; `0`, `-1`, `1.5`, `007`, `7abc` no, as `parseFolderParam` reads `?folder=`) |
| `serialize(value)` | value to text. Default: `String(value)`. Write one for a value whose `String` is not what the address should hold (a month as `2026-11`) |

What it does, each point a test in `tests/component/use-url-state.test.tsx`:

- **The same format as the rest of the portal.** It reads `new URLSearchParams(window.location.search)`, writes `history.pushState({}, "", "<path>?<query>")`
  (or `replaceState`) and listens to `popstate`, exactly as `usePortalNavigation` (`?page=`, `?signin=`) and `useResourceFolder` (`?folder=`) do. It keeps every
  parameter it was not asked about (`?page=` first among them, in its place) and the hash. **It does not change how `?page=` works**: that is still
  `lib/sections.ts` and the shell. A page change (`navigate()`) writes `?page=<name>` alone, so the parameters of the page you left do not follow you to the
  next one; Back brings the old page and its parameters back (tested together with `usePortalNavigation`).
- **The default is the clean address.** Setting the default removes the parameter (`/?page=attendance`, not `/?page=attendance&tab=overview`). An address that
  spells the default out (`?tab=overview`) is read as the default and left alone.
- **A bad parameter is the default, never an error.** Empty (`?tab=`), unknown (`?tab=zzz`), refused by `parse`, a `parse` that throws: the value is `defaultValue`.
  Reading never writes to the address (no clean-up `replaceState` on mount).
- **Back and Forward** update the value (`popstate`). Two hooks with the same key (a screen and its child) stay in step.
- **SSR-safe.** Nothing reads `window` while rendering. The server render and a hydration (the prerendered public page) give `defaultValue` first and the
  address's value in a second render straight after (`useSyncExternalStore` with a server snapshot), so there is no hydration mismatch. A screen that mounts
  later on the client (every screen behind the sign-in) has the address's value in its first render: no flash of the default.
- **One tick, one history entry.** `setTab("meetings"); setFolder(12);` in one handler is one entry, one Back undoes both. The same key set twice: the last value
  wins; set and set back: nothing is written. If any of the updates asks for `"push"` the entry is pushed, otherwise it replaces. The updates of different
  ticks (two clicks, or before and after an `await`) are different entries.
- **A value that is already in the address writes nothing** (no empty history entry from a click on the tab that is already open).
- `setValue(next)` has one identity for the life of the screen and always uses the options of the latest render. There is no updater form
  (`setValue(prev => ...)`): the value you hold is the one in the address.

Rules for the areas:

- The key is the parameter's name and must not be `page`, `signin` or `folder` (the shell and the library own them); use a name of your screen (`tab`, `group`, `month`, `q`, `status`).
- Put in the address what a person would send as a link (the tab, the selected group, the month, the status filter). Do not put in it a draft, a password, a person's
  email or anything private: addresses are logged, shared and kept in the browser's history.
- State that is derived from the address must not also be copied into `useState` (two truths): read it from `useUrlState`. A screen that cannot show a value yet
  (the group is not loaded) shows the default until it can; do not write the default back.
- A parameter that a page leaves behind is dropped by the shell's `navigate()` when the page changes; a screen that wants one to survive a page change sets it again after.
- Test it through the real address (`window.history.replaceState({}, "", "/?page=attendance&tab=meetings")` before rendering, `window.location` after); `setup.ts` resets the address to `/` after every test.


---

## 8. Accessibility base

What every screen inherits from `styles/shared.css` and `components/ui` (plan 3.4). A screen applies it by not undoing it.

### The focus ring

One rule in `styles/shared.css` gives **every** focusable element (links, buttons, inputs, selects, textareas, `summary`, `[tabindex]`, anything `:focus-visible`) the same ring:

```css
:focus-visible { outline: 3px solid var(--ink) !important; outline-offset: 2px; box-shadow: 0 0 0 2px var(--paper) !important; }
```

Two tones, because one is not enough on this palette: the old ring (carolina blue alone, 3 px) is **2.81:1 on the page (`--ivory`), 2.64:1 on pale blue and 3.00:1 on white**:
not the 3:1 a focus indicator needs (WCAG 1.4.11). Ink outside and a paper-white band between it and the element give, whichever background is under the element,
a tone that stands out: ink is **13.6:1 on the page, 14.5:1 on white, 12.7:1 on pale blue, 9.3:1 on `--line`, 4.8:1 on carolina** (a hovered button); the white band is **17.4:1 on
the dark header and footer** (`--maroon-dark`), where ink alone would be 1.2:1. `tests/component/a11y-base.test.tsx` computes these ratios from the tokens in the stylesheet and fails if a background gets
less than 3:1 from both tones, or if the band stops touching the ring.

- Do not write `outline: none` or `outline: 0` on a focusable element and do not remove the box-shadow of `:focus-visible`. The only two rules that do are the search box inside `.search`
  (its container draws the border) and the dialog panel (`[role="dialog"]`, which takes focus itself and names itself); both are pinned by a test.
- Do not draw your own ring with `focus-visible:` utilities; `Button` no longer has its own (the global ring replaced it). A *different* focus style that is needed (a row that highlights)
  is added on top of the ring, not instead of it.
- `app/globals.css` still has an older `:focus-visible` rule (carolina, in `@layer base`); it is overridden by this one (`!important`) and is dead code. It is outside the foundation's files.

Not verified here: how the ring looks on the real pages (clipped by an `overflow:hidden` parent, hidden behind a sticky header). That is for the browser run. A focused element inside a container
with `overflow:hidden` loses the outer part of the ring: give that container `padding` of 4px or use `overflow:clip` with `overflow-clip-margin: 5px`.

### `.sr-only`

`<span className="sr-only">Delete the announcement</span>`: not drawn, read by a screen reader (the clip pattern, not `display:none`). It is a plain rule in `shared.css` so that it exists whether or not
Tailwind generated the class. Use it for a name an icon needs next to it, a status that is only for the ear (`SkeletonRows` uses it), a heading a section has for navigation. An icon-only
button takes `IconButton` instead.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` in `shared.css` ends every transition and animation of every element (`.01ms`, no delay, one iteration) and sets `scroll-behavior: auto`; `ui.css` also switches
off the skeleton sweep and the upload bar's width transition. Nothing in the foundation has to move to be understood. A screen that moves something by script (`element.animate`, a CSS animation
it adds) follows the same rule. **Finding for the shell and public-site owners:** `window.scrollTo({ top: 0, behavior: "smooth" })` in `features/shell/hooks/use-portal-navigation.ts` and in
`features/public/components/public-site.tsx` is a script-driven smooth scroll, which the CSS rule does not stop; choose `behavior` from `matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"`.

### Tap targets: 44px on a small screen

- `Button`: `min-h-11` (44px) by default; `size="sm"` is 36px on a wide screen and 44px under 700px (`max-[700px]:min-h-11`), and under 700px every button is at least 44px wide.
- `IconButton`: 36px square, 44px under 700px.
- `Input`: `h-11`; `Textarea`: `min-h-24`; the plain `input, select, textarea` of the stylesheets: `min-height: 44px` (the modal's were 43px: now 44).
- The legacy `.modal-close` (the × of the hand-made modals) is 44px under 700px.
- A link or button that is not one of these (a text link inside a sentence is exempt; a row that is clickable is not): `min-h-11` and `max-[700px]:min-w-11` on a plain element, or use `Button`/`IconButton`.

### `IconButton` (`components/ui/icon-button.tsx`)

```tsx
<IconButton aria-label="Close the editor" onClick={onClose}>×</IconButton>
<IconButton aria-label={`Edit ${member.name}`} onClick={() => edit(member)}><PencilIcon aria-hidden="true" /></IconButton>
```

`aria-label` is **required by the type** (a call without it is a compile error; TypeScript does not check hyphenated attributes it does not know, so `aria-labelledby` is not refused, but it is not the way to name this button); the name says what the button does ("Close the editor", "Edit Asha"), not what it
looks like ("×", "pencil"). `type` is `button` unless given, a ref and a class are forwarded, and every other `<button>` attribute works. The hand-written icon buttons found by area (`.modal-close`,
`.toast-close`, the resources panel's `iconButton`, `Button variant="ghost" aria-label=... >×`) are for the area agents to move to `IconButton` when they touch them.

### Text is never under 12px

No text under 12px (0.75rem) in `styles/shared.css`, `components/ui/ui.css` and the classes of `components/ui/*.tsx`; `a11y-base.test.tsx` reads those files and fails on a smaller size (so the next edit cannot bring one back).
Rules raised to 12px in this step: `shared.css`: `.brand small` / `.role-button small` / `.footer-brand small` (10px), `.eyebrow` (10px, hidden by a later rule), `.count` (10px), `time` (10px), `footer` (10px), `.modal label` (10px),
`.action-feedback` (11px), `.workspace-seal` (11px); `ui.css`: `.scope-badge` (8px), `.content-scope` (7px); `Button size="sm"` (0.68rem = 10.9px) and `Badge` (0.66rem = 10.6px) now `text-xs` (12px).
Found in the areas, not changed: `features/dashboard/dashboard.css` (3 declarations), `features/shell/shell.css` (1) and 8 classes in `features/admin` (`text-[0.65rem]`, `text-[0.7rem]`). The same rule applies to the area files:
12px or more, and do not set a size in a unit that scales below it.

The larger text can wrap a place that was tuned for the smaller size (a badge, the footer, the header's "UNC Chapel Hill"); that is for the browser run to check.


---

## 9. Testing a screen

Everything here is in `tests/support/*` and runs in jsdom. The tests of the pieces themselves (`tests/component/{toast-provider,dialog,confirm,states,upload-progress,upload-with-progress,preview-dialog,use-url-state,a11y-base,test-support}.test.tsx`)
are the examples to copy.

**Accessibility, with axe-core** (`tests/support/a11y.ts`):

```tsx
const view = render(<ScreenUnderTest />);
await expectNoSeriousViolations(view.container);        // or view.baseElement when it opens a dialog
```

Every axe rule runs; a violation of impact *serious* or *critical* fails the test and names the rule, the help text and the elements. *Moderate* and *minor* findings are not reported (they are advice about page structure that a
single screen cannot satisfy). **Off: `color-contrast`**, which jsdom cannot compute: the contrast of the ring and of the shared colours is checked by arithmetic (section 8) and by a person in a browser. An iframe is audited as an element
(its title) but not inside. A fragment is audited without a landmark or an `<h1>`: a violation that still shows up is a real finding. Run it **in every state a screen can be in** (loading, empty, failed, with data, with a dialog open), not only the happy one.

**The keyboard, with user-event** (`tests/support/keyboard.ts`):

```tsx
const user = keyboardUser();                                   // keyboardUser({ fakeTimers: true }) under vi.useFakeTimers()
await user.tab();                                              // a real Tab: user-event computes the order
expect(focusedName()).toBe("Cancel");                          // aria-label, else text, else tag; "(page)" for the body
expect(await tabOrder(user, 3)).toEqual(["Cancel", "Delete", "Cancel"]);   // Tab 3 times; { shift: true } for Shift+Tab
await user.keyboard("{Escape}");
```

A screen that can be used with a mouse must be usable with these four moves: Tab reaches every control in a sensible order, Enter and Space act on a button, Escape closes a dialog and focus goes back to what opened it, and a
dialog keeps Tab inside. Test the ones your screen has. jsdom does not paint, so "focus is visible" is not testable here (section 8 has the ring's numbers); "focus is where it should be" is.

**A fake upload** (`tests/support/fake-xhr.ts`, section 5): `installFakeXhr()`, `xhr.waitForRequest()`, `xhr.last.progress(...)` / `.respond(...)` / `.networkError()`.

**A dialog that confirms**: render inside `ConfirmWrapper` / `withConfirm(node)` (`tests/support/confirm.tsx`), or the screen has no `ConfirmProvider` and `useConfirm()` throws.

**A toast**: `notifySpy()` (`tests/support/helpers.ts`) as before; to see the stack, render `ToastProvider` + `ToastViewport`.

**The address**: `window.history.replaceState({}, "", "/?page=attendance&tab=meetings")` before the render, `window.location` after (section 7). `setup.ts` resets the address, the fake client, timers, env stubs and globals after every test.

**Every new behaviour needs a test that fails when the behaviour is broken.** Break the code on purpose in a scratch copy (change a string, drop a guard, flip a condition), see the test fail, restore. The tests of the
pieces were checked this way (the evidence is in the foundation's report); a test that passes on a broken product is the most expensive kind.

What a test here **cannot** prove, so it goes on the browser run (`tests/browser`, the coordinator's axe run) and in the report as "not verified": colour contrast as painted; that the focus ring is visible and not clipped; layout at 360px
and the 44px targets as laid out; real screen-reader announcements (a live region that works in jsdom can still be silent in NVDA, JAWS or VoiceOver); real focus behaviour inside a PDF or media element; `prefers-reduced-motion` as a
browser sets it; a real upload against Supabase storage.

---

## 10. Checklist for an area

Do these in the area's files; use the piece, do not copy it. Anything a piece lacks: say `needs: ...` in the report; do not fork it.

**Feedback and safety (3.1)**
- [ ] Every failure that comes from the database is `notify(friendlyError(error, "<what to do next>"), "error")`; confirmations are plain `notify("Saved")` (section 1).
- [ ] Every destructive or hard-to-undo action asks first: `useConfirm()` with `tone: "destructive"` and a `confirmLabel` that names the action ("Delete announcement"), never `window.confirm`, never an unguarded click (section 3 lists each action in the portal and where it stands).
- [ ] Every first read has a loading state (`SkeletonRows` or `LoadingBlock`), a failed state with **Try again** (`ErrorBlock` + `retry` from `useQuery`), and an empty state (section 4.1).
- [ ] Every button that starts a mutation shows `pending` and cannot be pressed twice (`Button pending`, `useAsyncAction`, `exclusive` where a double click is possible) (4.2).
- [ ] A failed save never clears a form or closes its dialog (4.3).
- [ ] Every upload shows progress and a Retry on failure: `uploadWithProgress` + `UploadProgress` (section 5). Keep the bucket a literal.

**Dialogs and files (3.3, 3.4)**
- [ ] Every hand-made modal of the area is a `Dialog`/`FormDialog`/`ConfirmDialog` (the catalogue in section 2 names them), with a name, a description where it has one, Escape, focus in and back, and `dismissible={!busy}`.
- [ ] A stored file that a person opens is shown with `PreviewDialog` where it can be previewed (`previewKind`), with its own signed-link function as `load` (section 6).

**State in the address (3.2)**
- [ ] The selected group, tab, folder, month and filters the area has are `useUrlState`, with a key of the area's own and `history` chosen on purpose (section 7). `?page=` is not touched.

**Accessibility (3.4)**
- [ ] No `outline: none` without a replacement; no text under 12px in the area's CSS or `text-[...]` classes; no smooth scroll by script without checking reduced motion (section 8).
- [ ] Every icon-only control is an `IconButton` with a real name; every control is 44px under 700px.
- [ ] Every input has a visible label that is a `<label>` for it (or `aria-label` where a label would be redundant); errors are text, not only colour.
- [ ] An axe test and a keyboard test for the screen, in each of its states (section 9).

**In the report**
- [ ] Per file: what moved onto which piece. Every user-visible sentence added or changed (word for word). Every test that had to change and why. Mutation evidence for the new tests. What was **not** verified (section 9's list).
- [ ] Every `needs:` (what the piece lacks) and every file changed outside the area.

## 11. Where each area used the pieces (end of Phase 3)

What the address carries now (all with `useUrlState`; a bad value falls back to the default and is never written back):

| Page | Parameters |
|---|---|
| Any | `page` (the shell's, unchanged) |
| My Groups | `group` (open group), `tab` (announcements, dates, resources, recordings, attendance, roster, requests) |
| Calendar | `month` (push), `event` (replace) |
| Members | `q` (replace), `group` (push) |
| Attendance | `scope` (all, club, group-N), `term`, `session`; the tab is NOT in the address |
| Recordings | `view`, `group`, `q`, `recording` |
| Resources | `folder`, `q` |
| Finance | `tab` (overview, expenses, reimbursements, claims; `requests` is read as reimbursements), `flow`, `request` / `expense` / `payment` (the open detail) |
| Admin | `q`, `deactivated` |

Notes for whoever changes a page next:
- A group's Resources and Attendance tabs show those screens for the group; the shell supplies them (`renderGroupTab` in `features/shell/components/portal.tsx`). Recordings and Dates stay the group page's own panels: the recordings screen keeps its own group filter under `?group=`, the name the group page uses for the open group.
- Choosing "My Groups" while a group is open takes the person back to the list: `navigate()` tells the screens that keep state in the address when the same page gets another address.
- Uploads (`uploadWithProgress` + `UploadProgress`): resources and folders, recording takes, notation files, club archive, finance receipts and claim documents, attendance excuse proof. Order of operations and clean-up rules are as before.
- Every destructive action asks first, through `ConfirmDialog` (the action runs inside it and keeps it open and busy) or `useConfirm`; actions that need a reason use `FormDialog`.
- Previews (`PreviewDialog`): library files, notation files, archive items, receipts and claim documents. External links stay links.
- Account menu in the top bar (My profile, Sign out); "Complete your profile" once after the first sign-in (see docs/KNOWN_GAPS.md entry 2).
- Embedded screens inside a group tab each draw their own `<h1>`; a heading structure that fits the tab layout is a later cleanup.
