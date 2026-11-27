// admin_delete_member: refused with a readable message for an account that has finance history,
// and a clean delete for an account that has none (including what a deleted member's old session can still do).
import { ok, equal, refused, succeeded, rowsOf, firstRow } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";
import { png } from "../lib/fixtures.mjs";
import { put, uid, servedFromCache } from "../lib/storage.mjs";

export default async function adminDelete(t, ctx) {
  const { c, id } = ctx;
  const g = ctx.state.g;
  t.setSection("90 admin delete");

  await t.test("an account with finance history cannot be deleted: the administrator gets the readable message, and nothing is removed", async () => {
    const sub = firstRow(succeeded(await c.hist.rpc("submit_member_reimbursement", {
      p_description: mark("History reimbursement"), p_vendor: "Music Shop", p_amount: 9, p_purchase_date: new Date().toISOString().slice(0, 10),
      p_category: "Supplies", p_payment_card_last4: "1234",
    }), "hist submits a reimbursement"));
    const path = `${id.hist}/${uid()}-receipt.png`;
    succeeded(await put(c.hist, "finance-private", path, png(), "image/png"), "hist uploads a receipt");
    const doc = succeeded(await c.hist.from("finance_documents").insert({ document_type: "receipt", title: mark("History receipt"), storage_path: path, mime_type: "image/png", file_size_bytes: png().length, uploaded_by: id.hist }).select("id").single(), "receipt record");
    succeeded(await c.hist.from("finance_reimbursement_documents").insert({ reimbursement_id: sub.reimbursement_id, document_id: doc.id }), "link the receipt");
    succeeded(await c.execA.rpc("review_personal_reimbursement", { p_reimbursement_id: sub.reimbursement_id, p_decision: "rejected", p_review_note: "e2e: history only" }), "executive rejects it (no money moves)");

    refused(await c.execA.rpc("admin_delete_member", { p_target_id: id.hist }), "executive deleting a member", /Only administrators/i);
    refused(await c.hist.rpc("admin_delete_member", { p_target_id: id.hist }), "member deleting themselves", /Only administrators/i);
    refused(await c.admin.rpc("admin_delete_member", { p_target_id: id.admin }), "administrator deleting themselves", /cannot delete themselves/i);
    refused(await c.admin.rpc("admin_delete_member", { p_target_id: "00000000-0000-0000-0000-000000000000" }), "unknown member", /not found/i);
    const error = refused(await c.admin.rpc("admin_delete_member", { p_target_id: id.hist }), "deleting a member with history", /finance or recording history/i);
    ok(/Deactivate it instead/i.test(error.message), `the message should point to deactivation: ${error.message}`);
    equal(error.code, "23503", "error code");
    equal(rowsOf(await c.admin.from("profiles").select("id").eq("id", id.hist), "profile after the refused delete").length, 1, "profile rows after the refused delete");
    succeeded(await c.hist.rpc("get_portal_bootstrap"), "the member can still use their session");
  });

  const doomed = await ctx.signInOptional("doomed");
  if (!doomed) {
    t.skip("an account with no history is deleted, and its old session reads nothing", "e2e-doomed@example.com does not exist: the last run deleted it. Run the setup SQL again (node scripts/e2e/gen-setup-sql.mjs) to recreate it.");
  } else {
    await t.test("an account with no history is deleted: the account, profile and group memberships go, sign-in stops, and the audit log keeps a record", async () => {
      succeeded(await c.execA.rpc("add_subgroup_member", { p_subgroup_id: g.A, p_member_id: doomed.id }), "executive adds the account to group A");
      equal(succeeded(await doomed.client.rpc("get_portal_bootstrap"), "bootstrap before").memberships.length, 1, "memberships before the delete");
      succeeded(await c.admin.rpc("admin_delete_member", { p_target_id: doomed.id }), "delete");
      equal(rowsOf(await c.admin.from("profiles").select("id").eq("id", doomed.id), "profile after").length, 0, "profile rows after the delete");
      equal(rowsOf(await c.execA.from("subgroup_memberships").select("member_id").eq("member_id", doomed.id), "memberships after").length, 0, "membership rows after the delete");
      const signIn = await ctx.signInOptional("doomed");
      equal(signIn, null, "sign-in after the delete");
      const audit = rowsOf(await c.admin.from("admin_audit_log").select("action,actor_id,target_email").eq("target_email", "e2e-doomed@example.com").eq("action", "member_deleted"), "audit log");
      ok(audit.length >= 1 && audit[0].actor_id === id.admin, "no member_deleted audit entry for the administrator");
    });

    await t.test("the deleted member's old session (a token that has not expired yet) is of no use: reads return nothing and writes are refused", async () => {
      const profiles = rowsOf(await doomed.client.from("profiles").select("id").limit(10), "old session reads profiles");
      equal(profiles.length, 0, "profiles a deleted member's old token reads");
      for (const table of ["recordings", "resources", "events", "announcements", "subgroups", "finance_expenses"]) {
        const res = await doomed.client.from(table).select("*").limit(3);
        ok(res.error || (res.data || []).length === 0, `${table}: a deleted member's old token read ${res.data?.length} row(s)`);
      }
      const write = await doomed.client.rpc("submit_member_reimbursement", { p_description: mark("deleted member"), p_vendor: "x", p_amount: 5, p_purchase_date: new Date().toISOString().slice(0, 10), p_category: "Supplies", p_payment_card_last4: "1234" });
      ok(write.error, `a deleted member's old token submitted a reimbursement: ${JSON.stringify(write.data)}`);
      const up = await put(doomed.client, "recordings", `${doomed.id}/subgroups/${g.A}/${uid()}-x.wav`, Buffer.from("RIFFxxxx"), "audio/wav");
      ok(up.error, "a deleted member's old token uploaded a file");
    });
  }

  await t.observe("signed URLs that were fetched before a delete and still downloaded afterwards (CDN cache, not storage)", async () => {
    if (!servedFromCache.length) return "none: every delete in this run was proven with an unfetched signed URL, and no fetched URL kept working.";
    return `${servedFromCache.length} fetched URL(s) were still served after their file was deleted: ${JSON.stringify(servedFromCache)}`;
  });
}
