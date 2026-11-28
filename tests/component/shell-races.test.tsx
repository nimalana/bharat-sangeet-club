// Lists the shell loads more than once: the newest answer wins, and a list that failed to reload keeps what it shows.
//
// Replaces, from the old text tests:
//  shell-wiring "the admin and group lists drop answers that are no longer the newest (frontend-7)"
//    (each of AdminPage and SubgroupSpaces has its own gate; removing it from one must not be hidden by the other)
//    -> "the Admin lists ..." and "the group lists ..." (two overlapping reloads, the older answering last), and
//       "the shell's own group list" for the shell's gate on the groups it passes to every page.
//  shell-wiring "the dashboard, workspace, directory and recordings loaders keep their guards (round 1)"
//    -> the dashboard, directory (Members), workspace (shell-bootstrap.test.tsx) and recordings (people-recordings.test.tsx) races.
//  refresh-wiring "members, groups, admin and the dashboard keep a list that failed to load"
//    (the failed reload of members/groups/memberships, archive, resource count, members, items must not empty the list;
//    the old forms `setArchive(items)` / `setResourceCount(count || 0)` turned a failed query into an empty list)
//    -> "a list that failed to reload keeps what it shows" group.
//  refresh-wiring "dashboard, workspace and directory loads drop answers that are no longer the newest"
//    -> "the dashboard", "the member directory" races here; the account-change part is in shell-bootstrap.test.tsx.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const member = (id: string, name: string, role = "member") => ({ id, full_name: name, email: `${id}@x.test`, role, status: "active", phone: "1", class_year: "2027", specialty: "Vocal", joined_at: "2025-08-01" });
const home = () => screen.getByRole("button", { name: "Bharat Sangeet at UNC Chapel Hill home" });
const nav = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name }));
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
/** A permission change asks first: answers the question that is open with the button that says Yes. */
const answerYes = async (button: string) => fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: button }));
const concert = (id: number, title: string) => ({ id, title, description: "", starts_at: future(3), location: "Hill Hall", created_at: "2026-01-01T00:00:00Z", subgroup_id: null });

describe("only the newest answer changes a list that is reloaded after each change", () => {
  it("the Admin lists: of two overlapping reloads, the older answer arriving last is dropped", async () => {
    const olderReload = deferred();
    fake.from("profiles", "select")
      .replyOnce(ok([member("u-me", "Asha Rao", "admin"), member("u-2", "Bala Menon"), member("u-3", "Chitra Iyer")]))
      .replyOnce(olderReload.reply)
      .reply(ok([member("u-me", "Asha Rao", "admin"), member("u-2", "Bala Menon", "executive"), member("u-3", "Chitra Iyer", "executive"), member("u-4", "Fresh Arrival")]));
    fake.rpc("admin_change_member_role").reply(ok(null));
    openPortal({ role: "admin", page: "admin" });
    await screen.findByText("Bala Menon");
    // Two changes in a row: the first reload is slow, the second is quick.
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "executive" } });
    await answerYes("Make executive");
    await waitFor(() => expect(fake.from("profiles", "select").count).toBe(2));
    fireEvent.change(screen.getByLabelText("Permission for Chitra Iyer"), { target: { value: "executive" } });
    await answerYes("Make executive");
    expect(await screen.findByText("Fresh Arrival")).toBeInTheDocument();
    await act(async () => { olderReload.resolve(ok([member("u-me", "Asha Rao", "admin"), member("u-9", "Stale Entry")])); });
    expect(screen.queryByText("Stale Entry")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh Arrival")).toBeInTheDocument();
  });

  it("the group lists: of two overlapping reloads, the older answer arriving last is dropped", async () => {
    const group = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null };
    const olderReload = deferred();
    fake.from("subgroups", "select").reply(ok([group]));
    fake.from("announcements", "select").replyOnce(ok([])).replyOnce(olderReload.reply).reply(ok([{ id: 2, title: "Fresh update", body: "b", is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id: 7 }]));
    openPortal({ role: "executive", page: "groups", boot: { groups: [group] } });
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    const postUpdate = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Post update" }));
      fireEvent.submit(screen.getByRole("heading", { name: "Post a group update" }).closest("form")!);
    };
    await postUpdate();
    await waitFor(() => expect(fake.from("announcements", "select").count).toBe(2));
    await postUpdate();
    expect(await screen.findByText("Fresh update")).toBeInTheDocument();
    await act(async () => { olderReload.resolve(ok([{ id: 1, title: "Stale update", body: "b", is_pinned: false, published_at: "2026-09-01T00:00:00Z", subgroup_id: 7 }])); });
    expect(screen.queryByText("Stale update")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh update")).toBeInTheDocument();
  });

  it("the shell's own group list (the audiences offered on other pages): of two overlapping reloads, the older answer arriving last is dropped", async () => {
    const mine = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null };
    const older = deferred();
    let shellReads = 0;
    openPortal({ role: "executive", page: "groups", boot: { groups: [mine] } });
    // The shell filters out archived groups; the Groups page's own read does not. Only the shell's reads are scripted slow.
    fake.from("subgroups", "select").reply((call) => {
      if (!call.used("is", "archived_at")) return ok([mine]);
      shellReads += 1;
      return shellReads === 1 ? older.reply : ok([mine, { ...mine, id: 8, name: "Fresh Choir" }]);
    });
    fake.rpc("create_subgroup").reply(ok(null));
    // Each group created makes the shell read its groups again. The first read is slow; a second group is created meanwhile.
    const createGroup = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "＋ New group" }));
      fireEvent.submit(screen.getByRole("heading", { name: "Create a group" }).closest("form")!);
    };
    await createGroup();
    await waitFor(() => expect(shellReads).toBe(1));
    await createGroup();
    await waitFor(() => expect(shellReads).toBe(2));
    await act(async () => { older.resolve(ok([mine, { ...mine, id: 9, name: "Stale Choir" }])); });
    nav("Calendar");
    const audience = await screen.findByLabelText("Filter by audience");
    expect(within(audience).getByRole("option", { name: "Fresh Choir" })).toBeInTheDocument();
    expect(within(audience).queryByRole("option", { name: "Stale Choir" })).not.toBeInTheDocument();
  });

  it("the member directory: an older answer arriving last does not replace the newer one", async () => {
    const olderReload = deferred();
    fake.from("profiles", "select")
      .replyOnce(ok([member("u-me", "Asha Rao")]))
      .replyOnce(olderReload.reply)
      .reply(ok([member("u-me", "Asha Rao"), member("u-5", "Newest Member")]));
    openPortal({ page: "members" });
    await screen.findByRole("heading", { level: 1, name: "Member roster" });
    await screen.findByText("Asha Rao", { selector: "h3, b, strong, span, p" }).catch(() => undefined);
    const saveProfile = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" }));
      fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
    };
    await saveProfile();
    await waitFor(() => expect(fake.from("profiles", "select").count).toBe(2));
    await saveProfile();
    expect(await screen.findByText("Newest Member")).toBeInTheDocument();
    await act(async () => { olderReload.resolve(ok([member("u-me", "Asha Rao"), member("u-6", "Old Snapshot")])); });
    expect(screen.queryByText("Old Snapshot")).not.toBeInTheDocument();
  });
});

describe("a list that failed to reload keeps what it shows (and says so)", () => {
  const rehearsal = { id: 1, title: "Rehearsal moved to Friday", body: "Room 104", is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id: null };

  async function reloadOverview() {
    await screen.findByText(/Welcome back/);
    fireEvent.click(home());
  }

  it("the dashboard: announcements, events and the resource count stay when their reload fails", async () => {
    fake.from("announcements", "select").reply(fail("canceling statement due to statement timeout"));
    fake.from("events", "select").reply(fail("canceling statement due to statement timeout"));
    fake.from("resources", "select").reply(fail("canceling statement due to statement timeout"));
    fake.from("archive_items", "select").reply(fail("canceling statement due to statement timeout"));
    openPortal({ boot: { announcements: [rehearsal], events: [concert(3, "Diwali concert")], resource_count: 5 } });
    expect((await screen.findAllByText("Rehearsal moved to Friday")).length).toBeGreaterThan(0);
    expect(screen.getByText("5 available resources")).toBeInTheDocument();
    await reloadOverview();
    // Four lists failed; the toast shows the latest, as an alert.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/));
    // Still there: a failed reload is not an empty list.
    expect(screen.getAllByText("Rehearsal moved to Friday").length).toBeGreaterThan(0);
    expect(screen.getByText("Diwali concert")).toBeInTheDocument();
    expect(screen.getByText("5 available resources")).toBeInTheDocument();
    expect(fake.from("announcements", "select").count).toBe(1);
  });

  it("the dashboard: a reload that succeeds does replace them, and the resource count comes from the head count", async () => {
    fake.from("announcements", "select").reply(ok([{ ...rehearsal, id: 9, title: "Newer announcement" }]));
    fake.from("events", "select").reply(ok([concert(4, "Spring showcase")]));
    fake.from("archive_items", "select").reply(ok([]));
    fake.from("resources", "select").reply(ok(null, { count: 8 }));
    openPortal({ boot: { announcements: [rehearsal], events: [], resource_count: 5 } });
    await reloadOverview();
    expect((await screen.findAllByText("Newer announcement")).length).toBeGreaterThan(0);
    expect(screen.getByText("Spring showcase")).toBeInTheDocument();
    expect(screen.getByText("8 available resources")).toBeInTheDocument();
    expect(screen.queryByText("Rehearsal moved to Friday")).not.toBeInTheDocument();
  });

  it("the club archive list the managers see stays when its reload fails", async () => {
    const item = { id: 11, title: "Founders' Day", description: "", type: "recording", storage_path: "u/f.mp3", visibility: "members", is_public: false, event_date: null, raga: null, tala: null, created_at: "2026-01-01T00:00:00Z", subgroup_id: null };
    fake.from("archive_items", "select").reply(fail("boom"));
    openPortal({ role: "executive", boot: { archive: [item] } });
    await reloadOverview();
    await waitFor(() => expect(fake.from("archive_items", "select").count).toBe(1));
    nav("Recordings");
    expect(await screen.findByText("Founders' Day")).toBeInTheDocument();
  });

  it("the member directory keeps its rows and offers Try again", async () => {
    fake.from("profiles", "select").replyOnce(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon")])).reply(fail("boom"));
    openPortal({ page: "members" });
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
    expect(await screen.findByText("The directory could not be refreshed, so it may be out of date.")).toBeInTheDocument();
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(screen.getByText("The member directory could not be loaded", { exact: false })).toBeInTheDocument();
  });

  it("the Admin lists keep their rows when a reload fails, and the toast is an error", async () => {
    fake.from("profiles", "select").replyOnce(ok([member("u-me", "Asha Rao", "admin"), member("u-2", "Bala Menon")])).reply(fail("boom"));
    fake.rpc("admin_change_member_role").reply(ok(null));
    openPortal({ role: "admin", page: "admin" });
    await screen.findByText("Bala Menon");
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "executive" } });
    await answerYes("Make executive");
    const toast = await screen.findByText("Some admin data could not be loaded", { exact: false });
    expect(toast.closest("[role]")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
  });

  it("the group lists keep their groups and updates when a reload fails", async () => {
    const group = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null };
    const update = { id: 1, title: "Bring your shruti box", body: "b", is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id: 7 };
    fake.from("subgroups", "select").reply(ok([group]));
    fake.from("announcements", "select").replyOnce(ok([update])).reply(fail("boom"));
    openPortal({ role: "executive", page: "groups", boot: { groups: [group] } });
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    expect(await screen.findByText("Bring your shruti box")).toBeInTheDocument();
    // Pinning an update reloads the group's lists afterwards (and announces the pin first).
    fireEvent.click(screen.getByRole("button", { name: "Pin Bring your shruti box" }));
    const toast = await screen.findByText("Some group information could not be loaded", { exact: false });
    expect(toast.closest("[role]")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Bring your shruti box")).toBeInTheDocument();
  });
});
