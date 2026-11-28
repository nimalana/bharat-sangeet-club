// What the Attendance screen keeps in the address (Phase 3.2), as text and back: the audience (?scope=), the term (?term=) and the
// selected meeting (?session=). The three read and write through useUrlState (hooks/use-attendance-url.ts); this file only says what
// a valid value looks like, and is free of React so it runs under `node --test`.
//
//   ?page=attendance&scope=club&term=2026-fall&session=14
//
// A value that is not valid is not an error: useUrlState treats `undefined` as "not there", and the screen opens in its usual view.
// The tab is NOT in the address: the shell keys the page by its `?tab=` (portal.tsx), so writing it would remount the page.

// Type-only import: this file is loaded by node's test runner, so it imports nothing at run time.
import type { ScopeFilter } from "../../lib/db";

/** `all`, `club`, or `group-7` (a subgroup by its number). Anything else, `group-0`, `group-07` or `group-x` included, is invalid. */
export function parseScope(raw: string): ScopeFilter | undefined {
  if (raw === "all" || raw === "club") return raw;
  const group = /^group-([1-9]\d{0,15})$/.exec(raw);
  if (!group) return undefined;
  const id = Number(group[1]);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** The text of a scope; `null` (no choice made: the screen's own starting audience) is the empty text, which is never written. */
export function serializeScope(scope: ScopeFilter | null): string {
  if (scope === null) return "";
  return typeof scope === "number" ? `group-${scope}` : scope;
}

/** `all` (every term, the usual) or a term key such as `2026-fall` or `2025-spring`. */
export function parseTerm(raw: string): string | undefined {
  return raw === "all" || /^\d{4}-(spring|fall)$/.test(raw) ? raw : undefined;
}
