// What the workspace reads: the list of recordings for the view, group and search in force, 24 at a time, newest first.
//
// - the view, the group and the search live in the address (?view=drafts&group=3&q=bhairavi), so a reload keeps them, a link opens them
//   and Back returns to the last view or group; a value that is not valid (an unknown view, a group the person is not in) is the default;
// - search, view, group and "show more" each start a load; only the newest may change the list (request gate);
// - reopening shows the last first page at once (cache) and refreshes behind it;
// - a failed load keeps the list already shown, and its count, instead of emptying it.
import { useCallback, useEffect, useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import { listRecordings } from "../../../lib/api/recordings";
import { readCache, writeCache } from "../../../lib/cache";
import { useDebounced } from "../../../lib/hooks/use-debounced";
import { oneOf, positiveInteger, useUrlState } from "../../../lib/hooks/use-url-state";
import { createRequestGate } from "../../../lib/request-gate";
import { useToast } from "../../../components/ui/toast";
import { visibleRecordings, type Recording, type RecordingView, type Scope } from "../model";

const VIEWS = ["published", "drafts", "archived"] as const;
const parseView = oneOf(VIEWS);
const parseScope = (raw: string): Scope | undefined => (raw === "all" ? "all" : positiveInteger(raw));
const PUBLISHED: RecordingView = "published";

export function useRecordingsList({ userId, canManage, initialScope, groupIds }: { userId: string; canManage: boolean; initialScope: Scope; /** The groups the person may choose from. */ groupIds: readonly number[] }) {
  const { notify } = useToast();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  // The group a link from another page asked for is the default; the address says it when the person chooses another.
  const [usualScope] = useState<Scope>(initialScope);
  const [urlScope, setUrlScope] = useUrlState<Scope>("group", { parse: parseScope, defaultValue: usualScope, history: "push" });
  const allowed = (value: Scope) => value === "all" || groupIds.includes(value);
  const scope: Scope = allowed(urlScope) ? urlScope : allowed(usualScope) ? usualScope : "all";
  const [view, setUrlView] = useUrlState<RecordingView>("view", { parse: parseView, defaultValue: PUBLISHED, history: "push" });
  // The search box keeps its own text (a controlled input must change in the event that typed); the address follows it, and the box
  // follows the address when Back or a link changes it.
  const [urlQuery, setUrlQuery] = useUrlState("q", { defaultValue: "", history: "replace" });
  const [query, setQueryText] = useState(urlQuery);
  const [seenQuery, setSeenQuery] = useState(urlQuery);
  if (urlQuery !== seenQuery) { setSeenQuery(urlQuery); setQueryText(urlQuery); }
  const setQuery = (text: string) => { setQueryText(text); setUrlQuery(text.trim() ? text : ""); };
  const [loading, setLoading] = useState(true);

  // The server filters and pages the list: 24 at a time, newest first.
  const search = useDebounced(query, 250)[0].trim();
  const cacheKey = `recordings:${view}:${scope}:${search}`;
  // "Show more" counts pages for the list it was pressed on: another view, group or search starts again at the first page.
  const [paged, setPaged] = useState({ key: cacheKey, pages: 1 });
  const pages = paged.key === cacheKey ? paged.pages : 1;
  const [total, setTotal] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  // Search, view, scope and "show more" each start a load; only the newest may change the list.
  const [loadGate] = useState(createRequestGate);

  const load = useCallback(async () => {
    const isCurrent = loadGate.begin();
    const cachedPage = readCache<{ rows: Recording[]; total: number }>(userId, cacheKey);
    if (cachedPage && pages === 1) { setRecordings(cachedPage.rows); setTotal(cachedPage.total); setLoading(false); }
    else if (pages === 1) setLoading(true);
    const { data: list, error } = await attempt(() => listRecordings({ view, scope, search, pages, userId, canManage }));
    if (!isCurrent()) return;
    // A failed load keeps the list already shown (and its count) instead of emptying it.
    if (error) { setLoadFailed(true); setLoading(false); notify("The recordings workspace could not be loaded"); return; }
    setLoadFailed(false);
    const rows = list.rows as Recording[];
    setRecordings(rows);
    setTotal(list.total);
    if (pages === 1) writeCache(userId, cacheKey, { rows, total: list.total });
    setLoading(false);
  }, [cacheKey, canManage, loadGate, notify, pages, scope, search, userId, view]);

  // The loader synchronizes remote Supabase state into this client component.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const visible = visibleRecordings(recordings, { view, scope, query, userId, canManage });

  const chooseView = (next: RecordingView) => setUrlView(next);
  const chooseScope = (next: Scope) => setUrlScope(next);
  const showMore = () => setPaged({ key: cacheKey, pages: pages + 1 });

  return { recordings, visible, scope, query, setQuery, view, loading, total, loadFailed, load, chooseView, chooseScope, showMore };
}
