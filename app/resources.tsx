"use client";

import type { User } from "@supabase/supabase-js";
import { ResourceActions } from "../components/resources/resource-actions";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { clearCachePrefix, readCache, writeCache } from "../lib/cache";
import { keepRowsOnFailure } from "../lib/refresh";
import { LoadErrorBanner } from "../components/ui/load-error";
import {
  RESOURCE_PAGE_SIZE, THUMBNAIL_TTL_SECONDS, applyListPlan, buildListPlan, chainFromKnown, crumbCacheKey, folderUrl, isFlatListing, listCacheKey,
  mergePage, orderForDisplay, parseFolderParam, resolveFolderChain, resolveSubtreeFolderIds, subtreeCacheKey, thumbnailCacheKey, thumbnailExpiry, thumbnailsToSign,
  type LibraryTab, type ScopeFilter, type SortKey, type ThumbnailEntry,
} from "../lib/resources-query";
import { supabase } from "../lib/supabase";
import styles from "./resources.module.css";

export type ResourceItem = {
  id: number;
  node_kind: "folder" | "file" | "link";
  media_kind: "document" | "image" | "other" | null;
  title: string;
  description: string | null;
  parent_id: number | null;
  subgroup_id: number | null;
  visibility: "members" | "executives";
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  event_id: number | null;
  occurred_on: string | null;
  season_label: string | null;
  status: "pending_upload" | "ready" | "failed" | "archived";
  is_pinned: boolean;
  import_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  signedUrl?: string;
};

export type ResourceLibraryProps = {
  user: User;
  role: "member" | "executive" | "admin";
  groups: Array<{ id: number; name: string }>;
  memberships: Array<{ subgroup_id: number; status: string; membership_role: string }>;
  events: Array<{ id: number; title: string; starts_at: string; subgroup_id: number | null }>;
  notify: (message: string) => void;
  onResourceCountChange?: (count: number) => void;
  initialScope?: "all" | "club" | number;
};

type ComposerMode = "menu" | "folder" | "link" | "files" | "folder-upload" | null;
type UploadEntry = { file: File; relativePath: string; state: "queued" | "uploading" | "ready" | "failed"; error?: string };

const RESOURCE_FIELDS = "id,node_kind,media_kind,title,description,parent_id,subgroup_id,visibility,storage_bucket,storage_path,external_url,original_filename,mime_type,byte_size,checksum_sha256,event_id,occurred_on,season_label,status,is_pinned,import_id,created_by,created_at,updated_at";

function Icon({ name, size = 18 }: { name: "search" | "plus" | "folder" | "file" | "link" | "image" | "chevron" | "arrow" | "close" | "upload" | "grid" | "list" | "lock" | "external" | "refresh"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.7" /><path d="m16 16 4.3 4.3" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    folder: <><path d="M3.4 6.8h6l1.8 2h9.4v8.7a1.7 1.7 0 0 1-1.7 1.7H5.1a1.7 1.7 0 0 1-1.7-1.7Z" /><path d="M3.4 6.8V5.6a1.3 1.3 0 0 1 1.3-1.3h4l1.8 2.5" /></>,
    file: <><path d="M6 3.8h8l4 4v12.4H6z" /><path d="M14 3.8v4h4M9 13h6M9 16.5h4" /></>,
    link: <><path d="M9.6 14.4 8 16a3.7 3.7 0 0 1-5.2-5.2l2.8-2.8a3.7 3.7 0 0 1 5.2 0" /><path d="m14.4 9.6 1.6-1.6a3.7 3.7 0 0 1 5.2 5.2l-2.8 2.8a3.7 3.7 0 0 1-5.2 0" /><path d="m8.5 15.5 7-7" /></>,
    image: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="8.2" cy="9.1" r="1.4" /><path d="m4.5 17 4.5-4.5 3.2 3.1 2.2-2.2 5.1 4.8" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.1M4 12h.1M4 18h.1" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></>,
    external: <><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.6-3L4 10" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.6 3L20 14" /><path d="M20 19v-5h-5" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function formatBytes(bytes: number | null) {
  if (!bytes || bytes < 1) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function safeSegment(value: string) {
  return value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function isImage(item: ResourceItem) {
  return item.media_kind === "image" || Boolean(item.mime_type?.startsWith("image/"));
}

function itemIcon(item: ResourceItem) {
  if (item.node_kind === "folder") return "folder" as const;
  if (item.node_kind === "link") return "link" as const;
  return isImage(item) ? "image" as const : "file" as const;
}

type ListSnapshot = { rows: ResourceItem[]; hasMore: boolean; total: number | null; fetched: number };

// Signs the thumbnails of what is on screen: one request per bucket, only for
// images with no fresh link in the cache. Opening any other file signs on click.
async function attachThumbnails(client: NonNullable<typeof supabase>, userId: string, list: ResourceItem[]): Promise<ResourceItem[]> {
  const now = Date.now();
  const lookup = (key: string) => readCache<ThumbnailEntry>(userId, key);
  const toSign = thumbnailsToSign(list, lookup, now);
  await Promise.all([...toSign].map(async ([bucket, paths]) => {
    const signed = await client.storage.from(bucket).createSignedUrls(paths, THUMBNAIL_TTL_SECONDS);
    for (const entry of signed.data || []) if (entry.signedUrl && entry.path) writeCache<ThumbnailEntry>(userId, thumbnailCacheKey(bucket, entry.path), { url: entry.signedUrl, expires: thumbnailExpiry(now) });
  }));
  return list.map((item) => {
    if (!item.storage_path || item.node_kind !== "file" || !isImage(item)) return item;
    const hit = lookup(thumbnailCacheKey(item.storage_bucket || "club-resources", item.storage_path));
    return hit && hit.expires > now ? { ...item, signedUrl: hit.url } : item;
  });
}

function normalizeUrl(value: string) {
  const raw = value.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Links must use http or https");
  return url.toString();
}

export function ResourceLibrary({ user, role, groups, memberships, events, notify, onResourceCountChange, initialScope = "all" }: ResourceLibraryProps) {
  const [tab, setTab] = useState<LibraryTab>("all");
  const [query, setQuery] = useState("");
  // What is sent to the database: the search box after a 250 ms pause.
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<ScopeFilter>(initialScope);
  // The open folder lives in the address bar as ?page=documents&folder=<id>.
  const [folderId, setFolderId] = useState<number | null>(() => typeof window === "undefined" ? null : parseFolderParam(window.location.search));
  const [sort, setSort] = useState<SortKey>("updated");
  const [showArchived, setShowArchived] = useState(false);
  const listParams = useMemo(() => ({ folderId, scope, tab, search, sort, archived: showArchived }), [folderId, scope, tab, search, sort, showArchived]);
  const cacheKey = listCacheKey(listParams);
  const [firstSnapshot] = useState(() => readCache<ListSnapshot>(user.id, cacheKey));
  const [items, setItems] = useState<ResourceItem[]>(() => firstSnapshot?.rows || []);
  const [hasMore, setHasMore] = useState(() => firstSnapshot?.hasMore || false);
  const [total, setTotal] = useState<number | null>(() => firstSnapshot?.total ?? null);
  const [loading, setLoading] = useState(() => !firstSnapshot);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  // Bumped after any change, so the list, breadcrumb and counts are read again.
  const [version, setVersion] = useState(0);
  const [crumbState, setCrumbState] = useState<ResourceItem[]>([]);
  const [hasArchivedItems, setHasArchivedItems] = useState(false);
  const [childCountState, setChildCountState] = useState<{ id: number; count: number } | null>(null);
  const [selectedChain, setSelectedChain] = useState<{ id: number; chain: ResourceItem[] } | null>(null);
  const requestRef = useRef(0);
  // The list the rows on screen were loaded for; a failed refresh keeps them only for that same list.
  const shownKeyRef = useRef<string | null>(firstSnapshot ? cacheKey : null);
  const fetchedRef = useRef(0);
  const lastKeyRef = useRef("");
  const previousScopeRef = useRef(initialScope);
  const [display, setDisplay] = useState<"list" | "grid">("list");
  const [composer, setComposer] = useState<ComposerMode>(null);
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const [composerError, setComposerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [folderTitle, setFolderTitle] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderVisibility, setFolderVisibility] = useState<"members" | "executives">("members");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkVisibility, setLinkVisibility] = useState<"members" | "executives">("members");
  const [uploadEntries, setUploadEntries] = useState<UploadEntry[]>([]);
  const [uploadMode, setUploadMode] = useState<"files" | "folder-upload">("files");
  const [uploadVisibility, setUploadVisibility] = useState<"members" | "executives">("members");
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadDone, setUploadDone] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [failedUploadCount, setFailedUploadCount] = useState(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeMemberships = useMemo(() => new Set(memberships.filter((membership) => membership.status === "active").map((membership) => membership.subgroup_id)), [memberships]);
  const canManageClub = role === "executive" || role === "admin";
  const availableGroups = canManageClub ? groups : groups.filter((group) => activeMemberships.has(group.id));
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  // Everything on screen that is known by id: the rows and the open folder's ancestors.
  const itemById = useMemo(() => new Map([...crumbState, ...items].map((item) => [item.id, item])), [crumbState, items]);
  const canManageSubgroup = useCallback((subgroupId: number | null) => Boolean(subgroupId && (canManageClub || memberships.some((membership) => membership.subgroup_id === subgroupId && membership.status === "active" && ["leader", "manager"].includes(membership.membership_role)))), [canManageClub, memberships]);
  const canWriteScope = useCallback((subgroupId: number | null) => subgroupId === null ? canManageClub : canManageSubgroup(subgroupId), [canManageClub, canManageSubgroup]);

  useEffect(() => {
    // initialScope is also used to deep-link from My Groups; defer the sync so
    // the render that receives new navigation props stays interruption-safe.
    // The first run is skipped so a folder in the address bar is kept.
    if (previousScopeRef.current === initialScope) return;
    previousScopeRef.current = initialScope;
    const timer = window.setTimeout(() => { setScope(initialScope); changeFolder(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialScope]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Back and forward move between folders because each folder is its own URL.
  useEffect(() => {
    const onPopState = () => setFolderId(parseFolderParam(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function changeFolder(next: number | null) {
    setFolderId(next);
    const url = folderUrl(window.location.pathname, window.location.search, next);
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.pushState({ section: "documents" }, "", url);
  }

  // Drops every cached list, breadcrumb and subtree, then reads them again.
  const refreshAll = useCallback(() => { clearCachePrefix("resources:"); setVersion((value) => value + 1); }, []);

  // Rows added or changed by this screen show at once; refreshAll follows.
  const addRow = useCallback((item: ResourceItem) => {
    if (item.parent_id === folderId && !isFlatListing(listParams)) setItems((current) => current.some((row) => row.id === item.id) ? current : [item, ...current]);
  }, [folderId, listParams]);
  const replaceRow = useCallback((id: number, change: (item: ResourceItem) => ResourceItem) => setItems((current) => current.map((item) => item.id === id ? change(item) : item)), []);

  const fetchOneFolder = useCallback(async (id: number) => {
    if (!supabase) return null;
    const { data } = await supabase.from("resources").select(RESOURCE_FIELDS).eq("id", id).maybeSingle();
    return (data as ResourceItem | null) || null;
  }, []);

  const loadPage = useCallback(async (more: boolean) => {
    const client = supabase;
    if (!client) {
      setItems([]); setHasMore(false); setLoading(false);
      setLoadError("Resource storage is not configured in this environment.");
      return;
    }
    const requestId = ++requestRef.current;
    const cached = more ? undefined : readCache<ListSnapshot>(user.id, cacheKey);
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
        subtreeIds = readCache<number[]>(user.id, subtreeCacheKey(folderId)) || null;
        if (!subtreeIds) {
          subtreeIds = await resolveSubtreeFolderIds(folderId, async (parentIds) => {
            const { data, error } = await client.from("resources").select("id").eq("node_kind", "folder").neq("status", "archived").in("parent_id", parentIds);
            if (error) throw error;
            return (data || []).map((row: { id: number }) => row.id);
          });
          writeCache(user.id, subtreeCacheKey(folderId), subtreeIds);
        }
      }
      const offset = more ? fetchedRef.current : 0;
      const plan = buildListPlan({ ...listParams, subtreeIds, offset, limit: RESOURCE_PAGE_SIZE });
      const { data, error, count } = await applyListPlan(client.from("resources").select(RESOURCE_FIELDS, { count: more ? undefined : "exact" }), plan);
      if (error) throw error;
      let page = (data || []) as ResourceItem[];
      const fetched = page.length;
      if (showArchived) {
        // Only the top-most archived items, so a folder is restored as one.
        const parentIds = [...new Set(page.map((item) => item.parent_id).filter((id): id is number => id !== null))];
        if (parentIds.length) {
          const parents = await client.from("resources").select("id,status").in("id", parentIds);
          if (parents.error) throw parents.error;
          const archivedParents = new Set((parents.data || []).filter((row: { status: string }) => row.status === "archived").map((row: { id: number }) => row.id));
          page = page.filter((item) => item.parent_id === null || !archivedParents.has(item.parent_id));
        }
      }
      const withThumbs = await attachThumbnails(client, user.id, page);
      if (requestId !== requestRef.current) return;
      const nextTotal = more ? total : count ?? null;
      const moreAvailable = fetched === RESOURCE_PAGE_SIZE && (count === null || count === undefined || offset + fetched < count);
      fetchedRef.current = offset + fetched;
      if (!more) shownKeyRef.current = cacheKey;
      setHasMore(moreAvailable); setTotal(nextTotal);
      setItems((current) => more ? mergePage(current, withThumbs) : withThumbs);
      if (!more) writeCache<ListSnapshot>(user.id, cacheKey, { rows: withThumbs, hasMore: moreAvailable, total: nextTotal, fetched: offset + fetched });
      setLoading(false); setLoadingMore(false);
    } catch {
      fail();
    }
  }, [cacheKey, folderId, listParams, notify, showArchived, total, user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPage(false); }, 0);
    return () => window.clearTimeout(timer);
  // The list is read again when the folder or a filter changes, or after a change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, version]);

  // The breadcrumb: the open folder and its ancestors, fetching only what is missing.
  useEffect(() => {
    if (folderId === null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const cachedChain = readCache<ResourceItem[]>(user.id, crumbCacheKey(folderId));
      if (cachedChain) setCrumbState(cachedChain);
      const known = new Map(itemById);
      const chain = await resolveFolderChain(folderId, known, fetchOneFolder);
      if (cancelled) return;
      const found = chain[chain.length - 1];
      if (!found || found.id !== folderId || (found.status === "archived" && !showArchived)) {
        notify("That folder could not be found");
        changeFolder(null);
        return;
      }
      writeCache(user.id, crumbCacheKey(folderId), chain);
      setCrumbState(chain);
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, version]);

  // Whether anything is archived, and how many live items there are, without loading the library.
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const [archived, live] = await Promise.all([
        client.from("resources").select("id", { count: "exact", head: true }).eq("status", "archived"),
        client.from("resources").select("id", { count: "exact", head: true }).neq("status", "archived"),
      ]);
      if (cancelled) return;
      if (!archived.error) setHasArchivedItems((archived.count || 0) > 0);
      if (!live.error && live.count !== null) onResourceCountChange?.(live.count);
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    if (!composer && !selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setComposer(null); setSelected(null); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [composer, selected]);

  useEffect(() => {
    if (composer) window.setTimeout(() => composerRef.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(), 0);
  }, [composer]);

  const crumbs = useMemo(() => folderId !== null && crumbState.length && crumbState[crumbState.length - 1].id === folderId ? crumbState : [], [crumbState, folderId]);
  const currentFolder = crumbs.length ? crumbs[crumbs.length - 1] : null;
  const currentVisibility = currentFolder?.visibility || "members";
  const breadcrumb = crumbs;

  // Where the selected item sits, resolved from what is known and fetched only when it is not.
  useEffect(() => {
    if (!selected || selected.parent_id === null) return;
    const parentId = selected.parent_id;
    const known = chainFromKnown(parentId, itemById);
    if (known) return;
    let cancelled = false;
    void resolveFolderChain(parentId, itemById, fetchOneFolder).then((chain) => { if (!cancelled) setSelectedChain({ id: selected.id, chain }); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.parent_id]);
  const selectedLocation = useMemo(() => {
    if (!selected || selected.parent_id === null) return [];
    return chainFromKnown(selected.parent_id, itemById) || (selectedChain?.id === selected.id ? selectedChain.chain : []);
  }, [itemById, selected, selectedChain]);

  // A folder's contents are not loaded, so how many it holds is asked on its own.
  const selectedFolderId = selected?.node_kind === "folder" ? selected.id : null;
  useEffect(() => {
    const client = supabase;
    if (!client || selectedFolderId === null) return;
    let cancelled = false;
    void client.from("resources").select("id", { count: "exact", head: true }).eq("parent_id", selectedFolderId).then(({ count, error }) => {
      if (!cancelled && !error) setChildCountState({ id: selectedFolderId, count: count || 0 });
    });
    return () => { cancelled = true; };
  }, [selectedFolderId, version]);

  // Folders first, pinned items ahead of both; the database already ordered the rest.
  const visibleItems = useMemo(() => orderForDisplay(items), [items]);

  const destinationScope = currentFolder ? currentFolder.subgroup_id : scope === "club" || scope === "all" ? null : scope;
  const uploadDestinationVisibility = currentFolder?.visibility || (canManageClub ? uploadVisibility : "members");
  const canAdd = canWriteScope(destinationScope) && (folderId === null || currentFolder !== null);

  function openComposer(mode: Exclude<ComposerMode, null>) {
    setComposerError("");
    setComposer(mode);
    if (mode === "files" || mode === "folder-upload") { setUploadMode(mode); setUploadEntries([]); }
  }

  function closeComposer() {
    if (saving || uploading) return;
    setComposer(null);
    setComposerError("");
    setUploadEntries([]);
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !canWriteScope(destinationScope) || saving) return;
    if (!folderTitle.trim()) { setComposerError("Give this folder a clear name."); return; }
    setSaving(true);
    const { data, error } = await supabase.from("resources").insert({ node_kind: "folder", media_kind: null, title: folderTitle.trim(), description: folderDescription.trim(), parent_id: folderId, subgroup_id: destinationScope, visibility: currentFolder?.visibility || (canManageClub ? folderVisibility : "members"), status: "ready", is_pinned: false, created_by: user.id }).select(RESOURCE_FIELDS).single();
    setSaving(false);
    if (error || !data) { setComposerError(error?.message || "This folder could not be created."); return; }
    addRow(data as ResourceItem); refreshAll();
    setFolderTitle(""); setFolderDescription(""); setComposer(null); notify("Folder created");
  }

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !canWriteScope(destinationScope) || saving) return;
    if (!linkTitle.trim()) { setComposerError("Give this link a clear title."); return; }
    let normalized: string;
    try { normalized = normalizeUrl(linkUrl); } catch { setComposerError("Enter a complete web address, such as docs.google.com/document/…"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("resources").insert({ node_kind: "link", media_kind: null, title: linkTitle.trim(), description: linkDescription.trim(), parent_id: folderId, subgroup_id: destinationScope, visibility: currentFolder?.visibility || (canManageClub ? linkVisibility : "members"), external_url: normalized, status: "ready", is_pinned: false, created_by: user.id }).select(RESOURCE_FIELDS).single();
    setSaving(false);
    if (error || !data) { setComposerError(error?.message || "This link could not be saved."); return; }
    addRow(data as ResourceItem); refreshAll();
    setLinkTitle(""); setLinkUrl(""); setLinkDescription(""); setComposer(null); notify("Link added to Resources");
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    const folderInput = uploadMode === "folder-upload";
    if (!files.length) return;
    setUploadEntries(files.map((file) => ({ file, relativePath: folderInput ? ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name) : file.name, state: "queued" })));
    setUploadTotal(files.length); setUploadDone(0); setFailedUploadCount(0);
    event.target.value = "";
  }

  async function ensureFolderPath(path: string, importId: string, folderCache: Map<string, number>) {
    if (!supabase) throw new Error("Resource storage is unavailable");
    const segments = path.split("/").filter(Boolean);
    let parentId = folderId;
    let parentPath = "";
    for (const segment of segments) {
      parentPath = parentPath ? `${parentPath}/${segment}` : segment;
      const existing = folderCache.get(parentPath);
      if (existing) { parentId = existing; continue; }
      const { data, error } = await supabase.from("resources").insert({ node_kind: "folder", media_kind: null, title: segment.slice(0, 160), description: "", parent_id: parentId, subgroup_id: destinationScope, visibility: uploadDestinationVisibility, status: "ready", is_pinned: false, import_id: importId, created_by: user.id }).select(RESOURCE_FIELDS).single();
      if (error || !data) throw error || new Error(`Folder “${segment}” could not be created`);
      const created = data as ResourceItem;
      folderCache.set(parentPath, created.id); addRow(created); parentId = created.id;
    }
    return parentId;
  }

  async function uploadOne(entry: UploadEntry, index: number, importId: string, folderCache: Map<string, number>) {
    const client = supabase;
    if (!client) throw new Error("Resource storage is unavailable");
    const parts = entry.relativePath.split("/").filter(Boolean);
    const fileName = parts.pop() || entry.file.name;
    const parentPath = parts.join("/");
    const parentId = await ensureFolderPath(parentPath, importId, folderCache);
    const path = `${user.id}/${importId}/${parts.map(safeSegment).join("/")}${parts.length ? "/" : ""}${safeSegment(fileName)}`;
    const mediaKind = entry.file.type.startsWith("image/") ? "image" : entry.file.type.startsWith("text/") || entry.file.type === "application/pdf" || Boolean(entry.file.name.match(/\.(docx?|xlsx?|pptx?|csv)$/i)) ? "document" : "other";
    const pending = await client.from("resources").insert({ node_kind: "file", media_kind: mediaKind, title: fileName.slice(0, 160), description: "", parent_id: parentId, subgroup_id: destinationScope, visibility: uploadDestinationVisibility, storage_bucket: "club-resources", storage_path: path, original_filename: fileName, mime_type: entry.file.type || "application/octet-stream", byte_size: entry.file.size, status: "pending_upload", is_pinned: false, import_id: importId, created_by: user.id }).select(RESOURCE_FIELDS).single();
    if (pending.error || !pending.data) throw pending.error || new Error("File record could not be created");
    const pendingItem = pending.data as ResourceItem;
    addRow(pendingItem);
    const uploaded = await client.storage.from("club-resources").upload(path, entry.file, { contentType: entry.file.type || "application/octet-stream", upsert: false });
    if (uploaded.error) {
      await client.from("resources").update({ status: "failed" }).eq("id", pendingItem.id);
      replaceRow(pendingItem.id, (item) => ({ ...item, status: "failed" }));
      throw uploaded.error;
    }
    const ready = await client.from("resources").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", pendingItem.id).select(RESOURCE_FIELDS).single();
    if (ready.error || !ready.data) {
      await client.from("resources").update({ status: "failed" }).eq("id", pendingItem.id);
      replaceRow(pendingItem.id, (item) => ({ ...item, status: "failed" }));
      throw ready.error || new Error("File record could not be finalized");
    }
    replaceRow(pendingItem.id, () => ready.data as ResourceItem);
    return index;
  }

  async function startUploads(entriesToUpload = uploadEntries) {
    if (!entriesToUpload.length || uploading || !canWriteScope(destinationScope)) return;
    const destinationFolderDepth = crumbs.length;
    const deepestSelection = entriesToUpload.reduce((deepest, entry) => {
      const segments = entry.relativePath.split("/").filter(Boolean);
      segments.pop();
      return Math.max(deepest, segments.length);
    }, 0);
    if (destinationFolderDepth + deepestSelection > 3) {
      setComposerError(`This selection would create more than three folder levels (destination is already ${destinationFolderDepth} level${destinationFolderDepth === 1 ? "" : "s"} deep). Choose a shallower folder or a less nested selection.`);
      return;
    }
    setUploading(true); setComposerError("");
    const client = supabase;
    if (!client) { setUploading(false); setComposerError("Resource storage is not configured in this environment."); return; }
    const importRecord = await client.from("resource_imports").insert({ name: entriesToUpload.length === 1 ? entriesToUpload[0].file.name : `${entriesToUpload.length} uploaded resources`, root_parent_id: folderId, subgroup_id: destinationScope, visibility: uploadDestinationVisibility, status: "uploading", total_files: entriesToUpload.length, completed_files: 0, failed_files: 0, total_bytes: entriesToUpload.reduce((total, entry) => total + entry.file.size, 0), uploaded_bytes: 0, created_by: user.id }).select("id").single();
    if (importRecord.error || !importRecord.data) { setUploading(false); setComposerError(importRecord.error?.message || "The upload batch could not be started."); return; }
    const importId = String(importRecord.data.id);
    const folderCache = new Map<string, number>();
    try {
      // Resolve the complete tree before workers start so concurrent files
      // never race to create the same relative folder.
      for (const entry of entriesToUpload) {
        const parts = entry.relativePath.split("/").filter(Boolean);
        parts.pop();
        await ensureFolderPath(parts.join("/"), importId, folderCache);
      }
    } catch (error) {
      await client.from("resource_imports").update({ status: "failed", failed_files: entriesToUpload.length }).eq("id", importId);
      setUploading(false);
      setComposerError(error instanceof Error ? error.message : "The folder structure could not be created.");
      return;
    }
    let next = 0; let processed = 0; let completed = 0; let failed = 0; let uploadedBytes = 0;
    const entries = [...entriesToUpload];
    const worker = async () => {
      while (next < entries.length) {
        const index = next++;
        setUploadEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, state: "uploading" } : entry));
        try { await uploadOne(entries[index], index, importId, folderCache); completed += 1; uploadedBytes += entries[index].file.size; setUploadEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, state: "ready" } : entry)); }
        catch (error) { failed += 1; const message = error instanceof Error ? error.message : "Upload failed"; setUploadEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, state: "failed", error: message } : entry)); }
        processed += 1; setUploadDone(processed); setFailedUploadCount(failed);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));
    await client.from("resource_imports").update({ completed_files: completed, failed_files: failed, uploaded_bytes: uploadedBytes, status: failed ? (completed > 0 ? "partial" : "failed") : "completed" }).eq("id", importId);
    setUploading(false);
    refreshAll();
    if (failed) { setComposerError(`${failed} file${failed === 1 ? "" : "s"} failed. You can retry the failed rows after checking their error details.`); notify(`${completed} file${completed === 1 ? "" : "s"} uploaded; ${failed} failed`); }
    else { notify(`${completed} file${completed === 1 ? "" : "s"} uploaded`); setComposer(null); setUploadEntries([]); }
  }

  async function retryFailedUploads() {
    const failedEntries = uploadEntries.filter((entry) => entry.state === "failed");
    if (!failedEntries.length) return;
    const retryEntries = failedEntries.map((entry) => ({ ...entry, state: "queued" as const, error: undefined }));
    setUploadEntries(retryEntries);
    setUploadTotal(failedEntries.length); setUploadDone(0); setFailedUploadCount(0);
    await startUploads(retryEntries);
  }

  function openItem(item: ResourceItem) {
    if (item.node_kind === "folder" && item.status !== "archived") { changeFolder(item.id); setSelected(null); return; }
    setSelected(item);
  }

  async function openFile(item: ResourceItem) {
    if (item.node_kind === "link" && item.external_url) { window.open(item.external_url, "_blank", "noopener,noreferrer"); return; }
    if (!supabase || !item.storage_path) return;
    // Open the tab during the click, before waiting for the link, so browsers
    // that block pop-ups opened after a delay still allow it.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    const signed = (await supabase.storage.from(item.storage_bucket || "club-resources").createSignedUrl(item.storage_path, 300)).data?.signedUrl;
    if (!signed) { tab?.close(); notify("This resource could not be opened"); return; }
    if (tab) tab.location.replace(signed); else window.location.assign(signed);
  }

  const canManageItem = (item: ResourceItem) => canManageClub || (item.visibility === "members" && canManageSubgroup(item.subgroup_id));
  const hasArchived = hasArchivedItems;
  const selectedCurrent = selected ? itemById.get(selected.id) || selected : null;

  // After an action on the selected item: read it again, then the lists.
  async function afterChange() {
    const id = selected?.id;
    refreshAll();
    if (id === undefined) return;
    const fresh = await fetchOneFolder(id);
    if (fresh) { setSelected(fresh); replaceRow(id, () => fresh); }
  }

  const scopeLabel = scope === "all" ? "All spaces" : scope === "club" ? "Club-wide" : groupById.get(scope) || "Group";

  return <section className={styles.library} aria-label="Resources">
    <div className={styles.headingRow}>
      <div><p className={styles.kicker}>Club library</p><h1>Resources</h1><p className={styles.intro}>A shared shelf for rehearsal notes, repertoire, event material, and useful links.</p></div>
      <button className={styles.addButton} type="button" onClick={() => openComposer("menu")} disabled={!supabase || !canAdd} title={!canAdd ? "You need an executive or subgroup manager role to add here" : undefined}><Icon name="plus" size={16} /> Add resource</button>
    </div>

    <div className={styles.toolbar}>
      <label className={styles.search}><Icon name="search" size={17} /><span className={styles.srOnly}>Search resources</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, filename, or description" /></label>
      <label className={styles.selectWrap}><span className={styles.srOnly}>Scope</span><select value={String(scope)} onChange={(event) => { const value = event.target.value; setScope(value === "all" ? "all" : value === "club" ? "club" : Number(value)); changeFolder(null); }}><option value="all">All spaces</option><option value="club">Club-wide</option>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><Icon name="chevron" size={15} /></label>
      <label className={styles.selectWrap}><span className={styles.srOnly}>Sort resources</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="updated">Recently updated</option><option value="created">Recently added</option><option value="name">Name</option><option value="event">Event date</option></select><Icon name="chevron" size={15} /></label>
      <div className={styles.viewToggle} aria-label="Display mode"><button type="button" className={display === "list" ? styles.activeToggle : ""} onClick={() => setDisplay("list")} aria-label="List view"><Icon name="list" size={17} /></button><button type="button" className={display === "grid" ? styles.activeToggle : ""} onClick={() => setDisplay("grid")} aria-label="Grid view"><Icon name="grid" size={17} /></button></div>
      {(hasArchived || showArchived) && <button type="button" className={styles.secondaryButton} aria-pressed={showArchived} onClick={() => { setShowArchived((value) => !value); changeFolder(null); }}>{showArchived ? "Back to library" : "Show archived"}</button>}
    </div>

    <nav className={styles.tabs} aria-label="Resource views">{(["all", "documents", "links", "photos"] as LibraryTab[]).map((value) => <button key={value} className={tab === value ? styles.activeTab : ""} onClick={() => setTab(value)} type="button">{value[0].toUpperCase() + value.slice(1)}{tab === value && total !== null && !loading ? <> <span>{total}</span></> : null}</button>)}</nav>

    <div className={styles.breadcrumbRow}><button type="button" onClick={() => changeFolder(null)} className={folderId === null ? styles.currentCrumb : ""}>Resources</button>{breadcrumb.map((crumb) => <span key={crumb.id} className={styles.crumb}><Icon name="chevron" size={13} /><button type="button" onClick={() => changeFolder(crumb.id)} className={crumb.id === folderId ? styles.currentCrumb : ""}>{crumb.title}</button></span>)}{currentFolder && !showArchived && canManageItem(currentFolder) ? <button type="button" onClick={() => setSelected(currentFolder)}>Folder settings</button> : null}<span className={styles.scopeHint}>{showArchived ? "Archived · " : ""}{scopeLabel}{currentFolder?.visibility === "executives" ? <><span className={styles.dot}>·</span><Icon name="lock" size={13} /></> : null}</span></div>

    {!loading && loadError && visibleItems.length > 0 && <LoadErrorBanner message={`${loadError} What is shown may be out of date.`} onRetry={() => refreshAll()} />}
    {loading ? <div className={styles.state}><span className={styles.loader} /><h2>Opening the library</h2><p>Gathering the latest club resources…</p></div> : loadError && visibleItems.length === 0 ? <div className={styles.state}><div className={styles.stateIcon}><Icon name="refresh" size={22} /></div><h2>Something interrupted the shelf</h2><p>{loadError}</p><button type="button" className={styles.secondaryButton} onClick={() => refreshAll()}>Try again</button></div> : visibleItems.length === 0 ? <div className={styles.state}><div className={styles.stateIcon}><Icon name={search ? "search" : "folder"} size={23} /></div><h2>{showArchived ? "Nothing is archived here" : search ? "No matching resources" : folderId ? "This folder is ready for something" : "Your resource shelf is empty"}</h2><p>{search ? "Try a shorter search or clear the search field." : canAdd ? "Create a folder, add a useful link, or upload a set of files to get started." : "Resources shared with your membership will appear here."}</p>{search ? <button type="button" className={styles.secondaryButton} onClick={() => { setQuery(""); setSearch(""); }}>Clear search</button> : canAdd ? <button type="button" className={styles.secondaryButton} onClick={() => openComposer("menu")}><Icon name="plus" size={15} /> Add the first resource</button> : null}</div> : <div className={display === "grid" || tab === "photos" ? styles.resourceGrid : styles.resourceList}>{visibleItems.map((item) => <button key={item.id} type="button" className={styles.resourceRow} onClick={() => openItem(item)}>
      {/* Signed Supabase URLs are short-lived and dynamic, so a native img is intentional here instead of next/image. */}{item.node_kind === "file" && isImage(item) && item.signedUrl ? <img src={item.signedUrl} alt="" className={styles.thumbnail} loading="lazy" decoding="async" /> : <div className={`${styles.typeIcon} ${item.node_kind === "folder" ? styles.folderIcon : ""}`}><Icon name={itemIcon(item)} size={20} /></div>}
      <div className={styles.resourceCopy}><div className={styles.resourceTitle}>{item.title}{item.is_pinned ? <span className={styles.pinned}>Pinned</span> : null}{item.status === "failed" ? <span className={styles.failedBadge}>Upload failed</span> : null}</div><p>{item.description || (item.node_kind === "folder" ? "Folder" : item.node_kind === "link" ? item.external_url : item.original_filename) || "No description"}</p></div>
      <div className={styles.resourceMeta}><span>{item.node_kind === "folder" ? "Folder" : item.node_kind === "link" ? "Link" : formatBytes(item.byte_size)}</span><span>{formatDate(item.updated_at)}</span></div><Icon name="arrow" size={17} /></button>)}</div>}
    {!loading && !loadError && hasMore ? <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}><button type="button" className={styles.secondaryButton} onClick={() => void loadPage(true)} disabled={loadingMore}>{loadingMore ? "Loading…" : "Show more"}</button></div> : null}

    {composer ? <div className={styles.scrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}><aside className={styles.composer} ref={composerRef} role="dialog" aria-modal="true" aria-labelledby="resource-composer-title"><div className={styles.panelHeader}><div><p className={styles.kicker}>Protected workspace</p><h2 id="resource-composer-title">Add resource</h2></div><button type="button" className={styles.iconButton} onClick={closeComposer} aria-label="Close add resource"><Icon name="close" size={18} /></button></div><p className={styles.panelContext}>Adding to <strong>{currentFolder?.title || (destinationScope === null ? "Club-wide" : groupById.get(destinationScope) || "group")}</strong>{currentFolder ? ` · ${currentVisibility} access` : ""}</p>
      {composer === "menu" ? <div className={styles.composerMenu}><button type="button" onClick={() => openComposer("folder")}><span className={styles.menuIcon}><Icon name="folder" size={20} /></span><span><strong>Create folder</strong><small>Keep related materials together</small></span><Icon name="arrow" size={16} /></button><button type="button" onClick={() => openComposer("link")}><span className={styles.menuIcon}><Icon name="link" size={20} /></span><span><strong>Add link</strong><small>Save a useful web address</small></span><Icon name="arrow" size={16} /></button><button type="button" onClick={() => openComposer("files")}><span className={styles.menuIcon}><Icon name="upload" size={20} /></span><span><strong>Upload files</strong><small>Add individual documents or images</small></span><Icon name="arrow" size={16} /></button><button type="button" onClick={() => openComposer("folder-upload")}><span className={styles.menuIcon}><Icon name="folder" size={20} /></span><span><strong>Upload folder</strong><small>Preserve an existing folder structure</small></span><Icon name="arrow" size={16} /></button></div> : composer === "folder" ? <form className={styles.form} onSubmit={createFolder}><label>Folder name<input value={folderTitle} onChange={(event) => setFolderTitle(event.target.value)} maxLength={160} placeholder="e.g. Fall concert planning" /></label><label>Description <span className={styles.optional}>Optional</span><textarea value={folderDescription} onChange={(event) => setFolderDescription(event.target.value)} maxLength={1000} rows={3} placeholder="What belongs here?" /></label><label>Visibility<select value={folderVisibility} disabled={Boolean(currentFolder)} onChange={(event) => setFolderVisibility(event.target.value as "members" | "executives")}><option value="members">Members</option>{canManageClub ? <option value="executives">Executives only</option> : null}</select></label><FormActions saving={saving} onCancel={closeComposer} /></form> : composer === "link" ? <form className={styles.form} onSubmit={createLink}><label>Link title<input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} maxLength={160} placeholder="e.g. Repertoire spreadsheet" /></label><label>Web address<input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} inputMode="url" placeholder="https://…" /></label><label>Description <span className={styles.optional}>Optional</span><textarea value={linkDescription} onChange={(event) => setLinkDescription(event.target.value)} maxLength={1000} rows={3} placeholder="A sentence of context helps later." /></label><label>Visibility<select value={linkVisibility} disabled={Boolean(currentFolder)} onChange={(event) => setLinkVisibility(event.target.value as "members" | "executives")}><option value="members">Members</option>{canManageClub ? <option value="executives">Executives only</option> : null}</select></label><FormActions saving={saving} onCancel={closeComposer} /></form> : <div className={styles.uploadPanel}>{!currentFolder ? <label className={styles.uploadVisibility}>Visibility<select value={uploadVisibility} disabled={!canManageClub} onChange={(event) => setUploadVisibility(event.target.value as "members" | "executives")}><option value="members">Members</option>{canManageClub ? <option value="executives">Executives only</option> : null}</select></label> : null}<input ref={fileInputRef} type="file" multiple={composer === "files"} className={styles.hiddenInput} {...(composer === "folder-upload" ? { webkitdirectory: "" } : {})} onChange={handleFileSelection} /><button type="button" className={styles.dropzone} onClick={() => fileInputRef.current?.click()} disabled={uploading}><Icon name={composer === "folder-upload" ? "folder" : "upload"} size={22} /><strong>{uploadEntries.length ? "Choose a different set" : composer === "folder-upload" ? "Choose a folder" : "Choose files"}</strong><span>{composer === "folder-upload" ? "The folder structure will be kept" : "Up to three files upload at once"}</span></button>{uploadEntries.length ? <><div className={styles.progressRow}><span>{uploadDone} of {uploadTotal} complete</span><span>{failedUploadCount ? `${failedUploadCount} failed` : uploading ? "Uploading…" : "Ready to upload"}</span></div><div className={styles.progressTrack}><span style={{ width: "100%", transform: `scaleX(${uploadTotal ? uploadDone / uploadTotal : 0})` }} /></div><ul className={styles.uploadList}>{uploadEntries.map((entry, index) => <li key={`${entry.relativePath}-${index}`}><span className={entry.state === "failed" ? styles.uploadFailed : entry.state === "ready" ? styles.uploadReady : ""}><Icon name={entry.state === "failed" ? "close" : entry.state === "ready" ? "arrow" : "file"} size={15} /></span><span title={entry.relativePath}>{entry.relativePath}</span><small>{entry.error || entry.state}</small></li>)}</ul><div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={closeComposer} disabled={uploading}>Cancel</button>{failedUploadCount > 0 && !uploading ? <button type="button" className={styles.secondaryButton} onClick={() => void retryFailedUploads()}>Reset failed</button> : null}<button type="button" className={styles.primaryButton} onClick={() => void startUploads()} disabled={uploading || !uploadEntries.some((entry) => entry.state === "queued")}>{uploading ? "Uploading…" : "Start upload"}</button></div></> : null}</div>}
      {composerError ? <p className={styles.formError} role="alert">{composerError}</p> : null}</aside></div> : null}

    {selectedCurrent ? <div className={styles.scrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className={styles.detailPanel} role="dialog" aria-modal="true" aria-labelledby="resource-detail-title"><div className={styles.panelHeader}><div><p className={styles.kicker}>{selectedCurrent.node_kind === "folder" ? "Collection" : selectedCurrent.node_kind === "link" ? "Saved link" : "Resource detail"}</p><h2 id="resource-detail-title">{selectedCurrent.title}</h2></div><button type="button" className={styles.iconButton} onClick={() => setSelected(null)} aria-label="Close resource details"><Icon name="close" size={18} /></button></div>{selectedCurrent.node_kind === "file" && isImage(selectedCurrent) && selectedCurrent.signedUrl ? <img className={styles.detailImage} src={selectedCurrent.signedUrl} alt={selectedCurrent.title} /> : <div className={styles.detailIcon}><Icon name={itemIcon(selectedCurrent)} size={32} /></div>}<dl className={styles.detailList}><div><dt>Location</dt><dd>{selectedLocation.map((crumb) => crumb.title).join(" / ") || "Resources"}</dd></div><div><dt>Scope</dt><dd>{selectedCurrent.subgroup_id === null ? "Club-wide" : groupById.get(selectedCurrent.subgroup_id) || "Group"}{selectedCurrent.visibility === "executives" ? <span className={styles.privateLabel}><Icon name="lock" size={13} /> Executives only</span> : null}</dd></div><div><dt>Updated</dt><dd>{formatDate(selectedCurrent.updated_at)}</dd></div><div><dt>Format</dt><dd>{selectedCurrent.mime_type || (selectedCurrent.node_kind === "link" ? "Web link" : selectedCurrent.node_kind)}</dd></div>{selectedCurrent.byte_size ? <div><dt>Size</dt><dd>{formatBytes(selectedCurrent.byte_size)}</dd></div> : null}{selectedCurrent.event_id ? <div><dt>Event</dt><dd>{events.find((event) => event.id === selectedCurrent.event_id)?.title || "Related club event"}</dd></div> : null}</dl>{selectedCurrent.description ? <p className={styles.detailDescription}>{selectedCurrent.description}</p> : null}{selectedCurrent.node_kind === "folder" ? null : <button type="button" className={styles.primaryButton} onClick={() => void openFile(selectedCurrent)} disabled={selectedCurrent.status !== "ready" && !(selectedCurrent.status === "archived" && canManageItem(selectedCurrent))}>{selectedCurrent.node_kind === "link" ? <><Icon name="external" size={16} /> Open link</> : <><Icon name="arrow" size={16} /> Open file</>}</button>}{selectedCurrent.status === "failed" ? <p className={styles.formError}>This upload failed. Discard it below and upload the file again.</p> : null}{<ResourceActions key={selectedCurrent.id} item={selectedCurrent} canManage={canManageItem(selectedCurrent)} isExecutive={canManageClub} childCount={selectedCurrent.node_kind !== "folder" ? 0 : childCountState?.id === selectedCurrent.id ? childCountState.count : 1} notify={notify} onChanged={afterChange} onRemoved={() => { const removedId = selectedCurrent.id; setSelected(null); if (folderId === removedId) changeFolder(selectedCurrent.parent_id); refreshAll(); }} />}</aside></div> : null}
  </section>;
}

function FormActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={saving}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Saving…" : "Save resource"}</button></div>;
}
