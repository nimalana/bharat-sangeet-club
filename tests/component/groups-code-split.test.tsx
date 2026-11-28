// The people tabs (Roster, Requests) and the Dates tab of a group's page are their own bundles, fetched when the tab is first opened
// (features/groups/components/group-detail.tsx, next/dynamic), so that the groups page does not carry the roster, its dialogs and the
// dates for a person who only reads the announcements. Until the people tabs' file has arrived the panel shows a skeleton with a polite
// status (not a blank). Like shell-code-split.test.tsx, the test below opens the tab for the FIRST time in this file, so the file really
// is being fetched when the check runs: that is why it is kept in a file of its own. (The Dates tab's loader says the same words as the
// skeleton of its own read, "Loading the dates", so a test cannot tell the two apart; its states are in group-tabs.test.tsx.)
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const GROUP = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "approval", archived_at: null };

function openGroupAt(tab: string) {
  fake.from("subgroups", "select").reply(ok([GROUP]));
  fake.from("subgroup_memberships", "select").reply(ok([{ subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" }]));
  fake.from("announcements", "select").reply(ok([]));
  fake.from("archive_items", "select").reply(ok([]));
  fake.rpc("list_subgroup_roster").reply(ok([{ member_id: "u-me", full_name: "Asha Rao", email: "u-me@x.test", status: "active", membership_role: "member", joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" }]));
  fake.from("events", "select").reply(ok([]));
  openPortal({ role: "member", page: `groups&group=7&tab=${tab}`, boot: { groups: [GROUP], memberships: [{ subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" }] } });
}

describe("a group's tab that is its own bundle shows a skeleton until its file has arrived", () => {
  it("the Roster tab", async () => {
    openGroupAt("roster");
    const loading = await screen.findByText("Loading the people");
    expect(loading).toHaveAttribute("role", "status");
    expect(await screen.findByText("Asha Rao (you)", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText("Loading the people")).not.toBeInTheDocument();
  });
});
