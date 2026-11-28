// What the group's people screens share: the group they manage, the confirmation they may be asking for, and the words for roles and
// ways of joining.
import type { ReactNode } from "react";
import type { EnrollmentMode, GroupRole, Subgroup, Tables } from "../../lib/db";
import type { RosterRow } from "../../lib/api/groups";

export type ManagedGroup = Pick<Tables<"subgroups">, "id" | "name" | "description" | "enrollment_mode"> & Partial<Pick<Tables<"subgroups">, "archived_at">>;

/** The confirmation a person is being asked for, if any. */
export type Pending =
  | { kind: "remove"; row: RosterRow }
  | { kind: "decline"; row: RosterRow }
  | { kind: "leave" }
  | { kind: "archive" }
  | null;

export const roleLabels: Record<GroupRole, string> = { member: "Member", leader: "Leader", manager: "Manager" };
export const modeLabels: Record<EnrollmentMode, string> = { open: "Open — anyone can join", approval: "Request approval", invite: "Invitation only" };

/**
 * How the shell puts another area's screen into one of a group's tabs (features may not import each other; the shell combines them).
 * It is asked when that tab is opened, never before, so the screen it returns loads only then. Answer null (or undefined) for a tab the
 * shell does not fill: the group page shows its own short panel for it, with the button that opens that page for the group.
 */
export type GroupTabRenderer = (tab: "dates" | "resources" | "recordings" | "attendance", group: Subgroup) => ReactNode;
