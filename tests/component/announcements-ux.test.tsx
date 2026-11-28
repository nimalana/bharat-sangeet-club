// The announcement controls, plan 3.1 and 3.4: nothing is sent twice, nothing typed is lost, the dialogs are real dialogs, and the
// whole flow works from the keyboard. (What the editor sends, the wait and the toasts are in announcements-public.test.tsx; pin and
// delete in action-feedback.test.tsx.)
//  - a double submit of the editor sends ONE announcement; while it is sent nothing closes the dialog (Escape, the backdrop, Cancel);
//  - a click on the backdrop never throws away a half-written announcement;
//  - a double press on the delete question's button sends ONE delete, and the question stays until the delete is done;
//  - axe finds nothing serious in the editor (new and edit), the delete question and the feed;
//  - a person with only a keyboard posts an announcement: Tab to Post announcement, Enter, type, Tab to Publish, Enter; Escape closes
//    the editor and focus goes back to the button that opened it.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnouncementActions, AnnouncementEditor } from "../../features/announcements/components/announcement-actions";
import { AnnouncementFeed } from "../../features/announcements/components/announcement-feed";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { notifySpy, userOf } from "../support/helpers";
import { focusedName, keyboardUser } from "../support/keyboard";

const GROUPS = [{ id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "approval" as const, archived_at: null }, { id: 8, name: "Carnatic Violin", description: "", enrollment_mode: "approval" as const, archived_at: null }];
const existing = { id: 4, title: "Rehearsal moved", body: "Now at 7", is_pinned: false, subgroup_id: null as number | null };
const row = (over: Record<string, unknown> = {}) => ({ id: 4, title: "Rehearsal moved", body: "Now at 7", is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id: null, created_by: null, ...over });

function renderEditor(over: { announcement?: typeof existing } = {}) {
  notifySpy();
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<AnnouncementEditor user={userOf("u-me")} groups={GROUPS} announcement={over.announcement} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const formOf = () => within(screen.getByRole("dialog")).getByRole("button", { name: /Publish|Save changes|Saving…/ }).closest("form")!;

describe("the announcement editor: nothing is sent twice, nothing typed is lost", () => {
  it("a double submit publishes ONE announcement; the button waits (disabled, aria-busy)", async () => {
    const slow = deferred();
    fake.from("announcements", "insert").reply(slow.reply);
    const { onClose } = renderEditor();
    type("Title", "Spring concert");
    type("Message", "Doors at 6");
    const form = formOf();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.from("announcements", "insert").calls).toHaveLength(1));
    const waiting = screen.getByRole("button", { name: "Saving…" });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveAttribute("aria-busy", "true");
    await act(async () => { slow.resolve(ok([{ id: 11 }])); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fake.from("announcements", "insert").calls).toHaveLength(1);
  });

  it("while it is sent Escape does not close the dialog; when the answer is a failure the dialog is still there with what was typed and the reason", async () => {
    const slow = deferred();
    fake.from("announcements", "insert").reply(slow.reply);
    const { onClose } = renderEditor();
    type("Title", "Spring concert");
    type("Message", "Doors at 6");
    fireEvent.click(screen.getByLabelText("Pin to the top"));
    fireEvent.submit(formOf());
    await screen.findByRole("button", { name: "Saving…" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { slow.resolve(fail("The connection dropped")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("The connection dropped");
    expect(screen.getByLabelText("Title")).toHaveValue("Spring concert");
    expect(screen.getByLabelText("Message")).toHaveValue("Doors at 6");
    expect(screen.getByLabelText("Pin to the top")).toBeChecked();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a click on the backdrop does not close the dialog (a stray click must not throw away a half-written announcement)", async () => {
    const { onClose } = renderEditor();
    type("Title", "Spring concert");
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop); fireEvent.mouseUp(backdrop); fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Spring concert");
  });

  it("Escape and Cancel close it when nothing is being sent", async () => {
    const { onClose } = renderEditor();
    const user = keyboardUser();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("the delete question", () => {
  it("two presses on Delete announcement send ONE delete; the question stays until it is done, then closes", async () => {
    const notify = notifySpy();
    const slow = deferred();
    fake.from("announcements", "delete").reply(slow.reply);
    const onChanged = vi.fn();
    render(<AnnouncementActions user={userOf("u-me")} groups={GROUPS} announcement={existing} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Rehearsal moved" }));
    const confirm = within(screen.getByRole("dialog", { name: "Delete this announcement?" })).getByRole("button", { name: "Delete announcement" });
    act(() => { confirm.click(); confirm.click(); });
    await waitFor(() => expect(fake.from("announcements", "delete").calls).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: "Delete this announcement?" })).toBeInTheDocument();   // not closed by the second press
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.from("announcements", "delete").calls).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(notify.toasts()).toEqual([{ message: "Announcement deleted", tone: undefined }]);
  });

  it("the Pin button is busy (aria-busy) while the change is sent", async () => {
    notifySpy();
    const slow = deferred();
    fake.from("announcements", "update").reply(slow.reply);
    render(<AnnouncementActions user={userOf("u-me")} groups={GROUPS} announcement={existing} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Rehearsal moved" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pin Rehearsal moved" })).toHaveAttribute("aria-busy", "true"));
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pin Rehearsal moved" })).not.toHaveAttribute("aria-busy"));
  });
});

describe("accessibility of the announcement controls", () => {
  it("the editor for a new announcement", async () => {
    renderEditor();
    await expectNoSeriousViolations(screen.getByRole("dialog"));
  });

  it("the editor for an edit, and its failure sentence", async () => {
    fake.from("announcements", "update").reply(ok([]));
    renderEditor({ announcement: existing });
    fireEvent.submit(formOf());
    await screen.findByRole("alert");
    await expectNoSeriousViolations(screen.getByRole("dialog"));
  });

  it("the delete question", async () => {
    notifySpy();
    render(<AnnouncementActions user={userOf("u-me")} groups={GROUPS} announcement={existing} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Rehearsal moved" }));
    await expectNoSeriousViolations(await screen.findByRole("dialog"));
  });

  it("the feed, for a visitor and for someone who manages it; and the empty feed", async () => {
    notifySpy();
    const announcements = [row({ is_pinned: true }), row({ id: 5, title: "Concert call", subgroup_id: 7 })];
    const { container, rerender } = render(<AnnouncementFeed announcements={announcements} />);
    await expectNoSeriousViolations(container);
    rerender(<AnnouncementFeed announcements={announcements} manage={{ user: userOf("u-me"), groups: GROUPS, onChanged: vi.fn() }} />);
    await expectNoSeriousViolations(container);
    rerender(<AnnouncementFeed announcements={[]} />);
    expect(screen.getByText("No announcements yet.")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });
});

describe("with only the keyboard", () => {
  it("posts an announcement: Tab to Post announcement, Enter, type the title and the message, Tab to Publish, Enter", async () => {
    notifySpy();
    fake.from("announcements", "insert").reply(ok([{ id: 11 }]));
    const onChanged = vi.fn();
    render(<AnnouncementFeed announcements={[]} manage={{ user: userOf("u-me"), groups: GROUPS, onChanged }} />);
    const user = keyboardUser();
    await user.tab();
    expect(focusedName()).toBe("＋ Post announcement");
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Post an announcement" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();                                                       // the first field after wherever focus started
    while (document.activeElement !== within(dialog).getByLabelText("Title")) await user.tab();
    await user.keyboard("Spring concert");
    await user.tab();
    await user.keyboard("Doors at 6");
    await user.tab();                                                       // Pin to the top
    await user.keyboard(" ");
    await user.tab();                                                       // Cancel
    await user.tab();
    expect(focusedName()).toBe("Publish");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fake.from("announcements", "insert").calls[0].payload).toEqual({ title: "Spring concert", body: "Doors at 6", is_pinned: true, subgroup_id: null, created_by: "u-me" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(focusedName()).toBe("＋ Post announcement");                    // focus is back on the button that opened it
  });

  it("Escape closes the editor and focus goes back to the button that opened it", async () => {
    notifySpy();
    render(<AnnouncementFeed announcements={[]} manage={{ user: userOf("u-me"), groups: GROUPS, onChanged: vi.fn() }} />);
    const user = keyboardUser();
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Post an announcement" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(focusedName()).toBe("＋ Post announcement");
  });
});
