import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("unified resources use database-enforced hierarchy, storage, and permissions", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260907000000_unified_resources_library.sql", projectRoot), "utf8");

  assert.match(migration, /create table if not exists public\.resources/);
  assert.match(migration, /create table if not exists public\.resource_imports/);
  assert.match(migration, /create type public\.resource_node_kind/);
  assert.match(migration, /resources_node_shape/);
  assert.match(migration, /validate_resource_hierarchy/);
  assert.match(migration, /resource hierarchy cannot exceed three folder levels/);
  assert.match(migration, /alter table public\.resources enable row level security/);
  assert.match(migration, /revoke all on table public\.resources, public\.resource_imports/);
  assert.match(migration, /create policy "Members view permitted resources"/);
  assert.match(migration, /create policy "Managers create resources"/);
  assert.match(migration, /create policy "Managers upload resource files"\s+on storage\.objects/);
  assert.match(migration, /values \('club-resources', 'club-resources', false\)/);
});

test("resources UI is integrated as the single library while recordings stay in the archive", async () => {
  const [page, resources] = await Promise.all([
    readFile(new URL("app/portal.tsx", projectRoot), "utf8"),
    readFile(new URL("app/resources.tsx", projectRoot), "utf8"),
  ]);

  assert.match(page, /const ResourceLibrary = dynamic\(\(\) => import\("\.\/resources"\)/);
  assert.match(page, /section === "documents".*<ResourceLibrary/s);
  assert.match(page, /rawValue === "gallery" \? "documents"/);
  assert.doesNotMatch(page, /from\("resource_links"\)/);
  assert.match(page, /from\("archive_items"\)\.select\("\*"\)\.eq\("type", "recording"\)/);
  assert.match(page, /onOpenResources=\{\(groupId\) => \{ setResourceInitialScope\(groupId\); navigate\("documents"\); \}\}/);
  assert.match(page, /onClick=\{\(\) => onOpenResources\(active\.id\)\}>Open resources/);
  assert.doesNotMatch(page, /option value="document"/);
  assert.doesNotMatch(page, /option value="photo"/);
  assert.match(resources, /export function ResourceLibrary/);
  assert.match(resources, /from\("resources"\)/);
  assert.match(resources, /composer === "folder-upload"[\s\S]*webkitdirectory/);
  assert.match(resources, /webkitRelativePath/);
  assert.match(resources, /entry\.relativePath\.split\("\/"\)\.filter\(Boolean\)/);
  assert.match(resources, /for \(const segment of segments\)[\s\S]*parent_id: parentId/);
  assert.match(resources, /const parentId = await ensureFolderPath\(parentPath, importId, folderCache\)/);
  assert.match(resources, /storage_path: path/);
  const importRowIndex = resources.indexOf('from("resource_imports").insert');
  const fileRowIndex = resources.indexOf('await uploadOne(entries[index]');
  assert.ok(importRowIndex >= 0, "folder upload should create a resource_imports row");
  assert.ok(fileRowIndex > importRowIndex, "folder upload should create its import before resource rows");
  assert.match(resources, /Array\.from\(\{ length: Math\.min\(3, entries\.length\) \}/);
});

test("the library loads one folder at a time and keeps every action working inside that model", async () => {
  const resources = await readFile(new URL("app/resources.tsx", projectRoot), "utf8");
  assert.doesNotMatch(resources, /select\(RESOURCE_FIELDS\)\.order\("is_pinned"/, "the whole tree is no longer read in one query");
  assert.match(resources, /buildListPlan\(\{ \.\.\.listParams, subtreeIds, offset, limit: RESOURCE_PAGE_SIZE \}\)/);
  assert.match(resources, /setTimeout\(\(\) => setSearch\(query\), 250\)/);
  assert.match(resources, /parseFolderParam\(window\.location\.search\)/);
  assert.match(resources, /Show more/);
  assert.match(resources, /createSignedUrls\(paths, THUMBNAIL_TTL_SECONDS\)/);
  assert.match(resources, /<ResourceActions key=\{selectedCurrent\.id\}/);
  assert.match(resources, /onChanged=\{afterChange\}/);
  assert.match(resources, /eq\("parent_id", selectedFolderId\)/, "a folder's child count is asked on its own");
});
