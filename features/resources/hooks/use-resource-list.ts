// What the resource library shows and how it is read: the open folder (use-resource-folder.ts), the filters, the rows of the list,
// its breadcrumb (use-resource-breadcrumb.ts) and the two counts (use-resource-counts.ts). Everything that asks the database for the
// list is here or in those; the screen only draws it.
//
// The list is read when the folder or a filter changes, and again after any change (`refreshAll`). A list that was read before
// shows at once from the cache while it is read again; a refresh that fails keeps the rows of that same list and shows a banner
// (lib/refresh.ts), and rows of another folder or filter are dropped. Only the newest read may change the screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchResource, listArchivedAmong, listChildFolderIds, listResourcesPage, resourcesAvailable } from "../../../lib/api/resources";
import { clearCachePrefix, readCache, writeCache } from "../../../lib/cache";
import { useDebounced } from "../../../lib/hooks/use-debounced";
import { keepRowsOnFailure } from "../../../lib/refresh";
import {
  RESOURCE_PAGE_SIZE, buildListPlan, isFlatListing, listCacheKey, mergePage, orderForDisplay, resolveSubtreeFolderIds, subtreeCacheKey, type LibraryTab, type ScopeFilter, type SortKey,
} from "../../../lib/resources-query";
import type { Notify } from "../../../lib/toast";
import { attachThumbnails } from "../thumbnails";
import type { ListSnapshot, ResourceItem } from "../types";
import { useResourceBreadcrumb } from "./use-resource-breadcrumb";
import { useResourceCounts } from "./use-resource-counts";
import { useResourceFolder } from "./use-resource-folder";

export type ResourceListOptions = {
  userId: string;
  notify: Notify;
  onResourceCountChange?: (count: number) => void;
  initialScope: ScopeFilter;
};

export function useResourceList({ userId, notify, onResourceCountChange, initialScope }: ResourceListOptions) {
  const [tab, setTab] = useState<LibraryTab>("all");
  const [query, setQuery] = useState("");
  // What is sent to the database: the search box after a 250 ms pause.
  const [search, setSearch] = useDebounced(query, 250);
  const { scope, setScope, folderId, changeFolder } = useResourceFolder(initialScope);
  const [sort, setSort] = useState<SortKey>("updated");
  const [showArchived, setShowArchived] = useState(false);
  const listParams = useMemo(() => ({ folderId, scope, tab, search, sort, archived: showArchived }), [folderId, scope, tab, search, sort, showArchived]);
  const cacheKey = listCacheKey(listParams);
  const [firstSnapshot] = useState(() => readCache<ListSnapshot>(userId, cacheKey));
  const [items, setItems] = useState<ResourceItem[]>(() => firstSnapshot?.rows || []);
  const [hasMore, setHasMore] = useState(() => firstSnapshot?.hasMore || false);
  const [total, setTotal] = useState<number | null>(() => firstSnapshot?.total ?? null);
  const [loading, setLoading] = useState(() => !firstSnapshot);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  // Bumped after any change, so the list, breadcrumb and counts are read again.
  const [version, setVersion] = useState(0);
  const requestRef = useRef(0);
  // The list the rows on screen were loaded for; a failed refresh keeps them only for that same list.
  const shownKeyRef = useRef<string | null>(firstSnapshot ? cacheKey : null);
  const fetchedRef = useRef(0);
  const lastKeyRef = useRef("");

  // Drops every cached list, breadcrumb and subtree, then reads them again.
  const refreshAll = useCallback(() => { clearCachePrefix("resources:"); setVersion((value) => value + 1); }, []);

  // Rows added or changed by this screen show at once; refreshAll follows.
  const addRow = useCallback((item: ResourceItem) => {
    if (item.parent_id === folderId && !isFlatListing(listParams)) setItems((current) => current.some((row) => row.id === item.id) ? current : [item, ...current]);
  }, [folderId, listParams]);
  const replaceRow = useCallback((id: number, change: (item: ResourceItem) => ResourceItem) => setItems((current) => current.map((item) => item.id === id ? change(item) : item)), []);

  const fetchOneFolder = useCallback(async (id: number) => {
    // A row that cannot be read is a row that is not there (the breadcrumb then says the folder was not found).
    try { return await fetchResource(id) || null; } catch { return null; }
  }, []);

  const loadPage = useCallback(async (more: boolean) => {
    if (!resourcesAvailable()) {
      setItems([]); setHasMore(false); setLoading(false);
      setLoadError("Resource storage is not configured in this environment.");
      return;
    }
    const requestId = ++requestRef.current;
    const cached = more ? undefined : readCache<ListSnapshot>(userId, cacheKey);
    if (!more) {
      if (cached) { setItems(cached.rows); setHasMore(cached.hasMore); setTotal(cached.total); fetchedRef.current = cached.fetched; shownKeyRef.current = cacheKey; setLoading(false); }
      else if (lastKeyRef.current !== cacheKey) setLoading(true);
      lastKeyRef.current = cacheKey;
    } else setLoadingMore(true);
    setLoadError("");
    const fail = () => {
      if (requestId !== requestRef.current) return;
      setLoadError("Resources could not be loaded. Try again in a moment.");
      // The rows on screen stay when they belong to this same list; rows of another folder or filter go.
      if (!more && !keepRowsOnFailure(shownKeyRef.current, cacheKey)) { setItems([]); setHasMore(false); shownKeyRef.current = null; }
      notify("The resource library could not be loaded");
      setLoading(false); setLoadingMore(false);
    };
    try {
      // A search or kind tab looks inside the open folder and every folder under it.
      let subtreeIds: number[] | null = null;
      if (!showArchived && folderId !== null && isFlatListing(listParams)) {
        subtreeIds = readCache<number[]>(userId, subtreeCacheKey(folderId)) || null;
        if (!subtreeIds) {
          subtreeIds = await resolveSubtreeFolderIds(folderId, listChildFolderIds);
          writeCache(userId, subtreeCacheKey(folderId), subtreeIds);
        }
      }
      const offset = more ? fetchedRef.current : 0;
      const plan = buildListPlan({ ...listParams, subtreeIds, offset, limit: RESOURCE_PAGE_SIZE });
      const { rows, count } = await listResourcesPage(plan, !more);
      let page: ResourceItem[] = rows;
      const fetched = page.length;
      if (showArchived) {
        // Only the top-most archived items, so a folder is restored as one.
        const parentIds = [...new Set(page.map((item) => item.parent_id).filter((id): id is number => id !== null))];
        if (parentIds.length) {
          const archivedParents = new Set(await listArchivedAmong(parentIds));
          page = page.filter((item) => item.parent_id === null || !archivedParents.has(item.parent_id));
        }
      }
      const withThumbs = await attachThumbnails(userId, page);
      if (requestId !== requestRef.current) return;
      const nextTotal = more ? total : count ?? null;
      const moreAvailable = fetched === RESOURCE_PAGE_SIZE && (count === null || count === undefined || offset + fetched < count);
      fetchedRef.current = offset + fetched;
      if (!more) shownKeyRef.current = cacheKey;
      setHasMore(moreAvailable); setTotal(nextTotal);
      setItems((current) => more ? mergePage(current, withThumbs) : withThumbs);
      if (!more) writeCache<ListSnapshot>(userId, cacheKey, { rows: withThumbs, hasMore: moreAvailable, total: nextTotal, fetched: offset + fetched });
      setLoading(false); setLoadingMore(false);
    } catch {
      fail();
    }
  }, [cacheKey, folderId, listParams, notify, showArchived, total, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPage(false); }, 0);
    return () => window.clearTimeout(timer);
  // The list is read again when the folder or a filter changes, or after a change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, version]);

  const { itemById, crumbs, currentFolder } = useResourceBreadcrumb({ userId, notify, folderId, version, showArchived, items, changeFolder, fetchOneFolder });
  const hasArchivedItems = useResourceCounts(version, onResourceCountChange);

  // Folders first, pinned items ahead of both; the database already ordered the rest.
  const visibleItems = useMemo(() => orderForDisplay(items), [items]);

  return {
    tab, setTab, query, setQuery, search, setSearch, scope, setScope, sort, setSort, showArchived, setShowArchived,
    folderId, changeFolder, listParams,
    items, visibleItems, hasMore, total, loading, loadingMore, loadError, loadPage, version, refreshAll, addRow, replaceRow, fetchOneFolder,
    itemById, crumbs, currentFolder, hasArchivedItems,
  };
}
