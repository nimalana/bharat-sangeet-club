// What the workspace reads: the list of recordings for the view, group and search in force, 24 at a time, newest first.
//
// - search, view, group and "show more" each start a load; only the newest may change the list (request gate);
// - reopening shows the last first page at once (cache) and refreshes behind it;
// - a failed load keeps the list already shown, and its count, instead of emptying it.
import { useCallback, useEffect, useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import { listRecordings } from "../../../lib/api/recordings";
import { readCache, writeCache } from "../../../lib/cache";
import { useDebounced } from "../../../lib/hooks/use-debounced";
import { createRequestGate } from "../../../lib/request-gate";
import { useToast } from "../../../components/ui/toast";
import { visibleRecordings, type Recording, type RecordingView, type Scope } from "../model";

export function useRecordingsList({ userId, canManage, initialScope }: { userId: string; canManage: boolean; initialScope: Scope }) {
  const { notify } = useToast();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<RecordingView>("published");
  const [loading, setLoading] = useState(true);

  // The server filters and pages the list: 24 at a time, newest first.
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const search = useDebounced(query, 250, () => setPages(1))[0].trim();
  const cacheKey = `recordings:${view}:${scope}:${search}`;
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

  // Each choice starts again at the first page.
  const chooseView = (next: RecordingView) => { setView(next); setPages(1); };
  const chooseScope = (next: Scope) => { setScope(next); setPages(1); };
  const showMore = () => setPages((current) => current + 1);

  return { recordings, visible, scope, query, setQuery, view, loading, total, loadFailed, load, chooseView, chooseScope, showMore };
}
