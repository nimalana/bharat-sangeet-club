// Pure helpers behind the Resources screen: what is asked of the database for
// one folder, how the breadcrumb is rebuilt from parent_id, and how the open
// folder is kept in the address bar.
//
// Nothing here imports React, Supabase or another local file, so the whole
// module runs under `node --test` (see tests/resources-query.test.mjs).

export const RESOURCE_PAGE_SIZE = 100;
// validate_resource_hierarchy refuses a fourth folder level, so a folder's
// ancestor chain and its subfolders are never more than this deep.
export const MAX_FOLDER_DEPTH = 3;
// Searching inside a folder lists the folder ids in the URL; stop well short of
// a request line too long for the API gateway.
export const MAX_SUBTREE_FOLDERS = 400;
export const SEARCH_MAX_LENGTH = 100;
export const THUMBNAIL_TTL_SECONDS = 3600;
// A signed link is treated as expired this long before it really is.
export const THUMBNAIL_REFRESH_MARGIN_SECONDS = 300;

export type ScopeFilter = "all" | "club" | number;
export type LibraryTab = "all" | "documents" | "links" | "photos";
export type SortKey = "updated" | "created" | "name" | "event";

export type ResourceListParams = {
  folderId: number | null;
  scope: ScopeFilter;
  tab: LibraryTab;
  // The text in the search box after the 250 ms debounce.
  search: string;
  sort: SortKey;
  archived: boolean;
  // The open folder and every folder under it. Only used when a search or a
  // kind tab is on (see isFlatListing); null means "look everywhere".
  subtreeIds?: number[] | null;
  offset: number;
  limit: number;
};

export type FilterOp =
  | { op: "eq"; column: string; value: string | number | boolean }
  | { op: "neq"; column: string; value: string | number | boolean }
  | { op: "is"; column: string; value: null }
  | { op: "in"; column: string; value: number[] }
  | { op: "or"; value: string };
export type OrderOp = { column: string; ascending: boolean; nullsFirst?: boolean };
export type ListPlan = { filters: FilterOp[]; orders: OrderOp[]; from: number; to: number };

// ---------------------------------------------------------------- search text

// The text goes into a PostgREST `or=(...)` filter, where `,` `(` `)` and `"`
// end or quote a value, and `%` `*` are wildcards. They are replaced by spaces.
// `_` is left alone: it is common in file names and only widens the match.
export function normalizeSearch(raw: string): string {
  return raw.replace(/[,()"\\%*]/g, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim();
}

export function searchFilter(raw: string): string | null {
  const term = normalizeSearch(raw);
  if (!term) return null;
  return ["title", "description", "original_filename"].map((column) => `${column}.ilike.%${term}%`).join(",");
}

// ------------------------------------------------------------ what to request

// Browsing shows one folder's direct children. A search, a kind tab or the
// archived view looks across the whole open folder (or everywhere, at the top).
export function isFlatListing(params: Pick<ResourceListParams, "tab" | "search" | "archived">): boolean {
  return params.archived || params.tab !== "all" || normalizeSearch(params.search) !== "";
}

export function sortOrders(sort: SortKey): OrderOp[] {
  const pinned: OrderOp = { column: "is_pinned", ascending: false };
  // `id` last, always: it makes the order total, so a page boundary never
  // repeats or skips a row. It matches resources_parent_order_idx.
  if (sort === "created") return [pinned, { column: "created_at", ascending: false }, { column: "id", ascending: false }];
  if (sort === "name") return [pinned, { column: "title", ascending: true }, { column: "id", ascending: true }];
  if (sort === "event") return [pinned, { column: "occurred_on", ascending: true, nullsFirst: false }, { column: "updated_at", ascending: false }, { column: "id", ascending: false }];
  return [pinned, { column: "updated_at", ascending: false }, { column: "id", ascending: false }];
}

export function buildListPlan(params: ResourceListParams): ListPlan {
  const filters: FilterOp[] = [];
  filters.push(params.archived ? { op: "eq", column: "status", value: "archived" } : { op: "neq", column: "status", value: "archived" });

  if (params.scope === "club") filters.push({ op: "is", column: "subgroup_id", value: null });
  else if (typeof params.scope === "number") filters.push({ op: "eq", column: "subgroup_id", value: params.scope });

  if (!params.archived) {
    if (isFlatListing(params)) {
      if (params.folderId !== null) {
        const ids = params.subtreeIds && params.subtreeIds.length ? params.subtreeIds : [params.folderId];
        filters.push({ op: "in", column: "parent_id", value: ids });
      }
    } else if (params.folderId === null) filters.push({ op: "is", column: "parent_id", value: null });
    else filters.push({ op: "eq", column: "parent_id", value: params.folderId });
  }

  // Kind is read from media_kind, which the upload sets from the file's type.
  if (params.tab === "documents") filters.push({ op: "eq", column: "node_kind", value: "file" }, { op: "neq", column: "media_kind", value: "image" });
  else if (params.tab === "photos") filters.push({ op: "eq", column: "node_kind", value: "file" }, { op: "eq", column: "media_kind", value: "image" });
  else if (params.tab === "links") filters.push({ op: "eq", column: "node_kind", value: "link" });

  const search = searchFilter(params.search);
  if (search) filters.push({ op: "or", value: search });

  return { filters, orders: sortOrders(params.sort), from: params.offset, to: params.offset + params.limit - 1 };
}

type PlanChain = {
  eq: (column: string, value: unknown) => PlanChain;
  neq: (column: string, value: unknown) => PlanChain;
  is: (column: string, value: null) => PlanChain;
  in: (column: string, values: unknown[]) => PlanChain;
  or: (filters: string) => PlanChain;
  order: (column: string, options: { ascending: boolean; nullsFirst?: boolean }) => PlanChain;
  range: (from: number, to: number) => PlanChain;
};

// Applies a plan to a PostgREST filter builder (the object that
// `supabase.from(...).select(...)` returns). Typed loosely on purpose: the
// builder's own generics cannot be satisfied by a plain description.
export function applyListPlan<Query>(query: Query, plan: ListPlan): Query {
  let current = query as unknown as PlanChain;
  for (const filter of plan.filters) {
    if (filter.op === "eq") current = current.eq(filter.column, filter.value);
    else if (filter.op === "neq") current = current.neq(filter.column, filter.value);
    else if (filter.op === "is") current = current.is(filter.column, filter.value);
    else if (filter.op === "in") current = current.in(filter.column, filter.value);
    else current = current.or(filter.value);
  }
  for (const order of plan.orders) {
    current = current.order(order.column, order.nullsFirst === undefined ? { ascending: order.ascending } : { ascending: order.ascending, nullsFirst: order.nullsFirst });
  }
  return current.range(plan.from, plan.to) as unknown as Query;
}

// One key per folder and filter combination, so a folder you left shows
// instantly when you come back. The page number is not part of it: only the
// first page is cached.
export function listCacheKey(params: Pick<ResourceListParams, "folderId" | "scope" | "tab" | "search" | "sort" | "archived">): string {
  return ["resources", params.archived ? "archived" : "live", params.folderId ?? "root", params.scope, params.tab, params.sort, normalizeSearch(params.search)].join(":");
}
export const crumbCacheKey = (folderId: number) => `resources:crumbs:${folderId}`;
export const subtreeCacheKey = (folderId: number) => `resources:subtree:${folderId}`;
export const thumbnailCacheKey = (bucket: string, path: string) => `thumb:${bucket}/${path}`;

export function mergePage<Row extends { id: number }>(current: Row[], next: Row[]): Row[] {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...next.filter((row) => !seen.has(row.id))];
}

// Pinned items first, then folders, each group keeping the order the database
// returned. Array.prototype.sort is stable.
export function orderForDisplay<Row extends { node_kind: string; is_pinned: boolean }>(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || Number(b.node_kind === "folder") - Number(a.node_kind === "folder"));
}

// ------------------------------------------------------------------- folders

type TreeNode = { id: number; parent_id: number | null };

// The folder and the folders above it, top first, using only rows already in
// hand. Null when any ancestor is missing, so the caller knows to fetch.
export function chainFromKnown<Row extends TreeNode>(folderId: number, known: ReadonlyMap<number, Row>): Row[] | null {
  const chain: Row[] = [];
  const seen = new Set<number>();
  let cursor: number | null = folderId;
  while (cursor !== null) {
    if (seen.has(cursor) || chain.length >= MAX_FOLDER_DEPTH) return null;
    seen.add(cursor);
    const node: Row | undefined = known.get(cursor);
    if (!node) return null;
    chain.unshift(node);
    cursor = node.parent_id;
  }
  return chain;
}

// The same chain, fetching only what is missing, one parent at a time: at most
// MAX_FOLDER_DEPTH small requests, however deep the folder is. If an ancestor
// cannot be read the chain starts below it; if the folder itself cannot be read
// the result does not end with `folderId` and the caller treats it as not found.
export async function resolveFolderChain<Row extends TreeNode>(
  folderId: number,
  known: ReadonlyMap<number, Row>,
  fetchOne: (id: number) => Promise<Row | null>,
): Promise<Row[]> {
  const chain: Row[] = [];
  const seen = new Set<number>();
  let cursor: number | null = folderId;
  while (cursor !== null && !seen.has(cursor) && chain.length < MAX_FOLDER_DEPTH) {
    seen.add(cursor);
    const node: Row | null = known.get(cursor) ?? (await fetchOne(cursor));
    if (!node) break;
    chain.unshift(node);
    cursor = node.parent_id;
  }
  return chain;
}

// A folder's id followed by the ids of every folder inside it, found one level
// at a time. A search inside the folder reads these, so it covers the whole
// subtree and not just the first level.
export async function resolveSubtreeFolderIds(
  rootId: number,
  fetchChildFolderIds: (parentIds: number[]) => Promise<number[]>,
): Promise<number[]> {
  const all = [rootId];
  const seen = new Set(all);
  let frontier = [rootId];
  for (let level = 1; level < MAX_FOLDER_DEPTH && frontier.length && all.length < MAX_SUBTREE_FOLDERS; level += 1) {
    const children = (await fetchChildFolderIds(frontier)).filter((id) => !seen.has(id));
    for (const id of children) seen.add(id);
    all.push(...children);
    frontier = children;
  }
  return all.slice(0, MAX_SUBTREE_FOLDERS);
}

export function formatLocation(chain: Array<{ title: string }>): string {
  return chain.map((folder) => folder.title).join(" / ") || "Resources";
}

// ------------------------------------------------------------------------ URL

// `?page=documents&folder=12`. Anything that is not a plain positive whole
// number is ignored, so a mistyped link opens the top of the library.
export function parseFolderParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("folder");
  if (!raw || !/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function folderUrl(pathname: string, search: string, folderId: number | null): string {
  const params = new URLSearchParams(search);
  params.set("page", "documents");
  if (folderId === null) params.delete("folder");
  else params.set("folder", String(folderId));
  return `${pathname}?${params.toString()}`;
}

// ----------------------------------------------------------------- thumbnails

type ThumbnailCandidate = { node_kind: string; status: string; storage_bucket: string | null; storage_path: string | null; media_kind: string | null; mime_type: string | null };
export type ThumbnailEntry = { url: string; expires: number };

export function isImageResource(item: Pick<ThumbnailCandidate, "media_kind" | "mime_type">): boolean {
  return item.media_kind === "image" || Boolean(item.mime_type?.startsWith("image/"));
}

// Image files that are ready and have no usable signed link yet, grouped by
// bucket so each bucket is signed with one request. `lookup` is the cache.
export function thumbnailsToSign(
  items: ThumbnailCandidate[],
  lookup: (key: string) => ThumbnailEntry | undefined,
  now: number,
): Map<string, string[]> {
  const byBucket = new Map<string, string[]>();
  const queued = new Set<string>();
  for (const item of items) {
    if (item.status !== "ready" || item.node_kind !== "file" || !item.storage_path || !isImageResource(item)) continue;
    const bucket = item.storage_bucket || "club-resources";
    const key = thumbnailCacheKey(bucket, item.storage_path);
    const hit = lookup(key);
    if ((hit && hit.expires > now) || queued.has(key)) continue;
    queued.add(key);
    byBucket.set(bucket, [...(byBucket.get(bucket) || []), item.storage_path]);
  }
  return byBucket;
}

export function thumbnailExpiry(now: number): number {
  return now + (THUMBNAIL_TTL_SECONDS - THUMBNAIL_REFRESH_MARGIN_SECONDS) * 1000;
}
