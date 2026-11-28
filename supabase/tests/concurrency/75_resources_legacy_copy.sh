#!/usr/bin/env bash
# The data copy inside 20260907000000_unified_resources_library.sql: archive items of
# type document and photo, and every resource link, are copied into public.resources
# (legacy_archive_item_id / legacy_resource_link_id in metadata), recordings are not,
# a second run copies nothing twice, and the club-resources bucket is forced private.
#
# This cannot be a normal SQL test: those run on a database that already holds every
# migration, from empty, so there is nothing for the copy to copy. This script builds
# its own database in the same cluster, replays the migrations that come BEFORE the
# one under test, seeds legacy rows, applies that one migration file, and checks the
# result. It lives next to the two-session tests only because db-replay.sh already
# runs every supabase/tests/concurrency/*.sh against the cluster; it needs no second
# connection and does not touch the replayed database.
#
#   scripts/db-replay.sh runs it after the SQL tests. To run it by hand against a
#   cluster you started with KEEP=1:
#
#     PGHOST=<socket dir> PGPORT=<port> PGUSER=postgres bash supabase/tests/concurrency/75_resources_legacy_copy.sh
#
# Same limits as the other tests: plain PostgreSQL with the shims of shims.sql, so it
# says nothing about the real Storage service, only about the rows and the bucket row.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TARGET_GLOB="$MIGRATIONS/*_unified_resources_library.sql"
DBNAME="legacy75_$$"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
FAILED=0

admin() { "${PSQL[@]}" -d postgres "$@"; }
db() { "${PSQL[@]}" -d "$DBNAME" "$@"; }
cleanup() {
  admin -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DBNAME'" >/dev/null 2>&1
  admin -c "drop database if exists $DBNAME" >/dev/null 2>&1
}
trap cleanup EXIT

# A block of SQL that raises when a fact does not hold. $1 label, then SQL on stdin.
check() {
  local label="$1" out
  if out="$(db 2>&1)"; then echo "  ok   $label"; else echo "  FAIL $label"; sed 's/^/       /' <<<"$out"; FAILED=1; fi
}

TARGETS=($TARGET_GLOB)
[ "${#TARGETS[@]}" = "1" ] && [ -f "${TARGETS[0]}" ] || { echo "expected exactly one $TARGET_GLOB"; exit 1; }
TARGET="${TARGETS[0]}"
TARGET_NAME="$(basename "$TARGET")"

# ---------------------------------------------------------------------------
# A database that has every migration before the one under test, and no more.
# ---------------------------------------------------------------------------
admin -c "create database $DBNAME template template0" || { echo "could not create a database"; exit 1; }
ADMIN_MIGRATION="$MIGRATIONS/20260812000000_admin_console.sql"
BOOTSTRAP_EMAIL="$(grep -oE "lower\(email\) = '[^']+'" "$ADMIN_MIGRATION" | head -1 | sed -E "s/.*'([^']+)'/\1/")"
db -f "$ROOT/supabase/tests/shims.sql" || exit 1
bootstrapped=0
applied=0
for file in "$MIGRATIONS"/*.sql; do
  name="$(basename "$file")"
  [[ "$name" < "$TARGET_NAME" ]] || break
  if [ "$bootstrapped" = "0" ] && [[ "$name" > "20260811" ]]; then
    PGOPTIONS="$PGOPTIONS -c replay.bootstrap_email=$BOOTSTRAP_EMAIL" db -f "$ROOT/supabase/tests/bootstrap.sql" || exit 1
    bootstrapped=1
  fi
  db -f "$file" >/dev/null || { echo "FAILED applying $name"; exit 1; }
  applied=$((applied + 1))
done
echo "  replayed $applied migrations before $TARGET_NAME"

# ---------------------------------------------------------------------------
# Legacy data, as the portal wrote it before the unified library existed.
# ---------------------------------------------------------------------------
db >/dev/null <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'exec.legacy@test.invalid', '{"full_name":"Exec Legacy"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'member.legacy@test.invalid', '{"full_name":"Member Legacy"}');
insert into public.subgroups (id, name, created_by) overriding system value
  values (7001, 'Legacy Ensemble', '00000000-0000-0000-0000-0000000000a1');

insert into public.archive_items (id, title, description, type, storage_path, visibility, subgroup_id, event_date, uploaded_by, is_public, created_at) overriding system value values
  -- documents and photos: copied
  (9001, 'Concert notes',  'Program notes',  'document', 'a1/notes/program.pdf', 'members',    null, '2025-03-04', '00000000-0000-0000-0000-0000000000a1', false, '2025-03-05 10:00+00'),
  (9002, '   ',            '',               'photo',    'a1/photos/stage.jpg',  'executives', 7001, null,         '00000000-0000-0000-0000-0000000000a1', false, '2025-04-06 11:30+00'),
  (9003, 'Rehearsal',      'Full run',       'photo',    'rehearsal.png',        'members',    7001, '2025-05-07', '00000000-0000-0000-0000-0000000000a2', false, '2025-05-08 09:15+00'),
  (9004, 'Orphan document', 'Author removed', 'document', 'gone/orphan.docx',    'members',    null, null,         null,                                   false, '2025-06-09 08:00+00'),
  -- recordings stay in the archive: never copied, public or not
  (9005, 'Spring concert', '',               'recording', 'a1/spring.webm',      'members',    null, '2025-03-30', '00000000-0000-0000-0000-0000000000a1', true,  '2025-03-31 20:00+00'),
  (9006, 'Practice take',  '',               'recording', 'a2/take.webm',        'members',    7001, null,         '00000000-0000-0000-0000-0000000000a2', false, '2025-04-01 18:00+00');

insert into public.resource_links (id, title, description, url, created_by, created_at) overriding system value values
  (8001, 'Syllabus',  'Term plan', 'https://example.org/syllabus',  '00000000-0000-0000-0000-0000000000a1', '2025-01-02 12:00+00'),
  (8002, 'Tuner',     '',          'http://example.org/tuner?x=1#a', null,                                   '2025-02-03 13:00+00');

-- A bucket somebody created public by hand before the migration existed.
insert into storage.buckets (id, name, public) values ('club-resources', 'club-resources', true);
SQL
check "before the migration there is no resources table and the bucket is public" <<'SQL'
do $$ begin
  assert to_regclass('public.resources') is null, 'resources already exists';
  assert (select public from storage.buckets where id = 'club-resources'), 'bucket seed is public';
end $$;
SQL

# ---------------------------------------------------------------------------
# The migration under test, first run.
# ---------------------------------------------------------------------------
db -f "$TARGET" >/dev/null || { echo "FAILED applying $TARGET_NAME on the seeded database"; exit 1; }

check "documents and photos are copied, recordings are not" <<'SQL'
do $$ begin
  assert (select count(*) from public.resources) = 6, 'six rows in all: ' || (select count(*) from public.resources);
  assert (select count(*) from public.resources where metadata ? 'legacy_archive_item_id') = 4, 'four archive items copied';
  assert (select array_agg((metadata ->> 'legacy_archive_item_id')::int order by (metadata ->> 'legacy_archive_item_id')::int) from public.resources where metadata ? 'legacy_archive_item_id') = array[9001, 9002, 9003, 9004], 'the documents and photos';
  assert not exists (select 1 from public.resources where storage_path in ('a1/spring.webm', 'a2/take.webm')), 'no recording became a resource';
  assert not exists (select 1 from public.resources where metadata ->> 'legacy_archive_item_id' in ('9005', '9006')), 'no recording marker';
  assert (select count(*) from public.archive_items) = 6, 'the archive keeps all six items';
  assert (select count(*) from public.resource_links) = 2, 'and both links';
end $$;
SQL

check "a document item keeps its fields" <<'SQL'
do $$ declare r public.resources; begin
  select * into r from public.resources where metadata ->> 'legacy_archive_item_id' = '9001';
  assert r.node_kind = 'file' and r.media_kind = 'document', 'a file, media kind document';
  assert r.title = 'Concert notes' and r.description = 'Program notes', 'title and description';
  assert r.storage_bucket = 'club-archive' and r.storage_path = 'a1/notes/program.pdf', 'it points at the stored object in the archive bucket';
  assert r.original_filename = 'program.pdf', 'file name is the last path segment: ' || r.original_filename;
  assert r.mime_type = 'application/octet-stream', 'document mime type';
  assert r.occurred_on = date '2025-03-04', 'event date becomes occurred_on';
  assert r.status = 'ready', 'ready';
  assert r.visibility = 'members' and r.subgroup_id is null, 'scope is kept';
  assert r.created_by = '00000000-0000-0000-0000-0000000000a1', 'uploader becomes creator';
  assert r.created_at = timestamptz '2025-03-05 10:00+00' and r.updated_at = r.created_at, 'dates are the item''s';
  assert r.metadata = jsonb '{"legacy_archive_item_id": 9001, "legacy_archive_type": "document"}', 'metadata marker: ' || r.metadata::text;
  assert r.parent_id is null and r.external_url is null and not r.is_pinned, 'top level, no link, not pinned';
end $$;
SQL

check "a photo item keeps its fields, a blank title gets a name, scope is kept" <<'SQL'
do $$ declare r public.resources; begin
  select * into r from public.resources where metadata ->> 'legacy_archive_item_id' = '9002';
  assert r.node_kind = 'file' and r.media_kind = 'image', 'a file, media kind image';
  assert r.title = 'Untitled resource', 'blank title: [' || r.title || ']';
  assert r.mime_type = 'image/*', 'photo mime type';
  assert r.original_filename = 'stage.jpg', 'file name';
  assert r.occurred_on is null, 'no date stays no date';
  assert r.subgroup_id = 7001 and r.visibility = 'executives', 'the group and the executives-only visibility carry over';
  assert r.metadata ->> 'legacy_archive_type' = 'photo', 'type marker';
  select * into r from public.resources where metadata ->> 'legacy_archive_item_id' = '9003';
  assert r.original_filename = 'rehearsal.png', 'a path with no folder is its own file name: ' || r.original_filename;
  assert r.created_by = '00000000-0000-0000-0000-0000000000a2' and r.subgroup_id = 7001 and r.visibility = 'members', 'creator and scope';
  select * into r from public.resources where metadata ->> 'legacy_archive_item_id' = '9004';
  assert r.created_by is null, 'an item whose uploader was removed is copied with no creator';
  assert r.media_kind = 'document' and r.original_filename = 'orphan.docx', 'and as a document';
end $$;
SQL

check "a link keeps its fields" <<'SQL'
do $$ declare r public.resources; begin
  select * into r from public.resources where metadata ->> 'legacy_resource_link_id' = '8001';
  assert r.node_kind = 'link' and r.media_kind is null, 'a link';
  assert r.title = 'Syllabus' and r.description = 'Term plan', 'title and description';
  assert r.external_url = 'https://example.org/syllabus', 'address';
  assert r.storage_bucket is null and r.storage_path is null, 'nothing stored';
  assert r.visibility = 'members' and r.subgroup_id is null and r.parent_id is null, 'club-wide, members, top level';
  assert r.status = 'ready', 'ready';
  assert r.created_by = '00000000-0000-0000-0000-0000000000a1', 'creator';
  assert r.created_at = timestamptz '2025-01-02 12:00+00' and r.updated_at = r.created_at, 'dates are the link''s';
  assert r.metadata = jsonb '{"legacy_resource_link_id": 8001}', 'metadata marker: ' || r.metadata::text;
  select * into r from public.resources where metadata ->> 'legacy_resource_link_id' = '8002';
  assert r.external_url = 'http://example.org/tuner?x=1#a' and r.created_by is null, 'a link with no author is copied as it is';
  assert r.description = '', 'empty description';
end $$;
SQL

check "the resources bucket is private afterwards, the archive bucket untouched" <<'SQL'
do $$ begin
  assert (select count(*) from storage.buckets where id = 'club-resources') = 1, 'one row for the bucket';
  assert not (select public from storage.buckets where id = 'club-resources'), 'the migration turned the public bucket private';
  assert not (select public from storage.buckets where id = 'club-archive'), 'the archive bucket is private';
end $$;
SQL

# The other way in: no bucket row at all, as on a fresh project. It must be created private.
db -c "delete from storage.buckets where id = 'club-resources'" || exit 1
db -f "$TARGET" >/dev/null || { echo "FAILED applying $TARGET_NAME with no bucket row"; exit 1; }
check "a bucket row that does not exist yet is created private" <<'SQL'
do $$ begin
  assert (select count(*) from storage.buckets where id = 'club-resources') = 1, 'one row for the bucket';
  assert not (select public from storage.buckets where id = 'club-resources'), 'created private';
end $$;
SQL

# ---------------------------------------------------------------------------
# Running it again, and again after more legacy rows arrive.
# ---------------------------------------------------------------------------
db >/dev/null <<'SQL'
create table public.r75_snapshot as select id, title, metadata, created_at, updated_at from public.resources;
SQL
db -f "$TARGET" >/dev/null || { echo "FAILED re-applying $TARGET_NAME"; exit 1; }
check "applying the migration again copies nothing twice and changes no copied row" <<'SQL'
do $$ begin
  assert (select count(*) from public.resources) = 6, 'still six rows: ' || (select count(*) from public.resources);
  assert (select count(*) from public.resources where metadata ? 'legacy_archive_item_id') = 4, 'still four archive items';
  assert (select count(*) from public.resources where metadata ? 'legacy_resource_link_id') = 2, 'still two links';
  assert not exists (select 1 from public.resources r join public.r75_snapshot s using (id) where (r.title, r.metadata, r.created_at, r.updated_at) is distinct from (s.title, s.metadata, s.created_at, s.updated_at)), 'rows are as they were';
  assert (select count(*) from public.resources r join public.r75_snapshot s using (id)) = 6, 'with the same ids';
end $$;
SQL

# A resource somebody edited after the first copy is not copied again, and a legacy row
# added after the first run is picked up exactly once by the next run.
db >/dev/null <<'SQL'
update public.resources set title = 'Renamed after the move', is_pinned = true where metadata ->> 'legacy_archive_item_id' = '9001';
update public.resources set title = 'Renamed link' where metadata ->> 'legacy_resource_link_id' = '8001';
-- an executive may repoint a copy at another stored object; the marker, not the path, says it was copied
update public.resources set storage_path = 'gone/orphan-moved.docx' where metadata ->> 'legacy_archive_item_id' = '9004';
insert into public.archive_items (id, title, description, type, storage_path, visibility, uploaded_by, created_at) overriding system value
  values (9007, 'Late document', '', 'document', 'a1/late.pdf', 'members', '00000000-0000-0000-0000-0000000000a1', '2025-07-01 10:00+00'),
         (9008, 'Late recording', '', 'recording', 'a1/late.webm', 'members', '00000000-0000-0000-0000-0000000000a1', '2025-07-01 11:00+00');
insert into public.resource_links (id, title, url, created_by, created_at) overriding system value
  values (8003, 'Late link', 'https://example.org/late', '00000000-0000-0000-0000-0000000000a1', '2025-07-02 10:00+00');
SQL
db -f "$TARGET" >/dev/null || { echo "FAILED applying $TARGET_NAME a third time"; exit 1; }
db -f "$TARGET" >/dev/null || { echo "FAILED applying $TARGET_NAME a fourth time"; exit 1; }
check "rows added later are copied once; edited copies are left alone" <<'SQL'
do $$ begin
  assert (select count(*) from public.resources) = 8, 'six plus the late document and the late link: ' || (select count(*) from public.resources);
  assert (select count(*) from public.resources where metadata ->> 'legacy_archive_item_id' = '9007') = 1, 'the late document once';
  assert (select count(*) from public.resources where metadata ->> 'legacy_resource_link_id' = '8003') = 1, 'the late link once';
  assert not exists (select 1 from public.resources where metadata ->> 'legacy_archive_item_id' = '9008'), 'the late recording not at all';
  assert (select title from public.resources where metadata ->> 'legacy_archive_item_id' = '9001') = 'Renamed after the move', 'an edited copy keeps its edit';
  assert (select is_pinned from public.resources where metadata ->> 'legacy_archive_item_id' = '9001'), 'and its pin';
  assert (select title from public.resources where metadata ->> 'legacy_resource_link_id' = '8001') = 'Renamed link', 'an edited link keeps its edit';
  assert (select count(*) from public.resources where metadata ->> 'legacy_archive_item_id' = '9004') = 1, 'a copy whose stored object was repointed is not copied again';
  assert (select storage_path from public.resources where metadata ->> 'legacy_archive_item_id' = '9004') = 'gone/orphan-moved.docx', 'and keeps its new path';
end $$;
SQL

# An object that already has a row (same bucket and path) is skipped, not an error, even
# when that row carries no legacy marker. Removing the marker from a copy stands in for it.
db >/dev/null <<'SQL'
update public.resources set metadata = '{}' where metadata ->> 'legacy_archive_item_id' = '9003';
SQL
db -f "$TARGET" >/dev/null || { echo "FAILED applying $TARGET_NAME over a row that already holds an archive path"; FAILED=1; }
check "an archive path that already has a resources row is not copied a second time" <<'SQL'
do $$ begin
  assert (select count(*) from public.resources where storage_bucket = 'club-archive' and storage_path = 'rehearsal.png') = 1, 'one row for that stored object';
  assert (select count(*) from public.resources) = 8, 'no extra rows: ' || (select count(*) from public.resources);
end $$;
SQL

[ "$FAILED" = "0" ] || exit 1
