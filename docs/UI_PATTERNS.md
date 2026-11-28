# UI patterns (Phase 3)

The shared pieces of Phase 3 (feedback, safety, accessibility) and how a screen uses them. Written for the people and agents who apply
them to the areas: you only apply, you do not rebuild. Each piece says what it is, its props, a short example, and what a screen must do.
Where a piece is missing something, say `needs: ...` in your report instead of copying the piece into your area.

Everything here lives in `components/ui/*` (the pieces and `ui.css`), `lib/toast.ts`, `lib/hooks/*`, `lib/api/_core.ts`, `styles/shared.css`
and `tests/support/*`. Nothing is used by a screen yet unless a section says so.

- [1. Toast](#1-toast)
- [2. Dialog](#2-dialog) (and the list of every dialog in the portal, with who migrates it)

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
