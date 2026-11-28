// The Admin page, opened through the shell by an administrator. What the older tests did not pin, so that the page can be taken apart
// without changing what a person sees or what is sent:
//  the four reads and their limits; the four numbers at the top; who is listed (deactivated ones only on request) and how the search works;
//  changing a permission; editing a member (the groups ticked are the active ones, the ids sent are numbers); the announcement form;
//  the audit log; a list that fails keeps what is shown.
// Failure toasts are in toast-tone.test.tsx; the access buttons (deactivate, reactivate, delete) in action-feedback.test.tsx; a race in shell-races.test.tsx.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, full_name: name, email: `${id}@x.test`, role: "member", status: "active", phone: "919-555-0100", class_year: "2028", specialty: "Veena", joined_at: "2025-08-01", ...over });
const group = (id: number, name: string) => ({ id, name, description: `${name} description`, enrollment_mode: "approval", archived_at: null });
const active = (subgroup_id: number, member_id: string, status = "active") => ({ subgroup_id, member_id, status, membership_role: "member" });
const chainOf = (call: { chain: Array<{ method: string; args: unknown[] }> }) => call.chain.map((link) => [link.method, ...link.args]);
const row = (name: string) => screen.getByLabelText(`Permission for ${name}`).closest(".admin-member-row") as HTMLElement;

const GROUPS = [group(7, "Hindustani Vocal"), group(8, "Carnatic Violin")];
const MEMBERS = [member("u-me", "Asha Rao", { role: "admin" }), member("u-2", "Bala Menon"), member("u-3", "Chitra Iyer", { role: "executive", phone: "", specialty: "" })];

async function openAdmin(options: { members?: Array<Record<string, unknown>>; memberships?: Array<Record<string, unknown>>; announcements?: Array<Record<string, unknown>>; audit?: Array<Record<string, unknown>> } = {}) {
  fake.from("profiles", "select").reply(ok(options.members ?? MEMBERS));
  fake.from("subgroup_memberships", "select").reply(ok(options.memberships ?? [active(7, "u-2")]));
  fake.from("announcements", "select").reply(ok(options.announcements ?? []));
  fake.from("admin_audit_log", "select").reply(ok(options.audit ?? []));
  openPortal({ role: "admin", page: "admin", boot: { groups: GROUPS } });
  await screen.findByRole("heading", { level: 1, name: "Club control center" });
}

describe("what the page reads", () => {
  it("asks for the members, the announcements, the audit log and the memberships once each, with the limits it has always used", async () => {
    await openAdmin();
    expect(fake.from("profiles", "select").count).toBe(1);
    expect(chainOf(fake.from("profiles", "select").calls[0])).toEqual([["select", "id,full_name,email,role,status,phone,class_year,specialty,joined_at"], ["order", "full_name"], ["limit", 2000]]);
    expect(chainOf(fake.from("announcements", "select").calls.find((call) => call.used("limit", 50))!)).toEqual([["select", "*"], ["order", "is_pinned", { ascending: false }], ["order", "published_at", { ascending: false }], ["limit", 50]]);
    expect(chainOf(fake.from("admin_audit_log", "select").calls[0])).toEqual([["select", "id,action,actor_email,target_email,details,created_at"], ["order", "created_at", { ascending: false }], ["limit", 20]]);
    expect(chainOf(fake.from("subgroup_memberships", "select").calls.find((call) => call.used("limit", 5000))!)).toEqual([["select", "subgroup_id,member_id,status,membership_role"], ["limit", 5000]]);
  });

  it("shows the loading line until the answers arrive", async () => {
    const slow = deferred();
    fake.from("profiles", "select").reply(slow.reply);
    openPortal({ role: "admin", page: "admin" });
    const line = await screen.findByText("Loading the archive…");
    expect(line.className).toBe("inline-loading");
    await act(async () => { slow.resolve(ok(MEMBERS)); });
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("Loading the archive…")).not.toBeInTheDocument();
  });
});

describe("the numbers and the list", () => {
  it("counts the active members, the executives, the administrators and the profiles missing a phone or an instrument", async () => {
    await openAdmin({ members: [...MEMBERS, member("u-4", "Dev Nair", { status: "deactivated", role: "admin", phone: "" })] });
    const stat = (label: string) => screen.getByText(label).previousElementSibling as HTMLElement;
    expect(stat("Active members")).toHaveTextContent("3");
    expect(stat("Executives")).toHaveTextContent("1");
    expect(stat("Administrators")).toHaveTextContent("1");
    expect(stat("Incomplete profiles")).toHaveTextContent("1");
  });

  it("lists each member with their active groups only, or 'No subgroup'", async () => {
    await openAdmin({ memberships: [active(7, "u-2"), active(8, "u-2", "pending")] });
    expect(within(row("Bala Menon")).getByText("Hindustani Vocal")).toBeInTheDocument();
    expect(within(row("Bala Menon")).queryByText("Carnatic Violin")).not.toBeInTheDocument();
    expect(within(row("Chitra Iyer")).getByText("No subgroup")).toBeInTheDocument();
  });

  it("hides deactivated members until asked, then marks them and offers Reactivate and Delete instead of Edit", async () => {
    await openAdmin({ members: [...MEMBERS, member("u-4", "Dev Nair", { status: "deactivated" })] });
    expect(screen.queryByText("Dev Nair")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Show 1 deactivated"));
    expect(screen.getByText("Dev Nair")).toBeInTheDocument();
    const gone = row("Dev Nair");
    expect(within(gone).getByText("Deactivated")).toBeInTheDocument();
    expect(within(gone).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(gone).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(within(gone).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByLabelText("Permission for Dev Nair")).toBeDisabled();
  });

  it("with nobody deactivated there is no checkbox", async () => {
    await openAdmin();
    expect(screen.queryByText(/deactivated$/)).not.toBeInTheDocument();
  });

  it("the search matches the name, the email or the role", async () => {
    await openAdmin();
    const search = screen.getByPlaceholderText("Search members");
    fireEvent.change(search, { target: { value: "executive" } });
    expect(screen.getByText("Chitra Iyer")).toBeInTheDocument();
    expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "U-2@X" } });
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("Chitra Iyer")).not.toBeInTheDocument();
  });

  it("an administrator cannot deactivate themselves", async () => {
    await openAdmin();
    expect(within(row("Asha Rao")).getByRole("button", { name: "Deactivate" })).toBeDisabled();
    expect(within(row("Bala Menon")).getByRole("button", { name: "Deactivate" })).toBeEnabled();
  });
});

describe("changing a permission", () => {
  it("sends the change, says so, and reads the members again", async () => {
    await openAdmin();
    fake.rpc("admin_change_member_role").reply(ok(null));
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "executive" } });
    expect(await screen.findByText(/Bala Menon is now executive/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.rpc("admin_change_member_role").calls[0].payload).toEqual({ p_target_id: "u-2", p_new_role: "executive" });
    await waitFor(() => expect(fake.from("profiles", "select").count).toBe(2));
  });

  it("choosing the permission the member already has sends nothing", async () => {
    await openAdmin();
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "member" } });
    await act(async () => { await Promise.resolve(); });
    expect(fake.rpc("admin_change_member_role").calls).toHaveLength(0);
  });

  it("a refused change says why and does not read the members again", async () => {
    await openAdmin();
    fake.rpc("admin_change_member_role").reply(fail("Only administrators can change member roles"));
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "admin" } });
    expect(await screen.findByText(/Only administrators can change member roles/, { selector: ".toast" })).toHaveClass("error");
    expect(fake.from("profiles", "select").count).toBe(1);
  });
});

describe("editing a member", () => {
  const edit = async (name: string) => {
    fireEvent.click(within(row(name)).getByRole("button", { name: "Edit" }));
    return (await screen.findByRole("heading", { name: "Edit member" })).closest("form") as HTMLFormElement;
  };

  it("shows the member's details, with their active groups ticked", async () => {
    await openAdmin({ memberships: [active(7, "u-2"), active(8, "u-2", "pending")] });
    const form = await edit("Bala Menon");
    expect(within(form).getByLabelText("Preferred name")).toHaveValue("Bala Menon");
    expect(within(form).getByLabelText("Email")).toBeDisabled();
    expect(within(form).getByLabelText("Phone number")).toHaveValue("919-555-0100");
    expect(within(form).getByLabelText("Class year")).toHaveValue("2028");
    expect(within(form).getByLabelText("Voice / instrument")).toHaveValue("Veena");
    expect(within(form).getByRole("checkbox", { name: /Hindustani Vocal/ })).toBeChecked();
    expect(within(form).getByRole("checkbox", { name: /Carnatic Violin/ })).not.toBeChecked();
  });

  it("sends the changed details and the ticked groups as numbers, closes, says so and reads the members again", async () => {
    await openAdmin({ memberships: [active(7, "u-2")] });
    fake.rpc("admin_update_member_profile").reply(ok(null));
    const form = await edit("Bala Menon");
    fireEvent.change(within(form).getByLabelText("Preferred name"), { target: { value: "Bala M." } });
    fireEvent.change(within(form).getByLabelText("Phone number"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("checkbox", { name: /Hindustani Vocal/ }));
    fireEvent.click(within(form).getByRole("checkbox", { name: /Carnatic Violin/ }));
    fireEvent.submit(form);
    expect(await screen.findByText(/Bala Menon was updated/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.rpc("admin_update_member_profile").calls[0].payload).toEqual({ p_target_id: "u-2", p_full_name: "Bala M.", p_phone: "", p_class_year: "2028", p_specialty: "Veena", p_subgroup_ids: [8] });
    expect(screen.queryByRole("heading", { name: "Edit member" })).not.toBeInTheDocument();
    await waitFor(() => expect(fake.from("profiles", "select").count).toBe(2));
  });

  it("while it saves the button says so and cannot be pressed twice", async () => {
    await openAdmin();
    const slow = deferred();
    fake.rpc("admin_update_member_profile").reply(slow.reply);
    const form = await edit("Bala Menon");
    fireEvent.submit(form);
    expect(await screen.findByRole("button", { name: "Saving member…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit member" })).not.toBeInTheDocument());
  });

  it("Cancel and the close button leave without sending anything", async () => {
    await openAdmin();
    await edit("Bala Menon");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Edit member" })).not.toBeInTheDocument();
    await edit("Bala Menon");
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByRole("heading", { name: "Edit member" })).not.toBeInTheDocument();
    expect(fake.rpc("admin_update_member_profile").calls).toHaveLength(0);
  });
});

describe("the announcement form", () => {
  const form = () => screen.getByRole("heading", { name: "Post announcement" }).closest("form") as HTMLFormElement;
  const fill = (title: string, body: string) => {
    fireEvent.change(within(form()).getByLabelText("Title"), { target: { value: title } });
    fireEvent.change(within(form()).getByLabelText("Message"), { target: { value: body } });
  };

  it("offers the whole club and every group as audience", async () => {
    await openAdmin();
    expect(within(within(form()).getByLabelText("Audience")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Whole club", "Hindustani Vocal", "Carnatic Violin"]);
  });

  it("to the whole club: no group in the row; the form is emptied, the page says so and reads the announcements again", async () => {
    await openAdmin();
    fake.from("announcements", "insert").reply(ok(null));
    fill("Welcome back", "See you Friday");
    fireEvent.submit(form());
    expect(await screen.findByText(/Announcement published/, { selector: ".toast" })).toHaveClass("success");
    const [call] = fake.from("announcements", "insert").calls;
    expect(call.payload).toEqual({ title: "Welcome back", body: "See you Friday", is_pinned: false, created_by: "u-me" });
    await waitFor(() => expect(form()).toHaveFormValues({ title: "", body: "" }));
    await waitFor(() => expect(fake.from("announcements", "select").calls.filter((read) => read.used("limit", 50))).toHaveLength(2));
  });

  it("to a group, pinned: the group id is a number", async () => {
    await openAdmin();
    fake.from("announcements", "insert").reply(ok(null));
    fill("Rehearsal", "Moved to 7");
    fireEvent.change(within(form()).getByLabelText("Audience"), { target: { value: "8" } });
    fireEvent.click(within(form()).getByLabelText(/Pin to dashboard/));
    fireEvent.submit(form());
    await waitFor(() => expect(fake.from("announcements", "insert").calls).toHaveLength(1));
    expect(fake.from("announcements", "insert").calls[0].payload).toEqual({ title: "Rehearsal", body: "Moved to 7", is_pinned: true, created_by: "u-me", subgroup_id: 8 });
  });

  it("a refused announcement keeps what was typed", async () => {
    await openAdmin();
    fake.from("announcements", "insert").reply(fail("Announcements are paused"));
    fill("Welcome back", "See you Friday");
    fireEvent.submit(form());
    expect(await screen.findByText(/Announcements are paused/, { selector: ".toast" })).toHaveClass("error");
    expect(form()).toHaveFormValues({ title: "Welcome back", body: "See you Friday" });
  });

  it("lists the five latest announcements with their audience", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `Notice ${i + 1}`, body: "b", is_pinned: i === 0, published_at: "2026-10-01T00:00:00Z", subgroup_id: i === 1 ? 7 : null }));
    await openAdmin({ announcements: rows });
    expect(screen.getAllByText(/Notice \d/)).toHaveLength(5);
    expect(screen.getByText("◆ Notice 1")).toBeInTheDocument();
    expect(screen.queryByText("Notice 6")).not.toBeInTheDocument();
    const list = screen.getByRole("heading", { name: "Announcements" }).closest("section") as HTMLElement;
    expect(within(list).getByText("7")).toBeInTheDocument();
  });
});

describe("the audit log", () => {
  it("names each action, the member it was done to, who did it and when; an action it does not know is 'Admin action'", async () => {
    await openAdmin({ audit: [
      { id: 1, action: "role_changed", actor_email: "asha@x.test", target_email: "bala@x.test", details: {}, created_at: "2026-10-02T12:00:00Z" },
      { id: 2, action: "something_new", actor_email: "asha@x.test", target_email: "chitra@x.test", details: {}, created_at: "2026-10-01T12:00:00Z" },
    ] });
    const log = screen.getByRole("heading", { name: "Recent admin activity" }).closest("section") as HTMLElement;
    expect(within(log).getByText("Permission changed")).toBeInTheDocument();
    expect(within(log).getByText("bala@x.test")).toBeInTheDocument();
    expect(within(log).getByText("Admin action")).toBeInTheDocument();
    expect(within(log).getAllByText(/^by asha@x.test · /)).toHaveLength(2);
  });

  it("says so when nothing was done yet", async () => {
    await openAdmin();
    expect(screen.getByText("No administrative changes recorded yet.")).toBeInTheDocument();
  });
});

describe("a list that fails to read", () => {
  it("one toast says some admin data could not be loaded, and the lists that did arrive are shown", async () => {
    fake.from("admin_audit_log", "select").reply(fail("boom"));
    fake.from("profiles", "select").reply(ok(MEMBERS));
    openPortal({ role: "admin", page: "admin" });
    expect(await screen.findByText(/Some admin data could not be loaded/, { selector: ".toast" })).toHaveClass("error");
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(screen.getByText("No administrative changes recorded yet.")).toBeInTheDocument();
  });

  it("a reload that fails keeps the members shown", async () => {
    await openAdmin();
    fake.rpc("admin_change_member_role").reply(ok(null));
    fake.from("profiles", "select").reply(fail("boom"));
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "executive" } });
    await waitFor(() => expect(fake.from("profiles", "select").count).toBe(2));
    expect(await screen.findByText(/Some admin data could not be loaded/, { selector: ".toast" })).toBeInTheDocument();
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(screen.getByText("Chitra Iyer")).toBeInTheDocument();
  });
});
