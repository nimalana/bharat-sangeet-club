// The main journeys, each once, as the role that does it. A journey consumes the fixture it needs (a check-in code can be used once, a
// request can be paid once), so each runs against a fresh setup; the setup creates one fixture per journey.
//
// This file is named to sort LAST: Playwright runs files in name order, and every screen test (and every screenshot) must see the
// fixtures before a journey has paid, deleted, approved or voided anything. E2E_JOURNEYS=0 leaves these out (see playwright.config.mjs),
// which is what keeps a set of kept fixtures (E2E_KEEP=1) reusable for screenshots and timings (E2E_REUSE=1).
import { test, expect } from "../support/test.mjs";
import { fx } from "../support/smoke.mjs";
import { openScreen } from "../support/screens.mjs";
import { storageHasObject } from "../support/api.mjs";
import { png, wav } from "../../../scripts/e2e/lib/fixtures.mjs";

const mark = (text) => `[e2e] BR ${text} ${fx().run}`;
const toast = (page) => page.locator(".toast");

test.describe("member", () => {
  test.use({ role: "member" });

  test("member checks in to the open attendance session with its code", async ({ page }) => {
    const { titles, ids } = fx();
    await openScreen(page, "attendance");
    const mine = page.locator(".member-history article", { hasText: titles.sessionOpen });
    await expect(mine).toBeVisible();
    await expect(mine).toContainText("open");
    await page.getByLabel("Attendance code").fill(ids.checkInCode);
    await page.getByRole("button", { name: "Check in" }).click();
    await expect(toast(page)).toHaveText(/Attendance confirmed/);
    await expect(page.getByText("You are checked in. Your attendance is confirmed.")).toBeVisible();
    // The history now shows the meeting as attended.
    await expect(mine).toContainText(/present/i);
  });

  test("member submits a reimbursement with a receipt upload", async ({ page }) => {
    const description = mark("Journey purchase");
    await openScreen(page, "finances");
    await expect(page.getByRole("heading", { level: 1, name: "My reimbursements" })).toBeVisible();
    await page.getByRole("button", { name: /Request reimbursement/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What was purchased?").fill(description);
    await dialog.getByLabel("Vendor").fill("Music Shop");
    await dialog.getByLabel("Amount").fill("12.50");
    await dialog.getByLabel("Card last four digits").fill("4242");
    await dialog.getByLabel("Legible receipt").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png() });
    await dialog.getByRole("button", { name: "Submit reimbursement" }).click();
    await expect(toast(page)).toHaveText(/Reimbursement request submitted/);
    const card = page.locator(".reimbursement-card", { hasText: description });
    await expect(card).toBeVisible();
    await expect(card).toContainText("$12.50");
    await expect(card).toContainText("submitted");
    await expect(card.locator(".document-chip", { hasText: `Receipt — ${description}` })).toBeVisible();
  });

  test("member uploads a recording, publishes it with a notation text note, and the note is there when it is opened", async ({ page }) => {
    const title = mark("Journey take");
    const notation = mark("Journey notation");
    await openScreen(page, "recordings");
    await expect(page.getByRole("heading", { level: 1, name: "Recordings" })).toBeVisible();
    await page.getByRole("button", { name: /New recording/ }).click();
    const studio = page.getByRole("dialog");
    await studio.locator("input[type=file]").first().setInputFiles({ name: "journey-take.wav", mimeType: "audio/wav", buffer: wav(0.5) });
    await expect(studio.getByText("journey-take.wav")).toBeVisible();
    await studio.getByLabel("Title").fill(title);
    await studio.getByLabel("Notation text").fill(notation);
    await studio.getByRole("button", { name: "Publish to subgroup" }).click();
    await expect(toast(page)).toHaveText(/Published to your subgroup/);
    const card = page.locator(".recording-card", { hasText: title });
    await expect(card).toBeVisible();
    await card.click();
    const detail = page.getByRole("dialog");
    await expect(detail.getByRole("heading", { name: title })).toBeVisible();
    await expect(detail.locator(".notation-item", { hasText: notation })).toBeVisible();
  });

  test("member removes their own extra receipt: the toast reports success and the file is gone from storage", async ({ page }) => {
    const { titles, ids } = fx();
    await openScreen(page, "finances");
    const card = page.locator(".reimbursement-card", { hasText: titles.reqMemberRemoves });
    await expect(card).toBeVisible();
    expect(await storageHasObject(page, "finance-private", ids.docMemberRemoves.path), "the extra receipt before removal").toBe(true);
    await card.getByRole("button", { name: `Remove ${titles.reqMemberRemovesExtra}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove document" }).click();
    await expect(toast(page)).toHaveText(/Document removed/);
    await expect(toast(page)).not.toHaveText(/still in storage/);
    await expect(card.getByRole("button", { name: new RegExp(titles.reqMemberRemovesExtra.replace(/[[\]]/g, "\\$&")) })).toHaveCount(0);
    expect(await storageHasObject(page, "finance-private", ids.docMemberRemoves.path), "the removed receipt in finance-private").toBe(false);
    // The first receipt stays: it is the one the request needs.
    expect(await storageHasObject(page, "finance-private", ids.reqMemberRemoves.receipt.path)).toBe(true);
  });
});

test.describe("group manager", () => {
  test.use({ role: "manager" });

  test("group manager approves a join request and the member appears in the group", async ({ page }) => {
    const { titles } = fx();
    await openScreen(page, "groups");
    await page.getByRole("button", { name: new RegExp(titles.groupA.replace(/[[\]]/g, "\\$&")) }).click();
    const people = page.getByRole("region", { name: `People in ${titles.groupA}` });
    const request = people.locator("li, article, div", { hasText: "E2E No History" }).filter({ has: page.getByRole("button", { name: "Approve" }) }).last();
    await expect(request).toBeVisible();
    await request.getByRole("button", { name: "Approve" }).click();
    await expect(toast(page)).toHaveText(new RegExp(`E2E No History joined ${titles.groupA.replace(/[[\]]/g, "\\$&")}`));
    // Their request is gone (the other waiting request, hist's, keeps its button) and they are listed among the members.
    await expect(people.getByRole("button", { name: "Approve" })).toHaveCount(1);
    await expect(people.locator("li, article, div", { hasText: "E2E With History" }).filter({ has: page.getByRole("button", { name: "Approve" }) }).last()).toBeVisible();
    await expect(people.getByText("E2E No History")).toBeVisible();
  });
});

test.describe("executive", () => {
  test.use({ role: "executive" });

  test("executive marks an approved reimbursement paid through the confirm dialog", async ({ page }) => {
    const { titles } = fx();
    await openScreen(page, "finances");
    await page.getByRole("tab", { name: "reimbursements" }).click();
    const card = page.locator(".reimbursement-card", { hasText: titles.reqToPay });
    await expect(card).toBeVisible();
    await expect(card).toContainText("approved");
    await card.getByRole("button", { name: "Mark paid" }).click();
    const dialog = page.getByRole("dialog", { name: "Mark this reimbursement as paid?" }).or(page.getByRole("dialog").filter({ hasText: "Mark this reimbursement as paid?" }));
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("$33.00");
    await expect(dialog).toContainText(titles.reqToPay);
    await dialog.getByRole("button", { name: "Mark paid" }).click();
    await expect(toast(page)).toHaveText(/Reimbursement marked paid/);
    await expect(card).toContainText("paid");
    await expect(card.getByRole("button", { name: "Mark paid" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Void payment" })).toBeVisible();
  });

  test("executive creates a funding claim from an unclaimed expense", async ({ page }) => {
    const { titles } = fx();
    const claimTitle = mark("Journey claim");
    await openScreen(page, "finances");
    await page.getByRole("tab", { name: "Funding claims" }).click();
    await page.getByRole("button", { name: /New funding claim/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Claim title").fill(claimTitle);
    await dialog.getByLabel(`Include ${titles.expToClaim}`).check();
    await dialog.getByLabel("Proof of funding approval").setInputFiles({ name: "approval.png", mimeType: "image/png", buffer: png() });
    await dialog.getByRole("button", { name: /Create claim/ }).click();
    await expect(toast(page)).toHaveText(/Funding claim workspace created/);
    const card = page.locator(".claim-card", { hasText: claimTitle });
    await expect(card).toBeVisible();
    await expect(card).toContainText("$21.00 requested");
    await expect(card).toContainText(titles.expToClaim);
  });

  test("executive removes a member's extra receipt: the toast reports success and the file is gone from finance-private", async ({ page }) => {
    const { titles, ids } = fx();
    await openScreen(page, "finances");
    await page.getByRole("tab", { name: "reimbursements" }).click();
    const card = page.locator(".reimbursement-card", { hasText: titles.reqExecRemoves });
    await expect(card).toBeVisible();
    expect(await storageHasObject(page, "finance-private", ids.docExecRemoves.path), "the extra receipt before removal").toBe(true);
    await card.getByRole("button", { name: `Remove ${titles.reqExecRemovesExtra}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove document" }).click();
    await expect(toast(page)).toHaveText(/Document removed/);
    await expect(toast(page)).not.toHaveText(/still in storage/);
    await expect(card.getByRole("button", { name: new RegExp(titles.reqExecRemovesExtra.replace(/[[\]]/g, "\\$&")) })).toHaveCount(0);
    expect(await storageHasObject(page, "finance-private", ids.docExecRemoves.path), "the removed receipt in finance-private").toBe(false);
    expect(await storageHasObject(page, "finance-private", ids.reqExecRemoves.receipt.path), "the receipt that stays").toBe(true);
  });

  test("executive deletes a resource: the file is removed from storage first, then the library no longer lists it", async ({ page }) => {
    const { titles, ids } = fx();
    await openScreen(page, "documents");
    await page.getByRole("button", { name: new RegExp(titles.fileToDelete.replace(/[[\]]/g, "\\$&")) }).click();
    const detail = page.getByRole("dialog", { name: titles.fileToDelete });
    await expect(detail).toBeVisible();
    expect(await storageHasObject(page, "club-resources", ids.fileToDeletePath), "the file before the delete").toBe(true);
    await detail.getByRole("button", { name: "Delete", exact: true }).click();
    // The confirmation is rendered inside the detail panel, so both dialogs contain its text: take the confirmation itself.
    const confirm = page.locator("#confirm-dialog-title", { hasText: "Delete this file for good?" }).locator("xpath=..");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(toast(page)).toHaveText(/The file was deleted/);
    await expect(page.getByRole("button", { name: new RegExp(titles.fileToDelete.replace(/[[\]]/g, "\\$&")) })).toHaveCount(0);
    expect(await storageHasObject(page, "club-resources", ids.fileToDeletePath), "the file after the delete").toBe(false);
  });

  test("executive voids a club expense with a reason: it stays listed as voided and loses its actions", async ({ page }) => {
    const { titles } = fx();
    await openScreen(page, "finances");
    await page.getByRole("tab", { name: "expenses" }).click();
    const row = page.locator(".finance-table-row", { hasText: titles.expToVoid });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Void" }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Void this expense?" });
    await dialog.getByLabel("Reason").fill("Entered twice by the browser suite");
    await dialog.getByRole("button", { name: "Void expense" }).click();
    await expect(toast(page)).toHaveText(/Expense voided/);
    await expect(row).toContainText("voided");
    await expect(row.getByRole("button", { name: "Void" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });
});
