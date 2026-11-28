// What the calendar page decides without drawing anything.
import type { ClubEvent, GroupOption, ScopeFilter } from "../../lib/db";

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

/**
 * The audience a date names under its title: "Club-wide", its group's name, or "Group" when the group is not in the list. (Not
 * components/ui ContentScopeLabel: that one is a different element, class and fallback word, "Subgroup".)
 */
export function scopeName(subgroupId: number | null | undefined, groups: GroupOption[]): string {
  return subgroupId ? groups.find((group) => group.id === subgroupId)?.name || "Group" : "Club-wide";
}
