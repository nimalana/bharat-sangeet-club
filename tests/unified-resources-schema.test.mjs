import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("unified resources migration defines the scoped resource tree and import model", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260907000000_unified_resources_library.sql", projectRoot),
    "utf8",
  );

  assert.match(migration, /execute 'create type public\.resource_node_kind as enum/);
  assert.match(migration, /execute 'create type public\.resource_media_kind as enum/);
  assert.match(migration, /execute 'create type public\.resource_status as enum/);
  assert.match(migration, /create table if not exists public\.resource_imports/);
  assert.match(migration, /create table if not exists public\.resources/);
  assert.match(migration, /parent_id bigint references public\.resources\(id\) on delete restrict/);
  assert.match(migration, /storage_bucket text/);
  assert.match(migration, /storage_path text/);
  assert.match(migration, /external_url text/);
  assert.match(migration, /event_id bigint references public\.events\(id\) on delete set null/);
  assert.match(migration, /create table if not exists public\.resource_tags/);
  assert.match(migration, /create table if not exists public\.resource_tag_assignments/);
  assert.match(migration, /resources_node_shape check/);
  assert.match(migration, /resources_metadata_object check/);
  assert.match(migration, /create unique index if not exists resources_storage_object_key_idx\s+on public\.resources \(storage_bucket, storage_path\)/s);
  assert.match(migration, /resource_imports_root_parent_idx/);
});

test("unified resources hierarchy and authorization are database enforced", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260907000000_unified_resources_library.sql", projectRoot),
    "utf8",
  );

  assert.match(migration, /create or replace function private\.validate_resource_hierarchy/);
  assert.match(migration, /parent_resource\.node_kind <> 'folder'/);
  assert.match(migration, /parent_resource\.subgroup_id is distinct from new\.subgroup_id/);
  assert.match(migration, /parent_resource\.visibility <> new\.visibility/);
  assert.match(migration, /resource hierarchy cannot contain a cycle/);
  assert.match(migration, /resource hierarchy cannot exceed three folder levels/);
  assert.match(migration, /a resource with children must remain a folder/);
  assert.match(migration, /resource descendants must have the same subgroup scope and visibility/);
  assert.match(migration, /create or replace function private\.validate_resource_import_destination/);
  assert.match(migration, /alter table public\.resources enable row level security/);
  assert.match(migration, /create policy "Members view permitted resources"/);
  assert.match(migration, /target_status = 'ready'/);
  assert.match(migration, /target_status in \('pending_upload', 'failed'\)/);
  assert.match(migration, /private\.is_subgroup_manager\(target_subgroup_id\)/);
  assert.match(migration, /create policy "Managers create resources"/);
  assert.match(migration, /private\.can_manage_resource\(subgroup_id, visibility\)/);
  assert.match(migration, /revoke all on table public\.resources, public\.resource_imports, public\.resource_tags, public\.resource_tag_assignments from anon/);
  assert.match(migration, /grant select, insert, update, delete on table public\.resources, public\.resource_imports, public\.resource_tags, public\.resource_tag_assignments to authenticated/);
});

test("unified resources migrates legacy metadata and protects both storage buckets", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260907000000_unified_resources_library.sql", projectRoot),
    "utf8",
  );

  assert.match(migration, /from public\.archive_items item\s+where item\.type in \('document', 'photo'\)/s);
  assert.match(migration, /legacy_archive_item_id/);
  assert.match(migration, /from public\.resource_links link/);
  assert.match(migration, /legacy_resource_link_id/);
  assert.match(migration, /values \('club-resources', 'club-resources', false\)/);
  assert.match(migration, /create policy "Members read permitted archive files"/);
  assert.match(migration, /create policy "Members read resource files"/);
  assert.match(migration, /bucket_id = 'club-resources'/);
  assert.match(migration, /bucket_id = 'club-archive'/);
  assert.match(migration, /create policy "Managers upload resource files"/);
  assert.match(migration, /create policy "Managers update resource files"/);
  assert.match(migration, /create policy "Managers delete resource files"/);
  assert.match(migration, /on conflict do nothing/);
});

test("advisor cleanup indexes tag authors and splits tag write policies", async () => {
  const cleanup = await readFile(
    new URL("supabase/migrations/20260907001000_unified_resources_advisor_cleanup.sql", projectRoot),
    "utf8",
  );

  assert.match(cleanup, /create index if not exists resource_tags_created_by_idx/);
  assert.match(cleanup, /on public\.resource_tags \(created_by\)\s+where created_by is not null/s);
  assert.match(cleanup, /create index if not exists resource_tag_assignments_created_by_idx/);
  assert.match(cleanup, /on public\.resource_tag_assignments \(created_by\)\s+where created_by is not null/s);
  assert.match(cleanup, /drop policy if exists "Executives manage resource tags"/);
  assert.match(cleanup, /create policy "Executives insert resource tags"[\s\S]*?for insert/s);
  assert.match(cleanup, /create policy "Executives update resource tags"[\s\S]*?for update/s);
  assert.match(cleanup, /create policy "Executives delete resource tags"[\s\S]*?for delete/s);
  assert.doesNotMatch(cleanup, /create policy "Executives manage resource tags"/);
});
