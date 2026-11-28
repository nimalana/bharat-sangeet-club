// The administrator (e2e-admin): the Admin screen, plus every other screen with the administrator's navigation.
import { test, expect } from "../support/test.mjs";
import { NAV, fx, navTest, smokeScreen } from "../support/smoke.mjs";
import { expectLandmarks, openScreen } from "../support/screens.mjs";
import { shoot } from "../support/shots.mjs";

test.use({ role: "admin" });

smokeScreen("admin", "admin", {
  after: async (page) => {
    // The deactivated member is hidden by default and listed on request.
    await expect(page.getByText(/Show \d+ deactivated/)).toBeVisible();
    await expect(page.locator(".admin-member-row", { hasText: "e2e-victim@example.com" })).toHaveCount(0);
    await page.getByText(/Show \d+ deactivated/).click();
    await expect(page.locator(".admin-member-row", { hasText: "e2e-victim@example.com" })).toBeVisible();
  },
});
navTest("admin", NAV.admin);

test("admin opens every other screen and sees the same club content as an executive, with the administrator's label", async ({ page }) => {
  const failures = [];
  for (const screen of ["home", "groups", "calendar", "members", "attendance", "recordings", "documents", "finances"]) {
    try {
      await openScreen(page, screen);
      await expectLandmarks(page, screen, "admin", fx());
      if (screen === "home") await expect(page.getByText("Admin view")).toBeVisible();
      // The other screens look the same as the executive's (their pictures are the executive's); the Overview shows the administrator's label.
      if (screen === "home") await shoot(page, { role: "admin", screen, run: fx().run });
    } catch (error) { failures.push(`${screen}: ${String(error.message).split("\n")[0]}`); }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
