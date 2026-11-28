// The part of the Attendance screen that lives in the address (Phase 3.2): which audience, which term and which meeting is selected.
// A reload keeps them, a link opens them, and the browser's Back and Forward move through them (every choice is a history entry).
//
// - The audience is `?scope=` (all, club, group-7). With no `scope` it is the audience the page was opened for (`initialScope`: "Open
//   attendance" on a group), so that link and the address agree without the address saying it. A group that is not one of `groups`
//   (once the groups are known) is not a view this person can open: the page falls back to its starting audience.
// - The term is `?term=` (2026-fall); no `term` is every term.
// - The selected meeting is `?session=` (a number). A number that is not a meeting of this view is read by the data hook as "the first one".
// - Nothing is written until the person chooses, and a bad value is only ignored, never corrected in the address.
// - `?page=` (the shell's) and every other parameter are left alone; the tab is not here (see url-state.ts).
import { useCallback } from "react";
import type { GroupOption, ScopeFilter } from "../../../lib/db";
import { positiveInteger, useUrlState } from "../../../lib/hooks/use-url-state";
import { parseScope, parseTerm, serializeScope } from "../url-state";

export function useAttendanceUrl({ initialScope, groups }: { initialScope: ScopeFilter; groups: GroupOption[] }) {
  const [scopeParam, setScopeParam] = useUrlState<ScopeFilter | null>("scope", { parse: parseScope, serialize: serializeScope, defaultValue: null, history: "push" });
  const [termFilter, setTermParam] = useUrlState<string>("term", { parse: parseTerm, defaultValue: "all", history: "push" });
  const [sessionParam, setSessionParam] = useUrlState<number | null>("session", { parse: positiveInteger, defaultValue: null, history: "push" });

  // Before the groups are known (none yet) a well-formed group is taken as it is; the server decides what its caller may read.
  const scopeIsKnown = typeof scopeParam !== "number" || groups.length === 0 || groups.some((group) => group.id === scopeParam);
  const scopeFilter: ScopeFilter = scopeParam !== null && scopeIsKnown ? scopeParam : initialScope;

  const chooseScope = useCallback((value: ScopeFilter) => setScopeParam(value), [setScopeParam]);
  const chooseTerm = useCallback((value: string) => setTermParam(value), [setTermParam]);
  const chooseSession = useCallback((id: number) => setSessionParam(id), [setSessionParam]);

  return { scopeFilter, termFilter, sessionParam, chooseScope, chooseTerm, chooseSession };
}
