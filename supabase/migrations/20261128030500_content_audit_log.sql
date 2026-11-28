-- Phase 4.4: an audit trail for content changes (plan 4.4, "extend audit logging to subgroup, event,
-- announcement, resource and recording changes"). Until now only member administration (admin_audit_log)
-- and finance (finance_audit_log) left a trail; a group renamed, an announcement rewritten, a resource made
-- public or a recording deleted left nothing to look at when someone asked "who did that, and when".
--
-- RELEASE ORDER: safe to apply BEFORE the new frontend (section "Apply before the new frontend" of
-- docs/RELEASE_ORDER.md). It adds a table, functions and triggers; no screen reads or writes the new table
-- yet and no existing write is refused (the triggers add one insert per audited statement).
--
-- WHAT IS RECORDED. One table, public.content_audit_log, written ONLY by statement-level security-definer
-- triggers on: subgroups, subgroup_memberships, events, announcements, resources, resource_imports, recordings,
-- recording_notes and archive_items (the legacy recording list that still feeds the public concert page: making
-- one public is exactly the kind of change this is for). One row says: when, who (auth.uid(), NULL for the
-- migration role / service role / maintenance), what kind of thing and which one (entity_type, entity_id,
-- label = its title or name), what happened (insert, update, delete), the group it belongs to, and `details`:
--     insert, delete   {"values": {title, visibility, ...}}                      the tracked columns
--     update           {"changes": {"visibility": ["members", "executives"]},    old and new of tracked columns
--                       "named": ["description", "storage_path"]}               columns whose NAME is recorded, not the text
-- Free text is cut at 200 characters. The body of an announcement, a description, a notation text and a file
-- path are "named" columns: the log says the description changed, not what it said (the log is read by every
-- executive and it must not become a second copy of private text); a file path is named because swapping it
-- repoints what the row serves, which is the change worth seeing.
--
-- NOISE, decided here and pinned by 77_content_audit_log.test.sql:
--   * An UPDATE that changes none of the tracked or named columns writes nothing: upload progress of an
--     import, `updated_at` touches, a resource moving from pending_upload to ready, a status counter. That is
--     what keeps the busiest tables (resources, resource_imports) from drowning the log.
--   * A resource created as part of an import (import_id is set) writes nothing on INSERT: the import itself
--     is one row (resource_imports insert, and its status changes), not one row per file of a 300-file folder.
--     Editing or deleting one of those files later IS logged like any other.
--   * One statement that changes MORE than 10 rows writes ONE summary row: row_count = n, entity_id NULL,
--     details = {"keys": [first 20 ids], "columns": [changed columns]}. A bulk delete of a folder's contents or a
--     fixture load is therefore one line, and the line says how many.
--   * Cascaded deletes (a group deleted takes its events, announcements and resources with it) are statements
--     like any other and are logged as the deletes they are, per table.
--
-- WHO CAN DO WHAT.
--   * Read: executives and administrators (private.is_executive()), active only, through the "Executives read
--     content audit log" policy; anon and authenticated hold SELECT and nothing else on the table. The function
--     public.list_content_audit(p_limit, p_before, p_entity_type) is SECURITY INVOKER (the policy applies),
--     refuses everyone else with 42501, pages newest first (keyset on id), and adds the actor's name.
--   * Write: nobody through the API. No INSERT/UPDATE/DELETE/TRUNCATE privilege for anon or authenticated, and the
--     rows come only from the definer triggers.
--   * Append-only even for the owner: a trigger refuses UPDATE, DELETE and TRUNCATE of the table, and fires
--     ALWAYS. Retention is therefore a deliberate, manual act of whoever owns the database:
--     `alter table public.content_audit_log disable trigger refuse_content_audit_change;` ... delete ... re-enable.
--   * Unbypassable by a session: the audit triggers are ENABLE ALWAYS (they fire under
--     session_replication_role = replica, which only a superuser can set) and cannot be disabled by anyone who
--     does not own the tables. There is no client path to a write of these tables that skips a statement
--     trigger: TRUNCATE is not granted, COPY and upserts fire them.
--   * actor_id has no foreign key: deleting a member must not blank or block the trail of what they did.
--
-- COST: one statement-level trigger per operation, one extra insert per audited statement that changed a
-- tracked column (two small indexes plus the primary key). Measured numbers are in the phase report.
--
-- Safe to run twice. Tests: 77_content_audit_log.test.sql.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
create table if not exists public.content_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  entity_type text not null,
  entity_id text,
  action text not null,
  subgroup_id bigint,
  label text,
  row_count integer not null default 1,
  details jsonb not null default '{}'::jsonb,
  constraint content_audit_log_entity_type_check check (entity_type in (
    'subgroup', 'subgroup_membership', 'event', 'announcement', 'resource', 'resource_import', 'recording', 'recording_note', 'archive_item')),
  constraint content_audit_log_action_check check (action in ('insert', 'update', 'delete')),
  constraint content_audit_log_row_count_check check (row_count >= 1),
  constraint content_audit_log_entity_id_check check ((row_count = 1 and entity_id is not null) or row_count > 1),
  constraint content_audit_log_label_length check (char_length(label) <= 200)
);

create index if not exists content_audit_log_occurred_idx on public.content_audit_log (occurred_at desc, id desc);
create index if not exists content_audit_log_entity_idx on public.content_audit_log (entity_type, entity_id, id desc);

alter table public.content_audit_log enable row level security;

revoke all on table public.content_audit_log from public, anon, authenticated;
grant select on table public.content_audit_log to authenticated;

drop policy if exists "Active members only" on public.content_audit_log;
create policy "Active members only" on public.content_audit_log
  as restrictive for all to authenticated
  using ((select private.is_active_member()))
  with check ((select private.is_active_member()));

drop policy if exists "Executives read content audit log" on public.content_audit_log;
create policy "Executives read content audit log" on public.content_audit_log
  for select to authenticated
  using ((select private.is_executive()));

-- the rule every public table follows (20_deactivation.test.sql): a deactivated person writes nothing
drop trigger if exists block_deactivated_writer on public.content_audit_log;
create trigger block_deactivated_writer before insert or update or delete on public.content_audit_log
  for each statement execute function private.block_deactivated_writer();

-- who is recorded is the signed-in person (P3-05, 20261128030200): the same guard as every other actor column.
-- The audit triggers insert from inside a trigger, which the guard leaves alone; this only matters to a direct write.
drop trigger if exists a_guard_actor_columns on public.content_audit_log;
create trigger a_guard_actor_columns before insert or update of actor_id on public.content_audit_log
  for each row execute function private.guard_actor_columns('stamp:actor_id');
alter table public.content_audit_log enable always trigger a_guard_actor_columns;

-- ---------------------------------------------------------------------------
-- Append-only, for every role including the owner
-- ---------------------------------------------------------------------------
create or replace function private.refuse_content_audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'The content audit log is append-only' using errcode = '42501';
end;
$$;
revoke all on function private.refuse_content_audit_change() from public, anon, authenticated;

drop trigger if exists refuse_content_audit_change on public.content_audit_log;
create trigger refuse_content_audit_change before update or delete on public.content_audit_log
  for each row execute function private.refuse_content_audit_change();
alter table public.content_audit_log enable always trigger refuse_content_audit_change;

drop trigger if exists refuse_content_audit_truncate on public.content_audit_log;
create trigger refuse_content_audit_truncate before truncate on public.content_audit_log
  for each statement execute function private.refuse_content_audit_change();
alter table public.content_audit_log enable always trigger refuse_content_audit_truncate;

-- ---------------------------------------------------------------------------
-- Helpers (pure functions on jsonb; only the trigger function below calls them)
-- ---------------------------------------------------------------------------
-- the listed columns of a row as a jsonb object, strings cut at 200 characters
create or replace function private.audit_pick(j jsonb, cols text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c, case when jsonb_typeof(j -> c) = 'string' then to_jsonb(left(j ->> c, 200)) else j -> c end)
                  filter (where j ? c), '{}'::jsonb)
  from unnest(cols) c;
$$;

-- what changed between two versions of a row: old and new of the tracked columns, the names of the named
-- columns; NULL when none of them changed
create or replace function private.audit_diff(o jsonb, n jsonb, tracked text[], named text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when t.changes is null and m.names is null then null
    else jsonb_strip_nulls(jsonb_build_object('changes', t.changes, 'named', m.names)) end
  from (
    select jsonb_object_agg(c, jsonb_build_array(
        case when jsonb_typeof(o -> c) = 'string' then to_jsonb(left(o ->> c, 200)) else o -> c end,
        case when jsonb_typeof(n -> c) = 'string' then to_jsonb(left(n ->> c, 200)) else n -> c end)) as changes
    from unnest(tracked) c where (o -> c) is distinct from (n -> c)
  ) t,
  (
    select jsonb_agg(c) as names from unnest(named) c where (o -> c) is distinct from (n -> c)
  ) m;
$$;
revoke all on function private.audit_pick(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.audit_diff(jsonb, jsonb, text[], text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trigger function: one call per audited statement
-- args: 0 entity type, 1 key columns (comma separated), 2 group column, 3 label column,
--       4 tracked columns, 5 named columns, 6 column that suppresses an INSERT when it is not NULL
-- ---------------------------------------------------------------------------
create or replace function private.audit_content_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_bulk constant integer := 10;     -- more changed rows than this in one statement: one summary row
  c_sample constant integer := 20;   -- ids kept in a summary row
  v_entity text := tg_argv[0];
  v_k1 text := (string_to_array(tg_argv[1], ','))[1];   -- key columns: one, or two for a composite key
  v_k2 text := (string_to_array(tg_argv[1], ','))[2];
  v_scope text := nullif(tg_argv[2], '');
  v_label text := nullif(tg_argv[3], '');
  v_tracked text[] := coalesce(string_to_array(nullif(tg_argv[4], ''), ','), '{}');
  v_named text[] := coalesce(string_to_array(nullif(tg_argv[5], ''), ','), '{}');
  v_skip text := nullif(tg_argv[6], '');
  v_action text := lower(tg_op);
  v_actor uuid;
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_old jsonb;
begin
  -- The rows the statement changed that are worth a line (v_total), and the first few of them (v_rows).
  -- Written so that the common case, one row, costs one cheap pass; the per-row work (to_jsonb, the diff) is
  -- only done for every row where the statement has to count them (an update) or for the sample (an insert, a delete).
  if tg_op = 'UPDATE' then
    -- The old versions are collected into one object keyed by the row's key and looked up by key, not joined:
    -- a join in a plan cached for one-row statements turns quadratic when a later statement changes thousands of rows.
    select jsonb_object_agg(concat_ws(':', o.j ->> v_k1, o.j ->> v_k2), o.j) into v_old
    from (select to_jsonb(r) as j from old_rows r) o;
    select count(*), coalesce(jsonb_agg(x.item) filter (where x.rn <= c_sample + 1), '[]'::jsonb)
      into v_total, v_rows
    from (
      select row_number() over () as rn,
             jsonb_build_object('key', k.key, 'scope', n.j ->> v_scope, 'label', n.j ->> v_label) || d.diff as item
      from (select to_jsonb(r) as j from new_rows r) n
      cross join lateral (select concat_ws(':', n.j ->> v_k1, n.j ->> v_k2) as key) k
      -- offset 0: evaluate the diff once per row (without it the planner repeats it in the filter and in the output)
      cross join lateral (select private.audit_diff(v_old -> k.key, n.j, v_tracked, v_named) as diff offset 0) d
      where d.diff is not null
    ) x;
  elsif tg_op = 'INSERT' then
    if v_skip is null then
      select count(*) into v_total from new_rows;
    else
      select count(*) into v_total from new_rows r where (to_jsonb(r) ->> v_skip) is null;
    end if;
    if v_total > 0 then
      select coalesce(jsonb_agg(s.item), '[]'::jsonb) into v_rows
      from (
        select jsonb_build_object('key', concat_ws(':', n.j ->> v_k1, n.j ->> v_k2), 'scope', n.j ->> v_scope, 'label', n.j ->> v_label,
                                  'values', private.audit_pick(n.j, array_remove(array[v_k1, v_k2], null) || v_tracked)) as item
        from (select to_jsonb(r) as j from new_rows r) n
        where v_skip is null or (n.j ->> v_skip) is null
        limit c_sample + 1
      ) s;
    end if;
  else
    select count(*) into v_total from old_rows;
    if v_total > 0 then
      select coalesce(jsonb_agg(s.item), '[]'::jsonb) into v_rows
      from (
        select jsonb_build_object('key', concat_ws(':', o.j ->> v_k1, o.j ->> v_k2), 'scope', o.j ->> v_scope, 'label', o.j ->> v_label,
                                  'values', private.audit_pick(o.j, array_remove(array[v_k1, v_k2], null) || v_tracked)) as item
        from (select to_jsonb(r) as j from old_rows r) o
        limit c_sample + 1
      ) s;
    end if;
  end if;

  if v_total = 0 then return null; end if;
  v_actor := auth.uid();

  if v_total <= c_bulk then
    insert into public.content_audit_log (actor_id, entity_type, entity_id, action, subgroup_id, label, details)
    select v_actor, v_entity, e ->> 'key', v_action, nullif(e ->> 'scope', '')::bigint, left(e ->> 'label', 200),
           e - 'key' - 'scope' - 'label'
    from jsonb_array_elements(v_rows) e;
  else
    insert into public.content_audit_log (actor_id, entity_type, entity_id, action, subgroup_id, label, row_count, details)
    values (
      v_actor, v_entity, null, v_action,
      (select case when count(distinct e ->> 'scope') = 1 then nullif(min(e ->> 'scope'), '')::bigint end from jsonb_array_elements(v_rows) e),
      null, v_total,
      jsonb_build_object(
        'keys', (select jsonb_agg(k) from (select e ->> 'key' as k from jsonb_array_elements(v_rows) e limit c_sample) s),
        'columns', coalesce((
          select jsonb_agg(distinct c) from jsonb_array_elements(v_rows) e,
            lateral (select jsonb_object_keys(coalesce(e -> 'changes', '{}'::jsonb)) as c
                     union all select jsonb_array_elements_text(coalesce(e -> 'named', '[]'::jsonb))) cols
        ), '[]'::jsonb)));
  end if;
  return null;
end;
$$;
revoke all on function private.audit_content_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attach it: three statement triggers per table, ENABLE ALWAYS
-- ---------------------------------------------------------------------------
do $$
declare
  spec record;
  v_args text;
begin
  for spec in
    select * from (values
      ('subgroups',            'subgroup',            'id',                    'id',          'name',  'name,enrollment_mode,archived_at,archived_by', 'description',                      ''),
      ('subgroup_memberships', 'subgroup_membership', 'subgroup_id,member_id', 'subgroup_id', '',      'status,membership_role',                     '',                                 ''),
      ('events',               'event',               'id',                    'subgroup_id', 'title', 'title,starts_at,location,subgroup_id',       'description',                      ''),
      ('announcements',        'announcement',        'id',                    'subgroup_id', 'title', 'title,is_pinned,subgroup_id',                'body',                             ''),
      ('resources',            'resource',            'id',                    'subgroup_id', 'title', 'title,node_kind,parent_id,subgroup_id,visibility,is_pinned,external_url,event_id,season_label',
                                                                                                                                                     'description,storage_bucket,storage_path', 'import_id'),
      ('resource_imports',     'resource_import',     'id',                    'subgroup_id', 'name',  'name,status,visibility,subgroup_id',         '',                                 ''),
      ('recordings',           'recording',           'id',                    'subgroup_id', 'title', 'title,subgroup_id,audience,status,recording_kind,event_date,raga,tala,sruthi,tempo',
                                                                                                                                                     'description,storage_bucket,storage_path', ''),
      ('recording_notes',      'recording_note',      'id',                    '',            'title', 'title,note_type,recording_id',               'body,storage_path',                ''),
      ('archive_items',        'archive_item',        'id',                    'subgroup_id', 'title', 'title,type,visibility,is_public,subgroup_id,event_date,raga,tala',
                                                                                                                                                     'description,storage_path',         '')
    ) as s(tbl, entity, keys, scope, label, tracked, named, skip)
  loop
    if to_regclass(format('public.%I', spec.tbl)) is null then
      raise notice 'content audit: table % does not exist here, skipped', spec.tbl;
      continue;
    end if;
    v_args := (select string_agg(quote_literal(a), ', ' order by ord)
               from unnest(array[spec.entity, spec.keys, spec.scope, spec.label, spec.tracked, spec.named, spec.skip]) with ordinality u(a, ord));

    execute format('drop trigger if exists audit_content_insert on public.%I', spec.tbl);
    execute format('drop trigger if exists audit_content_update on public.%I', spec.tbl);
    execute format('drop trigger if exists audit_content_delete on public.%I', spec.tbl);
    execute format('create trigger audit_content_insert after insert on public.%I referencing new table as new_rows for each statement execute function private.audit_content_change(%s)', spec.tbl, v_args);
    execute format('create trigger audit_content_update after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function private.audit_content_change(%s)', spec.tbl, v_args);
    execute format('create trigger audit_content_delete after delete on public.%I referencing old table as old_rows for each statement execute function private.audit_content_change(%s)', spec.tbl, v_args);
    execute format('alter table public.%I enable always trigger audit_content_insert', spec.tbl);
    execute format('alter table public.%I enable always trigger audit_content_update', spec.tbl);
    execute format('alter table public.%I enable always trigger audit_content_delete', spec.tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reading it
-- ---------------------------------------------------------------------------
create or replace function public.list_content_audit(
  p_limit integer default 50,
  p_before bigint default null,
  p_entity_type text default null
)
returns table (
  id bigint,
  occurred_at timestamptz,
  actor_id uuid,
  actor_name text,
  entity_type text,
  entity_id text,
  action text,
  subgroup_id bigint,
  label text,
  row_count integer,
  details jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_executive() then
    raise exception 'Only executives can read the content audit log' using errcode = '42501';
  end if;
  return query
  select l.id, l.occurred_at, l.actor_id, coalesce(nullif(btrim(p.full_name), ''), p.email), l.entity_type, l.entity_id,
         l.action, l.subgroup_id, l.label, l.row_count, l.details
  from public.content_audit_log l
  left join public.profiles p on p.id = l.actor_id
  where (p_before is null or l.id < p_before)
    and (p_entity_type is null or l.entity_type = p_entity_type)
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.list_content_audit(integer, bigint, text) from public, anon;
grant execute on function public.list_content_audit(integer, bigint, text) to authenticated;
