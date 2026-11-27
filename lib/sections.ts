// Which screens the portal has, which roles may open them, how the address bar
// names them and what the navigation menu lists. Pure, so the rules can be
// tested without a browser (tests/sections.test.mjs).
//
// Everything that decides "can this person reach this screen" lives here. The
// menu, the ?page= handling and the screen switch in app/portal.tsx all read
// the same table, so a screen cannot be built and then left unreachable.

export type ClubRole = "member" | "executive" | "admin";
export type Section = "home" | "groups" | "calendar" | "members" | "attendance" | "recordings" | "documents" | "finances" | "admin";

export const SECTIONS: readonly Section[] = ["home", "groups", "calendar", "members", "attendance", "recordings", "documents", "finances", "admin"];

export const SECTION_LABELS: Record<Section, string> = {
  home: "Overview", groups: "My Groups", calendar: "Calendar", members: "Members", attendance: "Attendance",
  recordings: "Recordings", documents: "Resources", finances: "Finances", admin: "Admin",
};

const ALL_ROLES: readonly ClubRole[] = ["member", "executive", "admin"];

// Who may open each screen. Finances is open to every signed-in role: members
// reach their own reimbursements, executives and admins the whole ledger; what
// each sees is decided by the database policies, not by this table. Admin is
// the one screen limited to a single role.
const ALLOWED_ROLES: Record<Section, readonly ClubRole[]> = {
  home: ALL_ROLES, groups: ALL_ROLES, calendar: ALL_ROLES, members: ALL_ROLES, attendance: ALL_ROLES,
  recordings: ALL_ROLES, documents: ALL_ROLES, finances: ALL_ROLES, admin: ["admin"],
};

export function isClubRole(value: unknown): value is ClubRole {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

export function isSection(value: unknown): value is Section {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

// An unknown or missing role may open nothing but the overview.
export function canViewSection(section: Section, role: ClubRole | null | undefined): boolean {
  if (!isClubRole(role)) return section === "home";
  return ALLOWED_ROLES[section].includes(role);
}

// Older links and bookmarks keep working: ?page=meetings and ?page=gallery were
// folded into other screens, and ?page=finance is the obvious misspelling.
const PAGE_ALIASES: Record<string, Section> = { meetings: "attendance", gallery: "documents", finance: "finances" };

export function sectionFromSearch(search: string): Section {
  const raw = new URLSearchParams(search).get("page");
  if (!raw) return "home";
  if (Object.hasOwn(PAGE_ALIASES, raw)) return PAGE_ALIASES[raw];
  return isSection(raw) ? raw : "home";
}

export function sectionUrl(pathname: string, section: Section): string {
  return section === "home" ? pathname : `${pathname}?page=${section}`;
}

// What the shell shows for the current address: the screen itself, or a
// refusal when this role may not open it. The shell must know the role first
// (see lib/bootstrap.ts); until it does, nothing is resolved.
export type SectionOutcome = { kind: "render"; section: Section } | { kind: "refused"; section: Section };

export function resolveSection(section: Section, role: ClubRole | null | undefined): SectionOutcome {
  return canViewSection(section, role) ? { kind: "render", section } : { kind: "refused", section };
}

export type MenuGroup = { title: string; pages: Section[]; clubWide: boolean };

// The navigation, grouped. Every page a role may open appears exactly once and
// nothing a role may not open appears. Members get Finances in a group of its
// own (their requests are theirs, not club-wide); executives and admins get it
// under "Manage club" with Admin.
export function menuGroups(role: ClubRole | null | undefined): MenuGroup[] {
  const manage: Section[] = ["finances", "admin"];
  const groups: MenuGroup[] = [
    { title: "CLUB", pages: ["home", "calendar", "members"], clubWide: true },
    { title: "LIBRARY", pages: ["recordings", "documents"], clubWide: false },
    { title: "GROUPS & ATTENDANCE", pages: ["groups", "attendance"], clubWide: false },
    role === "member" ? { title: "FINANCES", pages: manage, clubWide: false } : { title: "MANAGE CLUB", pages: manage, clubWide: true },
  ];
  return groups
    .map((group) => ({ ...group, pages: group.pages.filter((page) => canViewSection(page, role)) }))
    .filter((group) => group.pages.length > 0);
}

export function menuPages(role: ClubRole | null | undefined): Section[] {
  return menuGroups(role).flatMap((group) => group.pages);
}
