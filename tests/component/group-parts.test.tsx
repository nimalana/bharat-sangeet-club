// The parts of the Groups screens, rendered one by one with their props: the group list, the Discover cards, an open group's page,
// the two dialogs, and the five parts of a group's people (requests, roster, confirmations, settings, the add-a-member picker).
// The whole screens are in group-spaces.test.tsx and people-recordings.test.tsx; these check that each part does what its props say.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddMemberDialog } from "../../features/groups/components/add-member-dialog";
import { CreateGroupDialog } from "../../features/groups/components/create-group-dialog";
import { DiscoverGroups } from "../../features/groups/components/discover-groups";
import { GroupConfirmDialogs } from "../../features/groups/components/group-confirm-dialogs";
import { GroupDetail } from "../../features/groups/components/group-detail";
import { GroupList } from "../../features/groups/components/group-list";
import { GroupPeople } from "../../features/groups/components/group-people";
import { GroupSettingsDialog } from "../../features/groups/components/group-settings-dialog";
import { GroupUpdateDialog } from "../../features/groups/components/group-update-dialog";
import { JoinRequestsPanel } from "../../features/groups/components/join-requests-panel";
import { RosterList } from "../../features/groups/components/roster-list";
import type { Pending } from "../../features/groups/model";
import type { RosterRow } from "../../lib/api/groups";
import type { Announcement, ArchiveItem, Subgroup, SubgroupMembership } from "../../lib/db";
import { fake, ok } from "../support/fake-supabase";
import { notifySpy, userOf } from "../support/helpers";
import { keyboardUser } from "../support/keyboard";

const MEMBER = "member" as const;
const EXECUTIVE = "executive" as const;
const group = (id: number, name: string, over: Partial<Subgroup> = {}): Subgroup => ({ id, name, description: `${name} description`, enrollment_mode: "approval", archived_at: null, ...over });
const announcement = (id: number, title: string, subgroup_id: number, over: Partial<Announcement> = {}): Announcement => ({ id, title, body: `${title} body`, is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id, ...over });
const item = (id: number, subgroup_id: number) => ({ id, title: "Take", description: "", type: "recording", storage_path: "x", visibility: "members", is_public: false, event_date: null, raga: null, tala: null, created_at: "2026-10-01T00:00:00Z", subgroup_id }) as ArchiveItem;
const person = (id: string, name: string, status = "active", membership_role = "member"): RosterRow => ({ member_id: id, full_name: name, email: `${id}@x.test`, status, membership_role, joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" }) as RosterRow;

describe("GroupList", () => {
  const props = (over: Partial<Parameters<typeof GroupList>[0]> = {}) => ({ role: MEMBER as "member" | "executive" | "admin", joinedGroups: [group(7, "Vocal")], items: [], announcements: [], requestCounts: {}, onOpen: vi.fn(), onCreate: vi.fn(), ...over });

  it("a member has 'Your groups' and no New group button; an executive has 'Groups you manage' and the button", () => {
    const first = render(<GroupList {...props()} />);
    expect(screen.getByRole("heading", { name: "Your groups" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ New group" })).not.toBeInTheDocument();
    first.unmount();
    const onCreate = vi.fn();
    render(<GroupList {...props({ role: EXECUTIVE, onCreate })} />);
    expect(screen.getByRole("heading", { name: "Groups you manage" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "＋ New group" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("a row opens its group, and counts that group's updates and resources only", () => {
    const onOpen = vi.fn();
    render(<GroupList {...props({ onOpen, announcements: [announcement(1, "A", 7), announcement(2, "B", 7), announcement(3, "C", 8)], items: [item(1, 7), item(2, 8), item(3, 8)] })} />);
    const row = screen.getByRole("button", { name: /Vocal/ });
    expect(within(row).getByText("updates").previousElementSibling).toHaveTextContent("2");
    expect(within(row).getByText("resources").previousElementSibling).toHaveTextContent("1");
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(7);
  });

  it("shows the description, or a fallback, or the number of requests waiting (singular and plural); an archived group is marked", () => {
    render(<GroupList {...props({ role: EXECUTIVE, joinedGroups: [group(1, "One", { description: "" }), group(2, "Two"), group(3, "Three"), group(4, "Four", { archived_at: "2026-01-01T00:00:00Z" })], requestCounts: { 2: 1, 3: 4 } })} />);
    expect(screen.getByText("Bharat Sangeet group")).toBeInTheDocument();
    expect(screen.getByText("1 request to review")).toBeInTheDocument();
    expect(screen.getByText("4 requests to review")).toBeInTheDocument();
    expect(screen.queryByText("Two description")).not.toBeInTheDocument();
    expect(screen.getByText("Four (archived)")).toBeInTheDocument();
    expect(screen.getByText("4", { selector: ".group-list-heading span" })).toBeInTheDocument();
  });

  it("with no groups, says what to do next, by role", () => {
    const first = render(<GroupList {...props({ joinedGroups: [] })} />);
    expect(screen.getByText("Join an open group or ask an executive for an invitation.")).toBeInTheDocument();
    first.unmount();
    render(<GroupList {...props({ role: EXECUTIVE, joinedGroups: [] })} />);
    expect(screen.getByText("Create the first group to organize rehearsals and resources.")).toBeInTheDocument();
  });
});

describe("DiscoverGroups", () => {
  const status = (value: string): SubgroupMembership => ({ subgroup_id: 1, member_id: "u-me", status: value, membership_role: "member" }) as SubgroupMembership;

  it("each card says where the person stands, or offers the right button for how the group lets people in", () => {
    const onJoin = vi.fn();
    const memberships: Record<number, SubgroupMembership> = { 4: { ...status("pending"), subgroup_id: 4 }, 5: { ...status("waitlisted"), subgroup_id: 5 }, 6: { ...status("removed"), subgroup_id: 6 } };
    const groups = [group(1, "Open", { enrollment_mode: "open" }), group(2, "Approval"), group(3, "Invite", { enrollment_mode: "invite" }), group(4, "Pending"), group(5, "Waiting"), group(6, "Removed", { enrollment_mode: "open" })];
    render(<DiscoverGroups groups={groups} membershipFor={(id) => memberships[id]} joining={null} onJoin={onJoin} />);
    const card = (name: string) => screen.getByRole("heading", { name }).closest("article") as HTMLElement;
    fireEvent.click(within(card("Open")).getByRole("button", { name: "Join group" }));
    expect(onJoin).toHaveBeenLastCalledWith(groups[0]);
    fireEvent.click(within(card("Approval")).getByRole("button", { name: "Request to join" }));
    expect(onJoin).toHaveBeenLastCalledWith(groups[1]);
    expect(within(card("Invite")).getByText("Invitation required")).toHaveClass("enrollment-status", "muted");
    expect(within(card("Pending")).getByText("Request pending")).toHaveClass("enrollment-status");
    expect(within(card("Waiting")).getByText("Waitlisted")).toBeInTheDocument();
    expect(within(card("Removed")).getByText("Ask an executive to add you back")).toBeInTheDocument();
    expect(onJoin).toHaveBeenCalledTimes(2);
    expect(screen.getByText("6", { selector: ".group-list-heading span" })).toBeInTheDocument();
  });

  it("only the card being joined says Sending… and is disabled", () => {
    render(<DiscoverGroups groups={[group(1, "One", { enrollment_mode: "open" }), group(2, "Two", { enrollment_mode: "open" })]} membershipFor={() => undefined} joining={2} onJoin={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Join group" })).toBeEnabled();
  });

  it("a group with no description gets the standard line", () => {
    render(<DiscoverGroups groups={[group(1, "One", { description: "" })]} membershipFor={() => undefined} joining={null} onJoin={vi.fn()} />);
    expect(screen.getByText("A Bharat Sangeet group at UNC Chapel Hill.")).toBeInTheDocument();
  });
});

// A tab opens through the address (a microtask later), so a test waits for the tab to say it is the open one.
const openTab = async (name: string | RegExp) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.click(tab);
  await waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
};

describe("GroupDetail", () => {
  function renderDetail(role: "member" | "executive" | "admin", over: Partial<Parameters<typeof GroupDetail>[0]> = {}) {
    fake.rpc("list_subgroup_roster").reply(ok([]));
    const callbacks = { onBack: vi.fn(), onOpenAttendance: vi.fn(), onOpenRecordings: vi.fn(), onOpenResources: vi.fn(), onPostUpdate: vi.fn(), onAnnouncementsChanged: vi.fn(), onGroupChanged: vi.fn(), onLeft: vi.fn() };
    render(<GroupDetail user={userOf("u-me")} role={role} group={group(7, "Vocal")} groups={[group(7, "Vocal")]} announcements={[]} myRole={null} isMember={false} {...callbacks} {...over} />);
    return callbacks;
  }

  it("every button leads where it says, with the group's id: the buttons on top, and the one in each tab's own panel", async () => {
    notifySpy();
    const callbacks = renderDetail(MEMBER);
    fireEvent.click(screen.getByRole("button", { name: "← All groups" }));
    expect(callbacks.onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Open resources" }));
    fireEvent.click(screen.getByRole("button", { name: "Open recordings" }));
    fireEvent.click(screen.getByRole("button", { name: "View attendance" }));
    // The three tabs that have nothing of the other screens inside keep the panel they always had, with the same button.
    await openTab("Resources");
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Open resources" }));
    expect(callbacks.onOpenResources.mock.calls).toEqual([[7], [7]]);
    await openTab("Recordings");
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Open recording room →" }));
    expect(callbacks.onOpenRecordings.mock.calls).toEqual([[7], [7]]);
    await openTab("Attendance");
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "View attendance" }));
    expect(callbacks.onOpenAttendance.mock.calls).toEqual([[7], [7]]);
  });

  it("only those who may post to a group have Post update and Add recording", () => {
    notifySpy();
    const member = renderDetail(MEMBER);
    expect(screen.queryByRole("button", { name: "Post update" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add recording" })).not.toBeInTheDocument();
    expect(member.onPostUpdate).not.toHaveBeenCalled();
  });

  it("an executive's Post update and Add recording call back", () => {
    notifySpy();
    const callbacks = renderDetail(EXECUTIVE);
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(callbacks.onPostUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Add recording" }));
    expect(callbacks.onOpenRecordings).toHaveBeenCalledWith(7);
  });

  it("lists the announcements it is given with their count, pinned ones marked; an executive can manage them, a member cannot", () => {
    notifySpy();
    const rows = [announcement(1, "Rehearsal moved", 7, { is_pinned: true }), announcement(2, "Concert call", 7)];
    renderDetail(EXECUTIVE, { announcements: rows });
    const feed = document.querySelector(".group-feed") as HTMLElement;
    expect(within(feed).getByText("Rehearsal moved")).toBeInTheDocument();
    expect(within(feed).getByText(/^Pinned · /)).toBeInTheDocument();
    expect(within(feed).getByText("2")).toBeInTheDocument();
    expect(within(feed).getAllByRole("button", { name: /Pin|Unpin/ })).toHaveLength(2);
  });

  it("a member sees the announcements without the management buttons", () => {
    notifySpy();
    renderDetail(MEMBER, { announcements: [announcement(1, "Rehearsal moved", 7)] });
    const feed = document.querySelector(".group-feed") as HTMLElement;
    expect(within(feed).getByText("Rehearsal moved")).toBeInTheDocument();
    expect(within(feed).queryByRole("button")).not.toBeInTheDocument();
  });

  it("someone in the group can leave it; the people of the group are read for this group, when the Roster tab is opened", async () => {
    notifySpy();
    renderDetail(MEMBER, { isMember: true, myRole: "leader" });
    // The people are read when the Roster tab is opened, not before.
    expect(fake.rpc("list_subgroup_roster").calls).toHaveLength(0);
    await openTab("Roster");
    expect(await screen.findByRole("button", { name: "Leave group" })).toBeInTheDocument();
    expect(fake.rpc("list_subgroup_roster").calls[0].payload).toEqual({ p_subgroup_id: 7 });
  });
});

describe("CreateGroupDialog and GroupUpdateDialog", () => {
  // Both are on the shared Dialog: a name, Escape and the Close button close them, a click beside them does not (what was typed would be lost).
  it("the group form is a dialog named by its heading; Escape and Close close it, a click beside it does not; submit calls back", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<CreateGroupDialog onClose={onClose} onSubmit={onSubmit} />);
    const dialog = screen.getByRole("dialog", { name: "Create a group" });
    fireEvent.mouseDown(screen.getByLabelText("Name"));
    fireEvent.click(screen.getByLabelText("Name"));
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    await keyboardUser().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.submit(screen.getByRole("heading", { name: "Create a group" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("the group form offers the three ways to join, Request approval first selected, and requires a name", () => {
    render(<CreateGroupDialog onClose={vi.fn()} onSubmit={vi.fn()} />);
    const mode = screen.getByLabelText("Enrollment");
    expect(within(mode).getAllByRole("option").map((option) => option.textContent)).toEqual(["Open — anyone can join", "Request approval", "Invitation only"]);
    expect(mode).toHaveValue("approval");
    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxlength", "80");
  });

  it("while the group is being created the button waits (disabled, busy) and nothing closes the dialog", async () => {
    const onClose = vi.fn();
    render(<CreateGroupDialog onClose={onClose} onSubmit={vi.fn()} saving />);
    expect(screen.getByRole("button", { name: "Create group" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create group" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await keyboardUser().keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the update form names the group in capitals above and in the button; closes the same way", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<GroupUpdateDialog groupName="Hindustani Vocal" onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByRole("dialog", { name: "Post a group update" })).toBeInTheDocument();
    expect(screen.getByText("HINDUSTANI VOCAL")).toHaveClass("eyebrow");
    expect(screen.getByRole("button", { name: "Publish to Hindustani Vocal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeRequired();
    expect(screen.getByLabelText("Message")).toBeRequired();
    await keyboardUser().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByRole("heading", { name: "Post a group update" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("while the update is being posted the button waits and Escape does not close the dialog", async () => {
    const onClose = vi.fn();
    render(<GroupUpdateDialog groupName="Hindustani Vocal" onClose={onClose} onSubmit={vi.fn()} saving />);
    expect(screen.getByRole("button", { name: "Publish to Hindustani Vocal" })).toBeDisabled();
    await keyboardUser().keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("JoinRequestsPanel", () => {
  const pending = person("u-dev", "Dev Nair", "pending");
  const waiting = person("u-eka", "Eka Rao", "waitlisted");

  it("lists each request with the count; a waitlisted person is marked and cannot be waitlisted again", () => {
    render(<JoinRequestsPanel requests={[pending, waiting]} busyKey="" onReview={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /Requests to join/ })).toHaveTextContent("(2)");
    expect(screen.getByText("u-eka@x.test · Waitlisted")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Waitlist" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
  });

  it("Approve and Waitlist call back with the row and the decision; Decline asks the page to confirm", () => {
    const onReview = vi.fn();
    const onDecline = vi.fn();
    render(<JoinRequestsPanel requests={[pending]} busyKey="" onReview={onReview} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Waitlist" }));
    expect(onReview.mock.calls).toEqual([[pending, "approve"], [pending, "waitlist"]]);
    expect(onDecline).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledWith(pending);
  });

  it("while a change runs every button is disabled, and the one that runs says what it is doing", () => {
    render(<JoinRequestsPanel requests={[pending, waiting]} busyKey="approve-u-dev" onReview={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  it("the Waitlisting… and Declining… labels follow the key of their own row", () => {
    const first = render(<JoinRequestsPanel requests={[pending]} busyKey="waitlist-u-dev" onReview={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Waitlisting…" })).toBeInTheDocument();
    first.unmount();
    render(<JoinRequestsPanel requests={[pending]} busyKey="decline-u-dev" onReview={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Declining…" })).toBeInTheDocument();
  });
});

describe("RosterList", () => {
  const members = [person("u-me", "Asha Rao"), person("u-lead", "Lata Rao", "active", "leader"), person("u-dev", "Dev Nair")];
  const props = (over: Partial<Parameters<typeof RosterList>[0]> = {}) => ({ members, userId: "u-me", busyKey: "", canChangeRoles: false, canRemoveRow: () => false, onChangeRole: vi.fn(), onRemove: vi.fn(), ...over });

  it("marks the signed-in person, and shows a role label only for a leader or a manager", () => {
    render(<RosterList {...props()} />);
    expect(screen.getByText("Asha Rao (you)")).toBeInTheDocument();
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.queryByText("Member")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("those who may change roles get a select per row, holding the row's role, that calls back with the new one", () => {
    const onChangeRole = vi.fn();
    render(<RosterList {...props({ canChangeRoles: true, onChangeRole })} />);
    const select = screen.getByLabelText("Group role for Lata Rao");
    expect(select).toHaveValue("leader");
    fireEvent.change(select, { target: { value: "manager" } });
    expect(onChangeRole).toHaveBeenCalledWith(members[1], "manager");
    expect(screen.queryByText("Leader", { selector: "span" })).not.toBeInTheDocument();
  });

  it("Remove appears on the rows the page allows, and asks the page to confirm", () => {
    const onRemove = vi.fn();
    render(<RosterList {...props({ canRemoveRow: (row) => row.member_id === "u-dev", onRemove })} />);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith(members[2]);
  });

  it("while a change runs the selects and the buttons are disabled", () => {
    render(<RosterList {...props({ canChangeRoles: true, canRemoveRow: () => true, busyKey: "role-u-dev" })} />);
    for (const select of screen.getAllByRole("combobox")) expect(select).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: "Remove" })) expect(button).toBeDisabled();
  });

  it("a person with no name is listed by their email", () => {
    render(<RosterList {...props({ members: [person("u-9", "")] })} />);
    expect(screen.getAllByText("u-9@x.test")).toHaveLength(2);
  });
});

describe("GroupConfirmDialogs", () => {
  const Group = group(7, "Vocal");
  const show = (pending: Pending, over: Partial<Parameters<typeof GroupConfirmDialogs>[0]> = {}) => {
    const callbacks = { onConfirm: vi.fn(), onCancel: vi.fn() };
    render(<GroupConfirmDialogs group={Group} myRole={null} pending={pending} busyKey="" {...callbacks} {...over} />);
    return callbacks;
  };

  it("nothing is asked while nothing is pending", () => {
    show(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("declining: names the person and the group, and confirms with Decline request", () => {
    const callbacks = show({ kind: "decline", row: person("u-dev", "Dev Nair", "pending") });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Decline this request?")).toBeInTheDocument();
    expect(within(dialog).getByText("Dev Nair will not be added to Vocal. They can ask to join again later.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    expect(callbacks.onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });

  it("removing: says what the person loses, and who can add them back", () => {
    show({ kind: "remove", row: person("u-dev", "Dev Nair") });
    expect(screen.getByText("Remove from group?")).toBeInTheDocument();
    expect(screen.getByText(/Dev Nair will lose access to Vocal\. Their past attendance is kept\. They cannot rejoin on their own; an executive can add them back\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove member" })).toBeInTheDocument();
  });

  it("leaving: says what is lost, and a leader or a manager is told their role goes too", () => {
    show({ kind: "leave" }, { myRole: "leader" });
    expect(screen.getByText("Leave Vocal?")).toBeInTheDocument();
    expect(screen.getByText(/You will lose access to this group's resources and recordings\. Your past attendance is kept\. You will also give up your leader role\./)).toBeInTheDocument();
  });

  it("leaving as an ordinary member says nothing about a role", () => {
    show({ kind: "leave" }, { myRole: "member" });
    expect(screen.queryByText(/give up your/)).not.toBeInTheDocument();
  });

  it("archiving a live group warns that it is hidden, and restoring an archived one says it comes back", () => {
    const first = render(<GroupConfirmDialogs group={Group} myRole={null} pending={{ kind: "archive" }} busyKey="" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Archive Vocal?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive group" })).toBeInTheDocument();
    expect(screen.getByText(/The group is hidden from members and stops accepting requests\./)).toBeInTheDocument();
    first.unmount();
    render(<GroupConfirmDialogs group={{ ...Group, archived_at: "2026-01-01T00:00:00Z" }} myRole={null} pending={{ kind: "archive" }} busyKey="" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Restore Vocal?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore group" })).toBeInTheDocument();
    expect(screen.getByText("The group will appear in members' lists again.")).toBeInTheDocument();
  });

  it("the confirmation shows it is working: a decline while a decline runs (its key starts with 'decline-'), the others while 'confirm' runs", () => {
    const decline = render(<GroupConfirmDialogs group={Group} myRole={null} pending={{ kind: "decline", row: person("u-dev", "Dev Nair") }} busyKey="decline-u-dev" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })).toBeDisabled();
    decline.unmount();
    const leave = render(<GroupConfirmDialogs group={Group} myRole={null} pending={{ kind: "leave" }} busyKey="confirm" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Working…" })).toBeDisabled();
    leave.unmount();
    render(<GroupConfirmDialogs group={Group} myRole={null} pending={{ kind: "leave" }} busyKey="decline-u-dev" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave group" })).toBeEnabled();
  });
});

describe("GroupSettingsDialog", () => {
  const props = (over: Partial<Parameters<typeof GroupSettingsDialog>[0]> = {}) => ({ open: true, group: group(7, "Vocal", { enrollment_mode: "invite" }), canChangeEnrollment: true, canArchive: true, saving: false, onClose: vi.fn(), onSubmit: vi.fn((event: React.FormEvent) => event.preventDefault()), onArchive: vi.fn(), ...over });

  it("starts from the group's name, description and way of joining", () => {
    render(<GroupSettingsDialog {...props()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Vocal");
    expect(screen.getByLabelText("Description")).toHaveValue("Vocal description");
    expect(screen.getByLabelText("How members join")).toHaveValue("invite");
  });

  it("those who cannot change how people join are told, in the group's own words, instead of getting the select", () => {
    render(<GroupSettingsDialog {...props({ canChangeEnrollment: false })} />);
    expect(screen.queryByLabelText("How members join")).not.toBeInTheDocument();
    expect(screen.getByText("How members join: Invitation only. Only executives can change this.")).toBeInTheDocument();
  });

  it("Archive group is offered to those who may, as Restore group on an archived one; Save says Saving… while it runs", () => {
    const onArchive = vi.fn();
    const first = render(<GroupSettingsDialog {...props({ onArchive })} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = render(<GroupSettingsDialog {...props({ group: group(7, "Vocal", { archived_at: "2026-01-01T00:00:00Z" }) })} />);
    expect(screen.getByRole("button", { name: "Restore group" })).toBeInTheDocument();
    second.unmount();
    const third = render(<GroupSettingsDialog {...props({ canArchive: false })} />);
    expect(screen.queryByRole("button", { name: /Archive group|Restore group/ })).not.toBeInTheDocument();
    third.unmount();
    render(<GroupSettingsDialog {...props({ saving: true })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("submit and Cancel call back; closed, nothing is shown", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onClose = vi.fn();
    const first = render(<GroupSettingsDialog {...props({ onSubmit, onClose })} />);
    fireEvent.submit(screen.getByRole("heading", { name: "Group settings" }).closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<GroupSettingsDialog {...props({ open: false })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("AddMemberDialog", () => {
  const candidates = [{ id: "u-1", full_name: "Asha Rao", email: "asha@x.test" }, { id: "u-2", full_name: "", email: "bala@x.test" }];
  const props = (over: Partial<Parameters<typeof AddMemberDialog>[0]> = {}) => ({ open: true, group: group(7, "Vocal"), query: "", onQueryChange: vi.fn(), candidates, filteredCandidates: candidates, busyKey: "", onAdd: vi.fn(), onClose: vi.fn(), ...over });

  it("lists the people it is given (a person with no name by their email) and Add calls back with that person", () => {
    const onAdd = vi.fn();
    render(<AddMemberDialog {...props({ onAdd })} />);
    expect(screen.getByRole("heading", { name: "Add a member to Vocal" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByText("Asha Rao").closest("li")!).getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith(candidates[0]);
    expect(screen.getAllByText("bala@x.test")).toHaveLength(2);
  });

  it("typing in the search box tells the page", () => {
    const onQueryChange = vi.fn();
    render(<AddMemberDialog {...props({ onQueryChange })} />);
    fireEvent.change(screen.getByLabelText("Search club members"), { target: { value: "bal" } });
    expect(onQueryChange).toHaveBeenCalledWith("bal");
  });

  it("while one person is being added their button says Adding… and every button is disabled", () => {
    render(<AddMemberDialog {...props({ busyKey: "add-u-1" })} />);
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("an empty list says 'Loading members…' before the members arrive and 'No matching members…' after", () => {
    const first = render(<AddMemberDialog {...props({ candidates: [], filteredCandidates: [] })} />);
    expect(screen.getByText("Loading members…")).toBeInTheDocument();
    first.unmount();
    render(<AddMemberDialog {...props({ filteredCandidates: [] })} />);
    expect(screen.getByText("No matching members who are not already in this group.")).toBeInTheDocument();
  });

  it("Done closes it", () => {
    const onClose = vi.fn();
    render(<AddMemberDialog {...props({ onClose })} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("GroupPeople: who may be removed", () => {
  it("an executive can remove the other members but never themselves (Leave group is how a person goes)", async () => {
    notifySpy();
    fake.rpc("list_subgroup_roster").reply(ok([person("u-me", "Asha Rao"), person("u-dev", "Dev Nair"), person("u-eka", "Eka Rao", "active", "manager")]));
    render(<GroupPeople user={userOf("u-me")} role={EXECUTIVE} group={group(7, "Vocal")} myRole="member" isMember onGroupChanged={vi.fn()} onLeft={vi.fn()} />);
    await screen.findByText("Asha Rao (you)");
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(within(screen.getByText("Asha Rao (you)").closest("li")!).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(within(screen.getByText("Dev Nair").closest("li")!).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave group" })).toBeInTheDocument();
  });
});
