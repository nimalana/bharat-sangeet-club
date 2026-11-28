// The sign-up queue (P0-01): the people who signed in for the first time and wait for an executive.
//
// An executive opens it as the Sign-up requests page, an administrator also finds it on the Admin page; both are the same panel.
//  what it lists (waiting, oldest first as the database sends them; recently declined with who and why);
//  Approve and Decline send exactly review_pending_member(p_member_id, p_approved, p_reason), Decline asks for an optional reason;
//  what each outcome says (success toast, error toast with the database's words) and that the queue and the menu count are read again;
//  a failed read is never "nobody is waiting".
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const request = (id: string, name: string, over: Record<string, unknown> = {}) => ({ member_id: id, full_name: name, email: `${id}@x.test`, status: "pending", requested_at: "2026-10-01T12:00:00Z", decided_at: null, decided_by_name: null, reason: "", ...over });
const declined = (id: string, name: string, over: Record<string, unknown> = {}) => request(id, name, { status: "rejected", decided_at: "2026-10-03T12:00:00Z", decided_by_name: "Chitra Iyer", reason: "Not a student", ...over });

const WAITING = [request("u-1", "Bala Menon"), request("u-2", "", { email: "nameless@x.test" })];
const nav = () => screen.getByRole("navigation", { name: "Portal navigation" });
const rowOf = (name: string) => screen.getByText(name).closest(".signup-row") as HTMLElement;

async function openQueue(rows: unknown[] = WAITING, role: "executive" | "admin" = "executive") {
  fake.rpc("list_pending_members").reply(ok(rows));
  openPortal({ role, page: "signups", boot: { pending_signups: rows.filter((row) => (row as { status: string }).status === "pending").length } });
  await screen.findByRole("heading", { level: 1, name: "Sign-up requests" });
  await waitFor(() => expect(screen.queryByText("Loading sign-up requests…")).not.toBeInTheDocument());
}

describe("what the queue lists", () => {
  it("asks list_pending_members once, shows each person's name, email and the day they signed up, and how many wait", async () => {
    await openQueue();
    expect(fake.rpc("list_pending_members").count).toBe(1);
    expect(within(rowOf("Bala Menon")).getByText("u-1@x.test")).toBeInTheDocument();
    expect(within(rowOf("Bala Menon")).getByText("Signed up Oct 1, 2026")).toBeInTheDocument();
    // Someone with no name is listed by their email.
    expect(screen.getByRole("button", { name: "Approve nameless@x.test" }).closest(".signup-row")).toHaveTextContent("nameless@x.test");
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
  });

  it("says so when nobody is waiting", async () => {
    await openQueue([]);
    expect(screen.getByText("No sign-ups are waiting for approval.")).toBeInTheDocument();
    expect(screen.queryByText("Recently declined")).not.toBeInTheDocument();
  });

  it("lists the recently declined apart, with who declined, when and why, and an Approve that undoes it", async () => {
    await openQueue([...WAITING, declined("u-3", "Dev Nair")]);
    expect(screen.getByText("Recently declined")).toBeInTheDocument();
    const gone = rowOf("Dev Nair");
    expect(within(gone).getByText("Declined by Chitra Iyer · Oct 3, 2026 · Not a student")).toBeInTheDocument();
    expect(within(gone).getByRole("button", { name: "Approve Dev Nair" })).toBeInTheDocument();
    expect(within(gone).queryByRole("button", { name: "Decline Dev Nair" })).not.toBeInTheDocument();
    // They are not counted as waiting.
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
  });

  it("a declined sign-up with no reason and no recorded decider still reads sensibly", async () => {
    await openQueue([declined("u-3", "Dev Nair", { decided_at: null, decided_by_name: null, reason: "" })]);
    expect(within(rowOf("Dev Nair")).getByText("Declined")).toBeInTheDocument();
  });

  it("a decline reason that holds markup is shown as text, never as markup", async () => {
    await openQueue([declined("u-3", "Dev Nair", { reason: "<img src=x onerror=alert(1)>" })]);
    expect(within(rowOf("Dev Nair")).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("a failed read is a failure with Try again, never 'nobody is waiting'", async () => {
    fake.rpc("list_pending_members").replyOnce(fail("Could not reach the server")).reply(ok(WAITING));
    openPortal({ role: "executive", page: "signups" });
    expect(await screen.findByText("The sign-up requests could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No sign-ups are waiting for approval.")).not.toBeInTheDocument();
    expect(await screen.findByText(/Could not reach the server/, { selector: ".toast" })).toHaveClass("error");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    expect(fake.rpc("list_pending_members").count).toBe(2);
  });

  it("the queue is read by an executive's screen only: a refused read says why", async () => {
    fake.rpc("list_pending_members").reply(fail("Only club executives can see sign-up requests", "42501"));
    openPortal({ role: "executive", page: "signups" });
    expect(await screen.findByText(/Only club executives can see sign-up requests/, { selector: ".toast" })).toHaveClass("error");
  });
});

describe("Approve", () => {
  it("sends exactly the member, true and no reason; says so; reads the queue again and lowers the menu count", async () => {
    await openQueue();
    expect(within(nav()).getByRole("button", { name: "Sign-up requests (2 waiting)" })).toBeInTheDocument();
    fake.rpc("review_pending_member").reply(ok({}));
    fake.rpc("list_pending_members").reply(ok([WAITING[1]]));
    fireEvent.click(screen.getByRole("button", { name: "Approve Bala Menon" }));
    expect(await screen.findByText(/Bala Menon was approved and can use the portal now/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.rpc("review_pending_member").calls).toHaveLength(1);
    expect(fake.rpc("review_pending_member").calls[0].payload).toEqual({ p_member_id: "u-1", p_approved: true, p_reason: "" });
    await waitFor(() => expect(fake.rpc("list_pending_members").count).toBe(2));
    await waitFor(() => expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument());
    expect(within(nav()).getByRole("button", { name: "Sign-up requests (1 waiting)" })).toBeInTheDocument();
  });

  it("the last one approved leaves no count in the menu", async () => {
    await openQueue([WAITING[0]]);
    fake.rpc("review_pending_member").reply(ok({}));
    fake.rpc("list_pending_members").reply(ok([]));
    fireEvent.click(screen.getByRole("button", { name: "Approve Bala Menon" }));
    expect(await screen.findByText("No sign-ups are waiting for approval.")).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "Sign-up requests" })).toBeInTheDocument();
    expect(nav().querySelector(".nav-count")).toBeNull();
  });

  it("a refusal (another executive was first) is shown in the database's words as an error, nothing is reported as approved, and the queue is read again", async () => {
    await openQueue();
    fake.rpc("review_pending_member").reply(fail("This person is already an active member. Nothing was changed.", "P0001"));
    fake.rpc("list_pending_members").reply(ok([WAITING[1]]));
    fireEvent.click(screen.getByRole("button", { name: "Approve Bala Menon" }));
    expect(await screen.findByText(/This person is already an active member\. Nothing was changed\./, { selector: ".toast" })).toHaveClass("error");
    expect(screen.queryByText(/was approved/)).not.toBeInTheDocument();
    await waitFor(() => expect(fake.rpc("list_pending_members").count).toBe(2));
    await waitFor(() => expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument());
  });

  it("while a decision is on its way every button waits, so a double click sends one request", async () => {
    await openQueue();
    const slow = deferred();
    fake.rpc("review_pending_member").reply(slow.reply);
    fireEvent.click(screen.getByRole("button", { name: "Approve Bala Menon" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve Bala Menon" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Decline Bala Menon" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve nameless@x.test" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve Bala Menon" }));
    expect(fake.rpc("review_pending_member").calls).toHaveLength(1);
    await act(async () => { slow.resolve(ok({})); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve Bala Menon" })).toBeEnabled());
  });

  it("the undo: Approve on a declined sign-up sends the same call", async () => {
    await openQueue([declined("u-3", "Dev Nair")]);
    fake.rpc("review_pending_member").reply(ok({}));
    fake.rpc("list_pending_members").reply(ok([]));
    fireEvent.click(screen.getByRole("button", { name: "Approve Dev Nair" }));
    expect(await screen.findByText(/Dev Nair was approved and can use the portal now/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.rpc("review_pending_member").calls[0].payload).toEqual({ p_member_id: "u-3", p_approved: true, p_reason: "" });
    await waitFor(() => expect(screen.queryByText("Recently declined")).not.toBeInTheDocument());
  });
});

describe("Decline", () => {
  const dialog = () => screen.getByRole("dialog");

  it("opens a dialog that explains what happens and asks for a reason, and sends nothing yet", async () => {
    await openQueue();
    fireEvent.click(screen.getByRole("button", { name: "Decline Bala Menon" }));
    expect(within(dialog()).getByRole("heading", { name: "Decline Bala Menon?" })).toBeInTheDocument();
    expect(within(dialog()).getByText(/will see that their sign-up was not approved/)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText(/Reason \(optional/)).toBeInTheDocument();
    expect(fake.rpc("review_pending_member").calls).toHaveLength(0);
  });

  it("sends the member, false and the trimmed reason; says so; the declined person moves to Recently declined", async () => {
    await openQueue();
    fireEvent.click(screen.getByRole("button", { name: "Decline Bala Menon" }));
    fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "  Not a student  " } });
    fake.rpc("review_pending_member").reply(ok({}));
    fake.rpc("list_pending_members").reply(ok([WAITING[1], declined("u-1", "Bala Menon", { reason: "Not a student" })]));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Decline sign-up" }));
    expect(await screen.findByText(/Bala Menon's sign-up was declined/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.rpc("review_pending_member").calls[0].payload).toEqual({ p_member_id: "u-1", p_approved: false, p_reason: "Not a student" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Recently declined")).toBeInTheDocument();
    expect(within(rowOf("Bala Menon")).getByRole("button", { name: "Approve Bala Menon" })).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "Sign-up requests (1 waiting)" })).toBeInTheDocument();
  });

  it("the reason is optional", async () => {
    await openQueue();
    fireEvent.click(screen.getByRole("button", { name: "Decline Bala Menon" }));
    fake.rpc("review_pending_member").reply(ok({}));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Decline sign-up" }));
    await waitFor(() => expect(fake.rpc("review_pending_member").calls).toHaveLength(1));
    expect(fake.rpc("review_pending_member").calls[0].payload).toEqual({ p_member_id: "u-1", p_approved: false, p_reason: "" });
  });

  it("Cancel sends nothing and closes the dialog", async () => {
    await openQueue();
    fireEvent.click(screen.getByRole("button", { name: "Decline Bala Menon" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.rpc("review_pending_member").calls).toHaveLength(0);
  });

  it("a refusal is an error toast in the database's words; the dialog is closed and the queue is read again", async () => {
    await openQueue();
    fireEvent.click(screen.getByRole("button", { name: "Decline Bala Menon" }));
    fake.rpc("review_pending_member").reply(fail("This person is already an active member, so the sign-up cannot be declined. An administrator can deactivate the account.", "P0001"));
    fake.rpc("list_pending_members").reply(ok([WAITING[1]]));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Decline sign-up" }));
    expect(await screen.findByText(/so the sign-up cannot be declined/, { selector: ".toast" })).toHaveClass("error");
    expect(screen.queryByText(/sign-up was declined/)).not.toBeInTheDocument();
    await waitFor(() => expect(fake.rpc("list_pending_members").count).toBe(2));
  });
});

describe("the Admin page", () => {
  it("has the same queue above the member list, and approving there lowers the menu count too", async () => {
    fake.from("profiles", "select").reply(ok([{ id: "u-me", full_name: "Asha Rao", email: "u-me@x.test", role: "admin", status: "active", phone: "919", class_year: "2028", specialty: "Veena", joined_at: "2025-08-01" }]));
    fake.rpc("list_pending_members").reply(ok(WAITING));
    openPortal({ role: "admin", page: "admin", boot: { pending_signups: 2 } });
    await screen.findByRole("heading", { level: 1, name: "Club control center" });
    expect(await screen.findByRole("heading", { level: 2, name: "Sign-up requests" })).toBeInTheDocument();
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    // The sign-ups are not members: the first number on the page counts the one real member.
    expect((screen.getByText("Active members").previousElementSibling as HTMLElement).textContent).toBe("1");
    fake.rpc("review_pending_member").reply(ok({}));
    fake.rpc("list_pending_members").reply(ok([WAITING[1]]));
    fireEvent.click(screen.getByRole("button", { name: "Approve Bala Menon" }));
    await waitFor(() => expect(fake.rpc("review_pending_member").calls[0].payload).toEqual({ p_member_id: "u-1", p_approved: true, p_reason: "" }));
    await waitFor(() => expect(within(nav()).getByRole("button", { name: "Sign-up requests (1 waiting)" })).toBeInTheDocument());
  });

  it("the audit log names both sign-up decisions", async () => {
    fake.from("admin_audit_log", "select").reply(ok([
      { id: 1, action: "signup_approved", actor_email: "chitra@x.test", target_email: "bala@x.test", details: {}, created_at: "2026-10-02T12:00:00Z" },
      { id: 2, action: "signup_declined", actor_email: "chitra@x.test", target_email: "dev@x.test", details: {}, created_at: "2026-10-01T12:00:00Z" },
    ]));
    openPortal({ role: "admin", page: "admin" });
    const log = (await screen.findByRole("heading", { name: "Recent admin activity" })).closest("section") as HTMLElement;
    await waitFor(() => expect(within(log).getByText("Sign-up approved")).toBeInTheDocument());
    expect(within(log).getByText("Sign-up declined")).toBeInTheDocument();
    expect(within(log).queryByText("Admin action")).not.toBeInTheDocument();
  });
});
