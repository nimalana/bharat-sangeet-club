"use client";

// Which group is open and which of its tabs, kept in the address (`?page=groups&group=12&tab=roster`) with useUrlState: a reload keeps
// them, a link opens them, Back returns from a tab to the one before and from a group to the list. `?page=` is the shell's and is not
// touched. A missing or invalid value is the default (no group: the list; no tab: the first tab); an id that is not one of the person's
// groups is checked by the page that has the groups, which then shows the list (nothing is written back to the address).
import { oneOf, positiveInteger, useUrlState } from "../../../lib/hooks/use-url-state";

/** The tabs of a group's page, in the order they are drawn. The first is the default. */
const GROUP_TAB_IDS = ["announcements", "dates", "resources", "recordings", "attendance", "roster", "requests"] as const;
export type GroupTabId = (typeof GROUP_TAB_IDS)[number];
export const DEFAULT_GROUP_TAB: GroupTabId = GROUP_TAB_IDS[0];

const parseTab = oneOf(GROUP_TAB_IDS);

/** `?group=<id>`: the open group, or null (the list). "push": Back goes from a group to the list. */
export function useGroupParam() {
  return useUrlState<number | null>("group", { parse: positiveInteger, defaultValue: null, history: "push" });
}

/** `?tab=<id>`: the open tab. "push": Back returns to the tab before. The page that knows the person's rights replaces a tab they may not open by the first. */
export function useGroupTabParam() {
  return useUrlState<GroupTabId>("tab", { parse: parseTab, defaultValue: DEFAULT_GROUP_TAB, history: "push" });
}
