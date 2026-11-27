// The portal shell: what it shows before, and instead of, the member screens, and what it does when the
// signed-in account changes.
//
// Replaces, from the old text tests:
//  bootstrap.test.mjs "the shell waits for the answer, retries on failure and shows the deactivated screen"
//    -> "the shell waits for get_portal_bootstrap ..." (loading screen, retry screen, deactivated screen, no member
//       shell before the answer, no fall-through to the member shell with a toast).
//  refresh-wiring "dashboard, workspace and directory loads drop answers that are no longer the newest": the part
//    about a change of account ("a change of account makes everything still in flight stale")
//    -> "a late answer for the previous account ..." tests.
//  The task's "token refresh does not reload every screen" and "the profile is loaded once"
//    -> "token refresh ..." and "the profile is loaded once".
//  public-concerts.test.mjs last test (signed links only requested on click, the page is server-rendered with a
//    5 minute revalidate) -> "the public page ...".

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Page, { revalidate } from "../../app/page";
import { deferred, fail, fake, ok, rejects } from "../support/fake-supabase";
import { bootstrapAnswer, openPortal, renderPortal } from "../support/portal";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const event = (id: number, title: string, days = 3) => ({ id, title, description: "", starts_at: future(days), location: "Hill Hall", created_at: "2026-01-01T00:00:00Z", subgroup_id: null });

describe("the shell waits for get_portal_bootstrap before showing anything on a guess", () => {
  it("shows only the loading screen while the answer is pending: no navigation, no member screens", async () => {
    fake.signIn({ id: "u-me" });
    fake.rpc("get_portal_bootstrap").reply(deferred().reply);
    renderPortal();
    expect(await screen.findByText("Opening the club archive…")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument();
  });

  it.each([
    ["an error", ok(null) && fail("Failed to fetch")],
    ["no profile", ok({ groups: [] })],
    ["an unknown role", ok(bootstrapAnswer("member" as never, "x", { profile: { full_name: "x", role: "superuser", status: "active" } }))],
    ["a thrown request", rejects()],
  ])("%s gives the retry screen, never the member shell", async (_name, reply) => {
    fake.signIn({ id: "u-me" });
    fake.rpc("get_portal_bootstrap").reply(reply);
    renderPortal();
    expect(await screen.findByText("We could not load your club profile")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument();
  });

  it("Try again asks again, and the shell opens once the answer arrives", async () => {
    fake.signIn({ id: "u-me" });
    fake.rpc("get_portal_bootstrap").replyOnce(fail("Failed to fetch")).reply(ok(bootstrapAnswer("member", "Asha Rao")));
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Welcome back, Asha Rao.")).toBeInTheDocument();
    expect(fake.rpc("get_portal_bootstrap").count).toBe(2);
  });

  it("a deactivated account gets the deactivated screen, whatever else came back, and can sign out", async () => {
    fake.signIn({ id: "u-me" });
    fake.rpc("get_portal_bootstrap").reply(ok({ profile: { full_name: "Old Member", role: "admin", status: "deactivated" }, groups: [{ id: 1, name: "Carnatic" }] }));
    renderPortal();
    expect(await screen.findByText("Your access has been deactivated")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fake.callsTo("auth").map((call) => call.op)).toContain("signOut");
  });

  it("opens the shell with the role the database returned, and the profile is loaded once", async () => {
    openPortal({ role: "executive" });
    expect(await screen.findByText("Executive view")).toBeInTheDocument();
    // One request carries the profile and everything the first screen needs; nothing asks for the profile again.
    expect(fake.rpc("get_portal_bootstrap").count).toBe(1);
    expect(fake.from("profiles").calls).toHaveLength(0);
  });

  it("a name chosen at sign-up is saved once, after the shell is ready, and forgotten when it was saved", async () => {
    window.sessionStorage.setItem("bharat-sangeet-pending-signup-name", "Asha R.");
    fake.from("profiles", "update").reply(ok(null));
    openPortal({ name: "" });
    await waitFor(() => expect(fake.from("profiles", "update").calls).toHaveLength(1));
    expect(fake.from("profiles", "update").calls[0].payload).toEqual({ full_name: "Asha R." });
    expect(fake.from("profiles", "update").calls[0].used("eq", "id", "u-me")).toBe(true);
    await waitFor(() => expect(window.sessionStorage.getItem("bharat-sangeet-pending-signup-name")).toBeNull());
    expect(await screen.findByText(/Welcome back, Asha R\./)).toBeInTheDocument();
  });
});

describe("token refresh does not reload every screen; a different account does", () => {
  const session = (id: string, extra: Record<string, unknown> = {}) => ({ access_token: `t-${Math.random()}`, user: { id, email: `${id}@x.test`, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z", ...extra } });

  it("a refreshed token (a new user object with the same id, as Supabase sends every hour) changes nothing", async () => {
    openPortal({ page: "members" });
    expect(await screen.findByText("Member roster")).toBeInTheDocument();
    await waitFor(() => expect(fake.from("profiles", "select").count).toBe(1));
    const before = fake.calls.length;
    await act(async () => {
      for (let i = 0; i < 3; i += 1) fake.emitAuth("TOKEN_REFRESHED", session("u-me"));
      fake.emitAuth("SIGNED_IN", session("u-me"));
    });
    // Every screen would have asked again: the bootstrap, and the directory the person is looking at.
    expect(fake.rpc("get_portal_bootstrap").count).toBe(1);
    expect(fake.from("profiles", "select").count).toBe(1);
    expect(fake.calls.length).toBe(before);
    expect(screen.getByText("Member roster")).toBeInTheDocument();
  });

  it("another account signing in loads that account's shell, once", async () => {
    openPortal({ name: "Asha Rao" });
    expect(await screen.findByText("Welcome back, Asha Rao.")).toBeInTheDocument();
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "Bala Menon")));
    await act(async () => { fake.emitAuth("SIGNED_IN", session("u-other")); });
    expect(await screen.findByText("Welcome back, Bala Menon.")).toBeInTheDocument();
    expect(fake.rpc("get_portal_bootstrap").count).toBe(2);
  });

  it("signing out returns to the public page and shows nothing of the account", async () => {
    openPortal({ name: "Asha Rao" });
    expect(await screen.findByText("Welcome back, Asha Rao.")).toBeInTheDocument();
    await act(async () => { fake.emitAuth("SIGNED_OUT", null); });
    expect(await screen.findByText("Member sign in →")).toBeInTheDocument();
    expect(screen.queryByText(/Asha Rao/)).not.toBeInTheDocument();
  });

  it("stops listening to sign-in changes when the shell goes away", async () => {
    const { unmount } = openPortal();
    await screen.findByText(/Welcome back/);
    expect(fake.authSubscribers).toBe(1);
    unmount();
    expect(fake.authSubscribers).toBe(0);
  });
});

describe("a late answer for the previous account or for an older request is discarded", () => {
  const session = (id: string) => ({ access_token: "t", user: { id, email: `${id}@x.test`, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } });

  it("the bootstrap of the account that was replaced, arriving last, does not change the shell", async () => {
    fake.signIn({ id: "u-a" });
    const slowA = deferred();
    // Account A's bootstrap hangs; account B signs in and gets its own answer at once.
    fake.rpc("get_portal_bootstrap").replyOnce(slowA.reply).reply(ok(bootstrapAnswer("member", "Bala Menon")));
    renderPortal();
    await act(async () => { fake.emitAuth("SIGNED_IN", session("u-b")); });
    expect(await screen.findByText("Welcome back, Bala Menon.")).toBeInTheDocument();
    await act(async () => { slowA.resolve(ok(bootstrapAnswer("admin", "Asha Rao", { resource_count: 99 }))); });
    expect(screen.getByText("Welcome back, Bala Menon.")).toBeInTheDocument();
    expect(screen.queryByText(/Asha Rao/)).not.toBeInTheDocument();
    expect(screen.getByText("Member view")).toBeInTheDocument();
  });

  it("the dashboard's reload for the previous account, arriving after the account changed, shows nothing of it", async () => {
    openPortal({ name: "Asha Rao" });
    await screen.findByText("Welcome back, Asha Rao.");
    const slow = deferred();
    fake.from("events", "select").reply(slow.reply);
    // The person opens Overview again: the shell reloads its lists, and that answer is slow.
    fireEvent.click(screen.getByRole("button", { name: "Bharat Sangeet at UNC Chapel Hill home" }));
    await waitFor(() => expect(fake.from("events", "select").count).toBe(1));
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "Bala Menon")));
    await act(async () => { fake.emitAuth("SIGNED_IN", session("u-b")); });
    await screen.findByText("Welcome back, Bala Menon.");
    await act(async () => { slow.resolve(ok([event(1, "Asha's private rehearsal")])); });
    expect(screen.queryByText("Asha's private rehearsal")).not.toBeInTheDocument();
  });

  it("of two reloads of the dashboard, only the newest answer is used, even if the older one arrives last", async () => {
    openPortal({ name: "Asha Rao" });
    await screen.findByText("Welcome back, Asha Rao.");
    const older = deferred();
    fake.from("events", "select").replyOnce(older.reply).reply(ok([event(2, "Newer: spring concert")]));
    const home = screen.getByRole("button", { name: "Bharat Sangeet at UNC Chapel Hill home" });
    fireEvent.click(home);
    fireEvent.click(home);
    expect(await screen.findByText("Newer: spring concert")).toBeInTheDocument();
    await act(async () => { older.resolve(ok([event(1, "Older: autumn concert", 2)])); });
    expect(screen.queryByText("Older: autumn concert")).not.toBeInTheDocument();
    expect(screen.getByText("Newer: spring concert")).toBeInTheDocument();
  });

  it("the groups the shell reloads after a person joins one, answering after the account changed, are not kept for the new account", async () => {
    const group = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null };
    const slow = deferred();
    openPortal({ page: "groups", boot: { groups: [group] } });
    // The shell's own reload of the account's groups (it filters out archived ones) is slow; the group page's own read is not.
    fake.from("subgroups", "select").reply((call) => (call.used("is", "archived_at") ? slow.reply : ok([group])));
    const membership = { subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" };
    let joined = false;
    fake.from("subgroup_memberships", "select").reply(() => ok(joined ? [membership] : []));
    fake.rpc("request_subgroup_enrollment").reply(() => { joined = true; return ok(membership); });
    fireEvent.click(await screen.findByRole("button", { name: "Join group" }));
    await screen.findByText(/Welcome to Hindustani Vocal/);
    // The account changes before that reload answers.
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "Bala Menon")));
    await act(async () => { fake.emitAuth("SIGNED_IN", session("u-b")); });
    await screen.findByText("Bala Menon");
    await act(async () => { slow.resolve(ok([group])); });
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    const view = await screen.findByLabelText("Filter by audience");
    expect(within(view).queryByRole("option", { name: "Hindustani Vocal" })).not.toBeInTheDocument();
  });
});

describe("the public page", () => {
  const concert = { id: 4, title: "Spring Concert", description: "Live at Memorial Hall", type: "recording", storage_path: "public/spring.mp4", event_date: "2026-04-10", raga: "Yaman", tala: "Teentaal", created_at: "2026-04-11T00:00:00Z", is_public: true };

  it("lists the concerts the server read, and asks for a signed link only when Watch is clicked", async () => {
    renderPortal({ publicConcerts: [concert] as never });
    expect(await screen.findByText("Spring Concert")).toBeInTheDocument();
    expect(fake.callsTo("storage")).toHaveLength(0);
    // The server's list is used: the browser does not read it again.
    expect(fake.from("archive_items").calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Watch or listen/ }));
    await waitFor(() => expect(fake.storage("club-archive", "createSignedUrl").calls).toHaveLength(1));
    expect(fake.storage("club-archive", "createSignedUrl").calls[0].args).toEqual(["public/spring.mp4", 600]);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(expect.stringContaining("public/spring.mp4"), "_blank", "noopener,noreferrer"));
  });

  it("when the server could not read the list, the browser reads only the public concerts", async () => {
    fake.from("archive_items", "select").reply(ok([concert]));
    renderPortal({ publicConcerts: null });
    expect(await screen.findByText("Spring Concert")).toBeInTheDocument();
    const read = fake.from("archive_items", "select").calls[0];
    expect(read.used("eq", "type", "recording")).toBe(true);
    expect(read.used("eq", "is_public", true)).toBe(true);
  });

  it("the server page hands the portal the concerts it fetched, and is rebuilt every 5 minutes at most", async () => {
    expect(revalidate).toBe(300);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [concert] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    const element = await Page();
    expect(element.props.publicConcerts).toHaveLength(1);
    expect(element.props.publicConcerts[0]).toMatchObject({ id: 4, title: "Spring Concert" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { next?: { revalidate?: number } }];
    expect(init.next?.revalidate).toBe(300);
    // No signed link is requested on the server: the page only carries rows.
    expect(JSON.stringify(element.props.publicConcerts)).not.toMatch(/signed/i);
    expect(fake.callsTo("storage")).toHaveLength(0);
    vi.unstubAllEnvs();
    // Rendering what the server handed over shows the same concert.
    render(element);
    expect(await screen.findByText("Spring Concert")).toBeInTheDocument();
  });
});
