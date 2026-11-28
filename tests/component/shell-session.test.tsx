// Who is signed in, and what the shell shows while it finds out: the part of the shell's state machine that
// shell-bootstrap.test.tsx does not reach (it covers the bootstrap answer, retry, deactivated, token refresh and the
// account races).
//
// These pin the behaviour of the session code as it was written inline in the Portal, so that moving it into hooks
// (features/shell/hooks/use-auth-session.ts, use-portal-session.ts) cannot change it:
//  - a session that cannot be read does not keep the person on the loading screen (7 seconds, then the public page);
//  - a page restored from the back-forward cache reads the session again, and stops listening when the shell is gone;
//  - the first paint: the public page at once when the server sent the concerts and nothing says the person is signed in;
//  - the name shown when the profile has none; a sign-up name that cannot be saved; the account button and sign-out.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { advance, flush } from "../support/helpers";
import { deferred, fail, fake, never, ok, rejects } from "../support/fake-supabase";
import { bootstrapAnswer, openPortal, renderPortal, serverRenderPortal } from "../support/portal";

const concert = { id: 4, title: "Spring Concert", description: "Live at Memorial Hall", type: "recording", storage_path: "public/spring.mp4", event_date: "2026-04-10", raga: "Yaman", tala: "Teentaal", created_at: "2026-04-11T00:00:00Z", is_public: true };
const toast = () => document.querySelector(".toast") as HTMLElement | null;

describe("a session that cannot be read does not keep the loading screen", () => {
  it("shows the loading screen for 7 seconds, then the public page", async () => {
    vi.useFakeTimers();
    fake.auth("getSession").reply(never);
    renderPortal();
    expect(screen.getByText("Opening the club archive…")).toBeInTheDocument();
    await advance(6900);
    expect(screen.getByText("Opening the club archive…")).toBeInTheDocument();
    await advance(200);
    expect(screen.queryByText("Opening the club archive…")).not.toBeInTheDocument();
    expect(screen.getByText("Member sign in →")).toBeInTheDocument();
  });

  it.each([
    ["an error", fail("Failed to fetch")],
    ["a request that is rejected", rejects()],
  ])("%s while reading it gives the public page, not an error screen", async (_name, reply) => {
    fake.auth("getSession").reply(reply);
    renderPortal();
    expect(await screen.findByText("Member sign in →")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a page restored from the back-forward cache", () => {
  const restore = (persisted: boolean) => act(async () => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted })); });

  it("reads the session again, so a sign-in made in another tab shows up", async () => {
    fake.auth("getSession").reply(ok({ session: null }));
    renderPortal();
    await screen.findByText("Member sign in →");
    expect(fake.auth("getSession").count).toBe(1);
    fake.signIn({ id: "u-me", email: "u-me@x.test" });
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "Asha Rao")));
    await restore(true);
    expect(await screen.findByText("Welcome back, Asha Rao.")).toBeInTheDocument();
    expect(fake.auth("getSession").count).toBe(2);
  });

  it("an ordinary page show reads nothing", async () => {
    fake.auth("getSession").reply(ok({ session: null }));
    renderPortal();
    await screen.findByText("Member sign in →");
    await restore(false);
    expect(fake.auth("getSession").count).toBe(1);
  });

  it("is no longer listened to once the shell is gone", async () => {
    fake.auth("getSession").reply(ok({ session: null }));
    const { unmount } = renderPortal();
    await screen.findByText("Member sign in →");
    unmount();
    await restore(true);
    expect(fake.auth("getSession").count).toBe(1);
  });
});

describe("the first paint", () => {
  it("is the public page straight away when the server sent the concerts and no saved sign-in is known", () => {
    renderPortal({ publicConcerts: [concert] as never });
    // No wait: the page is there on the first render, not after the session has been read.
    expect(screen.getByText("Spring Concert")).toBeInTheDocument();
    expect(screen.queryByText("Opening the club archive…")).not.toBeInTheDocument();
  });

  it("is the loading screen when this browser holds a saved sign-in, even with the concerts", async () => {
    window.localStorage.setItem("sb-abcdefgh-auth-token", JSON.stringify({ access_token: "t" }));
    fake.auth("getSession").reply(ok({ session: null }));
    renderPortal({ publicConcerts: [concert] as never });
    expect(screen.getByText("Opening the club archive…")).toBeInTheDocument();
    expect(screen.queryByText("Spring Concert")).not.toBeInTheDocument();
    expect(await screen.findByText("Spring Concert")).toBeInTheDocument();
  });

  it("is the loading screen when the server sent no concerts", async () => {
    fake.auth("getSession").reply(ok({ session: null }));
    renderPortal({ publicConcerts: null });
    expect(screen.getByText("Opening the club archive…")).toBeInTheDocument();
    expect(await screen.findByText("Member sign in →")).toBeInTheDocument();
  });
});

describe("signing out and in again", () => {
  const session = (id: string) => ({ access_token: "t", user: { id, email: `${id}@x.test`, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } });

  it("never shows the shell of the account that left, or an empty one, while the next account's bootstrap is on its way", async () => {
    openPortal({ role: "admin", name: "Asha Rao" });
    await screen.findByText("Welcome back, Asha Rao.");
    await act(async () => { fake.emitAuth("SIGNED_OUT", null); });
    await screen.findByText("Member sign in →");

    // From here on, record every node that is put into the page.
    const slow = deferred();
    fake.rpc("get_portal_bootstrap").reply(slow.reply);
    const added: string[] = [];
    const watcher = new MutationObserver((records) => { for (const record of records) record.addedNodes.forEach((node) => added.push((node as Element).outerHTML ?? node.textContent ?? "")); });
    watcher.observe(document.body, { childList: true, subtree: true });
    await act(async () => { fake.emitAuth("SIGNED_IN", session("u-b")); });
    expect(screen.getByText("Opening the club archive…")).toBeInTheDocument();
    watcher.disconnect();
    expect(added.some((html) => html.includes("portal-shell"))).toBe(false);
    expect(added.some((html) => html.includes("Asha Rao"))).toBe(false);

    await act(async () => { slow.resolve(ok(bootstrapAnswer("member", "Bala Menon"))); });
    expect(await screen.findByText("Welcome back, Bala Menon.")).toBeInTheDocument();
    expect(screen.getByText("Member · Account")).toBeInTheDocument();
  });
});

describe("the page the server sends", () => {
  it("is the public page with the concerts in it, not a loading screen: nothing says the person is signed in", () => {
    const html = serverRenderPortal({ publicConcerts: [concert] as never });
    expect(html).toContain("Spring Concert");
    expect(html).not.toContain("Opening the club archive");
  });

  it("is the loading screen when the server could not read the concerts", () => {
    const html = serverRenderPortal({ publicConcerts: null });
    expect(html).toContain("Opening the club archive");
    expect(html).not.toContain("Member sign in");
  });
});

describe("the name the shell shows", () => {
  it("is the name on the profile", async () => {
    openPortal({ name: "Asha Rao" });
    expect(await screen.findByText("Welcome back, Asha Rao.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asha Rao/ })).toHaveAttribute("aria-haspopup", "menu");
  });

  it("is the part of the email before the @ when the profile has no name", async () => {
    openPortal({ name: "", userId: "bala.menon" });
    expect(await screen.findByText("Welcome back, bala.menon.")).toBeInTheDocument();
  });

  it("is Club member when there is neither", async () => {
    fake.signIn({ id: "u-x" });
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "")));
    renderPortal();
    expect(await screen.findByText("Welcome back, Club member.")).toBeInTheDocument();
  });

  it("a name chosen at sign-up that is saved after the account has changed is not given to the new account", async () => {
    window.sessionStorage.setItem("bharat-sangeet-pending-signup-name", "Asha R.");
    const slow = deferred();
    // The first account's save is slow; the second account's own attempt (the name is still pending) is refused.
    fake.from("profiles", "update").replyOnce(slow.reply).reply(fail("denied"));
    openPortal({ name: "Asha Rao" });
    await waitFor(() => expect(fake.from("profiles", "update").count).toBe(1));
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "Bala Menon")));
    await act(async () => { fake.emitAuth("SIGNED_IN", { access_token: "t", user: { id: "u-b", email: "u-b@x.test", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } }); });
    expect(await screen.findByText("Welcome back, Bala Menon.")).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(null)); });
    expect(screen.getByText("Welcome back, Bala Menon.")).toBeInTheDocument();
    expect(screen.queryByText(/Asha R\./)).not.toBeInTheDocument();
  });

  it("a name chosen at sign-up that could not be saved is said so, and kept for the next try", async () => {
    window.sessionStorage.setItem("bharat-sangeet-pending-signup-name", "  Asha R. ");
    fake.from("profiles", "update").reply(fail("permission denied for table profiles"));
    openPortal({ name: "" });
    await waitFor(() => expect(toast()).toHaveTextContent("Your account was created, but your preferred name could not be saved"));
    expect(toast()).toHaveClass("error");
    // The name was trimmed before it was sent, and is still there to try again.
    expect(fake.from("profiles", "update").calls[0].payload).toEqual({ full_name: "Asha R." });
    expect(window.sessionStorage.getItem("bharat-sangeet-pending-signup-name")).toBe("  Asha R. ");
    expect(screen.queryByText(/Asha R\./)).not.toBeInTheDocument();
  });
});

describe("the page around the screens", () => {
  it("has the club's top bar and footer on every page", async () => {
    openPortal({ page: "members" });
    await screen.findByRole("heading", { level: 1, name: "Member roster" });
    const header = document.querySelector("header.topbar")!;
    expect(within(header as HTMLElement).getByRole("button", { name: "Bharat Sangeet at UNC Chapel Hill home" })).toBeInTheDocument();
    expect(within(header as HTMLElement).getByRole("navigation", { name: "Portal navigation" })).toBeInTheDocument();
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("Bharat Sangeet");
    expect(footer).toHaveTextContent("UNC Chapel Hill");
    expect(footer).toHaveTextContent("Carnatic and Hindustani music at UNC Chapel Hill.");
    expect(footer).toHaveTextContent("2026–27 Season");
  });
});

// Phase 3.2: the account button is a menu button. It used to sign out at once (title "Sign out", caption "Member · Sign out"); now it opens a menu with
// "My profile" and "Sign out" (tests/component/shell-account-menu.test.tsx has the menu itself), and signing out is the menu's second item.
const accountButton = () => screen.getByRole("button", { name: /^Account menu for / });
const signOutFromMenu = () => { fireEvent.click(accountButton()); fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })); };

describe("the account button", () => {
  it.each([
    ["admin", "AD", "Admin · Account"],
    ["executive", "EX", "Executive · Account"],
    ["member", "MB", "Member · Account"],
  ] as const)("%s: badge %s, caption %s", async (role, badge, caption) => {
    openPortal({ role, name: "Asha Rao" });
    await screen.findByText("Welcome back, Asha Rao.");
    expect(accountButton()).toHaveTextContent(`${badge}Asha Rao${caption}`);
  });

  it("pressing it signs nobody out: it opens the menu", async () => {
    openPortal({ name: "Asha Rao" });
    await screen.findByText("Welcome back, Asha Rao.");
    fireEvent.click(accountButton());
    expect(fake.auth("signOut").count).toBe(0);
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
  });

  it("signs out from the menu, and the public page follows the sign-out", async () => {
    openPortal({ name: "Asha Rao" });
    await screen.findByText("Welcome back, Asha Rao.");
    signOutFromMenu();
    expect(fake.auth("signOut").count).toBe(1);
    await act(async () => { fake.emitAuth("SIGNED_OUT", null); });
    expect(await screen.findByText("Member sign in →")).toBeInTheDocument();
  });

  it.each([
    ["an error", fail("Network request failed")],
    ["a rejected request", rejects()],
  ])("a sign-out that fails with %s says nothing and leaves the person signed in", async (_name, reply) => {
    fake.auth("signOut").reply(reply);
    openPortal({ name: "Asha Rao" });
    await screen.findByText("Welcome back, Asha Rao.");
    signOutFromMenu();
    await flush();
    expect(fake.auth("signOut").count).toBe(1);
    expect(toast()).toBeNull();
    expect(screen.getByText("Welcome back, Asha Rao.")).toBeInTheDocument();
  });

  it("the retry screen and the deactivated screen sign out too", async () => {
    fake.signIn({ id: "u-me" });
    fake.rpc("get_portal_bootstrap").reply(fail("Failed to fetch"));
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(fake.auth("signOut").count).toBe(1);
  });
});
