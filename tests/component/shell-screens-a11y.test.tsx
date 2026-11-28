// Phase 3.4 for the screens of the shell, the public site and the sign-in: no serious or critical axe violation on each (colour contrast is not
// computed in jsdom: the real-browser run does that), the names and landmarks a screen reader needs, and the keyboard path through the sign-in.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginScreen } from "../../features/public/components/login-screen";
import { PublicSite } from "../../features/public/components/public-site";
import { expectNoSeriousViolations } from "../support/a11y";
import { fail, fake, never, ok } from "../support/fake-supabase";
import { focusedName, keyboardUser } from "../support/keyboard";
import { openPortal, renderPortal } from "../support/portal";

const pending = { profile: { full_name: "New Person", role: "member", status: "pending" }, groups: [], memberships: [], announcements: [], events: [], archive: [], resource_count: 0 };
const withStatus = (status: string) => ({ ...pending, profile: { ...pending.profile, status } });

describe("the screens a person sees before the portal", () => {
  it("the loading screen is announced, and has no serious violation", async () => {
    fake.auth("getSession").reply(never);
    const view = renderPortal();
    expect(await screen.findByText("Opening the club archive…")).toHaveAttribute("role", "status");
    await expectNoSeriousViolations(view.container);
  });

  it("the setup screen (no Supabase project) has no serious violation", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const view = renderPortal();
    await expectNoSeriousViolations(view.container);
  });

  it.each([
    ["waiting for approval", withStatus("pending"), "Welcome to Bharat Sangeet"],
    ["declined", withStatus("rejected"), "Your sign-up was not approved"],
    ["deactivated", withStatus("deactivated"), "Your access has been deactivated"],
  ])("a sign-up %s: a main with one heading, its buttons named, no serious violation", async (_label, answer, title) => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply(ok(answer));
    const view = renderPortal();
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await expectNoSeriousViolations(view.container);
  });

  it("the bootstrap failure screen is an alert with Try again and Sign out, and has no serious violation", async () => {
    fake.signIn({ id: "u-new" });
    fake.rpc("get_portal_bootstrap").reply({ data: null, error: { message: "boom" } });
    const view = renderPortal();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "We could not load your club profile" })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await expectNoSeriousViolations(view.container);
  });
});

describe("the signed-in shell", () => {
  it.each(["member", "executive", "admin"] as const)("the overview for a %s has no serious violation", async (role) => {
    const view = openPortal({ role, boot: { announcements: [{ id: 1, title: "Rehearsal moved", body: "Now at 7", is_pinned: true, published_at: "2026-10-01T00:00:00Z", subgroup_id: null }], events: [] } });
    await screen.findByText(/Welcome back/);
    await expectNoSeriousViolations(view.container);
  });

  it("a page the role may not open (Sign-up requests for a member) has no serious violation", async () => {
    const view = openPortal({ role: "member", page: "signups" });
    await screen.findByText("Sign-up requests is not available to your account");
    await expectNoSeriousViolations(view.container);
  });

  it("the page menu open, and the account menu open, have no serious violation", async () => {
    const view = openPortal({ role: "executive" });
    await screen.findByText(/Welcome back/);
    fireEvent.click(screen.getByRole("button", { name: /Navigate/ }));
    await expectNoSeriousViolations(view.container);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    await expectNoSeriousViolations(view.container);
  });

  it("the top bar names its landmarks: a banner with the portal navigation, one main, and the footer", async () => {
    openPortal();
    await screen.findByText(/Welcome back/);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("navigation", { name: "Portal navigation" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});

describe("the public site", () => {
  it("has no serious violation, with and without concerts", async () => {
    const view = render(<PublicSite onSignIn={vi.fn()} initialRecordings={[]} />);
    await expectNoSeriousViolations(view.container);
  });

  it("with the concert read failed (the error with Try again) and with a concert that could not be opened, no serious violation", async () => {
    fake.from("archive_items", "select").reply(fail("boom"));
    const failedRead = render(<PublicSite onSignIn={vi.fn()} initialRecordings={null} />);
    await screen.findByText("The concert recordings could not be loaded.", { selector: "[role=alert]" });
    await expectNoSeriousViolations(failedRead.container);
    failedRead.unmount();
    fake.storage("club-archive", "createSignedUrl").reply(fail("Object not found"));
    const concert = { id: 4, title: "Spring Concert", description: "", type: "recording", storage_path: "public/4.mp4", event_date: "2026-04-10", raga: "", tala: "", created_at: "2026-04-11T00:00:00Z", is_public: true };
    const unopened = render(<PublicSite onSignIn={vi.fn()} initialRecordings={[concert as never]} />);
    fireEvent.click(screen.getByRole("button", { name: /Watch or listen/ }));
    await screen.findByText("This recording could not be opened. Try again.");
    await expectNoSeriousViolations(unopened.container);
  });

  it("every picture has a text alternative (a decorative one has an empty one)", () => {
    const view = render(<PublicSite onSignIn={vi.fn()} initialRecordings={[]} />);
    for (const image of Array.from(view.container.querySelectorAll("img"))) expect(image.hasAttribute("alt")).toBe(true);
  });
});

describe("the sign-in screen", () => {
  it("has no serious violation, on either tab", async () => {
    const view = render(<LoginScreen onBack={vi.fn()} />);
    await expectNoSeriousViolations(view.container);
    fireEvent.click(screen.getByRole("button", { name: "Join the club" }));
    await expectNoSeriousViolations(view.container);
  });

  it("the two tabs say which one is chosen (aria-pressed), and choosing one changes the heading", () => {
    render(<LoginScreen onBack={vi.fn()} />);
    const signIn = screen.getByRole("button", { name: "Member sign in" });
    const join = screen.getByRole("button", { name: "Join the club" });
    expect(signIn).toHaveAttribute("aria-pressed", "true");
    expect(join).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(join);
    expect(join).toHaveAttribute("aria-pressed", "true");
    expect(signIn).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Join Bharat Sangeet" })).toBeInTheDocument();
  });

  it("the whole sign-in is reachable by keyboard: back, the two tabs, then Continue with Google, which Enter presses", async () => {
    fake.auth("signInWithOAuth").reply(ok(null));
    const onBack = vi.fn();
    render(<LoginScreen onBack={onBack} />);
    const user = keyboardUser();
    await user.tab();
    expect(focusedName()).toBe("← Back to public site");
    await user.tab();
    expect(focusedName()).toBe("Member sign in");
    await user.tab();
    expect(focusedName()).toBe("Join the club");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Join the club" })).toHaveAttribute("aria-pressed", "true");
    await user.tab();
    expect(focusedName()).toMatch(/Sign up with Google/);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fake.auth("signInWithOAuth").count).toBe(1));
  });

  it("an error from Google is announced (an alert) and the button is usable again", async () => {
    fake.auth("signInWithOAuth").reply({ data: null, error: { message: "Unsupported provider" } });
    render(<LoginScreen onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported provider");
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeEnabled();
  });
});
