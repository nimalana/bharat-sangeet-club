// The screens of the portal shell (features/shell/components/portal.tsx) as the browser sees them: where each one lives, what proves its CONTENT has arrived (not just its
// heading: several screens print the heading first and load their data after), and what a role must not see on it.
//
// Everything here is about rendered output (visible text and roles), never about how the source is arranged, so it keeps working
// when R3 moves the files.
import { expect } from "./test.mjs";

export const SCREEN_PATH = {
  home: "/", groups: "/?page=groups", calendar: "/?page=calendar", members: "/?page=members", attendance: "/?page=attendance",
  recordings: "/?page=recordings", documents: "/?page=documents", finances: "/?page=finances", admin: "/?page=admin",
};

// The labels the navigation shows, in order (lib/sections.ts menuPages).
export const NAV = {
  member: ["Overview", "Calendar", "Members", "Recordings", "Resources", "My Groups", "Attendance", "Finances"],
  executive: ["Overview", "Calendar", "Members", "Recordings", "Resources", "My Groups", "Attendance", "Finances"],
  admin: ["Overview", "Calendar", "Members", "Recordings", "Resources", "My Groups", "Attendance", "Finances", "Admin"],
};
// What the executives and the administrator see in place of "My Groups" is the same label; kept for clarity.

const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const has = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// kind: "member" (a plain member, also the group manager), "executive", "admin".
// Returns [{ name, locator }]: every locator must be visible once the screen has loaded.
export function landmarks(page, screen, kind, fx) {
  const t = fx.titles;
  const visible = (locator) => locator.filter({ visible: true }).first();
  switch (screen) {
    case "home": return [
      { name: "welcome heading", locator: page.getByRole("heading", { level: 1, name: /^Welcome back,/ }) },
      { name: "pinned announcement", locator: page.locator(".announcement-feed").getByRole("heading", { level: 3, name: exact(t.annPinned) }) },
      { name: "next on the calendar", locator: page.getByText("Next on the calendar") },
    ];
    case "groups": return [
      { name: "groups heading", locator: page.getByRole("heading", { level: 1, name: kind === "member" ? "My groups" : "All groups" }) },
      { name: "group A", locator: page.getByRole("button", { name: has(t.groupA) }) },
    ];
    case "calendar": return [
      { name: "calendar heading", locator: page.getByRole("heading", { level: 1, name: "Important dates" }) },
      { name: "today's club date", locator: visible(page.getByText(exact(t.eventToday))) },
    ];
    case "members": return [
      { name: "roster heading", locator: page.getByRole("heading", { level: 1, name: "Member roster" }) },
      { name: "a member card", locator: page.locator(".member-card", { hasText: "E2E Member Two" }) },
    ];
    case "attendance": return kind === "member" ? [
      { name: "attendance heading", locator: page.getByRole("heading", { level: 1, name: "Attendance" }) },
      { name: "check-in form", locator: page.getByLabel("Attendance code") },
      { name: "the closed meeting in my history", locator: page.locator(".member-history article", { hasText: t.sessionClosed }) },
    ] : [
      { name: "attendance heading", locator: page.getByRole("heading", { level: 1, name: "Attendance" }) },
      { name: "live meeting panel", locator: page.locator(".attendance-live", { hasText: t.sessionOpen }) },
    ];
    case "recordings": return [
      { name: "recordings heading", locator: page.getByRole("heading", { level: 1, name: "Recordings" }) },
      { name: "the published take", locator: page.locator(".recording-card", { hasText: t.recording }) },
      ...(kind === "member" ? [] : [{ name: "club archive manager", locator: page.getByRole("heading", { level: 2, name: "Club and concert recordings" }) }]),
    ];
    case "documents": return [
      { name: "resources heading", locator: page.getByRole("heading", { level: 1, name: "Resources" }) },
      { name: "the folder", locator: page.getByRole("button", { name: has(t.folder) }) },
      { name: "the top-level file", locator: page.getByRole("button", { name: has(t.fileKept) }) },
    ];
    case "finances": return kind === "member" ? [
      { name: "member finance heading", locator: page.getByRole("heading", { level: 1, name: "My reimbursements" }) },
      { name: "my approved request", locator: page.locator(".reimbursement-card", { hasText: t.reqToPay }) },
    ] : [
      { name: "finance heading", locator: page.getByRole("heading", { level: 1, name: "Club finances" }) },
      { name: "available cash card", locator: page.locator(".finance-stat", { hasText: "Available cash" }) },
      { name: "the income in the cash ledger", locator: page.locator(".ledger-row", { hasText: t.income }) },
    ];
    case "admin": return [
      { name: "control center heading", locator: page.getByRole("heading", { level: 1, name: "Club control center" }) },
      { name: "member list", locator: page.locator(".admin-member-row", { hasText: "e2e-member1@example.com" }) },
      { name: "audit panel", locator: page.getByRole("heading", { level: 2, name: "Recent admin activity" }) },
    ];
    default: throw new Error(`unknown screen ${screen}`);
  }
}

// What this kind of person must not see on the screen. Each locator must match nothing.
function absences(page, screen, kind, fx) {
  const t = fx.titles;
  const notMember = kind === "member";
  const list = [];
  const none = (name, locator) => list.push({ name, locator });
  if (notMember) {
    // Navigation: no Admin, and Finances sits in its own group (not "Manage club").
    none("an Admin navigation entry", page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Admin", exact: true }));
  }
  if (kind !== "admin") none("an Admin navigation entry", page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Admin", exact: true }));
  switch (screen) {
    case "home":
      if (notMember) none("the Post announcement button", page.getByRole("button", { name: /Post announcement/ }));
      break;
    case "groups":
      if (notMember) none("the New group button", page.getByRole("button", { name: /New group/ }));
      break;
    case "calendar":
      if (notMember) {
        none("the Add important date button", page.getByRole("button", { name: /Add important date/ }));
        none("edit and delete buttons on dates", page.getByRole("button", { name: /^(Edit|Delete) / }));
      }
      break;
    case "attendance":
      if (notMember) {
        none("the New meeting button", page.getByRole("button", { name: /New meeting/ }));
        none("the roster and check-in code", page.getByText("CHECK-IN CODE"));
        none("the policy flags", page.getByText("Members needing attention"));
      }
      break;
    case "recordings":
      if (notMember) none("the club archive manager", page.getByRole("heading", { name: "Club and concert recordings" }));
      break;
    case "documents":
      // A member may read the library but the Add resource button is disabled for them (see the screen).
      break;
    case "finances":
      if (notMember) {
        for (const text of ["Club finances", "Available cash", "Recorded income", "Expense register", "Cash ledger", "Action queue"]) none(`"${text}"`, page.getByText(text, { exact: true }));
        none("the Record income button", page.getByRole("button", { name: /Record income/ }));
        none("the Club expense button", page.getByRole("button", { name: /Club expense/ }));
        none("the Funding claims tab", page.getByRole("tab", { name: "Funding claims" }));
        none("an executive's club expense in the list", page.getByText(t.expToClaim));
        none("the Approve button on a request", page.getByRole("button", { name: "Approve", exact: true }));
        none("the Mark paid button", page.getByRole("button", { name: "Mark paid" }));
      }
      break;
    default: break;
  }
  return list;
}

// Waits for every landmark; the first one that never shows up fails with its name.
export async function expectLandmarks(page, screen, kind, fx, timeout = 20_000) {
  for (const { name, locator } of landmarks(page, screen, kind, fx)) {
    await expect(locator, `the ${screen} screen is missing its ${name}`).toBeVisible({ timeout });
  }
}

export async function expectAbsences(page, screen, kind, fx) {
  for (const { name, locator } of absences(page, screen, kind, fx)) {
    await expect(locator, `the ${screen} screen shows ${name}, which this role must not see`).toHaveCount(0);
  }
}

// Opens a screen by its address, as a bookmark or a reload does.
export async function openScreen(page, screen) {
  await page.goto(SCREEN_PATH[screen], { waitUntil: "commit" });
}

export function profileKind(role) { return role === "admin" ? "admin" : role === "executive" ? "executive" : "member"; }
