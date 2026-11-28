// A group's page as tabs (plan 3.2): Announcements, Dates, Resources, Recordings, Attendance, Roster, Requests (Requests only for those who
// may review them). What a person relies on: the tablist is a real WAI-ARIA tablist (roles, roving tabindex, arrow keys), the open tab and
// the open group are in the address (`?page=groups&group=12&tab=roster`) and a bad value falls back to the list / the first tab, Back works,
// and a tab's data is read only when the tab is opened (and not again when the Roster and Requests tabs trade places).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { GroupTabs } from "../../features/groups/components/group-tabs";
import { SubgroupSpaces } from "../../features/groups/components/subgroup-spaces";
import { setCacheOwner } from "../../lib/cache";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { notifySpy, userOf } from "../support/helpers";
import { focusedName, keyboardUser } from "../support/keyboard";
import { openPortal } from "../support/portal";

const group = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, name, description: `${name} description`, enrollment_mode: "approval", archived_at: null, ...over });
const membership = (subgroup_id: number, status = "active", membership_role = "member") => ({ subgroup_id, member_id: "u-me", status, membership_role });
const person = (id: string, name: string, status = "active", membership_role = "member") => ({ member_id: id, full_name: name, email: `${id}@x.test`, status, membership_role, joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" });
const announcement = (id: number, title: string, subgroup_id: number | null) => ({ id, title, body: `${title} body`, is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id });
const search = () => new URLSearchParams(window.location.search);
/** The visible label of each tab (without the number waiting). */
const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.firstChild?.textContent);

type Options = { role?: "member" | "executive" | "admin"; myRole?: "member" | "leader" | "manager"; url?: string; waiting?: number; roster?: unknown[] };

/** Opens the groups page of a person who is in group 7 (Hindustani Vocal), at `url` (default: the groups page, no group chosen). */
function openGroupsPage(options: Options = {}) {
  const groups = [group(7, "Hindustani Vocal"), group(8, "Carnatic Violin")];
  const rows = [membership(7, "active", options.myRole ?? "member"), ...Array.from({ length: options.waiting ?? 0 }, (_, index) => ({ subgroup_id: 7, member_id: `u-w${index}`, status: "pending", membership_role: "member" }))];
  fake.from("subgroups", "select").reply(ok(groups));
  fake.from("subgroup_memberships", "select").reply(ok(rows));
  fake.from("announcements", "select").reply(ok([announcement(1, "Rehearsal moved", 7), announcement(2, "Someone else's", 8)]));
  fake.from("archive_items", "select").reply(ok([]));
  fake.rpc("list_subgroup_roster").reply(ok(options.roster ?? [person("u-me", "Asha Rao"), person("u-dev", "Dev Nair", "pending")]));
  fake.from("events", "select").reply(ok([]));
  window.history.replaceState({}, "", options.url ?? "/?page=groups");
  return openPortal({ role: options.role ?? "member", boot: { groups, memberships: rows } });
}

const PROPS = { user: userOf("u-me"), role: "member" as const, onGroupsChanged: vi.fn(), onOpenAttendance: vi.fn(), onOpenRecordings: vi.fn(), onOpenResources: vi.fn() };
const openTab = async (name: string | RegExp) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.click(tab);
  await waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
};
const rosterReads = () => fake.rpc("list_subgroup_roster").calls.length;
const eventReads = () => fake.from("events", "select").calls.length;
const settle = () => act(async () => { await Promise.resolve(); });

describe("GroupTabs: a tablist", () => {
  const TABS = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma", count: 3 }];

  it("has role tablist with a name, role tab buttons, the open one selected and the only one in the Tab order, and says what it controls", () => {
    render(<GroupTabs tabs={TABS} selected="b" onSelect={vi.fn()} />);
    expect(screen.getByRole("tablist", { name: "Group sections" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    // Only the open tab has a panel in the page, so only it points at one.
    expect(tabs.map((tab) => tab.getAttribute("aria-controls"))).toEqual([null, "group-tabpanel", null]);
  });

  it("a count is part of the tab's name ('3 waiting') and drawn for the eye", () => {
    render(<GroupTabs tabs={TABS} selected="a" onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Gamma (3 waiting)" })).toBeInTheDocument();
  });

  it("ArrowRight and ArrowLeft open the next and the previous tab, wrapping; Home and End open the first and the last; focus follows", async () => {
    const onSelect = vi.fn();
    function Harness() {
      const [selected, setSelected] = useState("a");
      return <GroupTabs tabs={TABS} selected={selected} onSelect={(id) => { onSelect(id); setSelected(id); }} />;
    }
    render(<Harness />);
    const user = keyboardUser();
    await user.tab();
    expect(focusedName()).toBe("Alpha");
    await user.keyboard("{ArrowRight}");
    expect(focusedName()).toBe("Beta");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(focusedName()).toBe("Alpha");   // wraps
    await user.keyboard("{ArrowLeft}");
    expect(focusedName()).toMatch(/^Gamma/);
    await user.keyboard("{Home}");
    expect(focusedName()).toBe("Alpha");
    await user.keyboard("{End}");
    expect(focusedName()).toMatch(/^Gamma/);
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(["b", "c", "a", "c", "a", "c"]);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(/^Gamma/);
  });

  it("Tab leaves the strip after one stop (roving tabindex), and Shift+Tab does not land on a tab that is not open", async () => {
    render(<><button>before</button><GroupTabs tabs={TABS} selected="b" onSelect={vi.fn()} /><button>after</button></>);
    const user = keyboardUser();
    await user.tab();
    await user.tab();
    expect(focusedName()).toBe("Beta");
    await user.tab();
    expect(focusedName()).toBe("after");
    await user.tab({ shift: true });
    expect(focusedName()).toBe("Beta");
  });
});

describe("a group's page is a set of tabs", () => {
  it("an ordinary member has six tabs in the order of the plan, no Requests; the first is open and the panel is named by it", async () => {
    openGroupsPage();
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByRole("tablist");
    expect(tabNames()).toEqual(["Announcements", "Dates", "Resources", "Recordings", "Attendance", "Roster"]);
    expect(screen.getByRole("tab", { name: "Announcements" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName("Announcements");
    expect(within(panel).getByText("Rehearsal moved")).toBeInTheDocument();
    expect(within(panel).queryByText("Someone else's")).not.toBeInTheDocument();
  });

  it("a group manager has Requests last, with the number waiting; an executive has it too", async () => {
    openGroupsPage({ myRole: "manager", waiting: 2 });
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByRole("tablist");
    expect(tabNames()).toEqual(["Announcements", "Dates", "Resources", "Recordings", "Attendance", "Roster", "Requests"]);
    expect(screen.getByRole("tab", { name: "Requests (2 waiting)" })).toBeInTheDocument();
  });

  it("an executive who is in no group still sees every tab, Requests included", async () => {
    openGroupsPage({ role: "executive", url: "/?page=groups&group=8" });
    await screen.findByRole("tablist");
    expect(tabNames()).toContain("Requests");
  });

  it("opening a group leaves the address clean (the first tab is the default); opening a tab and a group put them in the address", async () => {
    openGroupsPage();
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByRole("tablist");
    await waitFor(() => expect(search().get("group")).toBe("7"));
    expect(search().get("page")).toBe("groups");
    expect(search().has("tab")).toBe(false);
    await openTab("Roster");
    expect(window.location.search).toBe("?page=groups&group=7&tab=roster");
    await openTab("Announcements");
    expect(window.location.search).toBe("?page=groups&group=7");
  });

  it("a link opens the group at its tab", async () => {
    openGroupsPage({ url: "/?page=groups&group=7&tab=roster" });
    expect(await screen.findByRole("tab", { name: "Roster" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Asha Rao (you)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Hindustani Vocal" })).toBeInTheDocument();
  });

  it("an unknown tab is the first tab, and nothing is written back to the address", async () => {
    openGroupsPage({ url: "/?page=groups&group=7&tab=zzz" });
    expect(await screen.findByRole("tab", { name: "Announcements" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?page=groups&group=7&tab=zzz");
  });

  it("?tab=requests for someone who may not review requests is the first tab", async () => {
    openGroupsPage({ url: "/?page=groups&group=7&tab=requests" });
    expect(await screen.findByRole("tab", { name: "Announcements" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /Requests/ })).not.toBeInTheDocument();
  });

  it.each(["abc", "0", "-3", "7abc", "1.5", "999"])("?group=%s is the list of groups, not a group page and not an error", async (bad) => {
    openGroupsPage({ url: `/?page=groups&group=${bad}&tab=roster` });
    expect(await screen.findByRole("heading", { level: 1, name: "My groups" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hindustani Vocal/ })).toBeInTheDocument();
  });

  it("a group the person is not in (an id from someone else's link) is the list too", async () => {
    openGroupsPage({ url: "/?page=groups&group=8" });
    expect(await screen.findByRole("heading", { level: 1, name: "My groups" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("Back goes from a tab to the tab before it, and from the group to the list; All groups does the same in one step", async () => {
    openGroupsPage();
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByRole("tablist");
    await openTab("Roster");
    await openTab("Dates");
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Roster" })).toHaveAttribute("aria-selected", "true"));
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Announcements" })).toHaveAttribute("aria-selected", "true"));
    await act(async () => { window.history.back(); });
    expect(await screen.findByRole("heading", { level: 1, name: "My groups" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await act(async () => { window.history.forward(); });
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });

  it("← All groups removes the group AND its tab from the address in one history entry, so one Back returns to the group on that tab", async () => {
    openGroupsPage({ url: "/?page=groups&group=7&tab=roster" });
    fireEvent.click(await screen.findByRole("button", { name: "← All groups" }));
    expect(await screen.findByRole("heading", { level: 1, name: "My groups" })).toBeInTheDocument();
    expect(window.location.search).toBe("?page=groups");
    await act(async () => { window.history.back(); });
    expect(await screen.findByRole("tab", { name: "Roster" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?page=groups&group=7&tab=roster");
  });

  it("opening another group starts at its first tab", async () => {
    openGroupsPage({ url: "/?page=groups&group=7&tab=roster" });
    fireEvent.click(await screen.findByRole("button", { name: "← All groups" }));
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    expect(await screen.findByRole("tab", { name: "Announcements" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("a tab's data is read when the tab is opened, and not before", () => {
  it("opening the group reads no roster and no dates; the Roster tab reads the roster once, the Dates tab the dates once", async () => {
    openGroupsPage();
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByRole("tablist");
    await settle();
    expect(rosterReads()).toBe(0);
    expect(eventReads()).toBe(0);
    await openTab("Roster");
    expect(await screen.findByText("Asha Rao (you)")).toBeInTheDocument();
    expect(rosterReads()).toBe(1);
    expect(eventReads()).toBe(0);
    await openTab("Dates");
    await waitFor(() => expect(eventReads()).toBe(1));
    expect(rosterReads()).toBe(1);
  });

  it("the Roster and Requests tabs share ONE read of the roster: moving between them reads nothing", async () => {
    openGroupsPage({ myRole: "manager" });
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    await screen.findByRole("tablist");
    await openTab("Requests");
    expect(await screen.findByText("Dev Nair")).toBeInTheDocument();
    expect(rosterReads()).toBe(1);
    await openTab("Roster");
    expect(await screen.findByText("Asha Rao (you)")).toBeInTheDocument();
    await openTab("Requests");
    await settle();
    expect(rosterReads()).toBe(1);
  });

  it("the Dates tab asks for this group's dates from today on, soonest first, and lists them", async () => {
    openGroupsPage({ url: "/?page=groups&group=7&tab=dates" });
    fake.from("events", "select").reply(ok([
      { id: 1, title: "Winter concert", description: "Bring the green shawl", starts_at: "2026-12-06T23:30:00Z", location: "Hill Hall", created_at: "2026-10-01T00:00:00Z", subgroup_id: 7 },
      { id: 2, title: "Open rehearsal", description: "", starts_at: "2026-12-09T23:00:00Z", location: "", created_at: "2026-10-01T00:00:00Z", subgroup_id: 7 },
    ]));
    const panel = await screen.findByRole("tabpanel");
    expect(await within(panel).findByText("Winter concert")).toBeInTheDocument();
    expect(within(panel).getByText("Bring the green shawl")).toBeInTheDocument();
    expect(within(panel).getByText("Hill Hall")).toBeInTheDocument();
    expect(within(panel).getByText("Open rehearsal")).toBeInTheDocument();
    const [call] = fake.from("events", "select").calls;
    const chain = call.chain.map((link) => [link.method, ...link.args]);
    expect(chain[0]).toEqual(["select", "id,title,description,starts_at,location,created_at,subgroup_id"]);
    expect(chain[1]).toEqual(["eq", "subgroup_id", 7]);
    expect(chain[2][0]).toBe("gte");
    const since = new Date(String(chain[2][2]));
    expect(since.getHours()).toBe(0);               // the start of today, in the viewer's time zone
    expect(Date.now() - since.getTime()).toBeLessThan(24 * 3600 * 1000 + 1000);
    expect(chain.slice(3)).toEqual([["order", "starts_at", { ascending: true }], ["limit", 100]]);
  });

  it("the Dates tab says so when there are none", async () => {
    openGroupsPage({ url: "/?page=groups&group=7&tab=dates" });
    expect(await screen.findByText("No upcoming dates for Hindustani Vocal yet.")).toBeInTheDocument();
  });

  it("the Dates tab shows a skeleton while it reads, and a failed read is an error with Try again (not 'no dates')", async () => {
    const slow = deferred();
    openGroupsPage({ url: "/?page=groups&group=7&tab=dates" });
    fake.from("events", "select").replyOnce(slow.reply).reply(ok([{ id: 5, title: "Winter concert", description: "", starts_at: "2026-12-06T23:30:00Z", location: "", created_at: "2026-10-01T00:00:00Z", subgroup_id: 7 }]));
    expect(await screen.findByText("Loading the dates")).toHaveAttribute("role", "status");
    await act(async () => { slow.resolve(fail("Network is down")); });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The dates could not be loaded.");
    expect(screen.queryByText(/No upcoming dates/)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Winter concert")).toBeInTheDocument();
  });
});

describe("the shell can fill a tab with another area's screen", () => {
  function renderSpaces(renderGroupTab: (tab: string, group: { id: number; name: string }) => ReactNode) {
    notifySpy();
    fake.from("subgroups", "select").reply(ok([group(7, "Hindustani Vocal")]));
    fake.from("subgroup_memberships", "select").reply(ok([membership(7)]));
    fake.from("announcements", "select").reply(ok([]));
    fake.from("archive_items", "select").reply(ok([]));
    fake.from("events", "select").reply(ok([]));
    window.history.replaceState({}, "", "/?page=groups&group=7");
    return render(<SubgroupSpaces {...PROPS} renderGroupTab={renderGroupTab} />);
  }

  it("asks only for the tab that is open (so the other screen loads then), and what it answers is drawn in the panel", async () => {
    const asked: string[] = [];
    renderSpaces((tab, selected) => { asked.push(`${tab}:${selected.id}`); return tab === "resources" ? <p>The resource library of group {selected.id}</p> : null; });
    await screen.findByRole("tablist");
    expect(asked).toEqual([]);
    await openTab("Resources");
    expect(within(screen.getByRole("tabpanel")).getByText("The resource library of group 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open resources" })).toBeInTheDocument();   // the button on top is still there
    expect(asked).not.toContain("recordings:7");
  });

  it("a tab it answers nothing for shows the page's own panel, with the button that opens that page", async () => {
    renderSpaces(() => null);
    await screen.findByRole("tablist");
    await openTab("Recordings");
    expect(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Open recording room →" })).toBeInTheDocument();
    await openTab("Attendance");
    expect(within(screen.getByRole("tabpanel")).getByText("Meetings, check-in and absence forms for this group are on the Attendance page.")).toBeInTheDocument();
  });
});

describe("leaving a group from its page", () => {
  it("returns to the list and takes the group and its tab out of the address", async () => {
    notifySpy();
    openGroupsPage({ url: "/?page=groups&group=7&tab=roster" });
    fake.rpc("leave_subgroup").reply(ok(null));
    fireEvent.click(await screen.findByRole("button", { name: "Leave group" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave group" }));
    expect(await screen.findByRole("heading", { level: 1, name: "My groups" })).toBeInTheDocument();
    expect(window.location.search).toBe("?page=groups");
  });
});

describe("My Groups is remembered (finding F6) and does not send the memberships twice (finding F4)", () => {
  it("opening the page sends ONE read of subgroup_memberships", async () => {
    openGroupsPage();
    await screen.findByRole("button", { name: /Hindustani Vocal/ });
    expect(fake.from("subgroup_memberships", "select").calls).toHaveLength(1);
    expect(fake.calls.filter((call) => call.target === "subgroup_memberships")).toHaveLength(1);
  });

  it("a second visit shows the list at once, with no skeleton, while the four reads run again in the background", async () => {
    notifySpy();
    setCacheOwner("u-me");
    const reads = () => { fake.from("subgroups", "select").reply(ok([group(7, "Hindustani Vocal")])); fake.from("subgroup_memberships", "select").reply(ok([membership(7)])); fake.from("announcements", "select").reply(ok([])); fake.from("archive_items", "select").reply(ok([])); };
    reads();
    const props = PROPS;
    const first = render(<SubgroupSpaces {...props} />);
    await screen.findByRole("button", { name: /Hindustani Vocal/ });
    first.unmount();
    // The second visit's reads are slow: the page must not wait for them.
    const slow = deferred();
    fake.from("subgroups", "select").reply(slow.reply);
    render(<SubgroupSpaces {...props} />);
    expect(screen.getByRole("button", { name: /Hindustani Vocal/ })).toBeInTheDocument();
    expect(screen.queryByText("Loading your groups")).not.toBeInTheDocument();
    await waitFor(() => expect(fake.from("subgroups", "select").calls).toHaveLength(2));
    expect(fake.from("subgroup_memberships", "select").calls).toHaveLength(2);
    await act(async () => { slow.resolve(ok([group(7, "Hindustani Vocal"), group(8, "Carnatic Violin")])); });
    expect(await screen.findByRole("heading", { name: "Carnatic Violin" })).toBeInTheDocument();
  });

  it("a first read that fails is an error with Try again, not 'No groups yet'; Try again shows the skeleton and then the groups", async () => {
    notifySpy();
    const slow = deferred();
    fake.from("subgroups", "select").replyOnce(fail("Network is down")).replyOnce(slow.reply);
    fake.from("subgroup_memberships", "select").reply(ok([membership(7)]));
    fake.from("announcements", "select").reply(ok([]));
    fake.from("archive_items", "select").reply(ok([]));
    render(<SubgroupSpaces {...PROPS} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The groups could not be loaded.");
    expect(screen.queryByText("No groups yet")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Loading your groups")).toBeInTheDocument();
    await act(async () => { slow.resolve(ok([group(7, "Hindustani Vocal")])); });
    expect(await screen.findByRole("button", { name: /Hindustani Vocal/ })).toBeInTheDocument();
  });

  it("a refresh that fails keeps the list and says it may be out of date, with Try again", async () => {
    notifySpy();
    setCacheOwner("u-me");
    fake.from("subgroups", "select").replyOnce(ok([group(7, "Hindustani Vocal")])).reply(fail("Network is down"));
    fake.from("subgroup_memberships", "select").reply(ok([membership(7)]));
    fake.from("announcements", "select").reply(ok([]));
    fake.from("archive_items", "select").reply(ok([]));
    const props = PROPS;
    const first = render(<SubgroupSpaces {...props} />);
    await screen.findByRole("button", { name: /Hindustani Vocal/ });
    first.unmount();
    render(<SubgroupSpaces {...props} />);
    const banner = await screen.findByText("Some group information could not be refreshed, so what is shown may be out of date.");
    expect(banner.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Hindustani Vocal/ })).toBeInTheDocument();
  });
});
