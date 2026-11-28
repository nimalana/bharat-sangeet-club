// lib/api/admin.ts: the Admin page's three reads, its administrator-only RPCs and its announcement form. Each sends exactly the call
// the page used to send; a failure is an ApiError that keeps the database's words (the page's sentences are friendlyError's).
import { describe, expect, it } from "vitest";
import {
  changeMemberRole, deactivateMember, deleteMember, listAdminAnnouncements, listAdminMembers, listAuditLog, publishAnnouncement, reactivateMember, updateMemberProfile,
} from "../../lib/api/admin";
import { ApiError } from "../../lib/errors";
import { fail, fake, ok } from "../support/fake-supabase";

const chainOf = (call: { chain: Array<{ method: string; args: unknown[] }> }) => call.chain.map((link) => [link.method, ...link.args]);

describe("the Admin page reads", () => {
  it("listAdminMembers: every member, deactivated ones too, by name, at most 2000", async () => {
    fake.from("profiles", "select").reply(ok([{ id: "u-1" }]));
    expect(await listAdminMembers()).toEqual([{ id: "u-1" }]);
    expect(chainOf(fake.calls[0])).toEqual([["select", "id,full_name,email,role,status,phone,class_year,specialty,joined_at"], ["order", "full_name"], ["limit", 2000]]);
  });

  it("listAdminAnnouncements: pinned first, then newest, at most 50", async () => {
    fake.from("announcements", "select").reply(ok([{ id: 1 }]));
    expect(await listAdminAnnouncements()).toEqual([{ id: 1 }]);
    expect(chainOf(fake.calls[0])).toEqual([["select", "*"], ["order", "is_pinned", { ascending: false }], ["order", "published_at", { ascending: false }], ["limit", 50]]);
  });

  it("listAuditLog: the 20 latest actions, newest first", async () => {
    fake.from("admin_audit_log", "select").reply(ok([{ id: 1 }]));
    expect(await listAuditLog()).toEqual([{ id: 1 }]);
    expect(chainOf(fake.calls[0])).toEqual([["select", "id,action,actor_email,target_email,details,created_at"], ["order", "created_at", { ascending: false }], ["limit", 20]]);
  });

  it.each([
    ["listAdminMembers", "profiles", () => listAdminMembers()],
    ["listAdminAnnouncements", "announcements", () => listAdminAnnouncements()],
    ["listAuditLog", "admin_audit_log", () => listAuditLog()],
  ] as const)("%s throws an ApiError that keeps the database's message and code", async (_name, table, read) => {
    fake.from(table, "select").reply(fail("permission denied", "42501"));
    const error = await read().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "permission denied", code: "42501" });
  });
});

describe("the administrator RPCs", () => {
  const rpcs = [
    ["changeMemberRole", "admin_change_member_role", () => changeMemberRole("u-2", "executive"), { p_target_id: "u-2", p_new_role: "executive" }],
    ["updateMemberProfile", "admin_update_member_profile", () => updateMemberProfile("u-2", { fullName: "Bala Menon", phone: "919", classYear: "2027", specialty: "Violin", subgroupIds: [7, 9] }), { p_target_id: "u-2", p_full_name: "Bala Menon", p_phone: "919", p_class_year: "2027", p_specialty: "Violin", p_subgroup_ids: [7, 9] }],
    ["deactivateMember", "admin_deactivate_member", () => deactivateMember("u-2", "Graduated"), { p_target_id: "u-2", p_reason: "Graduated" }],
    ["reactivateMember", "admin_reactivate_member", () => reactivateMember("u-2"), { p_target_id: "u-2" }],
    ["deleteMember", "admin_delete_member", () => deleteMember("u-2"), { p_target_id: "u-2" }],
  ] as const;

  it.each(rpcs)("%s calls %s once with exactly these arguments", async (_name, rpc, run, args) => {
    fake.rpc(rpc).reply(ok(null));
    await run();
    expect(fake.calls).toHaveLength(1);
    expect(fake.rpc(rpc).calls[0].payload).toEqual(args);
  });

  it.each(rpcs)("%s throws an ApiError that keeps the database's message and code", async (_name, rpc, run) => {
    fake.rpc(rpc).reply(fail("Only administrators can change member roles", "P0001"));
    const error = await run().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Only administrators can change member roles", code: "P0001" });
  });
});

describe("publishAnnouncement", () => {
  it("to the whole club: no group in the row", async () => {
    fake.from("announcements", "insert").reply(ok(null));
    await publishAnnouncement({ title: "Welcome", body: "Hello", isPinned: false, createdBy: "u-me", subgroupId: null });
    const [call] = fake.from("announcements", "insert").calls;
    expect(call.payload).toEqual({ title: "Welcome", body: "Hello", is_pinned: false, created_by: "u-me" });
    expect(call.payload).not.toHaveProperty("subgroup_id");
  });

  it("to one group: the group is in the row, and a pinned one says so", async () => {
    fake.from("announcements", "insert").reply(ok(null));
    await publishAnnouncement({ title: "Rehearsal", body: "Moved", isPinned: true, createdBy: "u-me", subgroupId: 7 });
    expect(fake.from("announcements", "insert").calls[0].payload).toEqual({ title: "Rehearsal", body: "Moved", is_pinned: true, created_by: "u-me", subgroup_id: 7 });
  });

  it("throws an ApiError when the insert is refused", async () => {
    fake.from("announcements", "insert").reply(fail("new row violates row-level security policy", "42501"));
    const error = await publishAnnouncement({ title: "x", body: "y", isPinned: false, createdBy: "u-me", subgroupId: null }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "42501" });
  });
});
