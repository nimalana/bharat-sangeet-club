// Groups: roster set-up by an executive, join requests reviewed by a manager who is not an
// executive, the member seeing the workspace with the same session, removal and re-joining.
import { ok, equal, refused, succeeded, rowsOf, firstRow } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";

export default async function groups(t, ctx) {
  const { c, id } = ctx;
  const s = (ctx.state.g = {});
  t.setSection("10 groups, join requests, removal");

  await t.test("executive creates group A (approval), B (invite) and C (open) with create_subgroup", async () => {
    for (const [key, mode] of [["A", "approval"], ["B", "invite"], ["C", "open"]]) {
      const row = firstRow(succeeded(await c.execA.rpc("create_subgroup", { subgroup_name: mark(`Group ${key}`), subgroup_description: "created by the e2e suite", subgroup_mode: mode }), `create group ${key}`));
      ok(row?.id, `group ${key} was not returned`);
      s[key] = row.id;
      equal(row.enrollment_mode, mode, `group ${key} mode`);
    }
    const mine = rowsOf(await c.execA.from("subgroup_memberships").select("subgroup_id,membership_role,status").eq("member_id", id.execA).in("subgroup_id", [s.A, s.B, s.C]), "creator memberships");
    equal(mine.map((r) => r.membership_role).sort(), ["manager", "manager", "manager"], "creator is manager of each new group");
  });

  await t.test("executive seeds the rosters: manager (A and C), leader (A), member1 (A), victim (A), member2 (B)", async () => {
    const add = async (groupId, who, role) => {
      succeeded(await c.execA.rpc("add_subgroup_member", { p_subgroup_id: groupId, p_member_id: id[who] }), `add ${who} to ${groupId}`);
      if (role !== "member") succeeded(await c.execA.rpc("set_subgroup_member_role", { target_subgroup_id: groupId, target_member_id: id[who], next_role: role }), `make ${who} ${role}`);
    };
    await add(s.A, "manager", "manager");
    await add(s.A, "leader", "leader");
    await add(s.A, "member1", "member");
    await add(s.A, "victim", "member");
    await add(s.B, "member2", "member");
    await add(s.C, "manager", "manager");
    const roster = rowsOf(await c.member1.rpc("list_subgroup_roster", { p_subgroup_id: s.A }), "member1 reads roster of A");
    const byRole = Object.fromEntries(roster.map((r) => [r.email, r.membership_role]));
    equal(byRole[ctx.accounts.manager.email], "manager", "manager role in roster");
    equal(byRole[ctx.accounts.leader.email], "leader", "leader role in roster");
  });

  await t.test("a plain member cannot add members or change roles (executive only)", async () => {
    refused(await c.member1.rpc("add_subgroup_member", { p_subgroup_id: s.A, p_member_id: id.hist }), "member1 add_subgroup_member", /executives/i);
    refused(await c.manager.rpc("set_subgroup_member_role", { target_subgroup_id: s.A, target_member_id: id.member1, next_role: "manager" }), "group manager set_subgroup_member_role", /executive/i);
  });

  await t.test("executive posts a group-A announcement and event so there is something only A members can see", async () => {
    const ann = succeeded(await c.execA.from("announcements").insert({ title: mark("Group A notice"), body: "visible to group A only", is_pinned: false, subgroup_id: s.A, created_by: id.execA }).select("id").single(), "insert announcement");
    s.annA = ann.id;
    const ev = succeeded(await c.execA.from("events").insert({ title: mark("Group A rehearsal"), description: "", starts_at: new Date(Date.now() + 5 * 86400000).toISOString(), location: "Hill Hall", subgroup_id: s.A, created_by: id.execA }).select("id").single(), "insert event");
    s.evA = ev.id;
  });

  await t.test("a join request to an approval group is pending, and the requester cannot see group content yet", async () => {
    const row = succeeded(await c.nohist.rpc("request_subgroup_enrollment", { target_subgroup_id: s.A }), "nohist requests A");
    equal(row.status, "pending", "request status");
    const boot = succeeded(await c.nohist.rpc("get_portal_bootstrap"), "bootstrap before approval");
    ok(!boot.announcements.some((a) => a.id === s.annA), "nohist can already see group A's announcement while only pending");
    ok(!boot.events.some((e) => e.id === s.evA), "nohist can already see group A's event while only pending");
    equal(boot.memberships.find((m) => m.subgroup_id === s.A)?.status, "pending", "membership status in bootstrap");
  });

  await t.test("only a manager, leader or executive can review: plain members of A and of other groups are refused", async () => {
    refused(await c.member1.rpc("review_subgroup_request", { p_subgroup_id: s.A, p_member_id: id.nohist, p_decision: "approve" }), "member1 reviewing", /leaders and executives/i);
    refused(await c.member2.rpc("review_subgroup_request", { p_subgroup_id: s.A, p_member_id: id.nohist, p_decision: "approve" }), "member2 reviewing", /leaders and executives/i);
    refused(await c.manager.rpc("review_subgroup_request", { p_subgroup_id: s.A, p_member_id: id.nohist, p_decision: "maybe" }), "manager with an invalid decision", /approve, waitlist, or decline/i);
  });

  await t.test("a group manager who is NOT an executive approves the request; the member then sees the group's workspace without signing in again", async () => {
    const mgrBoot = succeeded(await c.manager.rpc("get_portal_bootstrap"), "manager bootstrap");
    equal(mgrBoot.profile.role, "member", "the manager must be a plain member for this test");
    const row = succeeded(await c.manager.rpc("review_subgroup_request", { p_subgroup_id: s.A, p_member_id: id.nohist, p_decision: "approve" }), "manager approves");
    equal(row.status, "active", "status after approval");
    // Same client object, same access token: nothing was refreshed or re-created.
    const boot = succeeded(await c.nohist.rpc("get_portal_bootstrap"), "bootstrap after approval");
    equal(boot.memberships.find((m) => m.subgroup_id === s.A)?.status, "active", "membership in bootstrap after approval");
    ok(boot.announcements.some((a) => a.id === s.annA), "group A announcement not visible after approval");
    ok(boot.events.some((e) => e.id === s.evA), "group A event not visible after approval");
    const roster = rowsOf(await c.nohist.rpc("list_subgroup_roster", { p_subgroup_id: s.A }), "roster after approval");
    ok(roster.some((r) => r.email === ctx.accounts.nohist.email), "nohist is not in the roster of A after approval");
  });

  await t.test("a leader can waitlist and a manager can decline; a decided request cannot be decided again", async () => {
    succeeded(await c.hist.rpc("request_subgroup_enrollment", { target_subgroup_id: s.A }), "hist requests A");
    const waitlisted = succeeded(await c.leader.rpc("review_subgroup_request", { p_subgroup_id: s.A, p_member_id: id.hist, p_decision: "waitlist" }), "leader waitlists");
    equal(waitlisted.status, "waitlisted", "waitlist status");
    succeeded(await c.member2.rpc("request_subgroup_enrollment", { target_subgroup_id: s.A }), "member2 requests A");
    const declined = succeeded(await c.manager.rpc("review_subgroup_request", { p_subgroup_id: s.A, p_member_id: id.member2, p_decision: "decline" }), "manager declines");
    equal(declined.status, "inactive", "decline status");
    refused(await c.manager.rpc("review_subgroup_request", { p_subgroup_id: s.A, p_member_id: id.member2, p_decision: "approve" }), "approving a declined request", /no longer waiting/i);
    const boot = succeeded(await c.member2.rpc("get_portal_bootstrap"), "member2 bootstrap");
    ok(!boot.announcements.some((a) => a.id === s.annA), "a declined requester can see group A's announcement");
  });

  await t.test("an invitation-only group refuses join requests", async () => {
    refused(await c.hist.rpc("request_subgroup_enrollment", { target_subgroup_id: s.B }), "request to invite-only group", /invitation only/i);
  });

  await t.test("group manager renames the group; a leader and a plain member cannot", async () => {
    const renamed = succeeded(await c.manager.rpc("update_subgroup", { p_subgroup_id: s.A, p_name: mark("Group A renamed"), p_description: "renamed by the e2e manager" }), "manager renames A");
    equal(renamed.name, mark("Group A renamed"), "new name");
    refused(await c.leader.rpc("update_subgroup", { p_subgroup_id: s.A, p_name: mark("Group A by leader"), p_description: "" }), "leader renaming", /managers and executives/i);
    refused(await c.member1.rpc("update_subgroup", { p_subgroup_id: s.A, p_name: mark("Group A by member"), p_description: "" }), "member renaming", /managers and executives/i);
    const dup = await c.manager.rpc("update_subgroup", { p_subgroup_id: s.A, p_name: mark("Group B"), p_description: "" });
    refused(dup, "renaming onto another group's name", /already uses that name/i);
  });

  await t.test("only executives change how members join", async () => {
    refused(await c.manager.rpc("set_subgroup_enrollment_mode", { p_subgroup_id: s.A, p_mode: "open" }), "manager changing enrollment mode", /executives/i);
    equal(succeeded(await c.execA.rpc("set_subgroup_enrollment_mode", { p_subgroup_id: s.A, p_mode: "approval" }), "exec sets mode").enrollment_mode, "approval", "mode after executive change");
  });

  await t.test("open group C: members join at once; the manager removes a plain member but not another manager; a leader cannot remove", async () => {
    equal(succeeded(await c.nohist.rpc("request_subgroup_enrollment", { target_subgroup_id: s.C }), "nohist joins C").status, "active", "open group status");
    equal(succeeded(await c.hist.rpc("request_subgroup_enrollment", { target_subgroup_id: s.C }), "hist joins C").status, "active", "open group status (hist)");
    // execA created C and is a manager of C, as is `manager`.
    refused(await c.manager.rpc("remove_subgroup_member", { p_subgroup_id: s.C, p_member_id: id.execA }), "manager removing another manager", /executives can remove a group leader or manager/i);
    refused(await c.manager.rpc("remove_subgroup_member", { p_subgroup_id: s.C, p_member_id: id.manager }), "manager removing themselves", /Leave group/i);
    refused(await c.leader.rpc("remove_subgroup_member", { p_subgroup_id: s.A, p_member_id: id.member1 }), "leader removing a member", /managers and executives/i);
    refused(await c.member1.rpc("remove_subgroup_member", { p_subgroup_id: s.A, p_member_id: id.victim }), "member removing a member", /managers and executives/i);
    const removed = succeeded(await c.manager.rpc("remove_subgroup_member", { p_subgroup_id: s.C, p_member_id: id.nohist }), "manager removes nohist");
    equal(removed.status, "removed", "status after removal");
  });

  await t.test("a removed member cannot rejoin the open group by themselves, an executive can add them back", async () => {
    refused(await c.nohist.rpc("request_subgroup_enrollment", { target_subgroup_id: s.C }), "removed member re-requesting an open group", /removed from this group/i);
    const roster = rowsOf(await c.manager.rpc("list_subgroup_roster", { p_subgroup_id: s.C }), "roster of C");
    ok(!roster.some((r) => r.email === ctx.accounts.nohist.email), "removed member still listed in the roster");
    // They can leave other groups voluntarily and the status is 'inactive', which does allow rejoining.
    succeeded(await c.hist.rpc("leave_subgroup", { p_subgroup_id: s.C }), "hist leaves C");
    equal(succeeded(await c.hist.rpc("request_subgroup_enrollment", { target_subgroup_id: s.C }), "hist rejoins C after leaving").status, "active", "voluntary leaver can rejoin an open group");
    succeeded(await c.execA.rpc("add_subgroup_member", { p_subgroup_id: s.C, p_member_id: id.nohist }), "executive adds the removed member back");
    succeeded(await c.manager.rpc("remove_subgroup_member", { p_subgroup_id: s.C, p_member_id: id.nohist }), "manager removes nohist again");
  });
}
