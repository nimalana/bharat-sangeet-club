// What the calendar page decides without drawing anything.
import type { ClubEvent, ScopeFilter } from "../../lib/portal-types";

/**
 * Whether something that belongs to a group (or to the whole club, when `subgroupId` is empty) shows under a scope filter:
 * "all" shows everything, "club" only what is club-wide, a number only that group's.
 */
export function matchesScope(subgroupId: number | null | undefined, scope: ScopeFilter): boolean {
  return scope === "all" || (scope === "club" ? !subgroupId : subgroupId === scope);
}

/** The dates the calendar shows under a scope filter, in the order they were given. */
export function eventsInScope(events: ClubEvent[], scope: ScopeFilter): ClubEvent[] {
  return events.filter((item) => matchesScope(item.subgroup_id, scope));
}
