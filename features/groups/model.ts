// What the group's people screens share: the group they manage, the confirmation they may be asking for, and the words for roles and
// ways of joining.
import type { EnrollmentMode, GroupRole, Tables } from "../../lib/db";
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
