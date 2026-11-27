import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SECTIONS,
  SECTION_LABELS,
  canViewSection,
  menuGroups,
  menuPages,
  resolveSection,
  sectionFromSearch,
  sectionUrl,
} from "../lib/sections.ts";

const ROLES = ["member", "executive", "admin"];

// frontend-1: the Finance screen was built but nothing opened it. The menu did
// not list it and ?page=finances fell back to the overview.

test("?page=finances opens the finance screen", () => {
  assert.equal(sectionFromSearch("?page=finances"), "finances");
  assert.equal(sectionFromSearch("?page=finance"), "finances");
  assert.equal(sectionFromSearch("?tab=x&page=finances&folder=3"), "finances");
});

test("every screen the shell can show has an address", () => {
  for (const section of SECTIONS) {
    assert.equal(sectionFromSearch(new URL(sectionUrl("/", section), "https://club.example").search), section, section);
  }
});

test("older links and unknown pages still land somewhere sensible", () => {
  assert.equal(sectionFromSearch("?page=meetings"), "attendance");
  assert.equal(sectionFromSearch("?page=gallery"), "documents");
  assert.equal(sectionFromSearch("?page=nonsense"), "home");
  assert.equal(sectionFromSearch("?page=__proto__"), "home");
  assert.equal(sectionFromSearch("?page=constructor"), "home");
  assert.equal(sectionFromSearch("?page="), "home");
  assert.equal(sectionFromSearch(""), "home");
});

test("sectionUrl keeps the overview at the bare path", () => {
  assert.equal(sectionUrl("/", "home"), "/");
  assert.equal(sectionUrl("/", "finances"), "/?page=finances");
});

test("the finance section renders for every signed-in role", () => {
  for (const role of ROLES) {
    assert.deepEqual(resolveSection("finances", role), { kind: "render", section: "finances" }, role);
    assert.ok(canViewSection("finances", role), role);
  }
});

test("the finance section is refused when the role is unknown or missing", () => {
  for (const role of [null, undefined, "", "guest", "Admin", "treasurer"]) {
    assert.deepEqual(resolveSection("finances", role), { kind: "refused", section: "finances" }, String(role));
  }
});

test("only an admin may open the admin screen, and a refused section is never rendered", () => {
  assert.equal(resolveSection("admin", "admin").kind, "render");
  assert.equal(resolveSection("admin", "executive").kind, "refused");
  assert.equal(resolveSection("admin", "member").kind, "refused");
  assert.equal(resolveSection("admin", null).kind, "refused");
});

test("an unknown role can open the overview and nothing else", () => {
  for (const section of SECTIONS) {
    assert.equal(canViewSection(section, null), section === "home", section);
  }
});

test("every role has finances in its menu, in the top bar order, and only admins see Admin", () => {
  for (const role of ROLES) {
    const pages = menuPages(role);
    assert.ok(pages.includes("finances"), `${role} menu lists finances`);
    assert.equal(pages.includes("admin"), role === "admin", `${role} menu lists admin only for admins`);
    assert.equal(new Set(pages).size, pages.length, `${role} menu lists no page twice`);
  }
  assert.deepEqual(menuPages("member"), ["home", "calendar", "members", "recordings", "documents", "groups", "attendance", "finances"]);
  assert.deepEqual(menuPages("executive").slice(-1), ["finances"]);
  assert.deepEqual(menuPages("admin").slice(-2), ["finances", "admin"]);
});

test("the menu lists exactly the pages a role may open", () => {
  for (const role of ROLES) {
    const listed = new Set(menuPages(role));
    for (const section of SECTIONS) {
      assert.equal(listed.has(section), canViewSection(section, role), `${role} / ${section}`);
    }
  }
});

test("every menu page has a label and a menu group", () => {
  for (const role of ROLES) {
    for (const group of menuGroups(role)) {
      assert.ok(group.title && group.pages.length, `${role} / ${group.title}`);
      for (const page of group.pages) assert.ok(SECTION_LABELS[page], page);
    }
  }
  // Members' finances are their own requests, so they are not labelled club-wide.
  const memberFinance = menuGroups("member").find((group) => group.pages.includes("finances"));
  assert.equal(memberFinance.clubWide, false);
  const execFinance = menuGroups("executive").find((group) => group.pages.includes("finances"));
  assert.equal(execFinance.title, "MANAGE CLUB");
});

// The shell must use these rules. A section the table allows but the shell
// never renders (the original bug) is caught here.
test("the shell renders the finance screen from the shared rules", async () => {
  const shell = await readFile(new URL("../app/portal.tsx", import.meta.url), "utf8");
  assert.match(shell, /from "\.\.\/lib\/sections"/);
  assert.match(shell, /outcome\.kind === "render" && outcome\.section === "finances" && <FinancePage /);
  assert.match(shell, /outcome\.kind === "refused" && /);
  assert.match(shell, /outcome\.kind === "render" && outcome\.section === "admin" && <AdminPage /);
  // No private copy of the section list, the label table or the menu left behind.
  assert.doesNotMatch(shell, /const sectionValues/);
  assert.doesNotMatch(shell, /const labels: Record<Section, string>/);
  assert.doesNotMatch(shell, /const managePages/);
});
