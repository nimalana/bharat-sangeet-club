-- Phase 4.3, P3-05: a signed-in person cannot forge who did something.
--
-- RELEASE ORDER: safe to apply BEFORE the new frontend (section "Apply before the new frontend" of
-- docs/RELEASE_ORDER.md). Every screen already sends its own user id in these columns (lib/api/*.ts);
-- the guard only refuses a different one, and fills a missing one.
--
-- What was open (register P3-05, "some writable attribution fields are not constrained to auth.uid()"):
-- the columns that say WHO created, uploaded, marked, reviewed, approved or voided something were checked
-- by some insert policies (`created_by = auth.uid()` on announcements, resource_imports, recordings,
-- recording_notes, finance_documents) and by nothing else:
--   * events and archive_items: the insert policy only asked "is an executive", so an executive could
--     create a date or archive row in somebody else's name;
--   * every UPDATE policy (announcements, events, archive_items, resources, recordings, recording_notes,
--     resource_imports) said "is an executive / is the owner" without looking at the attribution column,
--     so an executive could re-assign `created_by` / `uploaded_by` of any row to any member, and a
--     manager could take over a resource import;
--   * the tables only the security-definer functions write (marks, reviews, approvals, voids, audit
--     logs) are safe today because each function writes `auth.uid()`, but nothing enforced it for the next
--     function somebody writes.
--
-- The fix is one generic row trigger, private.guard_actor_columns(), attached with `ENABLE ALWAYS` to every
-- table that has such a column (the list is at the bottom: it is the answer to "enumerate all of them").
-- Each column is declared with one of two kinds:
--
--   own:<column>    the row's author. Direct writes by members and executives (the client writes these
--                   tables with the API, the policies are the only other check). On INSERT a missing value
--                   is filled with auth.uid() and a value that is not auth.uid() is refused; on UPDATE the
--                   value cannot change at all (an author is not re-assigned, not even to yourself).
--   stamp:<column>  an actor recorded by a definer function or a trigger (marked_by, reviewed_by,
--                   approved_by, voided_by, changed_by, actor_id...). Never filled (a NULL is a row that
--                   has no such event yet), but whenever it is written or changed to a person it must be
--                   auth.uid(); clearing it to NULL is allowed (a resubmitted form clears its reviewer).
--
-- Not a write by a signed-in person, so not touched: no auth.uid() (migrations, the service role,
-- maintenance), and writes made by another trigger or a foreign-key action (pg_trigger_depth() > 1):
-- the ON DELETE SET NULL of admin_delete_member must still be able to blank `created_by` of a deleted
-- profile's rows (proved in 77_actor_columns.test.sql).
--
-- Left alone on purpose: `member_id` (the subject of a row, not its actor), finance_expenses.paid_by_member_id
-- (the payee), admin_audit_log.target_id; admin_audit_log.actor_email is text beside actor_id and is written
-- by the same definer function (not client writable), so it is not a separate guard.
--
-- The trigger is called a_guard_actor_columns on purpose: BEFORE ROW triggers fire in name order, and the
-- ones that look at the same columns (bind_recording_file_to_uploader, the validate_* and audit_* triggers)
-- must see the value this one filled in, not the NULL the client sent. 77_actor_columns.test.sql fails if
-- any other BEFORE ROW trigger on a guarded table sorts before it.
--
-- Safe to run twice. The tables and columns are looked up first: one that does not exist is skipped, so a
-- database that differs from the replay does not fail. Tests: 77_actor_columns.test.sql.

create or replace function private.guard_actor_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_arg text;
  v_kind text;
  v_col text;
  v_row jsonb;
  v_old_row jsonb;
  v_new text;
  v_old text;
begin
  -- A write made by another trigger or by a foreign-key action is the database's own, not a client's.
  if pg_trigger_depth() > 1 then return new; end if;
  v_uid := auth.uid();
  -- No signed-in person: the migration role, the service role, maintenance.
  if v_uid is null then return new; end if;

  v_row := to_jsonb(new);
  v_old_row := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  foreach v_arg in array tg_argv loop
    v_kind := split_part(v_arg, ':', 1);
    v_col := split_part(v_arg, ':', 2);
    v_new := v_row ->> v_col;
    v_old := v_old_row ->> v_col;
    if v_kind = 'own' then
      if tg_op = 'INSERT' then
        if v_new is null then
          new := jsonb_populate_record(new, jsonb_build_object(v_col, v_uid));
        elsif v_new <> v_uid::text then
          raise exception '%.% must be the signed-in member', tg_table_name, v_col using errcode = '42501';
        end if;
      elsif v_new is distinct from v_old then
        raise exception '%.% cannot be changed', tg_table_name, v_col using errcode = '42501';
      end if;
    else
      if (tg_op = 'INSERT' or v_new is distinct from v_old) and v_new is not null and v_new <> v_uid::text then
        raise exception '%.% must be the signed-in member', tg_table_name, v_col using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_actor_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attach it: one trigger per table, listing the columns and their kind
-- ---------------------------------------------------------------------------
do $$
declare
  spec record;
  v_item text;
  v_args text[];
  v_cols text[];
begin
  for spec in
    select * from (values
      -- written directly by members and executives through the API
      ('announcements',            array['own:created_by']),
      ('archive_items',            array['own:uploaded_by']),
      ('events',                   array['own:created_by']),
      ('finance_documents',        array['own:uploaded_by']),
      ('recording_notes',          array['own:uploaded_by']),
      ('recordings',               array['own:uploaded_by']),
      ('resource_imports',         array['own:created_by']),
      ('resources',                array['own:created_by']),
      -- written by definer functions and triggers
      ('resource_links',           array['stamp:created_by']),
      ('resource_tag_assignments', array['stamp:created_by']),
      ('resource_tags',            array['stamp:created_by']),
      ('subgroups',                array['stamp:created_by', 'stamp:archived_by']),
      ('subgroup_memberships',     array['stamp:added_by', 'stamp:requested_by', 'stamp:reviewed_by']),
      ('attendance_sessions',      array['stamp:created_by']),
      ('attendance_records',       array['stamp:marked_by']),
      ('attendance_record_audit',  array['stamp:changed_by']),
      ('attendance_excuses',       array['stamp:reviewed_by']),
      ('attendance_remediations',  array['stamp:assigned_by', 'stamp:completed_by']),
      ('attendance_eligibility',   array['stamp:updated_by']),
      ('attendance_settings',      array['stamp:updated_by']),
      ('member_deactivations',     array['stamp:deactivated_by']),
      ('finance_expenses',         array['stamp:created_by', 'stamp:approved_by', 'stamp:voided_by']),
      ('finance_payments',         array['stamp:created_by', 'stamp:voided_by']),
      ('funding_claims',           array['stamp:created_by', 'stamp:updated_by', 'stamp:voided_by']),
      ('personal_reimbursements',  array['stamp:reviewed_by', 'stamp:voided_by']),
      ('finance_audit_log',        array['stamp:actor_id']),
      ('admin_audit_log',          array['stamp:actor_id']),
      ('transactions',             array['stamp:created_by'])
    ) as s(tbl, items)
  loop
    if to_regclass(format('public.%I', spec.tbl)) is null then
      raise notice 'guard_actor_columns: table % does not exist here, skipped', spec.tbl;
      continue;
    end if;
    v_args := '{}';
    v_cols := '{}';
    foreach v_item in array spec.items loop
      if exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = spec.tbl and c.column_name = split_part(v_item, ':', 2)
      ) then
        v_args := v_args || quote_literal(v_item);
        v_cols := v_cols || quote_ident(split_part(v_item, ':', 2));
      else
        raise notice 'guard_actor_columns: %.% does not exist here, skipped', spec.tbl, split_part(v_item, ':', 2);
      end if;
    end loop;
    if cardinality(v_cols) = 0 then continue; end if;

    execute format('drop trigger if exists a_guard_actor_columns on public.%I', spec.tbl);
    execute format(
      'create trigger a_guard_actor_columns before insert or update of %s on public.%I for each row execute function private.guard_actor_columns(%s)',
      array_to_string(v_cols, ', '), spec.tbl, array_to_string(v_args, ', '));
    execute format('alter table public.%I enable always trigger a_guard_actor_columns', spec.tbl);
  end loop;
end $$;
