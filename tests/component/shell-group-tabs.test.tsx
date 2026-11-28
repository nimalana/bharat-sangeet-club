// The shell fills a group's Resources and Attendance tabs with those screens for that group (features/shell/components/portal.tsx
// `renderGroupTab`), and choosing "My Groups" in the menu while a group is open takes the person back to the list: the address changes
// and the screens that keep their state in it (lib/hooks/use-url-state.ts) are told, which they are not for a pushState.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const group = { id: 7, name: "Hindustani Vocal", description: "Weekly vocal class", enrollment_mode: "open", archived_at: null };
const active = { subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" };
const nav = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name }));

function openGroupsPage(url: string) {
  fake.from("subgroups", "select").reply(ok([group]));
  fake.from("subgroup_memberships", "select").reply(ok([active]));
  fake.from("announcements", "select").reply(ok([]));
  fake.from("archive_items", "select").reply(ok([]));
  fake.from("events", "select").reply(ok([]));
  fake.from("resources", "select").reply(ok([]));
  fake.rpc("get_attendance_overview").reply(ok({}));
  window.history.replaceState({}, "", url);
  return openPortal({ role: "member", boot: { groups: [group], memberships: [active] } });
}

describe("a group's tabs hold the screens of the other areas", () => {
  it("Resources shows the library, already on that group", async () => {
    openGroupsPage("/?page=groups&group=7&tab=resources");
    const panel = await screen.findByRole("tabpanel", { name: "Resources" }, { timeout: 5000 });
    expect(await within(panel).findByRole("region", { name: "Resources" }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("Attendance shows the attendance page, already on that group", async () => {
    openGroupsPage("/?page=groups&group=7&tab=attendance");
    const panel = await screen.findByRole("tabpanel", { name: "Attendance" }, { timeout: 5000 });
    expect(await within(panel).findByLabelText("Filter attendance by audience", undefined, { timeout: 5000 })).toHaveValue("group:7");
  });

  it("Recordings keeps its short panel with the button that opens the page for the group (its own address parameters would clash with the group page's)", async () => {
    openGroupsPage("/?page=groups&group=7&tab=recordings");
    const panel = await screen.findByRole("tabpanel", { name: "Recordings" }, { timeout: 5000 });
    expect(within(panel).getByRole("button", { name: "Open recording room →" })).toBeInTheDocument();
  });
});

describe("My Groups in the menu while a group is open", () => {
  it("goes back to the list of groups (the address loses the group and the tab, and the page follows)", async () => {
    openGroupsPage("/?page=groups&group=7&tab=announcements");
    await screen.findByRole("tablist", { name: "Group sections" }, { timeout: 5000 });
    nav("My Groups");
    await waitFor(() => expect(screen.queryByRole("tablist", { name: "Group sections" })).not.toBeInTheDocument());
    expect(window.location.search).toBe("?page=groups");
    // The list is back: the group is a row again.
    expect(await screen.findByRole("button", { name: /Hindustani Vocal/ })).toBeInTheDocument();
  });

  it("adds nothing to the history when the list is already open", async () => {
    openGroupsPage("/?page=groups");
    await screen.findByRole("button", { name: /Hindustani Vocal/ }, { timeout: 5000 });
    const before = window.history.length;
    nav("My Groups");
    expect(window.history.length).toBe(before);
  });
});
