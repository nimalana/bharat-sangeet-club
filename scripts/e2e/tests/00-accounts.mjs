// Real sign-in, the signup trigger, and role changes through the app's admin function.
import { ok, equal, refused, succeeded, rowsOf } from "../lib/assert.mjs";

export default async function accounts(t, ctx) {
  const { c, id } = ctx;
  t.setSection("00 accounts and roles");

  await t.test("every test account signs in with a password (real GoTrue) and has a profile from the signup trigger", async () => {
    for (const key of Object.keys(c)) {
      const { data, error } = await c[key].auth.getUser();
      ok(!error && data.user?.id === id[key], `${key}: getUser failed ${error?.message}`);
      const profile = succeeded(await c[key].from("profiles").select("id,email,full_name,role,status").eq("id", id[key]).maybeSingle(), `${key} own profile`);
      ok(profile, `${key} has no profile row, so the on_auth_user_created trigger did not run`);
      equal(profile.email, ctx.accounts[key].email, `${key} profile email`);
      equal(profile.status, "active", `${key} profile status`);
    }
  });

  await t.test("get_portal_bootstrap reports the admin role for the admin account", async () => {
    const boot = succeeded(await c.admin.rpc("get_portal_bootstrap"), "get_portal_bootstrap");
    equal(boot.profile.role, "admin", "admin role in bootstrap");
    equal(boot.profile.status, "active", "admin status in bootstrap");
  });

  await t.test("a member cannot promote themselves (profiles.role is not writable) and an executive cannot call admin_change_member_role", async () => {
    const direct = await c.member1.from("profiles").update({ role: "admin" }).eq("id", id.member1).select("id,role");
    refused(direct, "member updating profiles.role");
    const viaRpc = await c.member1.rpc("admin_change_member_role", { p_target_id: id.member1, p_new_role: "admin" });
    refused(viaRpc, "member calling admin_change_member_role", /administrators/i);
    const profile = succeeded(await c.member1.from("profiles").select("role").eq("id", id.member1).maybeSingle(), "re-read role");
    equal(profile.role, "member", "member1 role unchanged");
  });

  await t.test("admin promotes the two executives with admin_change_member_role and the new role applies at once, with the same session", async () => {
    const emails = [ctx.accounts.execA.email, ctx.accounts.execB.email];
    const promotions = async () => rowsOf(await c.admin.from("admin_audit_log").select("action,target_email,details").eq("action", "role_changed").in("target_email", emails), "audit log")
      .filter((row) => row.details?.new_role === "executive");
    // The accounts stay executives between runs (cleanup.sql keeps them as they are), and admin_change_member_role writes an audit row only
    // when the role really changes. So start from plain members: the promotion below is then a real change, and it must be audited.
    for (const key of ["execA", "execB"]) {
      const now = succeeded(await c[key].rpc("get_portal_bootstrap"), `${key} bootstrap`).profile.role;
      if (now === "member") continue;
      equal(succeeded(await c.admin.rpc("admin_change_member_role", { p_target_id: id[key], p_new_role: "member" }), `demote ${key}`).role, "member", `${key} role after demotion`);
      equal(succeeded(await c[key].rpc("get_portal_bootstrap"), `${key} bootstrap after demotion`).profile.role, "member", `${key} sees the demotion without signing in again`);
    }
    const before = (await promotions()).length;
    for (const key of ["execA", "execB"]) {
      const res = await c.admin.rpc("admin_change_member_role", { p_target_id: id[key], p_new_role: "executive" });
      const row = succeeded(res, `promote ${key}`);
      equal(row.role, "executive", `${key} role after promotion`);
      const boot = succeeded(await c[key].rpc("get_portal_bootstrap"), `${key} bootstrap`);
      equal(boot.profile.role, "executive", `${key} sees executive without signing in again`);
    }
    const after = await promotions();
    equal(after.length - before, 2, "role_changed audit rows written by these two promotions (one each)");
    for (const email of emails) ok(after.some((row) => row.target_email === email), `no role_changed audit row for ${email}`);
  });

  await t.test("an executive is not an administrator: admin RPCs and the audit log are closed to them", async () => {
    refused(await c.execA.rpc("admin_change_member_role", { p_target_id: id.member1, p_new_role: "executive" }), "executive changing a role", /administrators/i);
    refused(await c.execA.rpc("admin_deactivate_member", { p_target_id: id.member1, p_reason: "no" }), "executive deactivating", /administrators/i);
    const log = rowsOf(await c.execA.from("admin_audit_log").select("id").limit(1), "executive reading audit log");
    equal(log.length, 0, "rows of admin_audit_log visible to an executive");
  });

  await t.test("the admin can read the member directory with the app's own query (profiles incl. role and status)", async () => {
    const members = rowsOf(await c.admin.from("profiles").select("id,full_name,email,role,status,phone,class_year,specialty,joined_at").in("status", ["active", "deactivated"]).order("full_name").limit(2000), "admin member list");
    ok(members.length >= 11, `expected at least the 10 test accounts and the bootstrap admin, got ${members.length}`);
  });
}
