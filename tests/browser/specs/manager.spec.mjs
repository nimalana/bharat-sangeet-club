// A group manager (e2e-manager): a plain member by role who manages groups A and C. The club roles give them nothing; the group does.
import { test, expect } from "../support/test.mjs";
import { NAV, fx, navTest } from "../support/smoke.mjs";
import { expectAbsences, expectLandmarks, openScreen } from "../support/screens.mjs";
import { shoot } from "../support/shots.mjs";

test.use({ role: "manager" });

navTest("manager", NAV.member, ["admin"]);

test("manager sees the waiting request in their group and no club-wide management", async ({ page }) => {
  const t = fx().titles;
  await openScreen(page, "groups");
  await expectLandmarks(page, "groups", "member", fx());
  await expectAbsences(page, "groups", "member", fx());
  await expect(page.getByRole("button", { name: new RegExp(t.groupA.replace(/[[\]]/g, "\\$&")) })).toContainText(/[12] requests? to review/);
  await page.getByRole("button", { name: new RegExp(t.groupA.replace(/[[\]]/g, "\\$&")) }).click();
  const people = page.getByRole("region", { name: `People in ${t.groupA}` });
  await expect(people.getByRole("heading", { name: /Requests to join/ })).toBeVisible();
  // hist's request stays waiting in every run (nohist's is approved by a journey, which may have run before this test).
  await expect(people.locator("li, article, div", { hasText: "E2E With History" }).filter({ has: page.getByRole("button", { name: "Approve" }) }).last()).toBeVisible();
  await expect(people.getByRole("button", { name: "Group settings" })).toBeVisible();
  // Club management stays closed: no club-wide posting, no new group.
  await expect(page.getByRole("button", { name: /New group/ })).toHaveCount(0);
  await shoot(page, { role: "manager", screen: "group-people", run: fx().run });
});

test("manager's finances and calendar stay the member's: no ledger, no date editing", async ({ page }) => {
  await openScreen(page, "finances");
  await expect(page.getByRole("heading", { level: 1, name: "My reimbursements" })).toBeVisible();
  await expectAbsences(page, "finances", "member", fx());
  await openScreen(page, "calendar");
  await expectLandmarks(page, "calendar", "member", fx());
  await expectAbsences(page, "calendar", "member", fx());
});
