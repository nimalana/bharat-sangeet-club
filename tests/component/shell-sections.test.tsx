// Which screens the signed-in shell opens for which role, and what each role may manage.
//
// Replaces, from the old text tests:
//  sections.test.mjs "the shell renders the finance screen from the shared rules"
//    (the shell must render every section the rules allow, refuse the rest, keep no private copy of the menu)
//    -> "every section a role may open is rendered ..." and "the navigation lists exactly what the rules allow".
//  admin-permission-parity.test.mjs "admin-facing archive controls use the shared management capability"
//    (executives AND admins manage the archive, never "executive only" wording or checks)
//    -> "executives and administrators get the same management controls; members get none".
//  The task's "a member never sees Admin" -> "Admin is for administrators only ...".
//  resource-links.test.mjs "resources UI is integrated as the single library while recordings stay in the archive"
//    (shell part: ?page=gallery opens the library, the library is a screen of the shell, no resource_links table,
//    the archive is read as recordings only, a group's "Open resources" opens the library for that group, the club
//    recording form has no document/photo kinds) -> "the single resources library ..." tests.
//    The library-internal assertions of that test are in resources-library.test.tsx.

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SECTION_LABELS, menuGroups, menuPages, sectionFromSearch, type ClubRole, type Section } from "../../lib/sections";
import { fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const ROLES: ClubRole[] = ["member", "executive", "admin"];
const group = { id: 7, name: "Hindustani Vocal", description: "Weekly vocal class", enrollment_mode: "open", archived_at: null };
const active = { subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" };

// What each screen shows as its page title.
const TITLE: Record<Section, (role: ClubRole) => RegExp | string> = {
  home: () => /^Welcome back, Asha Rao\.$/,
  groups: (role) => (role === "member" ? "My groups" : "All groups"),
  calendar: () => "Important dates",
  members: () => "Member roster",
  attendance: () => "Attendance",
  recordings: () => "Recordings",
  documents: () => "Resources",
  finances: (role) => (role === "member" ? "My reimbursements" : "Club finances"),
  admin: () => "Club control center",
};
const title = (section: Section, role: ClubRole) => screen.findByRole("heading", { level: 1, name: TITLE[section](role) }, { timeout: 4000 });

describe("every section a role may open is rendered; the rest are refused", () => {
  const cases = ROLES.flatMap((role) => menuPages(role).map((section) => [role, section] as const));
  it.each(cases)("%s opens %s from the address bar", async (role, section) => {
    fake.rpc("get_attendance_overview").reply(ok({}));
    openPortal({ role, page: section === "home" ? undefined : section });
    expect(await title(section, role)).toBeInTheDocument();
    expect(screen.queryByText(/is not available to your account/)).not.toBeInTheDocument();
  });

  it.each(ROLES.filter((role) => role !== "admin"))("%s is refused Admin, and the admin data is never read", async (role) => {
    openPortal({ role, page: "admin" });
    expect(await screen.findByText("Admin is not available to your account")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Club control center" })).not.toBeInTheDocument();
    expect(fake.from("admin_audit_log").calls).toHaveLength(0);
    expect(fake.rpc("admin_change_member_role").calls).toHaveLength(0);
    // The way out is the overview.
    fireEvent.click(screen.getByRole("button", { name: "Back to Overview" }));
    expect(await title("home", role)).toBeInTheDocument();
  });

  it("an old link keeps working: ?page=gallery opens the library, ?page=meetings attendance, ?page=finance finances", async () => {
    expect(sectionFromSearch("?page=gallery")).toBe("documents");
    fake.rpc("get_attendance_overview").reply(ok({}));
    for (const [alias, section] of [["gallery", "documents"], ["meetings", "attendance"], ["finance", "finances"]] as const) {
      const view = openPortal({ role: "executive", page: alias });
      expect(await title(section, "executive")).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("the navigation lists exactly what the rules allow", () => {
  it.each(ROLES)("%s: the page buttons and the menu match menuPages / menuGroups of lib/sections", async (role) => {
    openPortal({ role });
    await title("home", role);
    const nav = screen.getByRole("navigation", { name: "Portal navigation" });
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(menuPages(role).map((page) => SECTION_LABELS[page]));
    fireEvent.click(screen.getByRole("button", { name: /Navigate/ }));
    const menu = screen.getByRole("menu", { name: "All pages" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.querySelector("span")!.textContent)).toEqual(menuPages(role).map((page) => SECTION_LABELS[page]));
    expect(Array.from(menu.querySelectorAll(".page-menu-group > p")).map((heading) => heading.textContent)).toEqual(menuGroups(role).map((entry) => entry.title));
  });

  it("only an administrator is offered Admin", async () => {
    for (const role of ROLES) {
      const view = openPortal({ role });
      await title("home", role);
      const nav = screen.getByRole("navigation", { name: "Portal navigation" });
      expect(within(nav).queryByRole("button", { name: "Admin" }) !== null, role).toBe(role === "admin");
      view.unmount();
    }
  });

  it("choosing a page opens it, puts it in the address bar and marks it as the current page", async () => {
    openPortal({ role: "member" });
    await title("home", "member");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name: "Members" }));
    expect(await title("members", "member")).toBeInTheDocument();
    expect(window.location.search).toBe("?page=members");
    expect(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name: "Members" })).toHaveAttribute("aria-current", "page");
  });
});

describe("executives and administrators get the same management controls; members get none", () => {
  const MANAGE = [
    ["the dashboard offers to post an announcement", undefined, "＋ Post announcement"],
    ["the calendar offers to add a date", "calendar", "＋ Add important date"],
    ["the recordings page offers the club archive and adding a club recording", "recordings", "＋ Add club recording"],
  ] as const;
  it.each(MANAGE.flatMap(([what, page, button]) => ROLES.map((role) => [what, role, page, button] as const)))("%s (%s)", async (_what, role, page, button) => {
    openPortal({ role, page });
    await screen.findByRole("heading", { level: 1 });
    const manages = role !== "member";
    await waitFor(() => expect(screen.queryByRole("button", { name: button }) !== null).toBe(manages));
    // The wording is about who manages, not about one role.
    expect(screen.queryByText(/executive only|only executives/i)).not.toBeInTheDocument();
  });

  it("the club archive manager lists the club recordings to executives and administrators, with the same actions", async () => {
    const item = { id: 11, title: "Founders' Day", description: "", type: "recording", storage_path: "u/founders.mp3", visibility: "members", is_public: false, event_date: null, raga: null, tala: null, created_at: "2026-01-01T00:00:00Z", subgroup_id: null };
    for (const role of ["executive", "admin"] as const) {
      const view = openPortal({ role, page: "recordings", boot: { archive: [item] } });
      expect(await screen.findByText("Founders' Day")).toBeInTheDocument();
      for (const name of ["Open", "Edit", "Delete"]) expect(screen.getByRole("button", { name }), `${role}: ${name}`).toBeInTheDocument();
      view.unmount();
    }
    openPortal({ role: "member", page: "recordings", boot: { archive: [item] } });
    await screen.findByRole("heading", { level: 1, name: "Recordings" });
    expect(screen.queryByText("Founders' Day")).not.toBeInTheDocument();
  });

  it("recordings: managers can start a recording in any group; a member needs an active membership", async () => {
    const boot = { groups: [group], memberships: [] };
    openPortal({ role: "executive", page: "recordings", boot });
    expect(await screen.findByRole("button", { name: "＋ New recording" })).toBeEnabled();
  });

  it("recordings: a member without a group cannot start one", async () => {
    openPortal({ role: "member", page: "recordings", boot: { groups: [group], memberships: [] } });
    expect(await screen.findByRole("button", { name: "＋ New recording" })).toBeDisabled();
    expect(screen.getByText("Join a subgroup to start recording")).toBeInTheDocument();
  });
});

describe("Admin is for administrators only, and lists what the database returned", () => {
  it("an administrator sees the control center with the members, and cannot change their own permission", async () => {
    fake.from("profiles", "select").reply(ok([
      { id: "u-me", full_name: "Asha Rao", email: "asha@x.test", role: "admin", status: "active", phone: "1", class_year: "2027", specialty: "Veena", joined_at: "2025-08-01" },
      { id: "u-2", full_name: "Bala Menon", email: "bala@x.test", role: "member", status: "active", phone: "", class_year: "", specialty: "", joined_at: "2025-09-01" },
    ]));
    openPortal({ role: "admin", page: "admin" });
    expect(await screen.findByRole("heading", { level: 1, name: "Club control center" })).toBeInTheDocument();
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    expect(screen.getByLabelText("Permission for Asha Rao")).toBeDisabled();
    expect(screen.getByLabelText("Permission for Bala Menon")).toBeEnabled();
  });
});

describe("the single resources library (resource-links)", () => {
  const recordingItem = { id: 11, title: "Founders' Day", description: "", type: "recording", storage_path: "u/f.mp3", visibility: "members", is_public: false, event_date: null, raga: null, tala: null, created_at: "2026-01-01T00:00:00Z", subgroup_id: null };

  it("Resources is one screen of the shell, and the retired resource_links table is never read", async () => {
    openPortal({ role: "executive", page: "documents" });
    expect(await title("documents", "executive")).toBeInTheDocument();
    await waitFor(() => expect(fake.from("resources", "select").count).toBeGreaterThan(0));
    for (const page of ["Overview", "Calendar", "Members", "Recordings", "Resources", "Finances"]) {
      fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name: page }));
      await screen.findByRole("heading", { level: 1 });
    }
    expect(fake.calls.filter((call) => call.kind === "from" && call.target === "resource_links")).toEqual([]);
  });

  it("opening the overview reads the club archive as recordings only, never documents or photos", async () => {
    fake.from("archive_items", "select").reply(ok([recordingItem]));
    openPortal({ role: "executive", page: "calendar" });
    await title("calendar", "executive");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name: "Overview" }));
    await waitFor(() => expect(fake.from("archive_items", "select").count).toBeGreaterThan(0));
    for (const call of fake.from("archive_items", "select").calls) {
      expect(call.used("select", "*")).toBe(true);
      expect(call.used("eq", "type", "recording")).toBe(true);
      expect(call.used("eq", "type", "document") || call.used("eq", "type", "photo")).toBe(false);
    }
  });

  it("a group's Open resources opens the library for that group", async () => {
    openPortal({ role: "member", page: "groups", boot: { groups: [group], memberships: [active] } });
    fake.from("subgroups", "select").reply(ok([group]));
    fake.from("subgroup_memberships", "select").reply(ok([active]));
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    const buttons = await screen.findAllByRole("button", { name: "Open resources" });
    fireEvent.click(buttons[0]);
    expect(await title("documents", "member")).toBeInTheDocument();
    expect(window.location.search).toContain("page=documents");
    await waitFor(() => expect(fake.from("resources", "select").calls.some((call) => call.used("eq", "subgroup_id", 7))).toBe(true));
  });

  it("the club recording form has no document or photo kinds", async () => {
    openPortal({ role: "executive", page: "recordings" });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add club recording" }));
    const form = (await screen.findByRole("heading", { name: "Add a club recording" })).closest("form")!;
    const values = Array.from(form.querySelectorAll("option")).map((option) => option.getAttribute("value"));
    expect(values).toEqual(["members", "executives", "public"]);
    expect(form.querySelector('[name="type"]')).toBeNull();
  });
});
