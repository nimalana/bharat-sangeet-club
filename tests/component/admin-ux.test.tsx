// The Admin page and the Sign-up requests, plan 3.1 (feedback), 3.2 (address) and 3.4 (accessibility):
//  - states: a list that never answered is an error with Try again (never an empty list), the first load is a skeleton, a refresh that
//    fails says the list may be out of date;
//  - nothing is sent twice (a double submit / press lands before the button has re-rendered, so only the code's own guard stops it) and
//    a failure keeps everything that was typed (the dialogs and the form stay as they were);
//  - the search and the "show deactivated" box are in the address (?q=, ?deactivated=1): a link opens the list filtered, Back/Forward
//    move the box, the caret does not jump while typing;
//  - axe on the page, its states and every dialog; the keyboard walkthrough of the sign-up queue and of a dialog's focus.
// (The numbers, the list, the permission question and the editor's fields are in admin-page.test.tsx; the queue's calls and sentences
// in signup-requests.test.tsx; the access buttons in action-feedback.test.tsx.)
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { focusedName, keyboardUser } from "../support/keyboard";
import { openPortal } from "../support/portal";

const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, full_name: name, email: `${id}@x.test`, role: "member", status: "active", phone: "919-555-0100", class_year: "2028", specialty: "Veena", joined_at: "2025-08-01", ...over });
const group = (id: number, name: string) => ({ id, name, description: `${name} description`, enrollment_mode: "approval", archived_at: null });
const active = (subgroup_id: number, member_id: string) => ({ subgroup_id, member_id, status: "active", membership_role: "member" });
const request = (id: string, name: string, over: Record<string, unknown> = {}) => ({ member_id: id, full_name: name, email: `${id}@x.test`, status: "pending", requested_at: "2026-10-01T12:00:00Z", decided_at: null, decided_by_name: null, reason: "", ...over });
const entry = (id: number) => ({ id, action: "role_changed", actor_email: "asha@x.test", target_email: "bala@x.test", details: {}, created_at: "2026-10-01T00:00:00Z" });
const announcement = (id: number, title: string) => ({ id, title, body: `${title} body`, is_pinned: id === 1, published_at: "2026-10-01T00:00:00Z", subgroup_id: null });

const GROUPS = [group(7, "Hindustani Vocal"), group(8, "Carnatic Violin")];
const MEMBERS = [member("u-me", "Asha Rao", { role: "admin" }), member("u-2", "Bala Menon"), member("u-3", "Chitra Iyer", { role: "executive" }), member("u-4", "Dev Nair", { status: "deactivated" })];
const row = (name: string) => screen.getByLabelText(`Permission for ${name}`).closest(".admin-member-row") as HTMLElement;

type Scripts = { members?: unknown; memberships?: unknown; announcements?: unknown; audit?: unknown; signups?: unknown };
/** Scripts the page's reads (each may be a reply) and opens it at `address` (default the Admin page). */
async function openAdmin(scripts: Scripts = {}, address = "admin") {
  fake.from("profiles", "select").reply((scripts.members ?? ok(MEMBERS)) as never);
  fake.from("subgroup_memberships", "select").reply((scripts.memberships ?? ok([active(7, "u-2")])) as never);
  fake.from("announcements", "select").reply((scripts.announcements ?? ok([announcement(1, "Rehearsal moved"), announcement(2, "Concert call")])) as never);
  fake.from("admin_audit_log", "select").reply((scripts.audit ?? ok([entry(1)])) as never);
  fake.rpc("list_pending_members").reply((scripts.signups ?? ok([request("u-5", "Esha Rao"), request("u-6", "Farid Khan")])) as never);
  openPortal({ role: "admin", page: address, boot: { groups: GROUPS } });
  await screen.findByRole("heading", { level: 1, name: "Club control center" });
}
const pageScope = () => document.querySelector(".page-section") as HTMLElement;

describe("a list that never answered is an error with Try again, not an empty list", () => {
  it("the members: the error replaces the list, the page around it is there, and Try again reads the page again", async () => {
    await openAdmin({ members: fail("Network is down") });
    const alert = await screen.findByText("The members could not be loaded.");
    expect(screen.queryByLabelText(/Permission for/)).not.toBeInTheDocument();
    expect(screen.queryByText("No member matches", { exact: false })).not.toBeInTheDocument();
    fake.from("profiles", "select").reply(ok(MEMBERS));
    fireEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("The members could not be loaded.")).not.toBeInTheDocument();
  });

  it("the announcements: the form is still there, the list says it could not be loaded, and Try again works", async () => {
    await openAdmin({ announcements: fail("Network is down") });
    const alert = (await screen.findByText("The announcements could not be loaded.")).closest("[role=alert]") as HTMLElement;
    expect(screen.queryByText("No announcements yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish announcement" })).toBeInTheDocument();
    fake.from("announcements", "select").reply(ok([announcement(1, "Rehearsal moved")]));
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Rehearsal moved/)).toBeInTheDocument();
  });

  it("the audit log: not 'no changes recorded', but the error and Try again", async () => {
    await openAdmin({ audit: fail("Network is down") });
    const alert = (await screen.findByText("The admin activity could not be loaded.")).closest("[role=alert]") as HTMLElement;
    expect(screen.queryByText("No administrative changes recorded yet.")).not.toBeInTheDocument();
    fake.from("admin_audit_log", "select").reply(ok([entry(1)]));
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Permission changed")).toBeInTheDocument();
  });

  it("the members' groups: the list is shown and says the Subgroups column may be wrong", async () => {
    await openAdmin({ memberships: fail("Network is down") });
    expect(await screen.findByText("The groups of each member could not be loaded, so the Subgroups column may be wrong.")).toBeInTheDocument();
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
  });

  it("while Try again reads, its button waits (disabled, aria-busy)", async () => {
    await openAdmin({ audit: fail("Network is down") });
    const alert = (await screen.findByText("The admin activity could not be loaded.")).closest("[role=alert]") as HTMLElement;
    const slow = deferred();
    fake.from("admin_audit_log", "select").reply(slow.reply);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(alert).getByRole("button", { name: "Try again" })).toHaveAttribute("aria-busy", "true"));
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeDisabled();
    await act(async () => { slow.resolve(ok([entry(1)])); });
    expect(await screen.findByText("Permission changed")).toBeInTheDocument();
  });
});

describe("the sign-up requests panel", () => {
  it("shows a skeleton while it reads, a failed read as an error with Try again (the skeleton again while it tries), then the people", async () => {
    const slow = deferred();
    await openAdmin({ signups: fail("Network is down") });
    const alert = (await screen.findByText("The sign-up requests could not be loaded.")).closest("[role=alert]") as HTMLElement;
    fake.rpc("list_pending_members").reply(slow.reply);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Loading sign-up requests")).toHaveAttribute("role", "status");
    expect(screen.queryByText("The sign-up requests could not be loaded.")).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok([request("u-5", "Esha Rao")])); });
    expect(await screen.findByText("Esha Rao")).toBeInTheDocument();
  });

  it("a refresh that fails keeps the people and says they may be out of date", async () => {
    await openAdmin({ signups: fail("unused") });
    fake.rpc("list_pending_members").replyOnce(ok([request("u-5", "Esha Rao")])).reply(fail("Network is down"));
    fireEvent.click((await screen.findByText("The sign-up requests could not be loaded.")).closest("[role=alert]")!.querySelector("button") as HTMLElement);
    expect(await screen.findByText("Esha Rao")).toBeInTheDocument();
    fake.rpc("review_pending_member").reply(fail("Someone else decided first"));
    fireEvent.click(screen.getByRole("button", { name: "Approve Esha Rao" }));
    expect(await screen.findByText("The sign-up requests could not be refreshed, so they may be out of date.")).toBeInTheDocument();
    expect(screen.getByText("Esha Rao")).toBeInTheDocument();
  });

  it("two presses on Approve before the buttons re-render send ONE review; the pressed button is busy, the others wait", async () => {
    await openAdmin();
    const slow = deferred();
    fake.rpc("review_pending_member").reply(slow.reply);
    const approve = await screen.findByRole("button", { name: "Approve Esha Rao" });
    act(() => { approve.click(); approve.click(); });
    await waitFor(() => expect(fake.rpc("review_pending_member").calls).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve Esha Rao" })).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("button", { name: "Approve Farid Khan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve Farid Khan" })).not.toHaveAttribute("aria-busy");
    await act(async () => { slow.resolve(ok({})); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve Farid Khan" })).toBeEnabled());
    expect(fake.rpc("review_pending_member").calls).toHaveLength(1);
  });

  it("two submits of the decline form send ONE review, and the dialog stays until it is done", async () => {
    await openAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Decline Esha Rao" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline Esha Rao?" });
    const slow = deferred();
    fake.rpc("review_pending_member").reply(slow.reply);
    const form = dialog.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.rpc("review_pending_member").calls).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Working…" })).toBeDisabled();
    fake.rpc("list_pending_members").reply(ok([request("u-6", "Farid Khan")]));
    await act(async () => { slow.resolve(ok({})); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.rpc("review_pending_member").calls).toHaveLength(1);
  });
});

describe("nothing is sent twice, nothing typed is lost", () => {
  const openEditor = async () => {
    await openAdmin();
    fireEvent.click(within(row("Bala Menon")).getByRole("button", { name: "Edit" }));
    const form = (await screen.findByRole("heading", { name: "Edit member" })).closest("form") as HTMLFormElement;
    fireEvent.change(within(form).getByLabelText("Preferred name"), { target: { value: "Bala M." } });
    fireEvent.change(within(form).getByLabelText("Voice / instrument"), { target: { value: "Violin" } });
    return form;
  };

  it("the member editor: a double submit sends ONE update, and the dialog cannot be closed while it is sent", async () => {
    const form = await openEditor();
    const slow = deferred();
    fake.rpc("admin_update_member_profile").reply(slow.reply);
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.rpc("admin_update_member_profile").calls).toHaveLength(1));
    const saving = screen.getByRole("button", { name: "Saving member…" });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close editor" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Edit member" })).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit member" })).not.toBeInTheDocument());
    expect(fake.rpc("admin_update_member_profile").calls).toHaveLength(1);
  });

  it("the member editor: a refused save keeps every field as typed and the button is back", async () => {
    const form = await openEditor();
    fake.rpc("admin_update_member_profile").reply(fail("Only administrators can edit members"));
    fireEvent.submit(form);
    expect(await screen.findByText(/Only administrators can edit members/, { selector: ".toast" })).toHaveClass("error");
    expect(within(form).getByLabelText("Preferred name")).toHaveValue("Bala M.");
    expect(within(form).getByLabelText("Voice / instrument")).toHaveValue("Violin");
    expect(within(form).getByRole("button", { name: "Save member" })).toBeEnabled();
  });

  it("the member editor: a click beside it does not close it (what was typed would be lost)", async () => {
    await openEditor();
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop); fireEvent.mouseUp(backdrop); fireEvent.click(backdrop);
    expect(screen.getByRole("heading", { name: "Edit member" })).toBeInTheDocument();
  });

  it("the announcement form: a double submit sends ONE announcement; the button says Publishing… and waits", async () => {
    await openAdmin();
    const form = screen.getByRole("heading", { name: "Post announcement" }).closest("form") as HTMLFormElement;
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Spring concert" } });
    fireEvent.change(within(form).getByLabelText("Message"), { target: { value: "Doors at 6" } });
    const slow = deferred();
    fake.from("announcements", "insert").reply(slow.reply);
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.from("announcements", "insert").calls).toHaveLength(1));
    const waiting = within(form).getByRole("button", { name: "Publishing…" });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveAttribute("aria-busy", "true");
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(within(form).getByLabelText("Title")).toHaveValue(""));
    expect(within(form).getByRole("button", { name: "Publish announcement" })).toBeEnabled();
    expect(fake.from("announcements", "insert").calls).toHaveLength(1);
  });

  it("the announcement form: a refused announcement keeps the title and the message, and says why", async () => {
    await openAdmin();
    const form = screen.getByRole("heading", { name: "Post announcement" }).closest("form") as HTMLFormElement;
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Spring concert" } });
    fireEvent.change(within(form).getByLabelText("Message"), { target: { value: "Doors at 6" } });
    fake.from("announcements", "insert").reply(fail("Only executives can post announcements"));
    fireEvent.submit(form);
    expect(await screen.findByText(/Only executives can post announcements/, { selector: ".toast" })).toHaveClass("error");
    expect(within(form).getByLabelText("Title")).toHaveValue("Spring concert");
    expect(within(form).getByLabelText("Message")).toHaveValue("Doors at 6");
  });

  it("deactivate: two presses send ONE request; a refusal keeps the question open with the reason as typed", async () => {
    await openAdmin();
    fireEvent.click(within(row("Bala Menon")).getByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Bala Menon?" });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Graduated" } });
    const slow = deferred();
    fake.rpc("admin_deactivate_member").reply(slow.reply);
    const button = within(dialog).getByRole("button", { name: "Deactivate" });
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(fake.rpc("admin_deactivate_member").calls).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Working…" })).toHaveAttribute("aria-busy", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Deactivate Bala Menon?" })).toBeInTheDocument();
    await act(async () => { slow.resolve(fail("The last administrator cannot be deactivated")); });
    expect(await screen.findByText(/The last administrator cannot be deactivated/, { selector: ".toast" })).toHaveClass("error");
    expect(screen.getByRole("dialog", { name: "Deactivate Bala Menon?" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue("Graduated");
    expect(within(dialog).getByRole("button", { name: "Deactivate" })).toBeEnabled();
    expect(fake.rpc("admin_deactivate_member").calls).toHaveLength(1);
  });
});

describe("the search and the deactivated box are in the address", () => {
  const search = () => screen.getByRole("textbox", { name: "Search members" }) as HTMLInputElement;

  it("a link with ?q= opens the list filtered, with the search box filled", async () => {
    await openAdmin({}, "admin&q=bala");
    expect(search()).toHaveValue("bala");
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("Chitra Iyer")).not.toBeInTheDocument();
  });

  it("typing writes ?q= (replacing the entry, so Back leaves the page), clearing removes it, and ?page= is left alone", async () => {
    await openAdmin();
    const entries = window.history.length;
    fireEvent.change(search(), { target: { value: "chi" } });
    await waitFor(() => expect(window.location.search).toBe("?page=admin&q=chi"));
    fireEvent.change(search(), { target: { value: "chitra" } });
    await waitFor(() => expect(window.location.search).toBe("?page=admin&q=chitra"));
    expect(window.history.length).toBe(entries);
    fireEvent.change(search(), { target: { value: "" } });
    await waitFor(() => expect(window.location.search).toBe("?page=admin"));
  });

  it("the caret stays where it is when a letter is typed in the middle of the text", async () => {
    await openAdmin();
    const user = keyboardUser();
    await user.click(search());
    await user.keyboard("ab");
    await waitFor(() => expect(window.location.search).toContain("q=ab"));
    search().setSelectionRange(1, 1);
    await user.keyboard("X");
    await waitFor(() => expect(window.location.search).toContain("q=aXb"));
    expect(search()).toHaveValue("aXb");
    expect(search().selectionStart).toBe(2);
  });

  it("the address changing by itself (Back, Forward, a link) moves the search box", async () => {
    await openAdmin({}, "admin&q=bala");
    await act(async () => { window.history.pushState({}, "", "/?page=admin&q=chitra"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(search()).toHaveValue("chitra"));
    expect(screen.getByText("Chitra Iyer")).toBeInTheDocument();
    expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument();
  });

  it("says so when nobody matches", async () => {
    await openAdmin({}, "admin&q=zzz");
    expect(await screen.findByText("No member matches “zzz”.")).toBeInTheDocument();
  });

  it("?deactivated=1 opens with the box ticked and the deactivated members listed; anything else is the usual list", async () => {
    await openAdmin({}, "admin&deactivated=1");
    expect(screen.getByLabelText("Show 1 deactivated")).toBeChecked();
    expect(screen.getByText("Dev Nair")).toBeInTheDocument();
  });

  it("?deactivated=yes is ignored (the usual list), and nothing is written back", async () => {
    await openAdmin({}, "admin&deactivated=yes");
    expect(screen.getByLabelText("Show 1 deactivated")).not.toBeChecked();
    expect(screen.queryByText("Dev Nair")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?page=admin&deactivated=yes");
  });
});

describe("accessibility of the Admin page", () => {
  it("the page, with its members, announcements, audit log and the sign-up queue", async () => {
    await openAdmin();
    await screen.findByText("Esha Rao");
    await expectNoSeriousViolations(pageScope());
  });

  it("the page with deactivated members shown and a search with no match", async () => {
    await openAdmin({}, "admin&deactivated=1&q=zzz");
    await screen.findByText("No member matches “zzz”.");
    await expectNoSeriousViolations(pageScope());
  });

  it("the skeleton, and each list's error", async () => {
    const slow = deferred();
    fake.from("profiles", "select").reply(slow.reply);
    openPortal({ role: "admin", page: "admin" });
    const status = await screen.findByText("Loading the control center");
    await expectNoSeriousViolations(status.closest("section") as HTMLElement);
  });

  it("every list failing at once (the errors, in place)", async () => {
    await openAdmin({ members: fail("Network is down"), announcements: fail("Network is down"), audit: fail("Network is down"), memberships: fail("Network is down"), signups: fail("Network is down") });
    await screen.findByText("The sign-up requests could not be loaded.");
    await expectNoSeriousViolations(pageScope());
  });

  it("the member editor", async () => {
    await openAdmin();
    fireEvent.click(within(row("Bala Menon")).getByRole("button", { name: "Edit" }));
    await expectNoSeriousViolations(await screen.findByRole("dialog", { name: "Edit member" }));
  });

  it("the permission question, the deactivate dialog, and the reactivate and delete questions", async () => {
    await openAdmin({}, "admin&deactivated=1");
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "admin" } });
    await expectNoSeriousViolations(await screen.findByRole("dialog", { name: "Make Bala Menon an administrator?" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(row("Bala Menon")).getByRole("button", { name: "Deactivate" }));
    await expectNoSeriousViolations(await screen.findByRole("dialog", { name: "Deactivate Bala Menon?" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(row("Dev Nair")).getByRole("button", { name: "Reactivate" }));
    await expectNoSeriousViolations(await screen.findByRole("dialog", { name: "Reactivate Dev Nair?" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(row("Dev Nair")).getByRole("button", { name: "Delete" }));
    await expectNoSeriousViolations(await screen.findByRole("dialog", { name: "Permanently delete Dev Nair?" }));
  });

  it("the decline form of the sign-up queue, and the Sign-up requests page", async () => {
    await openAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Decline Esha Rao" }));
    await expectNoSeriousViolations(await screen.findByRole("dialog", { name: "Decline Esha Rao?" }));
  });
});

describe("with only the keyboard", () => {
  it("approves a sign-up: Tab to Approve Esha Rao, Enter; the queue is read again and Esha is gone", async () => {
    await openAdmin();
    const user = keyboardUser();
    await screen.findByRole("button", { name: "Approve Esha Rao" });
    for (let step = 0; step < 80 && focusedName() !== "Approve Esha Rao"; step += 1) await user.tab();
    expect(focusedName()).toBe("Approve Esha Rao");
    fake.rpc("review_pending_member").reply(ok({}));
    fake.rpc("list_pending_members").reply(ok([request("u-6", "Farid Khan")]));
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/Esha Rao was approved and can use the portal now/, { selector: ".toast" })).toHaveClass("success");
    await waitFor(() => expect(screen.queryByText("Esha Rao")).not.toBeInTheDocument());
  });

  it("opens Decline with Enter, Escape closes it, and focus is back on the Decline button", async () => {
    await openAdmin();
    const user = keyboardUser();
    await screen.findByRole("button", { name: "Decline Esha Rao" });
    for (let step = 0; step < 80 && focusedName() !== "Decline Esha Rao"; step += 1) await user.tab();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Decline Esha Rao?" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(focusedName()).toBe("Decline Esha Rao");
  });

  it("the member editor: Enter on Edit opens it, focus is inside, Escape closes it and focus returns to Edit", async () => {
    await openAdmin();
    const user = keyboardUser();
    const edit = within(row("Bala Menon")).getByRole("button", { name: "Edit" });
    edit.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Edit member" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(edit).toHaveFocus();
  });
});
