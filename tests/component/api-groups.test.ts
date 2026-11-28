// lib/api/groups.ts: every function sends exactly the call the group screens used to send themselves (table, operation, chain,
// arguments, payload), returns what the screen used, and throws an ApiError that keeps the database's words when the call fails.
// (Here and not under node --test because the modules import ../errors without an extension, as the app's code does.)
import { describe, expect, it } from "vitest";
import {
  addSubgroupMember, createSubgroup, leaveSubgroup, listAllMemberships, listGroupAnnouncements, listGroupRecordings, listMyMemberships, listOthersWaitingRequests,
  listSubgroupRoster, listSubgroups, postGroupAnnouncement, removeSubgroupMember, requestSubgroupEnrollment, reviewSubgroupRequest, setSubgroupArchived,
  setSubgroupEnrollmentMode, setSubgroupMemberRole, updateSubgroup,
} from "../../lib/api/groups";
import { ApiError } from "../../lib/errors";
import { fail, fake, ok } from "../support/fake-supabase";

const chainOf = (call: { chain: Array<{ method: string; args: unknown[] }> }) => call.chain.map((link) => [link.method, ...link.args]);

describe("the group reads", () => {
  const reads = [
    ["listSubgroups", "subgroups", () => listSubgroups(), [["select", "id,name,description,enrollment_mode,archived_at"], ["order", "name"]]],
    ["listMyMemberships", "subgroup_memberships", () => listMyMemberships("u-me"), [["select", "subgroup_id,member_id,status,membership_role"], ["eq", "member_id", "u-me"]]],
    ["listAllMemberships", "subgroup_memberships", () => listAllMemberships(), [["select", "subgroup_id,member_id,status,membership_role"], ["limit", 5000]]],
    ["listGroupRecordings", "archive_items", () => listGroupRecordings(), [["select", "*"], ["eq", "type", "recording"], ["not", "subgroup_id", "is", null], ["order", "created_at", { ascending: false }], ["limit", 500]]],
    ["listGroupAnnouncements", "announcements", () => listGroupAnnouncements(), [["select", "*"], ["not", "subgroup_id", "is", null], ["order", "published_at", { ascending: false }], ["limit", 300]]],
    ["listOthersWaitingRequests", "subgroup_memberships", () => listOthersWaitingRequests("u-me"), [["select", "subgroup_id"], ["in", "status", ["pending", "waitlisted"]], ["neq", "member_id", "u-me"]]],
  ] as const;

  it.each(reads)("%s asks for exactly the rows the page always asked for", async (_name, table, read, chain) => {
    fake.from(table, "select").reply(ok([{ id: 1 }]));
    expect(await read()).toEqual([{ id: 1 }]);
    const [call] = fake.from(table, "select").calls;
    expect(fake.calls).toHaveLength(1);
    expect(chainOf(call)).toEqual(chain.map((link) => [...link]));
  });

  it.each(reads)("%s throws an ApiError that keeps the database's message and code", async (_name, table, read) => {
    fake.from(table, "select").reply(fail("Something the database said", "42501"));
    const error = await read().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Something the database said", code: "42501" });
  });
});

describe("the group writes and RPCs", () => {
  const rpcs = [
    ["requestSubgroupEnrollment", "request_subgroup_enrollment", () => requestSubgroupEnrollment(7), { target_subgroup_id: 7 }],
    ["createSubgroup", "create_subgroup", () => createSubgroup({ name: "Hindustani Ensemble", description: "Weekly", mode: "approval" }), { subgroup_name: "Hindustani Ensemble", subgroup_description: "Weekly", subgroup_mode: "approval" }],
    ["listSubgroupRoster", "list_subgroup_roster", () => listSubgroupRoster(7), { p_subgroup_id: 7 }],
    ["reviewSubgroupRequest", "review_subgroup_request", () => reviewSubgroupRequest(7, "u-dev", "waitlist"), { p_subgroup_id: 7, p_member_id: "u-dev", p_decision: "waitlist" }],
    ["setSubgroupMemberRole", "set_subgroup_member_role", () => setSubgroupMemberRole(7, "u-dev", "leader"), { target_subgroup_id: 7, target_member_id: "u-dev", next_role: "leader" }],
    ["removeSubgroupMember", "remove_subgroup_member", () => removeSubgroupMember(7, "u-dev"), { p_subgroup_id: 7, p_member_id: "u-dev" }],
    ["leaveSubgroup", "leave_subgroup", () => leaveSubgroup(7), { p_subgroup_id: 7 }],
    ["setSubgroupArchived", "set_subgroup_archived", () => setSubgroupArchived(7, true), { p_subgroup_id: 7, p_archived: true }],
    ["addSubgroupMember", "add_subgroup_member", () => addSubgroupMember(7, "u-dev"), { p_subgroup_id: 7, p_member_id: "u-dev" }],
    ["updateSubgroup", "update_subgroup", () => updateSubgroup(7, "New name", "New description"), { p_subgroup_id: 7, p_name: "New name", p_description: "New description" }],
    ["setSubgroupEnrollmentMode", "set_subgroup_enrollment_mode", () => setSubgroupEnrollmentMode(7, "invite"), { p_subgroup_id: 7, p_mode: "invite" }],
  ] as const;

  it.each(rpcs)("%s calls %s once with exactly these arguments", async (_name, rpc, run, args) => {
    fake.rpc(rpc).reply(ok(null));
    await run();
    expect(fake.calls).toHaveLength(1);
    expect(fake.rpc(rpc).calls[0].payload).toEqual(args);
  });

  it.each(rpcs)("%s throws an ApiError that keeps the database's message and code", async (_name, rpc, run) => {
    fake.rpc(rpc).reply(fail("Only executives can do that", "P0001"));
    const error = await run().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Only executives can do that", code: "P0001" });
  });

  it("requestSubgroupEnrollment returns the membership row, createSubgroup the group row", async () => {
    fake.rpc("request_subgroup_enrollment").reply(ok({ subgroup_id: 7, member_id: "u-me", status: "pending", membership_role: "member" }));
    fake.rpc("create_subgroup").reply(ok({ id: 9, name: "New" }));
    expect(await requestSubgroupEnrollment(7)).toEqual({ subgroup_id: 7, member_id: "u-me", status: "pending", membership_role: "member" });
    expect(await createSubgroup({ name: "New", description: "", mode: "open" })).toEqual({ id: 9, name: "New" });
  });

  it("listSubgroupRoster returns the rows, and an empty list when the database answers with nothing", async () => {
    fake.rpc("list_subgroup_roster").replyOnce(ok([{ member_id: "u-dev" }])).replyOnce(ok(null));
    expect(await listSubgroupRoster(7)).toEqual([{ member_id: "u-dev" }]);
    expect(await listSubgroupRoster(7)).toEqual([]);
  });

  it("postGroupAnnouncement inserts one announcement for the group, with the author and the pin", async () => {
    fake.from("announcements", "insert").reply(ok(null));
    await postGroupAnnouncement({ title: "Rehearsal", body: "Moved to 7", isPinned: true, subgroupId: 7, createdBy: "u-me" });
    const [call] = fake.from("announcements", "insert").calls;
    expect(fake.calls).toHaveLength(1);
    expect(call.payload).toEqual({ title: "Rehearsal", body: "Moved to 7", is_pinned: true, subgroup_id: 7, created_by: "u-me" });
  });

  it("postGroupAnnouncement throws an ApiError when the insert is refused", async () => {
    fake.from("announcements", "insert").reply(fail("new row violates row-level security policy", "42501"));
    const error = await postGroupAnnouncement({ title: "x", body: "y", isPinned: false, subgroupId: 7, createdBy: "u-me" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "42501" });
  });
});
