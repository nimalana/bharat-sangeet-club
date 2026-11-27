-- Least-privilege grants for anon and authenticated (plan 2.0, and the sequence
-- part of P3-05 pulled forward).
--
-- ============================================================================
-- RELEASE ORDER: APPLY THIS MIGRATION ONLY AFTER THE NEW FRONTEND IS LIVE.
-- ============================================================================
-- The frontend that is deployed from main today writes funding_claims,
-- funding_claim_expenses and other tables straight through the REST API. This
-- migration takes those write privileges away. Applied first, it breaks the
-- live site (every such write answers 42501 "permission denied"). The order is:
--   1. apply every earlier migration (they are additive; the old frontend keeps working),
--   2. deploy the new frontend and check it,
--   3. apply this file.
-- docs/PHASE_1_MANUAL_CHECKS.md ("Release order") has the same list and the
-- one-line undo for a single table.
--
-- Why this exists. Hosted Supabase gives anon and authenticated, through default
-- ACLs, every privilege on every table that postgres creates in public (select,
-- insert, update, delete, truncate, references, trigger and, on PostgreSQL 17,
-- maintain), every privilege on every sequence, and EXECUTE on every function.
-- Row level security is then the only thing between an API caller and the
-- table. For the ledger that is not enough: the executive write policies on
-- finance_expenses, finance_payments, personal_reimbursements, funding_claims,
-- its link table, the attendance tables and the audit tables are live, so an
-- executive could insert, edit or delete ledger rows directly and skip the void,
-- edit and audit rules that the RPC functions enforce. TRUNCATE is not subject to
-- row level security at all: anyone holding it can empty a table.
--
-- What this migration does, in order:
--   1. Takes every privilege on every table in public and private away from
--      public, anon and authenticated (table level and column level). "revoke all"
--      is used on purpose: it also covers MAINTAIN (PostgreSQL 17 only; naming it
--      would fail on 16) and anything a later PostgreSQL version adds.
--   2. Grants back exactly the matrix below. A table that is not in the matrix
--      stays closed to both roles (a notice lists it).
--   3. Does the same for sequences and grants back USAGE only where a column
--      default calls nextval() on a table the role can insert into (serial or a
--      hand-written default). Identity columns, which are what every table here
--      uses, need no sequence privilege: PostgreSQL advances the sequence on
--      behalf of the table, not of the caller.
--   4. Stops the default ACLs of the postgres role from handing tables and
--      sequences created later to anon and authenticated. A migration that adds a
--      table now has to grant what it needs; forgetting is closed, not open.
--
-- The matrix (public schema). It is what the frontend does today, taken from
-- every .from(table).insert/update/delete and .rpc() call in app/, components/
-- and lib/ (the contract-check extractor lists them), plus what security-invoker
-- functions and policy sub-queries read as the signed-in user:
--
--   anon (the signed-out site)
--     archive_items            select      the public concert list under policy
--                                          "Visitors view public concert recordings"
--                                          (the server render and the browser fallback)
--     everything else          nothing     Storage reads are decided by storage.objects
--                                          policies, whose only public-schema read for
--                                          anon is this same archive_items select
--
--   authenticated
--     writes from the frontend (policies still decide which rows)
--       announcements, events, recordings, recording_notes, resources
--                              select, insert, update, delete
--       archive_items          select, insert, update, delete  (recordings archive form)
--       resource_imports       select, insert, update          (upload progress; the row
--                                                              is removed by cascade only)
--       finance_documents, finance_expense_documents,
--       finance_reimbursement_documents, finance_claim_documents
--                              select, insert                  (register an uploaded file;
--                                                              removal is remove_finance_document)
--       profiles               select, and update on four columns only
--                              (full_name, phone, class_year, specialty). role, status and
--                              email stay out of reach; rows are created by the signup trigger
--       attendance_eligibility select, insert, update          set_attendance_eligibility is a
--                              SECURITY INVOKER function (20260831004000, deliberate: "the RPC
--                              can run as the caller"), so it needs these two as the caller.
--                              Policies still limit them to executives. Make that function
--                              SECURITY DEFINER and this row can become select-only
--     read only: select and nothing else
--       every other table. All writes to them go through audited SECURITY DEFINER
--       RPCs: finance_expenses, finance_payments, personal_reimbursements,
--       funding_claims, funding_claim_expenses (the Phase 2.0 revokes, now part of this
--       file), the other attendance tables, subgroups, subgroup_memberships,
--       member_deactivations, admin_audit_log, finance_audit_log, transactions (legacy,
--       unused by the frontend), resource_links, resource_tags and resource_tag_assignments
--       (unused by the frontend). Select stays everywhere because the read functions are
--       SECURITY INVOKER and policy and storage sub-queries read these tables as the caller;
--       row level security still decides which rows come back.
--
-- Nobody loses anything the functions need: SECURITY DEFINER functions and triggers
-- run as their owner, and the foreign key checks run as the table owner.
-- service_role and postgres are untouched.
--
-- Not changed here: EXECUTE on functions (every function already has it revoked
-- from public and anon, and 70_default_privileges.test.sql keeps it that way),
-- storage.objects (managed by Supabase), and objects created by roles other than
-- postgres (migrations run as postgres).
--
-- Safe to run twice: it revokes to a known state and grants the matrix again.
-- Tests: supabase/tests/72_grants_matrix.test.sql.

do $grants$
declare
  rel record;
  m record;
  col_list text;
  closed text[] := '{}';
  foreign_owned text[] := '{}';
  skipped text[] := '{}';
  unlisted text[] := '{}';
  listed text[] := '{}';
begin
  -- 1. Start closed. Only objects the migration role owns (or may act for) can
  -- be changed; a hosted extension object owned by supabase_admin is left alone.
  for rel in
    select n.nspname, c.relname, pg_has_role(current_user, c.relowner, 'USAGE') as mine
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
    order by 1, 2
  loop
    if rel.mine then
      execute format('revoke all on table %I.%I from public, anon, authenticated', rel.nspname, rel.relname);
      closed := closed || format('%s.%s', rel.nspname, rel.relname);
    else
      foreign_owned := foreign_owned || format('%s.%s', rel.nspname, rel.relname);
    end if;
  end loop;
  if cardinality(foreign_owned) > 0 then
    raise warning 'least privilege: not changed, because the migration role cannot act for their owner: %', foreign_owned;
  end if;

  -- 2. The matrix. One row per table: privileges for anon, for authenticated,
  -- and the columns authenticated may update when it has no table-wide update.
  for m in
    select * from (values
      ('admin_audit_log',                 '',       'select',                         ''),
      ('announcements',                   '',       'select, insert, update, delete', ''),
      ('archive_items',                   'select', 'select, insert, update, delete', ''),
      ('attendance_eligibility',          '',       'select, insert, update',         ''),
      ('attendance_excuses',              '',       'select',                         ''),
      ('attendance_record_audit',         '',       'select',                         ''),
      ('attendance_records',              '',       'select',                         ''),
      ('attendance_remediations',         '',       'select',                         ''),
      ('attendance_session_participants', '',       'select',                         ''),
      ('attendance_sessions',             '',       'select',                         ''),
      ('attendance_settings',             '',       'select',                         ''),
      ('events',                          '',       'select, insert, update, delete', ''),
      ('finance_audit_log',               '',       'select',                         ''),
      ('finance_claim_documents',         '',       'select, insert',                 ''),
      ('finance_documents',               '',       'select, insert',                 ''),
      ('finance_expense_documents',       '',       'select, insert',                 ''),
      ('finance_expenses',                '',       'select',                         ''),
      ('finance_payments',                '',       'select',                         ''),
      ('finance_reimbursement_documents', '',       'select, insert',                 ''),
      ('funding_claim_expenses',          '',       'select',                         ''),
      ('funding_claims',                  '',       'select',                         ''),
      ('member_deactivations',            '',       'select',                         ''),
      ('personal_reimbursements',         '',       'select',                         ''),
      ('profiles',                        '',       'select',                         'full_name, phone, class_year, specialty'),
      ('recording_notes',                 '',       'select, insert, update, delete', ''),
      ('recordings',                      '',       'select, insert, update, delete', ''),
      ('resource_imports',                '',       'select, insert, update',         ''),
      ('resource_links',                  '',       'select',                         ''),
      ('resource_tag_assignments',        '',       'select',                         ''),
      ('resource_tags',                   '',       'select',                         ''),
      ('resources',                       '',       'select, insert, update, delete', ''),
      ('subgroup_memberships',            '',       'select',                         ''),
      ('subgroups',                       '',       'select',                         ''),
      ('transactions',                    '',       'select',                         '')
    ) as t(tbl, anon_priv, auth_priv, auth_update_cols)
  loop
    if to_regclass(format('public.%I', m.tbl)) is null then
      skipped := skipped || m.tbl;
      continue;
    end if;
    -- A listed table owned by a role this one cannot act for was reported above and is left alone.
    if ('public.' || m.tbl) = any (foreign_owned) then continue; end if;
    listed := listed || ('public.' || m.tbl);
    if m.anon_priv <> '' then
      execute format('grant %s on table public.%I to anon', m.anon_priv, m.tbl);
    end if;
    if m.auth_priv <> '' then
      execute format('grant %s on table public.%I to authenticated', m.auth_priv, m.tbl);
    end if;
    if m.auth_update_cols <> '' then
      select string_agg(format('%I', btrim(c)), ', ') into col_list from unnest(string_to_array(m.auth_update_cols, ',')) c;
      execute format('grant update (%s) on table public.%I to authenticated', col_list, m.tbl);
    end if;
  end loop;

  select coalesce(array_agg(t order by t), '{}') into unlisted from unnest(closed) t where t <> all (listed);
  if cardinality(skipped) > 0 then
    raise notice 'least privilege: matrix tables not present in this database (skipped): %', skipped;
  end if;
  if cardinality(unlisted) > 0 then
    raise notice 'least privilege: tables that are not in the matrix and are now closed to anon and authenticated: %', unlisted;
  end if;

  -- 3. Sequences: close them all, then give back USAGE only where a column
  -- default calls nextval() on a table the role can insert into.
  for rel in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind = 'S' and pg_has_role(current_user, c.relowner, 'USAGE')
    order by 1, 2
  loop
    execute format('revoke all on sequence %I.%I from public, anon, authenticated', rel.nspname, rel.relname);
  end loop;

  for rel in
    select distinct sn.nspname as seq_schema, s.relname as seq_name, r.rolname as grantee
    from pg_depend d
    join pg_attrdef ad on ad.oid = d.objid
    join pg_class t on t.oid = ad.adrelid
    join pg_namespace tn on tn.oid = t.relnamespace
    join pg_class s on s.oid = d.refobjid and s.relkind = 'S'
    join pg_namespace sn on sn.oid = s.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(rolname)
    where d.classid = 'pg_attrdef'::regclass and d.refclassid = 'pg_class'::regclass
      and tn.nspname in ('public', 'private') and sn.nspname in ('public', 'private')
      and has_any_column_privilege(r.rolname, t.oid, 'insert')
      and pg_has_role(current_user, s.relowner, 'USAGE')
    order by 1, 2, 3
  loop
    execute format('grant usage on sequence %I.%I to %I', rel.seq_schema, rel.seq_name, rel.grantee);
  end loop;
end
$grants$;

-- 4. Tables and sequences that postgres creates later no longer start out open
-- to anon and authenticated. service_role keeps its default. Functions are not
-- changed (see above).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
