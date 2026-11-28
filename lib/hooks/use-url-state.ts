// A piece of screen state that lives in the address bar: the open tab, the selected group, the open folder, the calendar month, a filter.
// A reload keeps it, a link opens it, and the browser's Back and Forward move through it.
//
//   const TABS = ["overview", "meetings", "excuses"] as const;
//   const [tab, setTab] = useUrlState("tab", { parse: oneOf(TABS), defaultValue: "overview", history: "push" });
//   const [groupId, setGroupId] = useUrlState("group", { parse: positiveInteger, defaultValue: null, history: "push" });
//   const [search, setSearch] = useUrlState("q", { defaultValue: "", history: "replace" });     // text: parse and serialize default to the string itself
//
// `history` is required, because it is a decision about the screen: "push" adds a history entry (Back returns to the previous value; for
// a tab, a folder, a selection) and "replace" overwrites the current one (Back leaves the screen; for a filter typed letter by letter).
//
// The address is the truth, and it is read the way the rest of the portal reads it (`?page=` in lib/sections.ts, `?folder=` in lib/resources-query.ts):
// `new URLSearchParams(window.location.search)`, written with `history.pushState({}, "", "<path>?<query>")` and read again on `popstate`.
// This hook never touches `?page=` or any parameter it was not asked about, and keeps the hash.
//
// - The value is `defaultValue` when the parameter is absent. Setting the default REMOVES the parameter (the address of a screen in its
//   usual state stays clean), and a value is compared by its serialized form (`serialize`), so `defaultValue` should be a constant.
// - A parameter that is empty, that `parse` returns `undefined` or `null` for, or that makes `parse` throw, is ignored: the value is `defaultValue`.
//   Reading never writes to the address and never throws; a mistyped link opens the screen in its usual state.
// - Back and Forward (`popstate`) update the value. Two screens (two hooks) that use the same key stay in step.
// - SSR: nothing reads `window` while rendering. The server and the first client render (hydration) give `defaultValue`; a different value in
//   the address is read straight after, in a second render, so there is no hydration mismatch.
// - Several updates made in the same tick (one click handler that sets a tab and a folder, or the same key twice) are written together, as ONE
//   history entry, and for the same key the last one wins. If any of them asks for "push" the entry is pushed, else it replaces. A value that
//   is already in the address writes nothing.
// - `setValue` has the same identity on every render. The value has a stable identity while the address and the options do not change, so an
//   object made by `parse` can be listed in an effect's dependencies (define `parse` and `defaultValue` outside the component, or they are new each render).
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export type UrlStateOptions<T> = {
  /** The value when the parameter is absent or invalid. A constant: it is compared by `serialize`. */
  defaultValue: T;
  /** Turns the parameter's text into a value; return `undefined` (or null) for text that is not valid. It may throw. Default: the text itself. */
  parse?: (raw: string) => T | undefined | null;
  /** Turns a value into the parameter's text. Default: `String(value)`. */
  serialize?: (value: T) => string;
  /** "push": a new history entry (Back returns); "replace": the current entry is overwritten. */
  history: "push" | "replace";
};

/** A parse for a value that is one of `allowed`: `useUrlState("tab", { parse: oneOf(TABS), ... })`. Anything else is invalid. */
export const oneOf = <T extends string>(allowed: readonly T[]) => (raw: string): T | undefined => (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;

/** A parse for a plain positive whole number (an id), as `parseFolderParam` reads `?folder=`: `7` is 7; `0`, `-1`, `1.5`, `7abc` and `007` are invalid. */
export const positiveInteger = (raw: string): number | undefined => {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
};

// ---------------------------------------------------------------- writing the address: one entry for the changes of one tick

type Change = { raw: string | null; usual: string };
const pending = new Map<string, Change>();
let pendingPush = false;
// What the hook writes is announced to every hook with this event (the browser says nothing about a pushState of the page's own).
const WRITTEN = "url-state-written";

// Runs once per tick that set something (a second run in the same tick finds nothing left to write).
function flush() {
  const changes = [...pending];
  const push = pendingPush;
  pending.clear();
  pendingPush = false;
  const params = new URLSearchParams(window.location.search);
  let changed = false;
  for (const [key, { raw, usual }] of changes) {
    const before = params.get(key);
    // An explicit parameter that says the usual value is the same as none.
    if ((before === usual ? null : before) !== raw) changed = true;
    if (raw === null) params.delete(key); else params.set(key, raw);
  }
  if (!changed) return;
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (push) window.history.pushState({}, "", url); else window.history.replaceState({}, "", url);
  window.dispatchEvent(new Event(WRITTEN));
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(WRITTEN, onChange);
  return () => { window.removeEventListener("popstate", onChange); window.removeEventListener(WRITTEN, onChange); };
}

export function useUrlState<T>(key: string, options: UrlStateOptions<T>): readonly [value: T, setValue: (next: T) => void] {
  const { defaultValue, parse, serialize, history } = options;
  const raw = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(key),
    () => null,
  );
  const value = useMemo(() => {
    if (!raw) return defaultValue;
    try {
      return (parse ? parse(raw) : (raw as unknown as T)) ?? defaultValue;
    } catch {
      return defaultValue;
    }
  }, [raw, parse, defaultValue]);

  // setValue is read at event time: it always uses the options of the latest render and keeps one identity.
  const latest = useRef({ serialize, defaultValue, history });
  useEffect(() => { latest.current = { serialize, defaultValue, history }; });
  const setValue = useCallback((next: T) => {
    if (typeof window === "undefined") return;
    const { serialize: write = (v: T) => String(v), defaultValue: usualValue, history: mode } = latest.current;
    const text = write(next);
    const usual = write(usualValue);
    pending.set(key, { raw: text === usual ? null : text, usual });
    if (mode === "push") pendingPush = true;
    queueMicrotask(flush);
  }, [key]);

  return [value, setValue] as const;
}
