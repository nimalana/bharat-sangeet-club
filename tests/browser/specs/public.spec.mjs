// A visitor who is not signed in: the landing page with the concert archive, the sign-in screen, and an old /meetings link.
import { test, expect } from "../support/test.mjs";
import { fx } from "../support/smoke.mjs";
import { shoot } from "../support/shots.mjs";

test.use({ role: "anon" });

test("visitor sees the landing page and the public concert archive, and nothing from the members", async ({ page, guard }) => {
  const t = fx().titles;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Indian classical music/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Concert recordings" })).toBeVisible();
  // The public concert is in the archive; the members-only recording and every other member screen are not.
  await expect(page.locator(".public-recording-grid").getByRole("heading", { level: 3, name: t.archivePublic })).toBeVisible();
  await expect(page.getByText(t.archiveMembers)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Portal navigation" })).toHaveCount(0);
  await expect(page.getByText("Welcome back")).toHaveCount(0);
  await shoot(page, { role: "visitor", screen: "landing", run: fx().run });
  // A signed-out browser sends no authenticated data request at all.
  const reads = guard.requests.filter((r) => !/^auth /.test(r.label));
  expect(reads.map((r) => r.label), "Supabase requests of a signed-out visitor").toEqual([]);
});

test("visitor opens a public concert: the signed link is requested for the visitor, in the club-archive bucket", async ({ page, context }) => {
  const t = fx().titles;
  await page.goto("/");
  const card = page.locator(".public-recording-grid article", { hasText: t.archivePublic });
  await expect(card).toBeVisible();
  const popup = context.waitForEvent("page");
  await card.getByRole("button", { name: /Watch or listen/ }).click();
  const opened = await popup;
  expect(opened.url()).toContain("/storage/v1/object/sign/club-archive/");
  await opened.close();
});

test("visitor reaches the sign-in screen; an old /meetings link lands on the public site, not on data", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Member sign in/ }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: "Welcome to Bharat Sangeet" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  await shoot(page, { role: "visitor", screen: "signin", run: fx().run });
  await page.goto("/meetings");
  await expect(page).toHaveURL(/\/\?page=meetings$/);
  await expect(page.getByRole("heading", { level: 1, name: /Indian classical music/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Attendance" })).toHaveCount(0);
});
