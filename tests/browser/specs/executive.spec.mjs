// An executive (e2e-exec-a): everything except the Admin screen.
import { test, expect } from "../support/test.mjs";
import { NAV, fx, navTest, smokeScreen } from "../support/smoke.mjs";

test.use({ role: "executive" });

for (const screen of ["home", "groups", "calendar", "members", "attendance", "recordings", "documents"]) smokeScreen("executive", screen);

smokeScreen("executive", "finances", {
  // The four finance views each show their own fixture.
  after: async (page) => {
    const t = fx().titles;
    await page.getByRole("tab", { name: "expenses" }).click();
    await expect(page.locator(".finance-table-row", { hasText: t.expToClaim })).toBeVisible();
    await page.getByRole("tab", { name: "reimbursements" }).click();
    await expect(page.locator(".reimbursement-card", { hasText: t.reqExecRemoves }).getByRole("button", { name: "Approve" })).toBeVisible();
    await page.getByRole("tab", { name: "Funding claims" }).click();
    await expect(page.locator(".claim-card", { hasText: t.claim })).toBeVisible();
    await page.getByRole("tab", { name: "overview" }).click();
  },
});

navTest("executive", NAV.executive, ["admin"]);
