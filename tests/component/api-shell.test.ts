// The shell's data layer: lib/api/auth.ts, lib/api/portal.ts, lib/api/events.ts.
//
// Each function must send exactly the request the shell and the calendar used to send inline (table, operation, the chain
// of filters, the payload), in the order they used to send them, and say what it found the way they consumed it. Written
// against the fake client; the chain is compared as a whole so that a dropped filter or a changed column is a failure.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser, hasSavedSession, isSupabaseConfigured, onAuthChange, signOut } from "../../lib/api/auth";
import { createEvent, deleteEvent, updateEvent, upcomingEventsQuery } from "../../lib/api/events";
import { getPortalBootstrap, loadPortalLists, loadWorkspaceLists, updateOwnFullName } from "../../lib/api/portal";
import { ApiError } from "../../lib/errors";
import { fail, fake, ok, rejects, withCount } from "../support/fake-supabase";

/** The chain a call used, as [method, ...arguments] rows. */
const chainOf = (call: { chain: { method: string; args: unknown[] }[] }) => call.chain.map((link) => [link.method, ...link.args]);

const fields = { title: "Open mic", description: "Bring a song", starts_at: "2026-12-01T19:00:00.000Z", location: "Hill Hall", subgroup_id: 7 };

describe("lib/api/auth", () => {
  it("knows the project is configured when there is a client", () => {
    expect(isSupabaseConfigured()).toBe(true);
  });

  describe("getSessionUser", () => {
    it("asks the client for the session and returns its user", async () => {
      fake.signIn({ id: "u-me", email: "me@x.test" });
      const user = await getSessionUser();
      expect(user?.id).toBe("u-me");
      expect(fake.callsTo("auth").map((call) => call.op)).toEqual(["getSession"]);
    });

    it("returns null when nobody is signed in", async () => {
      fake.auth("getSession").reply(ok({ session: null }));
      expect(await getSessionUser()).toBeNull();
    });

    it("throws an ApiError when the client cannot read the session", async () => {
      fake.auth("getSession").reply(fail("Auth session missing", "session_not_found"));
      const error = await getSessionUser().catch((caught) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ message: "Auth session missing", code: "session_not_found" });
    });

    it("lets a request that is never answered, only rejected, reject", async () => {
      fake.auth("getSession").reply(rejects());
      await expect(getSessionUser()).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("onAuthChange", () => {
    const session = (id: string) => ({ access_token: "t", user: { id, email: `${id}@x.test` } });

    it("hands the listener the user of every sign-in, token refresh and sign-out, and nothing else", () => {
      const heard: Array<string | null> = [];
      onAuthChange((user) => heard.push(user?.id ?? null));
      expect(fake.authSubscribers).toBe(1);
      fake.emitAuth("SIGNED_IN", session("u-a"));
      fake.emitAuth("TOKEN_REFRESHED", session("u-a"));
      fake.emitAuth("SIGNED_OUT", null);
      expect(heard).toEqual(["u-a", "u-a", null]);
    });

    it("the function it returns stops the listening", () => {
      const heard: unknown[] = [];
      const stop = onAuthChange((user) => heard.push(user));
      stop();
      expect(fake.authSubscribers).toBe(0);
      fake.emitAuth("SIGNED_IN", session("u-a"));
      expect(heard).toEqual([]);
    });
  });

  describe("signOut", () => {
    it("signs this browser out", async () => {
      await signOut();
      expect(fake.callsTo("auth").map((call) => call.op)).toEqual(["signOut"]);
    });

    it("throws an ApiError when the client refuses", async () => {
      fake.auth("signOut").reply(fail("Network request failed"));
      await expect(signOut()).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("hasSavedSession", () => {
    beforeEach(() => window.localStorage.clear());

    it("is true only for the key the Supabase client saves a sign-in under", () => {
      expect(hasSavedSession()).toBe(false);
      window.localStorage.setItem("sb-abcdef-auth-token-code-verifier", "x");
      window.localStorage.setItem("theme", "dark");
      expect(hasSavedSession()).toBe(false);
      window.localStorage.setItem("sb-abcdef-auth-token", "{}");
      expect(hasSavedSession()).toBe(true);
    });

    it("is false, not an error, when the browser refuses to read its storage", () => {
      vi.spyOn(Object, "keys").mockImplementation(() => { throw new Error("denied"); });
      expect(hasSavedSession()).toBe(false);
    });
  });
});

describe("lib/api/portal", () => {
  it("getPortalBootstrap calls get_portal_bootstrap with no arguments and returns the answer untouched", async () => {
    fake.rpc("get_portal_bootstrap").reply(ok({ profile: { role: "member" } }));
    const answer = await getPortalBootstrap();
    expect(fake.rpc("get_portal_bootstrap").calls).toHaveLength(1);
    expect(fake.rpc("get_portal_bootstrap").calls[0].args).toEqual([{}]);
    expect(answer).toMatchObject({ data: { profile: { role: "member" } }, error: null });
  });

  it("getPortalBootstrap returns a failed answer as it came: the shell judges it (lib/bootstrap.ts)", async () => {
    fake.rpc("get_portal_bootstrap").reply(fail("Failed to fetch"));
    expect((await getPortalBootstrap()).error).toMatchObject({ message: "Failed to fetch" });
  });

  describe("loadPortalLists", () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-28T12:00:00.000Z")); });

    it("sends the four reads of the shell, in this order, each with the filters it always had", async () => {
      await loadPortalLists();
      expect(fake.calls.map((call) => `${call.kind}:${call.target}:${call.op}`)).toEqual([
        "from:archive_items:select", "from:events:select", "from:announcements:select", "from:resources:select",
      ]);
      const [archive, events, announcements, resources] = fake.calls;
      expect(chainOf(archive)).toEqual([["select", "*"], ["eq", "type", "recording"], ["order", "created_at", { ascending: false }]]);
      expect(chainOf(events)).toEqual([["select", "*"], ["gte", "starts_at", "2025-11-28T12:00:00.000Z"], ["order", "starts_at", { ascending: true }]]);
      expect(chainOf(announcements)).toEqual([["select", "*"], ["order", "is_pinned", { ascending: false }], ["order", "published_at", { ascending: false }], ["limit", 12]]);
      expect(chainOf(resources)).toEqual([["select", "id", { count: "exact", head: true }], ["neq", "status", "archived"]]);
    });

    it("hands back each answer separately, so one list failing does not hide the others", async () => {
      fake.from("archive_items").reply(ok([{ id: 1 }]));
      fake.from("events").reply(fail("boom"));
      fake.from("announcements").reply(ok([{ id: 2 }]));
      fake.from("resources").reply(withCount(5));
      const lists = await loadPortalLists();
      expect(lists.archive.data).toEqual([{ id: 1 }]);
      expect(lists.events.error).toMatchObject({ message: "boom" });
      expect(lists.announcements.data).toEqual([{ id: 2 }]);
      expect(lists.resourceCount.count).toBe(5);
    });
  });

  it("loadWorkspaceLists reads the groups that are not archived and this person's memberships", async () => {
    const lists = await loadWorkspaceLists("u-me");
    expect(fake.calls.map((call) => `${call.target}:${call.op}`)).toEqual(["subgroups:select", "subgroup_memberships:select"]);
    expect(chainOf(fake.calls[0])).toEqual([["select", "id,name,description,enrollment_mode,archived_at"], ["is", "archived_at", null], ["order", "name"]]);
    expect(chainOf(fake.calls[1])).toEqual([["select", "subgroup_id,member_id,status,membership_role"], ["eq", "member_id", "u-me"]]);
    expect(lists.groups.error).toBeNull();
    expect(lists.memberships.error).toBeNull();
  });

  it("updateOwnFullName writes only the name, on the person's own row, and returns the answer", async () => {
    fake.from("profiles", "update").reply(fail("denied"));
    const answer = await updateOwnFullName("u-me", "Asha R.");
    const [call] = fake.from("profiles", "update").calls;
    expect(call.payload).toEqual({ full_name: "Asha R." });
    expect(chainOf(call)).toEqual([["update", { full_name: "Asha R." }], ["eq", "id", "u-me"]]);
    expect(answer.error).toMatchObject({ message: "denied" });
  });
});

describe("lib/api/events", () => {
  it("upcomingEventsQuery is the events read of the shell: from a year ago on, soonest first, and is not sent until awaited", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T12:00:00.000Z"));
    const query = upcomingEventsQuery();
    expect(fake.calls).toHaveLength(0);
    await query;
    expect(chainOf(fake.calls[0])).toEqual([["select", "*"], ["gte", "starts_at", "2025-11-28T12:00:00.000Z"], ["order", "starts_at", { ascending: true }]]);
  });

  it("createEvent inserts the fields with the person who added it, and asks for the id back", async () => {
    fake.from("events", "insert").reply(ok([{ id: 9 }]));
    const answer = await createEvent(fields, "u-me");
    const [call] = fake.from("events", "insert").calls;
    expect(call.payload).toEqual({ ...fields, created_by: "u-me" });
    expect(chainOf(call)).toEqual([["insert", { ...fields, created_by: "u-me" }], ["select", "id"]]);
    expect(answer).toMatchObject({ data: [{ id: 9 }], error: null });
  });

  it("updateEvent changes only that row, writes the fields and nothing else, and asks for the ids changed", async () => {
    fake.from("events", "update").reply(ok([]));
    const answer = await updateEvent(4, fields);
    const [call] = fake.from("events", "update").calls;
    expect(chainOf(call)).toEqual([["update", fields], ["eq", "id", 4], ["select", "id"]]);
    // A date removed meanwhile answers with no error and no rows: the caller must be able to tell.
    expect(answer).toMatchObject({ data: [], error: null });
  });

  it("deleteEvent removes that row", async () => {
    fake.from("events", "delete").reply(fail("denied"));
    const answer = await deleteEvent(4);
    expect(chainOf(fake.from("events", "delete").calls[0])).toEqual([["delete"], ["eq", "id", 4]]);
    expect(answer.error).toMatchObject({ message: "denied" });
  });

  it("returns the database's failure for the caller to read, rather than throwing it", async () => {
    fake.from("events", "insert").reply(fail("Only executives can add dates", "42501"));
    const answer = await createEvent(fields, "u-me");
    expect(answer.error).toMatchObject({ message: "Only executives can add dates", code: "42501" });
    expect(answer.data).toBeNull();
  });
});
