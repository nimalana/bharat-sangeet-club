// A deactivated member (e2e-victim, deactivated by the setup with admin_deactivate_member, reactivated by the teardown).
import { test, expect } from "../support/test.mjs";
import { fx } from "../support/smoke.mjs";
import { loadState } from "../support/state.mjs";
import { SCREEN_PATH } from "../support/screens.mjs";
import { shoot } from "../support/shots.mjs";

test.use({ role: "deactivated" });

test("deactivated member sees only the deactivated notice, and the portal makes no data request", async ({ page, guard }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your access has been deactivated" })).toBeVisible();
  await expect(page.getByText("This account can no longer open the member portal.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  // No portal at all: no navigation, no welcome, no club content, and nothing beyond the one bootstrap answer was read.
  await expect(page.getByRole("navigation", { name: "Portal navigation" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toHaveCount(0);
  await expect(page.getByText(fx().titles.annPinned)).toHaveCount(0);
  const reads = guard.requests.filter((r) => !/^auth /.test(r.label));
  expect(reads.map((r) => r.label), "the data requests a deactivated member's browser made").toEqual(["rpc get_portal_bootstrap"]);
  await shoot(page, { role: "deactivated", screen: "notice", run: fx().run });
});

test("deactivated member cannot reach any screen by its address, and the database answers their direct reads with nothing", async ({ page, guard }) => {
  for (const screen of ["finances", "attendance", "admin", "documents", "recordings"]) {
    await page.goto(SCREEN_PATH[screen]);
    await expect(page.getByRole("heading", { name: "Your access has been deactivated" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  }
  expect(guard.requests.filter((r) => /^(GET|POST|PATCH) /.test(r.label)).map((r) => r.label)).toEqual([]);
  // The same session asked straight for rows, from the browser (so through the browser's proxy): the policies return nothing. They do
  // not error; the rows are simply not there.
  const session = loadState().sessions.victim;
  const answers = await page.evaluate(async ({ base, key, token, tables }) => {
    const out = {};
    for (const table of tables) {
      const response = await fetch(`${base}/rest/v1/${table}?select=id&limit=5`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      out[table] = { status: response.status, rows: await response.json() };
    }
    return out;
  }, { base: loadState().supabaseUrl, key: loadState().supabaseKey, token: session.access_token, tables: ["finance_expenses", "personal_reimbursements", "finance_documents", "events", "announcements", "resources", "recordings", "attendance_sessions"] });
  for (const [table, answer] of Object.entries(answers)) {
    expect(answer.status, `${table} status`).toBe(200);
    expect(answer.rows, `${table} rows visible to a deactivated member`).toEqual([]);
  }
});
