// Least-privilege grants (20261127075000, 20261127090000): the money, attendance, audit and group tables are changed only through
// the portal's functions. Signed-in people hold SELECT on them (row-level security decides which rows), nothing else, so an
// executive, the administrator or a member who skips the functions and writes the table gets "permission denied for table".
// supabase/tests/permissions.snapshot is the list of what each role holds; this section checks the real project agrees.
import { readFileSync } from "node:fs";
import { ok, succeeded, describeError } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";

const inventory = JSON.parse(readFileSync(new URL("../inventory.json", import.meta.url), "utf8"));
// A plain column to aim an update at. (An identity column such as id cannot be set to NULL: Postgres rejects that while parsing,
// before it looks at privileges, so it would not show what we want to see.)
const plainColumn = (table) => {
  const columns = inventory.tables.find((x) => x.name === table).columns;
  return columns.includes("created_at") ? "created_at" : columns.find((name) => name !== "id") || columns[0];
};

// Tables whose only grant to `authenticated` is SELECT in the snapshot (profiles has a column-level UPDATE and is covered in section 00).
const FUNCTION_ONLY = [
  "admin_audit_log", "attendance_eligibility", "attendance_excuses", "attendance_record_audit", "attendance_records", "attendance_remediations",
  "attendance_session_participants", "attendance_sessions", "attendance_settings", "finance_audit_log", "finance_expenses", "finance_payments",
  "funding_claim_expenses", "funding_claims", "member_deactivations", "personal_reimbursements", "resource_links", "resource_tag_assignments",
  "resource_tags", "subgroup_memberships", "subgroups", "transactions",
];
// Still insertable by any signed-in person (the policies decide), by design for now: docs/KNOWN_GAPS.md, plan item P1-05 / Phase 4.2.
const STILL_INSERTABLE = ["finance_documents", "finance_expense_documents", "finance_reimbursement_documents", "finance_claim_documents"];

export default async function leastPrivilege(t, ctx) {
  const { c } = ctx;
  t.setSection("85 least privilege");

  await t.test(`an executive, the administrator and a member cannot write ${FUNCTION_ONLY.length} money, attendance, audit and group tables directly: insert, update and delete are "permission denied for table", while reading still works`, async () => {
    for (const table of FUNCTION_ONLY) ok(inventory.tables.some((x) => x.name === table), `${table} is not in inventory.json: regenerate it with inventory.sql`);
    const problems = [];
    for (const key of ["execA", "admin", "member1"]) {
      for (const table of FUNCTION_ONLY) {
        const first = plainColumn(table);
        const attempts = [
          ["insert", await c[key].from(table).insert({}).select()],
          ["update", await c[key].from(table).update({ [first]: null }).is(first, null).select()],
          ["delete", await c[key].from(table).delete().is(first, null).select()],
        ];
        for (const [what, res] of attempts) {
          if (!res.error) problems.push(`${key}: ${what} on ${table} was not refused (returned ${JSON.stringify(res.data)?.slice(0, 80)})`);
          else if (res.error.code !== "42501" || !/permission denied for table/i.test(res.error.message)) problems.push(`${key}: ${what} on ${table} failed with ${describeError(res.error)} (expected 42501 permission denied for table)`);
        }
      }
    }
    // Controls: the same people still read the tables the policies let them read, so a refusal above is about writing.
    for (const [key, table] of [["execA", "finance_payments"], ["execA", "attendance_sessions"], ["execA", "subgroups"], ["member1", "subgroups"], ["admin", "admin_audit_log"]]) {
      const res = await c[key].from(table).select("*").limit(1);
      if (res.error) problems.push(`${key}: reading ${table} failed with ${describeError(res.error)}`);
    }
    if (problems.length) throw new Error(`${problems.length} problem(s):\n${problems.slice(0, 12).join("\n")}`);
  });

  await t.test("the functions still do the writing for them: an executive records income and voids it through the functions", async () => {
    const paymentId = Number(succeeded(await c.execA.rpc("record_finance_income", { p_description: mark("least-privilege control income"), p_amount: 1, p_payment_date: new Date().toISOString().slice(0, 10), p_category: "Dues", p_counterparty: "e2e" }), "record_finance_income"));
    ok(paymentId > 0, `record_finance_income should return the payment id, got ${paymentId}`);
    succeeded(await c.execA.rpc("void_finance_payment", { p_payment_id: paymentId, p_reason: "least-privilege control, voided" }), "void the control income");
  });

  await t.observe("finance_documents and the four link tables are still directly insertable by signed-in people (documented gap)", async () => {
    const lines = [];
    for (const table of STILL_INSERTABLE) {
      const res = await c.member1.from(table).insert({}).select();
      const privilege = res.error && /permission denied for table/i.test(res.error.message);
      lines.push(`${table}: ${res.error ? describeError(res.error) : `inserted ${JSON.stringify(res.data)}`}${privilege ? " (INSERT revoked)" : " (INSERT granted, the policy refused this row)"}`);
    }
    return `An empty insert as a member is refused by the row-level-security policy ("new row violates row-level security policy") and not by a privilege ("permission denied for table"), so INSERT is still granted on these tables, unlike on the ${FUNCTION_ONLY.length} tables above: ${lines.join("; ")}. `
      + "The policies decide what a row may say (uploaded_by must be the caller, a link only to the caller's own expense), but not whether the file exists or sits in the caller's folder. See docs/KNOWN_GAPS.md.";
  });
}
