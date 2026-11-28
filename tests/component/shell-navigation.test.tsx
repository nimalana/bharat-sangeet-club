// Which page is open and what the address bar says: the part of the shell that shell-sections.test.tsx does not reach
// (it covers which roles may open which page, the menu, and the old ?page= names).
//
// These pin the behaviour of the navigation code as it was written inline in the Portal, so that moving it into
// features/shell/hooks/use-portal-navigation.ts cannot change it:
//  - choosing a page pushes ?page=<name>, once; the overview has the plain address;
//  - the browser's back and forward buttons put the page back and return to the top of the page;
//  - the public site's sign-in screen has its own entry in the history (?signin=1);
//  - ?page=meetings and ?tab=meetings open attendance on its meetings tab;
//  - "View attendance" / "Open recordings" on a group open that page for that group, and the shell remembers the group.

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fake, ok } from "../support/fake-supabase";
import { openPortal, renderPortal } from "../support/portal";

const nav = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name }));
const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name }, { timeout: 5000 });
const group = { id: 7, name: "Hindustani Vocal", description: "Weekly vocal class", enrollment_mode: "open", archived_at: null };
const active = { subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" };

describe("choosing a page", () => {
  it("pushes the page into the address bar, once, and the overview has the plain address", async () => {
    openPortal();
    await heading(/Welcome back/);
    expect(window.location.search).toBe("");
    nav("Calendar");
    await heading("Important dates");
    expect(window.location.search).toBe("?page=calendar");
    expect(window.history.state).toEqual({ section: "calendar" });
    // The page that is already open adds nothing to the history: one step back is the overview, not the calendar again.
    nav("Calendar");
    window.history.back();
    await heading(/Welcome back/);
    expect(window.location.search).toBe("");
    window.history.forward();
    await heading("Important dates");
    nav("Overview");
    await heading(/Welcome back/);
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({ section: "home" });
  });

  it("scrolls to the top", async () => {
    openPortal();
    await heading(/Welcome back/);
    nav("Members");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});

describe("the browser's back and forward buttons", () => {
  it("put the page back, and return to the top of the page", async () => {
    openPortal();
    await heading(/Welcome back/);
    nav("Calendar");
    await heading("Important dates");
    nav("Members");
    await heading("Member roster");
    (window.scrollTo as unknown as { mockClear(): void }).mockClear();

    window.history.back();
    await heading("Important dates");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    window.history.back();
    await heading(/Welcome back/);
    window.history.forward();
    await heading("Important dates");
    expect(window.location.search).toBe("?page=calendar");
  });
});

describe("the public site's sign-in screen", () => {
  const signInButton = () => screen.getAllByRole("button", { name: /Member sign in/ })[0];

  it("opens with its own history entry, and Back to public site closes it and clears the address", async () => {
    renderPortal();
    await screen.findByText("Member sign in →");
    fireEvent.click(signInButton());
    expect(await screen.findByRole("button", { name: /Back to public site/ })).toBeInTheDocument();
    expect(window.location.search).toBe("?signin=1");
    expect(window.history.state).toEqual({ signin: true });
    fireEvent.click(screen.getByRole("button", { name: /Back to public site/ }));
    expect(await screen.findByText("Member sign in →")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({});
  });

  it("the browser's back button closes it, and forward opens it again", async () => {
    renderPortal();
    await screen.findByText("Member sign in →");
    fireEvent.click(signInButton());
    await screen.findByRole("button", { name: /Back to public site/ });
    window.history.back();
    expect(await screen.findByText("Member sign in →")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to public site/ })).not.toBeInTheDocument();
    window.history.forward();
    expect(await screen.findByRole("button", { name: /Back to public site/ })).toBeInTheDocument();
  });
});

describe("attendance opens on the tab the address asks for", () => {
  const tab = (name: string) => screen.findByRole("tab", { name }, { timeout: 5000 });

  // Managers see the tabs; the overview they read needs a term.
  const overview = { terms: ["2026-fall"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall", list_limit: 100 };

  it.each([["meetings"], ["attendance&tab=meetings"]])("?page=%s opens the meetings tab", async (page) => {
    fake.rpc("get_attendance_overview").reply(ok(overview));
    openPortal({ role: "executive", page });
    expect(await tab("Meetings")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false");
  });

  it("?page=attendance opens the overview tab", async () => {
    fake.rpc("get_attendance_overview").reply(ok(overview));
    openPortal({ role: "executive", page: "attendance" });
    expect(await tab("Overview")).toHaveAttribute("aria-selected", "true");
  });
});

describe("opening a page for a group from the groups page", () => {
  async function openGroup() {
    fake.from("subgroups", "select").reply(ok([group]));
    fake.from("subgroup_memberships", "select").reply(ok([active]));
    fake.rpc("get_attendance_overview").reply(ok({}));
    openPortal({ role: "member", page: "groups", boot: { groups: [group], memberships: [active] } });
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
  }

  it("View attendance opens attendance for that group", async () => {
    await openGroup();
    fireEvent.click(await screen.findByRole("button", { name: "View attendance" }));
    await heading("Attendance");
    expect(window.location.search).toBe("?page=attendance");
    expect(await screen.findByLabelText("Filter attendance by audience")).toHaveValue("group:7");
    await waitFor(() => expect(fake.rpc("get_attendance_overview").calls.some((call) => (call.args[0] as { p_subgroup_id?: number }).p_subgroup_id === 7)).toBe(true));
  });

  it("Open recordings opens the recordings for that group", async () => {
    await openGroup();
    fireEvent.click((await screen.findAllByRole("button", { name: "Open recordings" }))[0]);
    await heading("Recordings");
    expect(window.location.search).toBe("?page=recordings");
    const picker = await screen.findByRole("combobox", { name: "Group" }, { timeout: 5000 });
    expect(picker).toHaveValue("7");
  });

  it("the shell remembers the group: opening attendance from the menu afterwards still starts on it", async () => {
    await openGroup();
    fireEvent.click(await screen.findByRole("button", { name: "View attendance" }));
    await heading("Attendance");
    nav("Overview");
    await heading(/Welcome back/);
    nav("Attendance");
    await heading("Attendance");
    expect(await screen.findByLabelText("Filter attendance by audience")).toHaveValue("group:7");
  });
});
