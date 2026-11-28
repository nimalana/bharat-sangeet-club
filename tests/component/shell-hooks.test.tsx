// The shell's hooks (features/shell/hooks), called directly: usePortalData and usePortalSession.
//
// shell-bootstrap, shell-races and shell-session drive them through the whole shell. This file reaches what a screen
// cannot: the exact sentences the shell toasts when a list does not load (and in which order), what a failed load keeps,
// what signing out forgets, and the guards of loadWorkspaces (which no page can call before the shell is ready).
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider, ToastViewport, useToast } from "../../components/ui/toast";
import { usePortalData } from "../../features/shell/hooks/use-portal-data";
import { usePortalSession } from "../../features/shell/hooks/use-portal-session";
import { deferred, fail, fake, ok, rejects, withCount } from "../support/fake-supabase";
import { bootstrapAnswer } from "../support/portal";

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}<ToastViewport /></ToastProvider>;
const toast = () => document.querySelector(".toast") as HTMLElement | null;
const group = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open" as const, archived_at: null };
const event = (id: number, title: string) => ({ id, title, description: "", starts_at: "2026-12-01T19:00:00Z", location: "", created_at: "2026-01-01T00:00:00Z", subgroup_id: null });

/** Everything the shell holds, the way the Portal composes it. */
function useShell() {
  const { notify } = useToast();
  const data = usePortalData(notify);
  const session = usePortalSession(data, notify);
  return { data, session };
}

/** What the data hook told the person, in order. `notify` is one stable function, as the toast context's is. */
const told: string[] = [];
const notify = (message: string) => { told.push(message); };
beforeEach(() => { told.length = 0; });

describe("usePortalData: loadData", () => {
  const useData = () => ({ data: usePortalData(notify) });

  it("fills the four lists, and the resource count comes from the head count", async () => {
    fake.from("archive_items", "select").reply(ok([{ id: 1, title: "Founders' Day", type: "recording" }]));
    fake.from("events", "select").reply(ok([event(1, "Picnic")]));
    fake.from("announcements", "select").reply(ok([{ id: 1, title: "Welcome" }]));
    fake.from("resources", "select").reply(withCount(12));
    const { result } = renderHook(useData, { wrapper });
    await act(async () => { await result.current.data.loadData(); });
    expect(result.current.data.archive).toHaveLength(1);
    expect(result.current.data.events.map((item) => item.title)).toEqual(["Picnic"]);
    expect(result.current.data.announcements).toHaveLength(1);
    expect(result.current.data.resourceCount).toBe(12);
    expect(result.current.data.dataLoading).toBe(false);
    expect(told).toEqual([]);
  });

  it("says which list failed, in this order, and keeps what each failed list showed", async () => {
    const { result } = renderHook(useData, { wrapper });
    await act(async () => { await result.current.data.loadData(); });
    fake.from("archive_items", "select").reply(ok([{ id: 1, title: "A", type: "recording" }]));
    fake.from("events", "select").reply(ok([event(1, "Picnic")]));
    fake.from("announcements", "select").reply(ok([{ id: 1, title: "Welcome" }]));
    fake.from("resources", "select").reply(withCount(5));
    await act(async () => { await result.current.data.loadData(); });
    expect(result.current.data.resourceCount).toBe(5);

    told.length = 0;
    fake.from("archive_items", "select").reply(fail("a"));
    fake.from("events", "select").reply(fail("b"));
    fake.from("announcements", "select").reply(fail("c"));
    fake.from("resources", "select").reply(fail("d"));
    await act(async () => { await result.current.data.loadData(); });
    expect(told).toEqual([
      "The club archive could not be loaded", "The calendar could not be loaded", "Announcements could not be loaded", "The resource count could not be loaded",
    ]);
    expect(result.current.data.archive).toHaveLength(1);
    expect(result.current.data.events).toHaveLength(1);
    expect(result.current.data.announcements).toHaveLength(1);
    expect(result.current.data.resourceCount).toBe(5);
    expect(result.current.data.dataLoading).toBe(false);
  });

  it("a request that is rejected (not answered) says the club data could not be loaded, and ends the loading state", async () => {
    fake.from("events", "select").reply(rejects());
    const { result } = renderHook(useData, { wrapper });
    await act(async () => { await result.current.data.loadData(); });
    expect(told).toEqual(["The club data could not be loaded. Check your connection and try again."]);
    expect(result.current.data.dataLoading).toBe(false);
  });

  it("is loading while the answer is on its way", async () => {
    const slow = deferred();
    fake.from("events", "select").reply(slow.reply);
    const { result } = renderHook(useData, { wrapper });
    let done!: Promise<void>;
    act(() => { done = result.current.data.loadData(); });
    expect(result.current.data.dataLoading).toBe(true);
    await act(async () => { slow.resolve(ok([])); await done; });
    expect(result.current.data.dataLoading).toBe(false);
  });

  it("of two loads, stays loading until the newest ends, and only the newest one's failure is told", async () => {
    const older = deferred();
    const newer = deferred();
    fake.from("events", "select").replyOnce(older.reply).replyOnce(newer.reply);
    const { result } = renderHook(useData, { wrapper });
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.data.loadData(); });
    act(() => { second = result.current.data.loadData(); });
    // The older load fails first: nobody is told, and the page is still waiting for the newer one.
    await act(async () => { older.reject(new TypeError("Failed to fetch")); await first; });
    expect(told).toEqual([]);
    expect(result.current.data.dataLoading).toBe(true);
    await act(async () => { newer.resolve(ok([event(2, "Newer")])); await second; });
    expect(result.current.data.dataLoading).toBe(false);
    expect(result.current.data.events.map((item) => item.title)).toEqual(["Newer"]);
  });

  it("asks nothing of the database after the account changed under it, and drops the answer", async () => {
    const slow = deferred();
    fake.from("events", "select").reply(slow.reply);
    const { result } = renderHook(useData, { wrapper });
    act(() => { result.current.data.switchAccount("u-a"); });
    let done!: Promise<void>;
    act(() => { done = result.current.data.loadData(); });
    act(() => { result.current.data.switchAccount("u-b"); });
    await act(async () => { slow.resolve(ok([event(1, "Asha's rehearsal")])); await done; });
    expect(result.current.data.events).toEqual([]);
    expect(told).toEqual([]);
  });
});

describe("usePortalData: reloadWorkspaces", () => {
  it("replaces the groups and memberships, and keeps them when either read fails, saying so", async () => {
    const membership = { subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" };
    const useData = () => ({ data: usePortalData(notify) });
    const { result } = renderHook(useData, { wrapper });
    act(() => { result.current.data.switchAccount("u-me"); });
    fake.from("subgroups", "select").reply(ok([group]));
    fake.from("subgroup_memberships", "select").reply(ok([membership]));
    await act(async () => { await result.current.data.reloadWorkspaces("u-me"); });
    expect(result.current.data.groups).toEqual([group]);
    expect(result.current.data.memberships).toEqual([membership]);

    fake.from("subgroups", "select").reply(ok([]));
    fake.from("subgroup_memberships", "select").reply(fail("boom"));
    await act(async () => { await result.current.data.reloadWorkspaces("u-me"); });
    expect(told).toEqual(["Your groups could not be loaded"]);
    expect(result.current.data.groups).toEqual([group]);
    expect(result.current.data.memberships).toEqual([membership]);
  });

  it("drops an answer for an account that is no longer the signed-in one", async () => {
    const useData = () => usePortalData(notify);
    const { result } = renderHook(useData, { wrapper });
    act(() => { result.current.switchAccount("u-a"); });
    const slow = deferred();
    fake.from("subgroups", "select").reply(slow.reply);
    let done!: Promise<void>;
    act(() => { done = result.current.reloadWorkspaces("u-a"); });
    act(() => { result.current.switchAccount("u-b"); });
    await act(async () => { slow.resolve(ok([group])); await done; });
    expect(result.current.groups).toEqual([]);
  });
});

describe("usePortalData: adoptBootstrap and clear", () => {
  it("takes every list out of the bootstrap answer, a resource count that is not a number becoming 0, and clear forgets them all", () => {
    const { result } = renderHook(() => usePortalData(() => {}), { wrapper });
    act(() => {
      result.current.adoptBootstrap({ groups: [group], memberships: [{ subgroup_id: 7, member_id: "u", status: "active", membership_role: "member" }], announcements: [{ id: 1, title: "t", body: "b", is_pinned: false, published_at: "2026-01-01T00:00:00Z", subgroup_id: null }], events: [event(1, "Picnic")], archive: [], resource_count: "12" as unknown as number });
    });
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.memberships).toHaveLength(1);
    expect(result.current.announcements).toHaveLength(1);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.resourceCount).toBe(12);
    act(() => { result.current.adoptBootstrap({ groups: [], memberships: [], announcements: [], events: [], archive: [], resource_count: undefined as unknown as number }); });
    expect(result.current.resourceCount).toBe(0);
    act(() => { result.current.adoptBootstrap({ groups: [group], memberships: [], announcements: [], events: [event(1, "Picnic")], archive: [], resource_count: 3 }); result.current.setDataLoading(true); });
    act(() => { result.current.clear(); });
    expect(result.current).toMatchObject({ groups: [], memberships: [], announcements: [], events: [], archive: [], resourceCount: 0, dataLoading: false });
  });
});

describe("usePortalSession", () => {
  const session = (id: string) => ({ access_token: "t", user: { id, email: `${id}@x.test`, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } });
  const ready = (role: "member" | "executive" | "admin" = "member", name = "Asha Rao", over: Record<string, unknown> = {}) => {
    fake.signIn({ id: "u-me", email: "u-me@x.test" });
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer(role, name, over)));
  };

  it("goes from loading to ready, with the profile's role and name and the lists of the bootstrap", async () => {
    ready("executive", "Asha Rao", { groups: [group], resource_count: 4 });
    const { result } = renderHook(useShell, { wrapper });
    expect(result.current.session.shellState).toBe("loading");
    expect(result.current.session.authLoading).toBe(true);
    await waitFor(() => expect(result.current.session.shellState).toBe("ready"));
    expect(result.current.session).toMatchObject({ authLoading: false, role: "executive", name: "Asha Rao" });
    expect(result.current.session.user?.id).toBe("u-me");
    expect(result.current.data.groups).toEqual([group]);
    expect(result.current.data.resourceCount).toBe(4);
    expect(result.current.data.dataLoading).toBe(false);
  });

  it("is failed when the answer is an error, deactivated when the profile says so, and Try again asks once more", async () => {
    fake.signIn({ id: "u-me" });
    fake.rpc("get_portal_bootstrap").replyOnce(fail("Failed to fetch")).replyOnce(ok({ profile: { full_name: "Old", role: "admin", status: "deactivated" } }));
    const { result } = renderHook(useShell, { wrapper });
    await waitFor(() => expect(result.current.session.shellState).toBe("failed"));
    expect(result.current.session.role).toBe("member");
    act(() => { result.current.session.retry(); });
    expect(result.current.session.shellState).toBe("loading");
    await waitFor(() => expect(result.current.session.shellState).toBe("deactivated"));
    expect(fake.rpc("get_portal_bootstrap").count).toBe(2);
  });

  it("retry with nobody signed in asks for nothing", async () => {
    fake.auth("getSession").reply(ok({ session: null }));
    const { result } = renderHook(useShell, { wrapper });
    await waitFor(() => expect(result.current.session.authLoading).toBe(false));
    act(() => { result.current.session.retry(); });
    expect(fake.rpc("get_portal_bootstrap").count).toBe(0);
  });

  it("signing out forgets the account: the role, the name and every list, and waits for the next bootstrap", async () => {
    ready("admin", "Asha Rao", { groups: [group], events: [event(1, "Picnic")], resource_count: 9 });
    const { result } = renderHook(useShell, { wrapper });
    await waitFor(() => expect(result.current.session.shellState).toBe("ready"));
    await act(async () => { fake.emitAuth("SIGNED_OUT", null); });
    expect(result.current.session).toMatchObject({ user: null, role: "member", name: "", shellState: "loading" });
    expect(result.current.data).toMatchObject({ groups: [], events: [], resourceCount: 0, dataLoading: false });
    await act(async () => { fake.emitAuth("SIGNED_IN", session("u-b")); });
    expect(result.current.session.user?.id).toBe("u-b");
  });

  it("a token refresh (the same account, a new user object) keeps the very same user", async () => {
    ready();
    const { result } = renderHook(useShell, { wrapper });
    await waitFor(() => expect(result.current.session.shellState).toBe("ready"));
    const before = result.current.session.user;
    await act(async () => { fake.emitAuth("TOKEN_REFRESHED", session("u-me")); });
    expect(result.current.session.user).toBe(before);
    expect(fake.rpc("get_portal_bootstrap").count).toBe(1);
  });

  describe("loadWorkspaces", () => {
    it("reads nothing until the shell is ready", async () => {
      fake.signIn({ id: "u-me" });
      fake.rpc("get_portal_bootstrap").reply(deferred().reply);
      const { result } = renderHook(useShell, { wrapper });
      await waitFor(() => expect(result.current.session.user?.id).toBe("u-me"));
      await act(async () => { await result.current.session.loadWorkspaces(); });
      expect(fake.from("subgroups").calls).toHaveLength(0);
      expect(fake.from("subgroup_memberships").calls).toHaveLength(0);
    });

    it("reads nothing when nobody is signed in", async () => {
      fake.auth("getSession").reply(ok({ session: null }));
      const { result } = renderHook(useShell, { wrapper });
      await waitFor(() => expect(result.current.session.authLoading).toBe(false));
      await act(async () => { await result.current.session.loadWorkspaces(); });
      expect(fake.calls.filter((call) => call.kind === "from")).toHaveLength(0);
    });

    it("once ready, reads the groups that are not archived and this person's own memberships, and keeps them in the shell", async () => {
      ready();
      const membership = { subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" };
      fake.from("subgroups", "select").reply(ok([group]));
      fake.from("subgroup_memberships", "select").reply(ok([membership]));
      const { result } = renderHook(useShell, { wrapper });
      await waitFor(() => expect(result.current.session.shellState).toBe("ready"));
      await act(async () => { await result.current.session.loadWorkspaces(); });
      expect(fake.from("subgroups", "select").calls[0].used("is", "archived_at", null)).toBe(true);
      expect(fake.from("subgroup_memberships", "select").calls[0].used("eq", "member_id", "u-me")).toBe(true);
      expect(result.current.data.groups).toEqual([group]);
      expect(result.current.data.memberships).toEqual([membership]);
    });
  });

  describe("signOutQuietly", () => {
    it("signs out", async () => {
      ready();
      const { result } = renderHook(useShell, { wrapper });
      await waitFor(() => expect(result.current.session.shellState).toBe("ready"));
      act(() => { result.current.session.signOutQuietly(); });
      expect(fake.auth("signOut").count).toBe(1);
    });

    it("says nothing when the sign-out fails", async () => {
      ready();
      fake.auth("signOut").reply(fail("Network request failed"));
      const { result } = renderHook(useShell, { wrapper });
      await waitFor(() => expect(result.current.session.shellState).toBe("ready"));
      await act(async () => { result.current.session.signOutQuietly(); });
      expect(fake.auth("signOut").count).toBe(1);
      expect(toast()).toBeNull();
      expect(result.current.session.shellState).toBe("ready");
    });
  });
});
