// The hooks that hold the data of the group, admin and member screens: use-group-spaces (the Groups page's five reads),
// use-admin-data (the Admin page's four), use-group-roster (one group's people) and use-member-directory (the Members page).
// What each promises: loading until the first answer, every list from its own read, a list that fails keeps what it had (and says so
// once), only the newest answer counts, and a reload never starts by itself.
import type { User } from "@supabase/supabase-js";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAdminData } from "../../features/admin/hooks/use-admin-data";
import { countRequestsByGroup, useGroupSpaces } from "../../features/groups/hooks/use-group-spaces";
import { useGroupRoster } from "../../features/groups/hooks/use-group-roster";
import { useMemberDirectory } from "../../features/members/hooks/use-member-directory";
import { setCacheOwner } from "../../lib/cache";
import type { SubgroupMembership } from "../../lib/db";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { notifySpy, userOf } from "../support/helpers";

// A hook that notifies reads useToast(); with no provider around a bare hook, the spy answers (and a test that reads the toasts makes its own).
beforeEach(() => { notifySpy(); });

const ME = userOf("u-me");
const group = (id: number, name: string) => ({ id, name, description: "", enrollment_mode: "open", archived_at: null });
const mine = (subgroup_id: number) => ({ subgroup_id, member_id: "u-me", status: "active", membership_role: "member" }) as SubgroupMembership;
const announcement = (id: number, title: string) => ({ id, title, body: "", is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id: 7 });
const recording = (id: number) => ({ id, title: `Take ${id}`, description: "", type: "recording", storage_path: "x", visibility: "members", is_public: false, event_date: null, raga: null, tala: null, created_at: "2026-10-01T00:00:00Z", subgroup_id: 7 });

describe("countRequestsByGroup", () => {
  it("counts the rows of each group, and has no entry for a group with none", () => {
    expect(countRequestsByGroup([{ subgroup_id: 7 }, { subgroup_id: 7 }, { subgroup_id: 8 }])).toEqual({ 7: 2, 8: 1 });
    expect(countRequestsByGroup([])).toEqual({});
  });
});

describe("useGroupSpaces", () => {
  function scriptGroups() {
    fake.from("subgroups", "select").reply(ok([group(7, "Vocal")]));
    fake.from("subgroup_memberships", "select").reply((call) => ok(call.used("in", "status") ? [{ subgroup_id: 7 }, { subgroup_id: 7 }] : [mine(7)]));
    fake.from("archive_items", "select").reply(ok([recording(1)]));
    fake.from("announcements", "select").reply(ok([announcement(1, "First")]));
  }

  it("is loading until the five reads have answered, then has every list and the request counts", async () => {
    const slow = deferred();
    scriptGroups();
    fake.from("announcements", "select").reply(slow.reply);
    const { result } = renderHook(() => useGroupSpaces(ME));
    expect(result.current.loading).toBe(true);
    expect(result.current.groups).toEqual([]);
    await waitFor(() => expect(fake.from("announcements", "select").count).toBe(1));
    expect(result.current.loading).toBe(true);
    await act(async () => { slow.resolve(ok([announcement(1, "First")])); });
    expect(result.current.loading).toBe(false);
    expect(result.current.groups).toEqual([group(7, "Vocal")]);
    expect(result.current.memberships).toEqual([mine(7)]);
    expect(result.current.items).toEqual([recording(1)]);
    expect(result.current.announcements).toEqual([announcement(1, "First")]);
    expect(result.current.requestCounts).toEqual({ 7: 2 });
  });

  it("reads the five lists once and not again by itself", async () => {
    scriptGroups();
    const { result, rerender } = renderHook(() => useGroupSpaces(ME));
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    rerender();
    expect(fake.calls).toHaveLength(5);
  });

  it("a list that fails on a reload keeps what it had, the others update, and one toast says so", async () => {
    const notify = notifySpy();
    scriptGroups();
    const { result } = renderHook(() => useGroupSpaces(ME));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fake.from("subgroups", "select").reply(ok([group(7, "Vocal"), group(8, "Violin")]));
    fake.from("announcements", "select").reply(fail("boom"));
    fake.from("archive_items", "select").reply(fail("boom"));
    await act(async () => { await result.current.load(); });
    expect(result.current.groups).toHaveLength(2);
    expect(result.current.announcements).toEqual([announcement(1, "First")]);
    expect(result.current.items).toEqual([recording(1)]);
    expect(notify.toasts()).toEqual([{ message: "Some group information could not be loaded", tone: "error" }]);
  });

  it("the waiting-request counts are kept when their read fails, and that failure alone does not toast", async () => {
    const notify = notifySpy();
    scriptGroups();
    const { result } = renderHook(() => useGroupSpaces(ME));
    await waitFor(() => expect(result.current.requestCounts).toEqual({ 7: 2 }));
    fake.from("subgroup_memberships", "select").reply((call) => (call.used("in", "status") ? fail("boom") : ok([mine(7)])));
    await act(async () => { await result.current.load(); });
    expect(result.current.requestCounts).toEqual({ 7: 2 });
    expect(notify.toasts()).toEqual([]);
  });

  it("of two overlapping reloads, the older answer arriving last is dropped", async () => {
    scriptGroups();
    const { result } = renderHook(() => useGroupSpaces(ME));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const older = deferred();
    fake.from("announcements", "select").replyOnce(older.reply).reply(ok([announcement(2, "Newest")]));
    let first!: Promise<void>;
    act(() => { first = result.current.load(); });
    await act(async () => { await result.current.load(); });
    expect(result.current.announcements).toEqual([announcement(2, "Newest")]);
    await act(async () => { older.resolve(ok([announcement(3, "Stale")])); await first; });
    expect(result.current.announcements).toEqual([announcement(2, "Newest")]);
  });

  it("a person who joins is added to the memberships at once (setMemberships), without a read", async () => {
    scriptGroups();
    const { result } = renderHook(() => useGroupSpaces(ME));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setMemberships((current) => [...current, mine(9)]); });
    expect(result.current.memberships).toEqual([mine(7), mine(9)]);
    expect(fake.calls).toHaveLength(5);
  });

  it("`load` is the same function on every render, so an effect that lists it does not read again", async () => {
    scriptGroups();
    const { result, rerender } = renderHook(() => useGroupSpaces(ME));
    const first = result.current.load;
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    expect(result.current.load).toBe(first);
  });
});

describe("useAdminData", () => {
  const member = (id: string, name: string) => ({ id, full_name: name, email: `${id}@x.test`, role: "member", status: "active", phone: "", class_year: "", specialty: "", joined_at: "2025-08-01" });
  const entry = (id: number) => ({ id, action: "role_changed", actor_email: "a@x.test", target_email: "b@x.test", details: {}, created_at: "2026-10-01T00:00:00Z" });
  function scriptAdmin() {
    fake.from("profiles", "select").reply(ok([member("u-1", "Asha")]));
    fake.from("announcements", "select").reply(ok([announcement(1, "First")]));
    fake.from("admin_audit_log", "select").reply(ok([entry(1)]));
    fake.from("subgroup_memberships", "select").reply(ok([mine(7)]));
  }

  it("is loading until the four reads have answered, then has every list", async () => {
    scriptAdmin();
    const { result } = renderHook(() => useAdminData());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toEqual([member("u-1", "Asha")]);
    expect(result.current.announcements).toEqual([announcement(1, "First")]);
    expect(result.current.audit).toEqual([entry(1)]);
    expect(result.current.memberships).toEqual([mine(7)]);
    expect(fake.calls).toHaveLength(4);
  });

  it("a list that fails keeps what it had, the others update, and one toast says so", async () => {
    const notify = notifySpy();
    scriptAdmin();
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fake.from("profiles", "select").reply(fail("boom"));
    fake.from("admin_audit_log", "select").reply(ok([entry(1), entry(2)]));
    await act(async () => { await result.current.load(); });
    expect(result.current.members).toEqual([member("u-1", "Asha")]);
    expect(result.current.audit).toHaveLength(2);
    expect(notify.toasts()).toEqual([{ message: "Some admin data could not be loaded", tone: "error" }]);
  });

  it("when the first read fails there is nothing to keep: the lists are empty, loading ends, and one toast says so", async () => {
    const notify = notifySpy();
    scriptAdmin();
    fake.from("subgroup_memberships", "select").reply(fail("boom"));
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.memberships).toEqual([]);
    expect(result.current.members).toHaveLength(1);
    expect(notify.toasts()).toHaveLength(1);
  });

  it("of two overlapping reloads, the older answer arriving last is dropped", async () => {
    scriptAdmin();
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const older = deferred();
    fake.from("profiles", "select").replyOnce(older.reply).reply(ok([member("u-9", "Newest")]));
    let first!: Promise<void>;
    act(() => { first = result.current.load(); });
    await act(async () => { await result.current.load(); });
    await act(async () => { older.resolve(ok([member("u-8", "Stale")])); await first; });
    expect(result.current.members).toEqual([member("u-9", "Newest")]);
  });
});

describe("useGroupRoster", () => {
  const row = (id: string, status = "active") => ({ member_id: id, full_name: id, email: `${id}@x.test`, status, membership_role: "member", joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" });

  it("reads the roster of the group it is given, and is loading until then", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([row("u-1"), row("u-2", "pending")]));
    const { result } = renderHook(() => useGroupRoster(7));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.roster.map((entry) => entry.member_id)).toEqual(["u-1", "u-2"]);
    expect(result.current.loadError).toBe("");
    expect(fake.rpc("list_subgroup_roster").calls[0].payload).toEqual({ p_subgroup_id: 7 });
  });

  it("a failed read says so in the person's words and keeps the roster that was shown", async () => {
    fake.rpc("list_subgroup_roster").replyOnce(ok([row("u-1")])).reply(fail("Network is down"));
    const { result } = renderHook(() => useGroupRoster(7));
    await waitFor(() => expect(result.current.roster).toHaveLength(1));
    await act(async () => { await result.current.loadRoster(); });
    expect(result.current.loadError).toBe("Network is down");
    expect(result.current.roster).toHaveLength(1);
  });

  it("a database error with no words of its own gets the fallback sentence", async () => {
    fake.rpc("list_subgroup_roster").reply(fail('relation "x" does not exist', "42P01"));
    const { result } = renderHook(() => useGroupRoster(7));
    await waitFor(() => expect(result.current.loadError).toBe("The roster could not be loaded."));
    expect(result.current.loading).toBe(false);
  });

  it("a good read after a failure clears the message", async () => {
    fake.rpc("list_subgroup_roster").replyOnce(fail("boom")).reply(ok([row("u-1")]));
    const { result } = renderHook(() => useGroupRoster(7));
    await waitFor(() => expect(result.current.loadError).not.toBe(""));
    await act(async () => { await result.current.loadRoster(); });
    expect(result.current.loadError).toBe("");
    expect(result.current.roster).toHaveLength(1);
  });

  it("retry shows the loading line again and reads once more", async () => {
    const slow = deferred();
    fake.rpc("list_subgroup_roster").replyOnce(fail("boom")).replyOnce(slow.reply);
    const { result } = renderHook(() => useGroupRoster(7));
    await waitFor(() => expect(result.current.loadError).not.toBe(""));
    expect(result.current.loading).toBe(false);
    act(() => { result.current.retry(); });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(fake.rpc("list_subgroup_roster").count).toBe(2));
    await act(async () => { slow.resolve(ok([row("u-1")])); });
    expect(result.current.loading).toBe(false);
    expect(result.current.roster).toHaveLength(1);
  });

  it("of two overlapping reads, the older answer arriving last is dropped", async () => {
    fake.rpc("list_subgroup_roster").replyOnce(ok([]));
    const { result } = renderHook(() => useGroupRoster(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const older = deferred();
    fake.rpc("list_subgroup_roster").replyOnce(older.reply).reply(ok([row("u-new")]));
    let first!: Promise<void>;
    act(() => { first = result.current.loadRoster(); });
    await act(async () => { await result.current.loadRoster(); });
    await act(async () => { older.resolve(ok([row("u-stale")])); await first; });
    expect(result.current.roster.map((entry) => entry.member_id)).toEqual(["u-new"]);
  });

  it("another group is another read", async () => {
    fake.rpc("list_subgroup_roster").reply((call) => ok([row(`of-${(call.payload as { p_subgroup_id: number }).p_subgroup_id}`)]));
    const { result, rerender } = renderHook(({ id }) => useGroupRoster(id), { initialProps: { id: 7 } });
    await waitFor(() => expect(result.current.roster.map((entry) => entry.member_id)).toEqual(["of-7"]));
    rerender({ id: 8 });
    await waitFor(() => expect(result.current.roster.map((entry) => entry.member_id)).toEqual(["of-8"]));
  });
});

describe("useMemberDirectory", () => {
  const member = (id: string, name: string) => ({ id, full_name: name, email: `${id}@x.test`, role: "member", phone: "", class_year: "", specialty: "", joined_at: "2025-08-01" });
  const as = (user: User) => renderHook(() => useMemberDirectory(user));

  it("has empty lists and is loading until the first read, then has the three lists", async () => {
    setCacheOwner("u-me");
    fake.from("profiles", "select").reply(ok([member("u-1", "Asha")]));
    fake.from("subgroups", "select").reply(ok([group(7, "Vocal")]));
    fake.from("subgroup_memberships", "select").reply(ok([mine(7)]));
    const { result } = as(ME);
    expect(result.current).toMatchObject({ members: [], groups: [], memberships: [], loading: true, failed: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toEqual([member("u-1", "Asha")]);
    expect(result.current.groups).toEqual([group(7, "Vocal")]);
    expect(result.current.memberships).toEqual([mine(7)]);
  });

  it("a second visit has the last directory at once, and the read behind it replaces it", async () => {
    setCacheOwner("u-me");
    fake.from("profiles", "select").replyOnce(ok([member("u-1", "Asha")])).reply(ok([member("u-1", "Asha"), member("u-2", "Bala")]));
    const first = as(ME);
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = as(ME);
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.members).toHaveLength(1);
    await waitFor(() => expect(second.result.current.members).toHaveLength(2));
  });

  it("a failed read is `failed`, with one toast, and a failed refresh keeps the members", async () => {
    const notify = notifySpy();
    setCacheOwner("u-me");
    fake.from("profiles", "select").replyOnce(ok([member("u-1", "Asha")])).reply(fail("boom"));
    const { result } = as(ME);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(false);
    await act(async () => { await result.current.reload(); });
    expect(result.current.failed).toBe(true);
    expect(result.current.members).toHaveLength(1);
    expect(notify.toasts()).toEqual([{ message: "The member directory could not be loaded", tone: undefined }]);
  });
});
