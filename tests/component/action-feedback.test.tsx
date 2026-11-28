// What a person sees while a button press waits for the database, and after: the wait (the button is disabled, the dialog says
// "Working…" and cannot be closed), the toast, the dialog, and what the parent is told. Written for the controls that share the
// pending / failure / toast handling in lib/hooks/use-async-action.ts (announcement pin and delete, member access), so that
// moving them onto the hook changes none of it. The failure TONE of the same controls is in toast-tone.test.tsx.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberAccessActions } from "../../components/admin/member-access";
import { AnnouncementActions } from "../../components/announcements/announcement-actions";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok } from "../support/fake-supabase";

const RLS = 'new row violates row-level security policy for table "announcements"';

describe("announcements: pinning and deleting wait, say what happened, and tell the parent", () => {
  const announcement = { id: 4, title: "Rehearsal moved", body: "Now at 7", is_pinned: false, subgroup_id: null };
  function renderActions(over: Partial<typeof announcement> = {}) {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<AnnouncementActions user={userOf("u-me")} groups={[]} announcement={{ ...announcement, ...over }} onChanged={onChanged} notify={notify} />);
    return { notify, onChanged };
  }
  const updates = () => fake.from("announcements", "update");
  const deletes = () => fake.from("announcements", "delete");

  it("pinning: the button is disabled while the change is sent, then a plain success toast and onChanged", async () => {
    const slow = deferred();
    updates().reply(slow.reply);
    const { notify, onChanged } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pin Rehearsal moved" }));
    await waitFor(() => expect(updates().count).toBe(1));
    expect(screen.getByRole("button", { name: "Pin Rehearsal moved" })).toBeDisabled();
    expect(notify.toasts()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Pin Rehearsal moved" })).toBeEnabled();
    expect(notify.toasts()).toEqual([{ message: "Announcement pinned", tone: undefined }]);
    expect(updates().calls[0].payload).toEqual({ is_pinned: true });
    expect(updates().calls[0].used("eq", "id", 4)).toBe(true);
  });

  it("unpinning says so", async () => {
    updates().reply(ok(null));
    const { notify, onChanged } = renderActions({ is_pinned: true });
    fireEvent.click(screen.getByRole("button", { name: "Unpin Rehearsal moved" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(notify.toasts()).toEqual([{ message: "Announcement unpinned", tone: undefined }]);
    expect(updates().calls[0].payload).toEqual({ is_pinned: false });
  });

  it("a failed pin shows the sentence a person can read, as an error, enables the button again and does not tell the parent", async () => {
    updates().reply(fail(RLS, "42501"));
    const { notify, onChanged } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pin Rehearsal moved" }));
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0]).toEqual({ message: "You do not have permission to do that.", tone: "error" });
    expect(screen.getByRole("button", { name: "Pin Rehearsal moved" })).toBeEnabled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a database sentence a person can read is shown as it is, capitalised", async () => {
    updates().reply(fail("canceling statement due to statement timeout"));
    const { notify } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pin Rehearsal moved" }));
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0].message).toBe("Canceling statement due to statement timeout");
  });

  it("deleting: the dialog says Working… and cannot be dismissed while it waits, then closes with a toast and onChanged", async () => {
    const slow = deferred();
    deletes().reply(slow.reply);
    const { notify, onChanged } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete Rehearsal moved" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete announcement" }));
    await waitFor(() => expect(deletes().count).toBe(1));
    expect(within(dialog).getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(deletes().calls[0].used("eq", "id", 4)).toBe(true);
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(notify.toasts()).toEqual([{ message: "Announcement deleted", tone: undefined }]);
  });

  it("a failed delete closes the dialog all the same, shows the failure and does not tell the parent", async () => {
    deletes().reply(fail(RLS, "42501"));
    const { notify, onChanged } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete Rehearsal moved" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete announcement" }));
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0]).toEqual({ message: "You do not have permission to do that.", tone: "error" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a second press while a change is being sent does not send another", async () => {
    const slow = deferred();
    updates().reply(slow.reply);
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pin Rehearsal moved" }));
    await waitFor(() => expect(updates().count).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Pin Rehearsal moved" }));
    await act(async () => { slow.resolve(ok(null)); });
    expect(updates().count).toBe(1);
  });
});

describe("member access: the wait, the toast, the dialog and the parent", () => {
  const active = { id: "u-2", full_name: "Bala Menon", email: "u-2@x.test", status: "active" as const };
  const gone = { ...active, status: "deactivated" as const };
  function renderAccess(member: typeof active | typeof gone) {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<MemberAccessActions member={member} isSelf={false} onChanged={onChanged} notify={notify} />);
    return { notify, onChanged };
  }

  it("deactivating sends the trimmed reason, waits with Working…, then closes the dialog, empties the reason, toasts and tells the parent", async () => {
    const slow = deferred();
    fake.rpc("admin_deactivate_member").reply(slow.reply);
    const { notify, onChanged } = renderAccess(active);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "  Graduated  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(fake.rpc("admin_deactivate_member").count).toBe(1));
    expect(fake.rpc("admin_deactivate_member").calls[0].payload).toEqual({ p_target_id: "u-2", p_reason: "Graduated" });
    expect(within(dialog).getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(notify.toasts()).toEqual([{ message: "Bala Menon was deactivated", tone: undefined }]);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(within(screen.getByRole("dialog")).getByLabelText(/Reason/)).toHaveValue("");
  });

  it.each([
    ["admin_reactivate_member", "Reactivate", "Reactivate", "Bala Menon was reactivated", { p_target_id: "u-2" }],
    ["admin_delete_member", "Delete", "Delete account", "Bala Menon was deleted", { p_target_id: "u-2" }],
  ] as const)("%s: toast, dialog closed, parent told", async (rpc, open, confirmLabel, message, payload) => {
    fake.rpc(rpc).reply(ok(null));
    const { notify, onChanged } = renderAccess(gone);
    fireEvent.click(screen.getByRole("button", { name: open }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: confirmLabel }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fake.rpc(rpc).calls[0].payload).toEqual(payload);
    expect(notify.toasts()).toEqual([{ message, tone: undefined }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failure keeps the dialog and the reason, enables the buttons again, and says it with the standard sentence when the database's is not readable", async () => {
    fake.rpc("admin_deactivate_member").reply(fail('violates check constraint "profiles_status_check"', "23514"));
    const { notify, onChanged } = renderAccess(active);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Moved away" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0]).toEqual({ message: "That change could not be saved.", tone: "error" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue("Moved away");
    expect(within(dialog).getByRole("button", { name: "Deactivate" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
