import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FOLDER_DEPTH,
  RESOURCE_PAGE_SIZE,
  applyListPlan,
  buildListPlan,
  chainFromKnown,
  crumbCacheKey,
  folderUrl,
  formatLocation,
  isFlatListing,
  listCacheKey,
  mergePage,
  normalizeSearch,
  orderForDisplay,
  parseFolderParam,
  resolveFolderChain,
  resolveSubtreeFolderIds,
  searchFilter,
  sortOrders,
  thumbnailCacheKey,
  thumbnailExpiry,
  thumbnailsToSign,
} from "../lib/resources-query.ts";

const base = { folderId: null, scope: "all", tab: "all", search: "", sort: "updated", archived: false, offset: 0, limit: RESOURCE_PAGE_SIZE };
const plan = (overrides = {}) => buildListPlan({ ...base, ...overrides });
const has = (p, filter) => p.filters.some((candidate) => JSON.stringify(candidate) === JSON.stringify(filter));

test("a folder is listed one level at a time, 100 rows to a page, pinned and newest first", () => {
  const root = plan();
  assert.ok(has(root, { op: "is", column: "parent_id", value: null }));
  assert.ok(has(root, { op: "neq", column: "status", value: "archived" }));
  assert.deepEqual(root.orders, [
    { column: "is_pinned", ascending: false },
    { column: "updated_at", ascending: false },
    { column: "id", ascending: false },
  ]);
  assert.deepEqual([root.from, root.to], [0, 99]);

  const folder = plan({ folderId: 42, offset: 200 });
  assert.ok(has(folder, { op: "eq", column: "parent_id", value: 42 }));
  assert.ok(!folder.filters.some((filter) => filter.op === "is" && filter.column === "parent_id"));
  assert.deepEqual([folder.from, folder.to], [200, 299]);
});

test("scope, kind and archived filters are sent to the database", () => {
  assert.ok(has(plan({ scope: "club" }), { op: "is", column: "subgroup_id", value: null }));
  assert.ok(has(plan({ scope: 7 }), { op: "eq", column: "subgroup_id", value: 7 }));
  assert.ok(!plan({ scope: "all" }).filters.some((filter) => filter.column === "subgroup_id"));

  const photos = plan({ tab: "photos" });
  assert.ok(has(photos, { op: "eq", column: "node_kind", value: "file" }));
  assert.ok(has(photos, { op: "eq", column: "media_kind", value: "image" }));
  const documents = plan({ tab: "documents" });
  assert.ok(has(documents, { op: "eq", column: "node_kind", value: "file" }));
  assert.ok(has(documents, { op: "neq", column: "media_kind", value: "image" }));
  assert.ok(has(plan({ tab: "links" }), { op: "eq", column: "node_kind", value: "link" }));

  const archived = plan({ archived: true, folderId: 9 });
  assert.ok(has(archived, { op: "eq", column: "status", value: "archived" }));
  assert.ok(!archived.filters.some((filter) => filter.column === "parent_id"), "the archived view is a flat list");
});

test("a search or kind tab covers the open folder and everything in it, not only its direct children", () => {
  assert.equal(isFlatListing({ tab: "all", search: "", archived: false }), false);
  assert.equal(isFlatListing({ tab: "all", search: "  ", archived: false }), false);
  assert.equal(isFlatListing({ tab: "all", search: "raga", archived: false }), true);
  assert.equal(isFlatListing({ tab: "links", search: "", archived: false }), true);

  const atTop = plan({ search: "raga" });
  assert.ok(!atTop.filters.some((filter) => filter.column === "parent_id"), "at the top a search looks everywhere");

  const inFolder = plan({ search: "raga", folderId: 5, subtreeIds: [5, 6, 9] });
  assert.ok(has(inFolder, { op: "in", column: "parent_id", value: [5, 6, 9] }));
  const withoutIds = plan({ tab: "photos", folderId: 5 });
  assert.ok(has(withoutIds, { op: "in", column: "parent_id", value: [5] }), "falls back to the folder itself");
});

test("search text becomes an ilike filter that cannot break out of the filter syntax", () => {
  assert.equal(normalizeSearch("  Fall   concert "), "Fall concert");
  assert.equal(normalizeSearch('a,b(c)"d%e*f\\g'), "a b c d e f g");
  assert.equal(normalizeSearch("raga_notes.pdf"), "raga_notes.pdf");
  assert.equal(normalizeSearch("x".repeat(300)).length, 100);
  assert.equal(searchFilter("   "), null);
  assert.equal(searchFilter("tala"), "title.ilike.%tala%,description.ilike.%tala%,original_filename.ilike.%tala%");
  assert.ok(has(plan({ search: "tala" }), { op: "or", value: searchFilter("tala") }));
});

test("every sort is ordered by pin first and ends on id, so pages never overlap", () => {
  for (const sort of ["updated", "created", "name", "event"]) {
    const orders = sortOrders(sort);
    assert.deepEqual(orders[0], { column: "is_pinned", ascending: false });
    assert.equal(orders.at(-1).column, "id");
  }
  assert.deepEqual(sortOrders("event")[1], { column: "occurred_on", ascending: true, nullsFirst: false });
  assert.deepEqual(sortOrders("name")[1], { column: "title", ascending: true });
});

test("a plan is applied to the query builder in order and ends with the page range", () => {
  const calls = [];
  const builder = new Proxy({}, {
    get: (_target, method) => (...args) => { calls.push([method, ...args]); return builder; },
  });
  applyListPlan(builder, plan({ folderId: 3, scope: 2, tab: "documents", search: "notes", sort: "event", offset: 100 }));
  assert.deepEqual(calls[0], ["neq", "status", "archived"]);
  assert.deepEqual(calls[1], ["eq", "subgroup_id", 2]);
  assert.deepEqual(calls[2], ["in", "parent_id", [3]], "a kind tab inside a folder covers the folder and what is under it");
  assert.ok(calls.some((call) => call[0] === "or" && call[1].includes("title.ilike.%notes%")));
  const orderCalls = calls.filter((call) => call[0] === "order");
  assert.deepEqual(orderCalls.map((call) => call[1]), ["is_pinned", "occurred_on", "updated_at", "id"]);
  assert.deepEqual(orderCalls[0][2], { ascending: false });
  assert.deepEqual(orderCalls[1][2], { ascending: true, nullsFirst: false });
  assert.deepEqual(calls.at(-1), ["range", 100, 199]);

  const browse = [];
  const recorder = new Proxy({}, { get: (_target, method) => (...args) => { browse.push([method, ...args]); return recorder; } });
  applyListPlan(recorder, plan({ folderId: 3 }));
  assert.deepEqual(browse[1], ["eq", "parent_id", 3]);
});

test("the cache key names the folder and every filter, and ignores noise in the search text", () => {
  const key = (overrides = {}) => listCacheKey({ ...base, ...overrides });
  assert.equal(key(), key());
  assert.notEqual(key(), key({ folderId: 4 }));
  assert.notEqual(key({ folderId: 4 }), key({ folderId: 5 }));
  assert.notEqual(key(), key({ scope: "club" }));
  assert.notEqual(key({ scope: 1 }), key({ scope: 2 }));
  assert.notEqual(key(), key({ tab: "links" }));
  assert.notEqual(key(), key({ sort: "name" }));
  assert.notEqual(key(), key({ archived: true }));
  assert.notEqual(key(), key({ search: "raga" }));
  assert.equal(key({ search: " raga  " }), key({ search: "raga" }));
  assert.equal(key({ search: "a,b" }), key({ search: "a b" }));
  assert.equal(crumbCacheKey(12), "resources:crumbs:12");
});

const folder = (id, parent_id, title = `Folder ${id}`) => ({ id, parent_id, title, node_kind: "folder" });

test("the breadcrumb is the chain of parent_id from the open folder to the top", () => {
  const known = new Map([folder(1, null, "Concerts"), folder(2, 1, "Fall"), folder(3, 2, "Rehearsal")].map((row) => [row.id, row]));
  assert.deepEqual(chainFromKnown(3, known).map((row) => row.title), ["Concerts", "Fall", "Rehearsal"]);
  assert.deepEqual(chainFromKnown(1, known).map((row) => row.id), [1]);
  assert.equal(chainFromKnown(9, known), null, "an unknown folder");
  known.delete(2);
  assert.equal(chainFromKnown(3, known), null, "a missing ancestor means the caller must fetch");
  assert.equal(formatLocation([{ title: "Concerts" }, { title: "Fall" }]), "Concerts / Fall");
  assert.equal(formatLocation([]), "Resources");
});

test("opening a folder from a link fetches only the ancestors it does not have, one request each", async () => {
  const database = new Map([folder(1, null), folder(2, 1), folder(3, 2)].map((row) => [row.id, row]));
  const fetched = [];
  const fetchOne = async (id) => { fetched.push(id); return database.get(id) ?? null; };

  const chain = await resolveFolderChain(3, new Map(), fetchOne);
  assert.deepEqual(chain.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(fetched, [3, 2, 1]);
  assert.ok(fetched.length <= MAX_FOLDER_DEPTH);

  fetched.length = 0;
  const partlyKnown = await resolveFolderChain(3, new Map([[2, database.get(2)], [1, database.get(1)]]), fetchOne);
  assert.deepEqual(partlyKnown.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(fetched, [3], "only the open folder itself was missing");
});

test("a folder that cannot be read, or a loop in parent_id, never hangs or loops the breadcrumb", async () => {
  const none = await resolveFolderChain(7, new Map(), async () => null);
  assert.deepEqual(none, []);

  const hiddenParent = new Map([folder(5, 4)].map((row) => [row.id, row]));
  const partial = await resolveFolderChain(5, hiddenParent, async () => null);
  assert.deepEqual(partial.map((row) => row.id), [5], "an unreadable ancestor ends the chain; the folder is still last");

  const loop = new Map([folder(1, 2), folder(2, 1)].map((row) => [row.id, row]));
  let requests = 0;
  const looped = await resolveFolderChain(1, loop, async () => { requests += 1; return null; });
  assert.equal(looped.length, 2);
  assert.equal(requests, 0);
  assert.equal(chainFromKnown(1, loop), null);

  const deep = new Map([folder(1, null), folder(2, 1), folder(3, 2), folder(4, 3)].map((row) => [row.id, row]));
  assert.equal((await resolveFolderChain(4, deep, async () => null)).length, MAX_FOLDER_DEPTH);
  assert.equal(chainFromKnown(4, deep), null);
});

test("searching inside a folder reads the folder ids level by level and stops at the depth limit", async () => {
  const children = { 1: [2, 3], 2: [4], 3: [], 4: [5] };
  const requests = [];
  const ids = await resolveSubtreeFolderIds(1, async (parents) => {
    requests.push(parents);
    return parents.flatMap((id) => children[id] || []);
  });
  assert.deepEqual(ids, [1, 2, 3, 4]);
  assert.deepEqual(requests, [[1], [2, 3]], "two levels below the folder are enough for a three-level tree");

  const empty = await resolveSubtreeFolderIds(8, async () => []);
  assert.deepEqual(empty, [8]);
});

test("the open folder lives in the address bar as ?page=documents&folder=<id>", () => {
  assert.equal(parseFolderParam("?page=documents&folder=12"), 12);
  assert.equal(parseFolderParam("?page=documents"), null);
  assert.equal(parseFolderParam("?folder=0"), null);
  assert.equal(parseFolderParam("?folder=-3"), null);
  assert.equal(parseFolderParam("?folder=4abc"), null);
  assert.equal(parseFolderParam("?folder=1.5"), null);
  assert.equal(parseFolderParam("?folder=99999999999999999999"), null);

  assert.equal(folderUrl("/", "?page=documents", 12), "/?page=documents&folder=12");
  assert.equal(folderUrl("/", "?page=documents&folder=12", 20), "/?page=documents&folder=20");
  assert.equal(folderUrl("/", "?page=documents&folder=12", null), "/?page=documents");
  assert.equal(folderUrl("/", "?page=gallery", 3), "/?page=documents&folder=3");
  assert.equal(folderUrl("/", "?page=documents&x=1", 3), "/?page=documents&x=1&folder=3");
});

test("'Show more' appends the next page without repeating a row, and folders list before files", () => {
  assert.deepEqual(mergePage([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map((row) => row.id), [1, 2, 3]);

  const rows = [
    { id: 1, node_kind: "file", is_pinned: false },
    { id: 2, node_kind: "folder", is_pinned: false },
    { id: 3, node_kind: "file", is_pinned: true },
    { id: 4, node_kind: "link", is_pinned: false },
    { id: 5, node_kind: "folder", is_pinned: false },
  ];
  assert.deepEqual(orderForDisplay(rows).map((row) => row.id), [3, 2, 5, 1, 4]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5], "the input is not changed");
});

test("thumbnails are signed once per bucket, only for ready images that have no fresh link", () => {
  const image = (path, extra = {}) => ({ node_kind: "file", status: "ready", storage_bucket: "club-resources", storage_path: path, media_kind: "image", mime_type: "image/png", ...extra });
  const items = [
    image("a.png"),
    image("b.png"),
    image("a.png"),
    image("c.jpg", { storage_bucket: "club-archive" }),
    image("d.png", { status: "pending_upload" }),
    image("e.pdf", { media_kind: "document", mime_type: "application/pdf" }),
    image("f.png", { storage_bucket: null }),
    { node_kind: "folder", status: "ready", storage_bucket: null, storage_path: null, media_kind: null, mime_type: null },
  ];
  const now = 1_000_000;
  const cache = new Map([[thumbnailCacheKey("club-resources", "b.png"), { url: "https://signed/b", expires: now + 1000 }]]);
  const toSign = thumbnailsToSign(items, (key) => cache.get(key), now);
  assert.deepEqual([...toSign.keys()].sort(), ["club-archive", "club-resources"]);
  assert.deepEqual(toSign.get("club-resources"), ["a.png", "f.png"], "b.png is cached, a.png is listed once, a missing bucket means club-resources");
  assert.deepEqual(toSign.get("club-archive"), ["c.jpg"]);

  cache.set(thumbnailCacheKey("club-resources", "b.png"), { url: "https://signed/b", expires: now - 1 });
  assert.deepEqual(thumbnailsToSign(items, (key) => cache.get(key), now).get("club-resources"), ["a.png", "b.png", "f.png"], "an expired link is signed again");
  assert.equal(thumbnailExpiry(now), now + 3300 * 1000, "a link signed for an hour is reused for 55 minutes");
});
