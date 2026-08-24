import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("resource links use database-enforced member and manager permissions", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260824193611_resource_links.sql", projectRoot), "utf8");
  const leastPrivilegeMigration = await readFile(
    new URL("supabase/migrations/20260824195043_resource_links_least_privilege.sql", projectRoot),
    "utf8",
  );
  const creatorIndexMigration = await readFile(
    new URL("supabase/migrations/20260824200959_resource_links_creator_index.sql", projectRoot),
    "utf8",
  );

  assert.match(migration, /create table public\.resource_links/);
  assert.match(migration, /alter table public\.resource_links enable row level security/);
  assert.match(migration, /revoke all on table public\.resource_links from anon/);
  assert.match(migration, /for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) is not null\)/s);
  assert.match(migration, /for insert\s+to authenticated\s+with check \(\s*\(select private\.is_executive\(\)\)/s);
  assert.match(migration, /check \(url ~\* '\^https\?:\/\//);
  assert.match(leastPrivilegeMigration, /revoke all on table public\.resource_links from authenticated/);
  assert.match(leastPrivilegeMigration, /grant select, insert, delete on table public\.resource_links to authenticated/);
  assert.match(creatorIndexMigration, /create index resource_links_created_by_idx/);
});

test("resources UI supports adding, opening, and removing links", async () => {
  const page = await readFile(new URL("app/page.tsx", projectRoot), "utf8");

  assert.match(page, /from\("resource_links"\)\.select/);
  assert.match(page, /function addResourceLink/);
  assert.match(page, /function deleteResourceLink/);
  assert.match(page, /title="Club resources"/);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /aria-busy=\{savingLink\}/);
});
