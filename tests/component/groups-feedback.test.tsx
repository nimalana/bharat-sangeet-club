// The Groups page, plan 3.1 (feedback) and 3.4 (keyboard) in one place:
//  - nothing is sent twice: a double press on Join / Request to join, a double submit of the create-group form and of the update form
//    send ONE request (the second press lands before the button has re-rendered as disabled, so only the code's own guard stops it);
//  - a request that fails keeps what the person typed (the dialogs stay open) and says why in a toast;
//  - a person who uses only the keyboard can join a group (at once, or by request), see it in My groups, create a group, and never loses
//    their place: after the page changes, focus is on the new page's heading, or on the sentence that says how the request went.
// The groups' own screens, the tabs and the reads are in group-spaces / group-tabs / group-parts / people-recordings tests.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { focusedName, keyboardUser } from "../support/keyboard";
import { openPortal } from "../support/portal";

const group = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, name, description: `${name} description`, enrollment_mode: "approval", archived_at: null, ...over });
const membership = (subgroup_id: number, status = "active", membership_role = "member") => ({ subgroup_id, member_id: "u-me", status, membership_role });

function openGroups(options: { role?: "member" | "executive" | "admin"; groups?: Array<Record<string, unknown>>; memberships?: Array<Record<string, unknown>>; address?: string } = {}) {
  const groups = options.groups ?? [];
  const memberships = options.memberships ?? [];
  fake.from("subgroups", "select").reply(ok(groups));
  fake.from("subgroup_memberships", "select").reply(ok(memberships));
  fake.from("announcements", "select").reply(ok([]));
  fake.from("archive_items", "select").reply(ok([]));
  openPortal({ role: options.role ?? "member", page: options.address ?? "groups", boot: { groups, memberships } });
}

/** Presses Tab until the focused element has this name (a real person's way to reach a control); fails if it is never reached. */
async function tabTo(user: ReturnType<typeof keyboardUser>, name: string, limit = 80) {
  for (let step = 0; step < limit; step += 1) {
    await user.tab();
    if (focusedName() === name) return;
  }
  throw new Error(`Tab never reached "${name}" in ${limit} presses (it stopped at "${focusedName()}")`);
}

describe("joining a group sends one request however often the button is pressed", () => {
  it("two presses before the button has re-rendered send ONE request; the button waits (disabled, aria-busy) until the answer", async () => {
    openGroups({ groups: [group(2, "Approval Group")] });
    const slow = deferred();
    fake.rpc("request_subgroup_enrollment").reply(slow.reply);
    const button = await screen.findByRole("button", { name: "Request to join" });
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(fake.rpc("request_subgroup_enrollment").calls).toHaveLength(1));
    const waiting = await screen.findByRole("button", { name: "Sending…" });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveAttribute("aria-busy", "true");
    await act(async () => { slow.resolve(ok(membership(2, "pending"))); });
    expect(await screen.findByText("Request pending")).toBeInTheDocument();
    expect(fake.rpc("request_subgroup_enrollment").calls).toHaveLength(1);
  });
});

describe("the create-group form", () => {
  async function openForm() {
    openGroups({ role: "executive" });
    fireEvent.click(await screen.findByRole("button", { name: "＋ New group" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a group" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Hindustani Ensemble" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Weekly practice" } });
    fireEvent.change(within(dialog).getByLabelText("Enrollment"), { target: { value: "invite" } });
    return dialog;
  }

  it("a double submit sends ONE group; the button waits (disabled, aria-busy) while it is on its way", async () => {
    const dialog = await openForm();
    const slow = deferred();
    fake.rpc("create_subgroup").reply(slow.reply);
    const form = dialog.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.rpc("create_subgroup").calls).toHaveLength(1));
    const button = within(dialog).getByRole("button", { name: "Create group" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fake.from("subgroups", "select").reply(ok([group(9, "Hindustani Ensemble")]));
    await act(async () => { slow.resolve(ok(group(9, "Hindustani Ensemble"))); });
    expect(await screen.findByRole("heading", { level: 1, name: "Hindustani Ensemble" })).toBeInTheDocument();
    expect(fake.rpc("create_subgroup").calls).toHaveLength(1);
  });

  it("while the group is sent Escape, Close and a click beside the form do nothing; a click beside the form never closes it", async () => {
    const dialog = await openForm();
    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop); fireEvent.click(backdrop);
    expect(screen.getByRole("dialog", { name: "Create a group" })).toBeInTheDocument();
    const slow = deferred();
    fake.rpc("create_subgroup").reply(slow.reply);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(fake.rpc("create_subgroup").calls).toHaveLength(1));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Create a group" })).toBeInTheDocument();
    fake.from("subgroups", "select").reply(ok([group(9, "Hindustani Ensemble")]));
    await act(async () => { slow.resolve(ok(group(9, "Hindustani Ensemble"))); });
    expect(await screen.findByRole("heading", { level: 1, name: "Hindustani Ensemble" })).toBeInTheDocument();
  });

  it("a refused group keeps everything that was typed, says why in a toast, and the button is back", async () => {
    const dialog = await openForm();
    fake.rpc("create_subgroup").reply(fail("Only executives can create groups"));
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByText(/Only executives can create groups/, { selector: ".toast" })).toHaveClass("error");
    expect(screen.getByRole("dialog", { name: "Create a group" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Hindustani Ensemble");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("Weekly practice");
    expect(within(dialog).getByLabelText("Enrollment")).toHaveValue("invite");
    const button = within(dialog).getByRole("button", { name: "Create group" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });
});

describe("the group-update form", () => {
  async function openForm() {
    openGroups({ role: "executive", groups: [group(7, "Hindustani Vocal")] });
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Post update" }));
    const dialog = await screen.findByRole("dialog", { name: "Post a group update" });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Rehearsal moved" } });
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Room 104" } });
    fireEvent.click(within(dialog).getByLabelText(/Pin this update/));
    return dialog;
  }

  it("a double submit posts ONE update; the button waits while it is on its way", async () => {
    const dialog = await openForm();
    const slow = deferred();
    fake.from("announcements", "insert").reply(slow.reply);
    const form = dialog.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.from("announcements", "insert").calls).toHaveLength(1));
    const button = within(dialog).getByRole("button", { name: "Publish to Hindustani Vocal" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.from("announcements", "insert").calls).toHaveLength(1);
  });

  it("while the update is sent Escape and Close do nothing, and a click beside the form never closes it", async () => {
    const dialog = await openForm();
    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop); fireEvent.click(backdrop);
    expect(screen.getByRole("dialog", { name: "Post a group update" })).toBeInTheDocument();
    const slow = deferred();
    fake.from("announcements", "insert").reply(slow.reply);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(fake.from("announcements", "insert").calls).toHaveLength(1));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Post a group update" })).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a refused update keeps the title, the message and the pin, says why in a toast, and the button is back", async () => {
    const dialog = await openForm();
    fake.from("announcements", "insert").reply(fail("new row violates row-level security policy for table \"announcements\"", "42501"));
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByText(/You do not have permission to do that\./, { selector: ".toast" })).toHaveClass("error");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Rehearsal moved");
    expect(within(dialog).getByLabelText("Message")).toHaveValue("Room 104");
    expect(within(dialog).getByLabelText(/Pin this update/)).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Publish to Hindustani Vocal" })).toBeEnabled();
  });
});

describe("the group settings form", () => {
  it("while it is saved Escape does nothing, Cancel is disabled and Save is busy; a refusal keeps what was typed", async () => {
    openGroups({ role: "executive", groups: [group(7, "Hindustani Vocal")], address: "groups&group=7&tab=roster" });
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fireEvent.click(await screen.findByRole("button", { name: "Group settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Group settings" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Hindustani Choir" } });
    const slow = deferred();
    fake.rpc("update_subgroup").reply(slow.reply);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(fake.rpc("update_subgroup").calls).toHaveLength(1));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Group settings" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-busy", "true");
    await act(async () => { slow.resolve(fail("Only executives can edit groups")); });
    expect(await screen.findByText(/Only executives can edit groups/, { selector: ".toast" })).toHaveClass("error");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Hindustani Choir");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("with only the keyboard", () => {
  it("joins an open group (Tab to Join group, Enter), lands on the group's heading, goes back with Enter and finds the group under Your groups", async () => {
    openGroups({ groups: [group(1, "Open Group", { enrollment_mode: "open" })] });
    fake.rpc("request_subgroup_enrollment").reply(ok(membership(1)));
    const user = keyboardUser();
    await screen.findByRole("button", { name: "Join group" });
    await tabTo(user, "Join group");
    await user.keyboard("{Enter}");
    const heading = await screen.findByRole("heading", { level: 1, name: "Open Group" });
    await waitFor(() => expect(heading).toHaveFocus());           // the Join button is gone: focus is on the new page, not lost
    await user.tab();
    expect(focusedName()).toBe("← All groups");
    await user.keyboard("{Enter}");
    const list = await screen.findByRole("heading", { level: 1, name: "My groups" });
    await waitFor(() => expect(list).toHaveFocus());
    expect(screen.getByRole("heading", { level: 2, name: "Your groups" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join group" })).not.toBeInTheDocument();
    await user.tab();
    expect(document.activeElement).toHaveTextContent("Open Group");   // the first Tab stop after the heading is the group
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });

  it("asks to join a group that needs approval (Space on Request to join) and hears how it went: focus is on the sentence, the card says Request pending", async () => {
    openGroups({ groups: [group(2, "Approval Group")] });
    fake.rpc("request_subgroup_enrollment").reply(ok(membership(2, "pending")));
    const user = keyboardUser();
    await screen.findByRole("button", { name: "Request to join" });
    await tabTo(user, "Request to join");
    await user.keyboard(" ");
    const sentence = await screen.findByText("Your request to join Approval Group was sent.");
    await waitFor(() => expect(sentence).toHaveFocus());
    expect(sentence).toHaveAttribute("role", "status");
    expect(screen.getByText("Request pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request to join" })).not.toBeInTheDocument();
  });

  it("a refused request puts focus on the database's sentence too, and the button is back", async () => {
    openGroups({ groups: [group(2, "Approval Group")] });
    fake.rpc("request_subgroup_enrollment").reply(fail("This group is archived"));
    const user = keyboardUser();
    await screen.findByRole("button", { name: "Request to join" });
    await tabTo(user, "Request to join");
    await user.keyboard("{Enter}");
    const sentence = await screen.findByText("This group is archived");
    await waitFor(() => expect(sentence).toHaveFocus());
    expect(screen.getByRole("button", { name: "Request to join" })).toBeEnabled();
  });

  it("an address that opens at a group does not take the focus away from the page", async () => {
    openGroups({ groups: [group(7, "Hindustani Vocal")], memberships: [membership(7)], address: "groups&group=7" });
    await screen.findByRole("tablist");
    expect(screen.getByRole("heading", { level: 1, name: "Hindustani Vocal" })).not.toHaveFocus();
  });

  it("an executive creates a group: Tab to ＋ New group, Enter, type, Tab to Create group, Enter; the new group opens", async () => {
    openGroups({ role: "executive" });
    fake.rpc("create_subgroup").reply(ok(group(9, "Hindustani Ensemble")));
    const user = keyboardUser();
    await screen.findByRole("button", { name: "＋ New group" });
    await tabTo(user, "＋ New group");
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Create a group" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);   // focus moved into the dialog
    await tabTo(user, "Close");
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Name"));
    await user.keyboard("Hindustani Ensemble");
    await user.tab();
    await user.keyboard("Weekly practice");
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Enrollment"));
    await user.tab();
    expect(focusedName()).toBe("Create group");
    fake.from("subgroups", "select").reply(ok([group(9, "Hindustani Ensemble")]));
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Hindustani Ensemble" })).toBeInTheDocument();
    expect(fake.rpc("create_subgroup").calls[0].payload).toEqual({ subgroup_name: "Hindustani Ensemble", subgroup_description: "Weekly practice", subgroup_mode: "approval" });
  });

  it("Escape closes the create-group form and focus goes back to the button that opened it", async () => {
    openGroups({ role: "executive" });
    const user = keyboardUser();
    await screen.findByRole("button", { name: "＋ New group" });
    await tabTo(user, "＋ New group");
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Create a group" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(focusedName()).toBe("＋ New group");
  });
});
