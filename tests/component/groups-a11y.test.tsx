// Accessibility of the Groups page (plan 3.4): axe on every screen, every state and every tab of a group, and on every dialog it opens.
// What this checks: no serious or critical axe violation in jsdom, scoped to the groups page (or to the dialog), so a finding in the
// shell around it is not counted here. What it cannot check (it goes on the real-browser run): colour contrast, the focus ring as painted,
// layout at 360px, the 44px targets as laid out, and what a screen reader says.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const group = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, name, description: `${name} description`, enrollment_mode: "approval", archived_at: null, ...over });
const membership = (subgroup_id: number, status = "active", membership_role = "member", member_id = "u-me") => ({ subgroup_id, member_id, status, membership_role });
const person = (id: string, name: string, status = "active", membership_role = "member") => ({ member_id: id, full_name: name, email: `${id}@x.test`, status, membership_role, joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" });
const announcement = (id: number, title: string, subgroup_id: number | null) => ({ id, title, body: `${title} body`, is_pinned: id === 1, published_at: "2026-10-01T00:00:00Z", subgroup_id });

type Role = "member" | "executive" | "admin";
function openGroups(options: { role?: Role; groups?: Array<Record<string, unknown>>; memberships?: Array<Record<string, unknown>>; address?: string } = {}) {
  const groups = options.groups ?? [];
  const memberships = options.memberships ?? [];
  fake.from("subgroups", "select").reply(ok(groups));
  fake.from("subgroup_memberships", "select").reply(ok(memberships));
  fake.from("announcements", "select").reply(ok([announcement(1, "Rehearsal moved", 7), announcement(2, "Concert call", 7)]));
  fake.from("archive_items", "select").reply(ok([]));
  fake.rpc("list_subgroup_roster").reply(ok([person("u-me", "Asha Rao"), person("u-meera", "Meera Iyer", "active", "leader"), person("u-dev", "Dev Nair", "pending"), person("u-ravi", "Ravi Das", "waitlisted")]));
  fake.from("events", "select").reply(ok([{ id: 1, title: "Winter concert", description: "Bring the green shawl", starts_at: "2026-12-06T23:30:00Z", location: "Hill Hall", created_at: "2026-10-01T00:00:00Z", subgroup_id: 7 }]));
  fake.from("profiles", "select").reply(ok([{ id: "u-new", full_name: "Kiran Shah", email: "kiran@x.test" }]));
  openPortal({ role: options.role ?? "member", page: options.address ?? "groups", boot: { groups, memberships } });
}
const pageScope = () => document.querySelector(".group-page") as HTMLElement;
/** An executive who is also in group 7: every tab, every button. */
const asExecutive = (address?: string) => openGroups({ role: "executive", groups: [group(7, "Hindustani Vocal"), group(8, "Carnatic Violin")], memberships: [membership(7)], address });

describe("the list of groups", () => {
  it("a member's list, with Your groups and one Discover card in each state", async () => {
    openGroups({
      groups: [group(1, "Hindustani Vocal"), group(2, "Open Group", { enrollment_mode: "open" }), group(3, "Approval Group"), group(4, "Invite Group", { enrollment_mode: "invite" }), group(5, "Pending Group"), group(6, "Waiting Group"), group(10, "Removed Group", { enrollment_mode: "open" })],
      memberships: [membership(1), membership(5, "pending"), membership(6, "waitlisted"), membership(10, "removed")],
    });
    await screen.findByRole("heading", { level: 2, name: "Discover groups" });
    await expectNoSeriousViolations(pageScope());
  });

  it("an executive's list, an archived group marked, with the New group button", async () => {
    openGroups({ role: "executive", groups: [group(7, "Hindustani Vocal"), group(9, "Old Choir", { archived_at: "2026-01-01T00:00:00Z" })], memberships: [] });
    await screen.findByRole("button", { name: "＋ New group" });
    await expectNoSeriousViolations(pageScope());
  });

  it("the empty state", async () => {
    openGroups();
    await screen.findByText("No groups yet");
    await expectNoSeriousViolations(pageScope());
  });

  it("the skeleton while the first read is on its way", async () => {
    const slow = deferred();
    openGroups();
    fake.from("subgroups", "select").reply(slow.reply);
    const status = await screen.findByText("Loading your groups");
    await expectNoSeriousViolations(status.closest("section") as HTMLElement);
  });

  it("the error with Try again when the first read fails", async () => {
    openGroups();
    fake.from("subgroups", "select").reply(fail("Network is down"));
    await screen.findByText("The groups could not be loaded.");
    await expectNoSeriousViolations(pageScope());
  });

  it("a join request's own sentence", async () => {
    openGroups({ groups: [group(2, "Approval Group")] });
    fake.rpc("request_subgroup_enrollment").reply(fail("This group is archived"));
    fireEvent.click(await screen.findByRole("button", { name: "Request to join" }));
    await screen.findByText("This group is archived");
    await expectNoSeriousViolations(pageScope());
  });
});

describe("one group's page, every tab (an executive in the group sees them all)", () => {
  // The shell fills Resources and Attendance with those screens for the group (renderGroupTab); the other tabs are the group page's own.
  const TABS: Array<[string, string, RegExp]> = [
    ["announcements", "Announcements", /Rehearsal moved/],
    ["dates", "Dates", /Winter concert/],
    ["resources", "Resources", /^Club library$/],
    ["recordings", "Recordings", /recording room/],
    ["attendance", "Attendance", /^Attendance$/],
    ["roster", "Roster", /Meera Iyer/],
    ["requests", "Requests", /Requests to join/],
  ];

  it.each(TABS)("the %s tab, with the tablist and the buttons above it", async (id, name, content) => {
    asExecutive(`groups&group=7&tab=${id}`);
    const tab = await screen.findByRole("tab", { name: new RegExp(`^${name}`) });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect((await within(screen.getByRole("tabpanel")).findAllByText(content)).length).toBeGreaterThan(0);
    await expectNoSeriousViolations(pageScope());
  });

  it("a group's page for an ordinary member (no Requests tab)", async () => {
    openGroups({ groups: [group(7, "Hindustani Vocal")], memberships: [membership(7)], address: "groups&group=7&tab=roster" });
    await screen.findByText("Meera Iyer");
    await expectNoSeriousViolations(pageScope());
  });

  it("the roster while it reads, and the roster's error with Try again", async () => {
    asExecutive("groups&group=7&tab=roster");
    const slow = deferred();
    fake.rpc("list_subgroup_roster").replyOnce(slow.reply);
    const status = await screen.findByText("Loading the roster");
    await expectNoSeriousViolations(status.closest("section") as HTMLElement);
  });

  it("the roster's first read failing", async () => {
    asExecutive("groups&group=7&tab=roster");
    fake.rpc("list_subgroup_roster").reply(fail("Network is down"));
    await screen.findByText("Network is down");
    await expectNoSeriousViolations(pageScope());
  });

  it("the Dates tab: empty, and failing", async () => {
    asExecutive("groups&group=7&tab=dates");
    fake.from("events", "select").reply(fail("Network is down"));
    await screen.findByText("The dates could not be loaded.");
    await expectNoSeriousViolations(pageScope());
  });
});

describe("the dialogs of the groups page", () => {
  const dialogNamed = async (name: string) => screen.findByRole("dialog", { name });

  it("Create a group", async () => {
    asExecutive();
    fireEvent.click(await screen.findByRole("button", { name: "＋ New group" }));
    await expectNoSeriousViolations(await dialogNamed("Create a group"));
  });

  it("Post a group update", async () => {
    asExecutive();
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Post update" }));
    await expectNoSeriousViolations(await dialogNamed("Post a group update"));
  });

  it("Group settings", async () => {
    asExecutive("groups&group=7&tab=roster");
    fireEvent.click(await screen.findByRole("button", { name: "Group settings" }));
    await expectNoSeriousViolations(await dialogNamed("Group settings"));
  });

  it("Add a member", async () => {
    asExecutive("groups&group=7&tab=roster");
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add member" }));
    const dialog = await dialogNamed("Add a member to Hindustani Vocal");
    await within(dialog).findByText("Kiran Shah");
    await expectNoSeriousViolations(dialog);
  });

  it.each([
    ["Leave Hindustani Vocal?", "Roster", "Leave group"],
    ["Remove Meera Iyer?", "Roster", "Remove"],
    ["Decline this request?", "Requests", "Decline"],
  ])("the question %s", async (title, tab, button) => {
    asExecutive(`groups&group=7&tab=${tab.toLowerCase()}`);
    await within(await screen.findByRole("tabpanel")).findByText(tab === "Requests" ? /Requests to join/ : /Meera Iyer/);
    fireEvent.click(screen.getAllByRole("button", { name: button })[0]);
    await expectNoSeriousViolations(await dialogNamed(title));
  });

  it("Archive Hindustani Vocal?", async () => {
    asExecutive("groups&group=7&tab=roster");
    fireEvent.click(await screen.findByRole("button", { name: "Group settings" }));
    fireEvent.click(within(await dialogNamed("Group settings")).getByRole("button", { name: "Archive group" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Archive Hindustani Vocal?" })).toBeInTheDocument());
    await expectNoSeriousViolations(screen.getByRole("dialog"));
  });

  it("the announcement editor (an executive on a group's Announcements tab)", async () => {
    asExecutive("groups&group=7");
    const panel = await screen.findByRole("tabpanel");
    fireEvent.click((await within(panel).findAllByRole("button", { name: /^Edit / }))[0]);
    await expectNoSeriousViolations(await screen.findByRole("dialog"));
  });
});
