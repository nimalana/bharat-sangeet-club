// The membership gate in the shell (P0-01): a person who signed in but is not a member yet.
//
//  pending  - a new sign-up waits for a club executive: one sentence, Check again, Sign out, no navigation, and no request but
//             get_portal_bootstrap, whatever else the answer holds or the address asks for.
//  rejected - a declined sign-up: a clear message and Sign out, the same silence.
//  the count of sign-ups waiting is shown to executives and administrators next to Sign-up requests, and to nobody else.
// The queue itself (Approve, Decline) is in signup-requests.test.tsx.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fake, ok } from "../support/fake-supabase";
import { bootstrapAnswer, openPortal, renderPortal } from "../support/portal";

const NAME_KEY = "bharat-sangeet-pending-signup-name";
const SENTENCE = "Your sign-up is waiting for approval by a club executive.";
// What a pending account's bootstrap really looks like (get_portal_bootstrap is security invoker: its own profile, nothing else)...
const pendingAnswer = { profile: { full_name: "New Person", role: "member", status: "pending" }, groups: [], memberships: [], announcements: [], events: [], archive: [], resource_count: 0 };
// ...and one that wrongly carries data, to show the shell does not look at it.
const generousAnswer = { ...pendingAnswer, groups: [{ id: 1, name: "Carnatic Violin", description: "", enrollment_mode: "open", archived_at: null }], announcements: [{ id: 1, title: "Secret", body: "Members only", is_pinned: false, published_at: "2026-10-01T00:00:00Z", subgroup_id: null }], resource_count: 40 };

const requestsMade = () => fake.calls.filter((call) => call.kind !== "auth").map((call) => `${call.kind}:${call.target}`);

describe("a sign-up waiting for approval", () => {
  it("sees the one sentence, Check again and Sign out, and no portal", async () => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(pendingAnswer));
    renderPortal();
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument();
    // It is not an error screen: nothing to retry, nothing went wrong.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("We could not load your club profile")).not.toBeInTheDocument();
  });

  it("asks for nothing but get_portal_bootstrap, even when the address asks for a page and the answer carries data", async () => {
    window.history.replaceState({}, "", "/?page=admin");
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(generousAnswer));
    renderPortal();
    await screen.findByText(SENTENCE);
    expect(requestsMade()).toEqual(["rpc:get_portal_bootstrap"]);
    expect(screen.queryByText("Carnatic Violin")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    expect(screen.queryByText(/Club control center/)).not.toBeInTheDocument();
  });

  it("a pending account that claims a role is still only pending (the database refuses that combination; the shell does not trust it either)", async () => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok({ ...generousAnswer, profile: { full_name: "New Person", role: "admin", status: "pending" } }));
    renderPortal();
    await screen.findByText(SENTENCE);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(requestsMade()).toEqual(["rpc:get_portal_bootstrap"]);
  });

  it("Sign out signs out", async () => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(pendingAnswer));
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(fake.callsTo("auth").map((call) => call.op)).toContain("signOut");
  });

  it("Check again asks again; once an executive has approved, the portal opens", async () => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").replyOnce(ok(pendingAnswer)).reply(ok(bootstrapAnswer("member", "New Person")));
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Welcome back, New Person.")).toBeInTheDocument();
    expect(fake.rpc("get_portal_bootstrap").count).toBe(2);
    expect(screen.getByRole("navigation", { name: "Portal navigation" })).toBeInTheDocument();
  });

  it("Check again while still waiting shows the same sentence again", async () => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(pendingAnswer));
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await waitFor(() => expect(fake.rpc("get_portal_bootstrap").count).toBe(2));
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    expect(requestsMade()).toEqual(["rpc:get_portal_bootstrap", "rpc:get_portal_bootstrap"]);
  });

  it("the name typed at sign-up is not sent while waiting (the database would refuse it) and is kept for the first time the portal opens", async () => {
    window.sessionStorage.setItem(NAME_KEY, "Asha R.");
    fake.signIn({ id: "u-new" });
    fake.from("profiles", "update").reply(ok(null));
    fake.rpc("get_portal_bootstrap").replyOnce(ok(pendingAnswer)).reply(ok(bootstrapAnswer("member", "")));
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await screen.findByRole("navigation", { name: "Portal navigation" });
    // Nothing was written while pending: the one update is the one after approval.
    await waitFor(() => expect(fake.from("profiles", "update").calls).toHaveLength(1));
    expect(fake.from("profiles", "update").calls[0].payload).toEqual({ full_name: "Asha R." });
  });

  it("while waiting the name stays in the tab's storage", async () => {
    window.sessionStorage.setItem(NAME_KEY, "Asha R.");
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(pendingAnswer));
    renderPortal();
    await screen.findByText(SENTENCE);
    expect(window.sessionStorage.getItem(NAME_KEY)).toBe("Asha R.");
    expect(fake.from("profiles").calls).toHaveLength(0);
  });
});

describe("a declined sign-up", () => {
  const rejectedAnswer = { ...generousAnswer, profile: { full_name: "New Person", role: "member", status: "rejected" } };

  it("sees a clear message and Sign out, no portal, and no request but the bootstrap", async () => {
    window.history.replaceState({}, "", "/?page=members");
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(rejectedAnswer));
    renderPortal();
    expect(await screen.findByRole("heading", { name: "Your sign-up was not approved" })).toBeInTheDocument();
    expect(screen.getByText(/cannot open the member portal/)).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("Carnatic Violin")).not.toBeInTheDocument();
    expect(requestsMade()).toEqual(["rpc:get_portal_bootstrap"]);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fake.callsTo("auth").map((call) => call.op)).toContain("signOut");
  });

  it("is offered nothing but Sign out (signing in again asks again; an executive can still approve the sign-up)", async () => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(rejectedAnswer));
    renderPortal();
    await screen.findByRole("heading", { name: "Your sign-up was not approved" });
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });
});

describe("the count of sign-ups waiting", () => {
  const nav = () => screen.getByRole("navigation", { name: "Portal navigation" });

  it.each(["executive", "admin"] as const)("%s sees it next to Sign-up requests, in the top bar and in the menu", async (role) => {
    openPortal({ role, boot: { pending_signups: 3 } });
    await screen.findByRole("navigation", { name: "Portal navigation" });
    expect(within(nav()).getByRole("button", { name: "Sign-up requests (3 waiting)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Navigate/ }));
    expect(within(screen.getByRole("menu", { name: "All pages" })).getByRole("menuitem", { name: /Sign-up requests \(3 waiting\)/ })).toBeInTheDocument();
  });

  it("with nobody waiting there is no count", async () => {
    openPortal({ role: "executive", boot: { pending_signups: 0 } });
    await screen.findByRole("navigation", { name: "Portal navigation" });
    expect(within(nav()).getByRole("button", { name: "Sign-up requests" })).toBeInTheDocument();
    expect(nav().querySelector(".nav-count")).toBeNull();
  });

  it("an answer without the field (an older database, or not an executive) shows no count", async () => {
    openPortal({ role: "executive" });
    await screen.findByRole("navigation", { name: "Portal navigation" });
    expect(nav().querySelector(".nav-count")).toBeNull();
  });

  it("a member has no Sign-up requests entry and no count", async () => {
    openPortal({ role: "member", boot: { pending_signups: 3 } });
    await screen.findByRole("navigation", { name: "Portal navigation" });
    expect(within(nav()).queryByRole("button", { name: /Sign-up requests/ })).not.toBeInTheDocument();
    expect(nav().querySelector(".nav-count")).toBeNull();
  });
});
