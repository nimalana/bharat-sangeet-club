# UI patterns (Phase 3)

The shared pieces of Phase 3 (feedback, safety, accessibility) and how a screen uses them. Written for the people and agents who apply
them to the areas: you only apply, you do not rebuild. Each piece says what it is, its props, a short example, and what a screen must do.
Where a piece is missing something, say `needs: ...` in your report instead of copying the piece into your area.

Everything here lives in `components/ui/*` (the pieces and `ui.css`), `lib/toast.ts`, `lib/hooks/*`, `lib/api/_core.ts`, `styles/shared.css`
and `tests/support/*`. Nothing is used by a screen yet unless a section says so.

- [1. Toast](#1-toast)
- [2. Dialog](#2-dialog) (and the list of every dialog in the portal, with who migrates it)
- [3. Confirm](#3-confirm) (and how every destructive action confirms today)

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
