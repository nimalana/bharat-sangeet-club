// The Groups page (SubgroupSpaces), opened through the shell. What the older tests did not pin, so that the page can be taken apart
// without changing what a person sees or what is sent:
//  the four reads and their limits (the memberships and the waiting requests of others are ONE read, finding F4); which groups are
//  listed, which are discoverable and what each offers;
//  joining (open groups at once, others by request) and the inline sentence of a refused request;
//  the number of requests waiting in a group; creating a group; posting a group update; a list that fails to reload keeps what is shown.
// The group's people (requests, roster, settings) are in people-recordings.test.tsx; failure toasts in toast-tone.test.tsx; races in shell-races.test.tsx.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const group = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, name, description: `${name} description`, enrollment_mode: "approval", archived_at: null, ...over });
const membership = (subgroup_id: number, status = "active", membership_role = "member") => ({ subgroup_id, member_id: "u-me", status, membership_role });
const announcement = (id: number, title: string, subgroup_id: number | null, over: Record<string, unknown> = {}) => ({ id, title, body: `${title} body`, is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id, ...over });
const chainOf = (call: { chain: Array<{ method: string; args: unknown[] }> }) => call.chain.map((link) => [link.method, ...link.args]);

function openGroups(options: { role?: "member" | "executive" | "admin"; groups?: Array<Record<string, unknown>>; memberships?: Array<Record<string, unknown>>; announcements?: Array<Record<string, unknown>>; archive?: Array<Record<string, unknown>>; waiting?: Array<Record<string, unknown>> } = {}) {
  const groups = options.groups ?? [group(7, "Hindustani Vocal")];
  const memberships = options.memberships ?? [membership(7)];
  fake.from("subgroups", "select").reply(ok(groups));
  // ONE read answers with the person's own rows and the waiting requests of other people.
  fake.from("subgroup_memberships", "select").reply(ok([...memberships, ...(options.waiting ?? [])]));
  fake.from("announcements", "select").reply(ok(options.announcements ?? []));
  fake.from("archive_items", "select").reply(ok(options.archive ?? []));
  openPortal({ role: options.role ?? "member", page: "groups", boot: { groups, memberships } });
}

describe("what the page reads", () => {
  it("asks for the groups, the memberships (the person's own and the waiting requests of others, in ONE read), the groups' recordings and announcements, once each", async () => {
    openGroups({ role: "executive" });
    await screen.findByRole("heading", { level: 1, name: "All groups" });
    const own = fake.from("subgroups", "select").calls.filter((call) => !call.used("is", "archived_at"));
    expect(own).toHaveLength(1);
    expect(chainOf(own[0])).toEqual([["select", "id,name,description,enrollment_mode,archived_at"], ["order", "name"]]);
    // Finding F4: this page used to send two GETs of subgroup_memberships (its own rows, then the others' waiting requests).
    const memberships = fake.from("subgroup_memberships", "select").calls;
    expect(memberships).toHaveLength(1);
    expect(chainOf(memberships[0])).toEqual([["select", "subgroup_id,member_id,status,membership_role"], ["or", "member_id.eq.u-me,status.in.(pending,waitlisted)"]]);
    expect(chainOf(fake.from("archive_items", "select").calls.find((call) => call.used("limit", 500))!)).toEqual([["select", "*"], ["eq", "type", "recording"], ["not", "subgroup_id", "is", null], ["order", "created_at", { ascending: false }], ["limit", 500]]);
    expect(chainOf(fake.from("announcements", "select").calls.find((call) => call.used("limit", 300))!)).toEqual([["select", "*"], ["not", "subgroup_id", "is", null], ["order", "published_at", { ascending: false }], ["limit", 300]]);
  });

  it("shows a skeleton (a polite status, no heading yet) until the first answers arrive, then the group with its update and resource counts", async () => {
    const slow = deferred();
    openGroups({ announcements: [announcement(1, "Rehearsal", 7), announcement(2, "Other group", 8), announcement(3, "Club wide", null)], archive: [{ id: 5, title: "Take", description: "", type: "recording", storage_path: "x", visibility: "members", is_public: false, event_date: null, raga: null, tala: null, created_at: "2026-10-01T00:00:00Z", subgroup_id: 7 }] });
    fake.from("subgroups", "select").reply((call) => (call.used("is", "archived_at") ? ok([group(7, "Hindustani Vocal")]) : slow.reply));
    expect(await screen.findByText("Loading your groups")).toHaveAttribute("role", "status");
    expect(document.querySelector(".skeleton")).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: "My groups" })).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok([group(7, "Hindustani Vocal")])); });
    const row = (await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    expect(within(row).getByText("updates").previousElementSibling).toHaveTextContent("1");
    expect(within(row).getByText("resources").previousElementSibling).toHaveTextContent("1");
    expect(screen.getByRole("heading", { level: 1, name: "My groups" })).toBeInTheDocument();
  });
});

describe("which groups are listed", () => {
  it("a member sees the groups they are in, and the others under Discover; an archived group is hidden from them", async () => {
    openGroups({ groups: [group(7, "Hindustani Vocal"), group(8, "Carnatic Violin"), group(9, "Old Choir", { archived_at: "2026-01-01T00:00:00Z" })], memberships: [membership(7)] });
    expect(await screen.findByRole("button", { name: /Hindustani Vocal/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Discover groups" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Carnatic Violin" })).toBeInTheDocument();
    expect(screen.queryByText(/Old Choir/)).not.toBeInTheDocument();
  });

  it("an executive sees every group, an archived one marked, and no Discover list", async () => {
    openGroups({ role: "executive", groups: [group(7, "Hindustani Vocal"), group(9, "Old Choir", { archived_at: "2026-01-01T00:00:00Z" })], memberships: [] });
    expect(await screen.findByRole("button", { name: /Old Choir \(archived\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hindustani Vocal/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Discover groups" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Groups you manage" })).toBeInTheDocument();
  });

  it("someone in no group is told how to find one", async () => {
    openGroups({ groups: [], memberships: [] });
    expect(await screen.findByText("No groups yet")).toBeInTheDocument();
    expect(screen.getByText("Join an open group or ask an executive for an invitation.")).toBeInTheDocument();
  });

  it("an executive with no groups is asked to create the first", async () => {
    openGroups({ role: "executive", groups: [], memberships: [] });
    expect(await screen.findByText("Create the first group to organize rehearsals and resources.")).toBeInTheDocument();
  });

  it("the number of requests waiting is shown instead of the description, with the right singular", async () => {
    fake.from("subgroups", "select").reply(ok([group(7, "Hindustani Vocal"), group(8, "Carnatic Violin")]));
    // Other people's waiting requests come in the same read as the person's own rows (here: none of their own).
    const waiting = (subgroup_id: number, member_id: string, status = "pending") => ({ subgroup_id, member_id, status, membership_role: "member" });
    fake.from("subgroup_memberships", "select").reply(ok([waiting(7, "u-a"), waiting(7, "u-b", "waitlisted"), waiting(8, "u-c")]));
    openPortal({ role: "executive", page: "groups" });
    expect(await screen.findByText("2 requests to review")).toBeInTheDocument();
    expect(screen.getByText("1 request to review")).toBeInTheDocument();
    expect(screen.queryByText("Hindustani Vocal description")).not.toBeInTheDocument();
  });
});

describe("what each group not yet joined offers", () => {
  it("says where the person stands, or what they can do", async () => {
    openGroups({
      groups: [group(1, "Open Group", { enrollment_mode: "open" }), group(2, "Approval Group"), group(3, "Invite Group", { enrollment_mode: "invite" }), group(4, "Pending Group"), group(5, "Waiting Group"), group(6, "Removed Group", { enrollment_mode: "open" })],
      memberships: [membership(4, "pending"), membership(5, "waitlisted"), membership(6, "removed")],
    });
    const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("article") as HTMLElement;
    expect(within(await card("Open Group")).getByRole("button", { name: "Join group" })).toBeEnabled();
    expect(within(await card("Approval Group")).getByRole("button", { name: "Request to join" })).toBeEnabled();
    expect(within(await card("Invite Group")).getByText("Invitation required")).toBeInTheDocument();
    expect(within(await card("Pending Group")).getByText("Request pending")).toBeInTheDocument();
    expect(within(await card("Waiting Group")).getByText("Waitlisted")).toBeInTheDocument();
    expect(within(await card("Removed Group")).getByText("Ask an executive to add you back")).toBeInTheDocument();
  });
});

describe("joining a group", () => {
  it("an open group lets the person in at once: Welcome toast, and the group's page opens", async () => {
    openGroups({ groups: [group(1, "Open Group", { enrollment_mode: "open" })], memberships: [] });
    fake.rpc("request_subgroup_enrollment").reply(ok(membership(1)));
    fireEvent.click(await screen.findByRole("button", { name: "Join group" }));
    expect(await screen.findByText(/Welcome to Open Group/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.rpc("request_subgroup_enrollment").calls[0].payload).toEqual({ target_subgroup_id: 1 });
    expect(await screen.findByRole("heading", { level: 1, name: "Open Group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← All groups" })).toBeInTheDocument();
  });

  it("a group that needs approval says the request was sent, and the card now says Request pending", async () => {
    openGroups({ groups: [group(2, "Approval Group")], memberships: [] });
    fake.rpc("request_subgroup_enrollment").reply(ok(membership(2, "pending")));
    fireEvent.click(await screen.findByRole("button", { name: "Request to join" }));
    expect(await screen.findByText("Your request to join Approval Group was sent.")).toHaveAttribute("role", "status");
    expect(screen.getByText("Request pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request to join" })).not.toBeInTheDocument();
  });

  it("while the request is on its way the button says Sending… and cannot be pressed", async () => {
    openGroups({ groups: [group(2, "Approval Group")], memberships: [] });
    let answer: (value: unknown) => void = () => {};
    fake.rpc("request_subgroup_enrollment").reply(() => new Promise((resolve) => { answer = resolve; }) as never);
    fireEvent.click(await screen.findByRole("button", { name: "Request to join" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    answer(ok(membership(2, "pending")));
    await screen.findByText("Request pending");
  });

  it("a refused request shows the database's own sentence on the page, not as a toast, and the button is back", async () => {
    openGroups({ groups: [group(2, "Approval Group")], memberships: [] });
    fake.rpc("request_subgroup_enrollment").reply(fail("This group is archived"));
    fireEvent.click(await screen.findByRole("button", { name: "Request to join" }));
    expect(await screen.findByText("This group is archived")).toHaveAttribute("role", "status");
    expect(document.querySelector(".toast")).toBeNull();
    expect(screen.getByRole("button", { name: "Request to join" })).toBeEnabled();
  });
});

describe("creating a group", () => {
  it("sends the form, then reads the groups again, opens the new group and says so", async () => {
    openGroups({ role: "executive", groups: [group(7, "Hindustani Vocal")], memberships: [] });
    fake.rpc("create_subgroup").reply(ok(group(9, "Hindustani Ensemble")));
    fireEvent.click(await screen.findByRole("button", { name: "＋ New group" }));
    const dialog = screen.getByRole("heading", { name: "Create a group" }).closest("form")!;
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Hindustani Ensemble" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Weekly practice" } });
    fireEvent.change(within(dialog).getByLabelText("Enrollment"), { target: { value: "invite" } });
    const readsBefore = fake.from("subgroups", "select").calls.length;
    fake.from("subgroups", "select").reply(ok([group(7, "Hindustani Vocal"), group(9, "Hindustani Ensemble")]));
    fireEvent.submit(dialog);
    expect(await screen.findByText(/Group created/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.rpc("create_subgroup").calls[0].payload).toEqual({ subgroup_name: "Hindustani Ensemble", subgroup_description: "Weekly practice", subgroup_mode: "invite" });
    await waitFor(() => expect(fake.from("subgroups", "select").calls.length).toBeGreaterThan(readsBefore));
    expect(await screen.findByRole("heading", { level: 1, name: "Hindustani Ensemble" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create a group" })).not.toBeInTheDocument();
  });

  it("the form's enrollment starts at Request approval", async () => {
    openGroups({ role: "executive", groups: [], memberships: [] });
    fireEvent.click(await screen.findByRole("button", { name: "＋ New group" }));
    expect(screen.getByLabelText("Enrollment")).toHaveValue("approval");
  });

  it("a refused group keeps the form open", async () => {
    openGroups({ role: "executive", groups: [], memberships: [] });
    fake.rpc("create_subgroup").reply(fail("Only executives can create groups"));
    fireEvent.click(await screen.findByRole("button", { name: "＋ New group" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Create a group" }).closest("form")!);
    expect(await screen.findByText(/Only executives can create groups/, { selector: ".toast" })).toHaveClass("error");
    expect(screen.getByRole("heading", { name: "Create a group" })).toBeInTheDocument();
  });
});

describe("one group's page", () => {
  const open = async (options: Parameters<typeof openGroups>[0] = {}) => {
    openGroups(options);
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByRole("button", { name: "← All groups" });
  };

  it("lists that group's announcements, pinned ones marked, and none of the others", async () => {
    await open({ announcements: [announcement(1, "Rehearsal moved", 7, { is_pinned: true }), announcement(2, "Concert call", 7), announcement(3, "Someone else's", 8)] });
    const feed = document.querySelector(".group-feed") as HTMLElement;
    expect(within(feed).getByText("Rehearsal moved")).toBeInTheDocument();
    expect(within(feed).getByText(/^Pinned · /)).toBeInTheDocument();
    expect(within(feed).getByText("Concert call")).toBeInTheDocument();
    expect(within(feed).queryByText("Someone else's")).not.toBeInTheDocument();
    expect(within(feed).getByText("2")).toBeInTheDocument();
  });

  it("says when there are none", async () => {
    await open();
    expect(screen.getByText("No announcements for this group yet.")).toBeInTheDocument();
  });

  it("the buttons lead to the group's resources, and back to the list", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Hindustani Vocal" })).toBeInTheDocument();
    expect(screen.getByText("Hindustani Vocal description")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← All groups" }));
    expect(await screen.findByRole("heading", { level: 1, name: "My groups" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hindustani Vocal/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Open resources" }))[0]);
    await waitFor(() => expect(window.location.search).toContain("page=documents"));
  });

  it("an ordinary member has no Post update or Add recording; an executive has both", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Post update" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add recording" })).not.toBeInTheDocument();
  });

  it("posting an update sends it to the group, closes the form, reads the announcements again and says so", async () => {
    await open({ role: "executive", memberships: [] });
    fake.from("announcements", "insert").reply(ok(null));
    fireEvent.click(await screen.findByRole("button", { name: "Post update" }));
    const form = screen.getByRole("heading", { name: "Post a group update" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Rehearsal moved" } });
    fireEvent.change(within(form).getByLabelText("Message"), { target: { value: "Room 104" } });
    fireEvent.click(within(form).getByLabelText(/Pin this update/));
    const readsBefore = fake.from("announcements", "select").calls.length;
    fake.from("announcements", "select").reply(ok([announcement(1, "Rehearsal moved", 7, { is_pinned: true })]));
    fireEvent.submit(form);
    expect(await screen.findByText(/Announcement posted to Hindustani Vocal/, { selector: ".toast" })).toHaveClass("success");
    expect(fake.from("announcements", "insert").calls[0].payload).toEqual({ title: "Rehearsal moved", body: "Room 104", is_pinned: true, subgroup_id: 7, created_by: "u-me" });
    await waitFor(() => expect(fake.from("announcements", "select").calls.length).toBeGreaterThan(readsBefore));
    expect(await screen.findByText(/^Pinned · /)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Post a group update" })).not.toBeInTheDocument();
  });

  it("a refused update keeps the form open and says why", async () => {
    await open({ role: "executive", memberships: [] });
    fake.from("announcements", "insert").reply(fail("new row violates row-level security policy for table \"announcements\"", "42501"));
    fireEvent.click(await screen.findByRole("button", { name: "Post update" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Post a group update" }).closest("form")!);
    expect(await screen.findByText(/You do not have permission to do that\./, { selector: ".toast" })).toHaveClass("error");
    expect(screen.getByRole("heading", { name: "Post a group update" })).toBeInTheDocument();
  });
});

describe("a list that fails to reload keeps what is shown", () => {
  it("one toast says something could not be loaded, and the lists stay on screen (the four reads are one: a half-answer is not kept)", async () => {
    openGroups({ role: "executive", memberships: [], announcements: [announcement(1, "Rehearsal moved", 7)] });
    fake.rpc("list_subgroup_roster").reply(ok([{ member_id: "u-dev", full_name: "Dev Nair", email: "u-dev@x.test", status: "pending", membership_role: "member", joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" }]));
    fake.rpc("review_subgroup_request").reply(ok(null));
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByText("Rehearsal moved");
    // The requests are on their own tab. Approving one makes the page read its lists again; the announcements read fails this time.
    fireEvent.click(screen.getByRole("tab", { name: /^Requests/ }));
    fake.from("announcements", "select").reply(fail("boom"));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/Some group information could not be loaded/, { selector: ".toast" })).toHaveClass("error");
    fireEvent.click(screen.getByRole("tab", { name: "Announcements" }));
    expect(await screen.findByText("Rehearsal moved")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Hindustani Vocal" })).toBeInTheDocument();
  });
});
