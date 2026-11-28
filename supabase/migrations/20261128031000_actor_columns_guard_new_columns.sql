-- Phase 4 integration: the who-columns that Phase 4.1 and 4.2 added are guarded like the others (P3-05).
--
-- RELEASE ORDER: safe to apply BEFORE the new frontend (section "Apply before the new frontend" of
-- docs/RELEASE_ORDER.md). Both columns are written only by SECURITY DEFINER functions from auth.uid(), which the
-- guard accepts; no screen writes them.
--
-- 20261128030200_actor_columns_guard.sql attached private.guard_actor_columns() to every column that names an
-- actor. Two such columns were created by branches that were developed in parallel with it:
--   * public.finance_expenses.rejected_by   (20261128020100_finance_rejection_audit.sql, who declined a purchase);
--   * public.signup_reviews.decided_by      (20261128010000_membership_gate_schema.sql, who approved or declined a sign-up).
-- Both are "stamp" columns (set by a definer function, NULL until the event happens, must equal auth.uid() when
-- written). supabase/tests/77_actor_columns.test.sql lists every guarded column and fails when a column that names an
-- actor is missing from the list, which is how this was found.
--
-- The trigger of a table is dropped and created again with its full list of columns (a trigger names the columns it
-- fires on), so finance_expenses keeps created_by, approved_by and voided_by and gains rejected_by. Safe to run twice;
-- a table or column that does not exist here is skipped.

do $$
declare
  spec record;
  v_item text;
  v_args text[];
  v_cols text[];
begin
  for spec in
    select * from (values
      ('finance_expenses', array['stamp:created_by', 'stamp:approved_by', 'stamp:voided_by', 'stamp:rejected_by']),
      ('signup_reviews',   array['stamp:decided_by'])
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
