// lib/api/members.ts: the member directory (three reads asked together), a member's own contact update, and the picker list a group
// adds from. Each sends exactly the call the screens used to send; a failure is an ApiError that keeps the database's words.
import { describe, expect, it } from "vitest";
import { getMemberDirectory, listAddableMembers, updateOwnContact } from "../../lib/api/members";
import { ApiError } from "../../lib/errors";
import { deferred, fail, fake, ok } from "../support/fake-supabase";

const chainOf = (call: { chain: Array<{ method: string; args: unknown[] }> }) => call.chain.map((link) => [link.method, ...link.args]);

describe("getMemberDirectory", () => {
  it("asks for the active members, the groups and the memberships, in that order, with the limits it has always used", async () => {
    fake.from("profiles", "select").reply(ok([{ id: "u-1", full_name: "Asha", email: "a@x.test", role: "member" }]));
    fake.from("subgroups", "select").reply(ok([{ id: 7, name: "Vocal" }]));
    fake.from("subgroup_memberships", "select").reply(ok([{ subgroup_id: 7, member_id: "u-1", status: "active", membership_role: "member" }]));
    const directory = await getMemberDirectory();
    expect(directory).toEqual({
      members: [{ id: "u-1", full_name: "Asha", email: "a@x.test", role: "member" }],
      groups: [{ id: 7, name: "Vocal" }],
      memberships: [{ subgroup_id: 7, member_id: "u-1", status: "active", membership_role: "member" }],
    });
    expect(fake.calls.map((call) => call.target)).toEqual(["profiles", "subgroups", "subgroup_memberships"]);
    expect(chainOf(fake.calls[0])).toEqual([["select", "id,full_name,email,role,phone,class_year,specialty,joined_at"], ["eq", "status", "active"], ["order", "full_name"], ["limit", 2000]]);
    expect(chainOf(fake.calls[1])).toEqual([["select", "id,name,description,enrollment_mode"], ["order", "name"]]);
    expect(chainOf(fake.calls[2])).toEqual([["select", "subgroup_id,member_id,status,membership_role"], ["limit", 5000]]);
  });

  it("any one read failing fails the whole directory, with that read's words", async () => {
    fake.from("profiles", "select").reply(ok([]));
    fake.from("subgroups", "select").reply(fail("boom", "XX000"));
    const error = await getMemberDirectory().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "boom", code: "XX000" });
  });

  it("waits for all three reads before it answers, so a slow read is never left behind a failure", async () => {
    const slow = deferred();
    fake.from("profiles", "select").reply(fail("first read failed"));
    fake.from("subgroups", "select").reply(slow.reply);
    let settled = false;
    const outcome = getMemberDirectory().catch((caught) => caught).finally(() => { settled = true; });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    slow.resolve(ok([]));
    expect(await outcome).toMatchObject({ message: "first read failed" });
  });
});

describe("updateOwnContact", () => {
  it("updates the four contact columns of the member's own row", async () => {
    fake.from("profiles", "update").reply(ok(null));
    await updateOwnContact("u-me", { fullName: "Asha Rao", phone: "919-555-0100", classYear: "2028", specialty: "Veena" });
    const [call] = fake.from("profiles", "update").calls;
    expect(fake.calls).toHaveLength(1);
    expect(call.payload).toEqual({ full_name: "Asha Rao", phone: "919-555-0100", class_year: "2028", specialty: "Veena" });
    expect(chainOf(call)).toEqual([["update", call.payload], ["eq", "id", "u-me"]]);
  });

  it("throws an ApiError with the database's own sentence when the update is refused", async () => {
    fake.from("profiles", "update").reply(fail("Phone numbers must be 10 digits", "P0001"));
    const error = await updateOwnContact("u-me", { fullName: "A", phone: "1", classYear: "", specialty: "" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Phone numbers must be 10 digits", code: "P0001" });
  });
});

describe("listAddableMembers", () => {
  it("lists the active members by name, at most 1000, for the add-a-member picker", async () => {
    fake.from("profiles", "select").reply(ok([{ id: "u-1", full_name: "Asha", email: "a@x.test" }]));
    expect(await listAddableMembers()).toEqual([{ id: "u-1", full_name: "Asha", email: "a@x.test" }]);
    expect(chainOf(fake.calls[0])).toEqual([["select", "id,full_name,email"], ["eq", "status", "active"], ["order", "full_name"], ["limit", 1000]]);
  });

  it("throws an ApiError when the read fails", async () => {
    fake.from("profiles", "select").reply(fail("permission denied for table profiles", "42501"));
    expect(await listAddableMembers().catch((caught) => caught)).toBeInstanceOf(ApiError);
  });
});
