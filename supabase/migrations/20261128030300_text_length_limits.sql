-- Phase 4.3 / 4.4: upper bounds on free-text columns that had none (a member or a script could store a
-- multi-megabyte "title"; every list screen then downloads it).
--
-- RELEASE ORDER: apply AFTER the new frontend is live (section "Apply after the frontend is live" of
-- docs/RELEASE_ORDER.md). It refuses text the deployed screens still accept: a few textareas have no
-- maxLength (a recording or event description, the treasurer's note and the schedule of a purchase, a
-- notation text). Every limit below is above anything a screen's maxLength allows (the table is in this
-- header), so only a pasted wall of text is refused, but the refusal reaches the person as an error toast.
--
-- MANUAL STEP, not part of this migration: the constraints are added NOT VALID, so they are enforced for
-- every new row and every changed row from now on and no existing row is scanned (production cannot be
-- read from here). A NOT VALID check is also enforced on an UPDATE of an old row, so an old row that is
-- already over a limit cannot be edited until it is shortened. Find them, shorten them, validate:
--
--   select c.conrelid::regclass as table_name, c.conname,
--          (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s where not (%s)',
--             c.conrelid::regclass, pg_get_expr(c.conbin, c.conrelid)), false, true, '')))[1]::text::int as rows_over_limit
--   from pg_constraint c
--   where c.contype = 'c' and not c.convalidated and c.conname like '%\_max\_length'
--   order by 1, 2;
--
--   alter table public.<table> validate constraint <name>;     -- takes a SHARE UPDATE EXCLUSIVE lock, reads allowed
--
-- The limits (characters, `char_length`), and what the screens allow today:
--   names and titles     archive_items.title, events.title, recordings.title, recording_notes.title,
--                        attendance_sessions.title                200   (screens: 160)
--                        subgroups.name                           120   (screens: 80 and 120; update_subgroup already enforces 120)
--   descriptions         archive_items.description, events.description, recordings.description,
--                        subgroups.description                    2000  (screens: 1000 and 2000; update_subgroup enforces 2000)
--   short labels         archive_items.raga/tala, recordings.raga/tala/sruthi/tempo/recording_kind,
--                        finance_payments.category                80
--                        events.location, finance_expenses.vendor/event_name,
--                        finance_payments.counterparty, funding_claims.funder_name,
--                        profiles.full_name, profiles.specialty   200   (screens: vendor 200)
--                        finance_payments.account_name, funding_claims.award_reference/heellife_reference,
--                        resources.season_label                   120
--                        profiles.phone, profiles.class_year, attendance_eligibility.term_key   40
--   reasons and notes    attendance_records.note, attendance_remediations.assignment/note, attendance_sessions.cancel_reason,
--                        attendance_excuses.review_note, attendance_eligibility.reason,
--                        finance_expenses.void_reason, finance_payments.void_reason, funding_claims.void_reason,
--                        personal_reimbursements.void_reason      1000  (screens: 500, member note 1000)
--                        finance_expenses.notes/event_schedule, funding_claims.notes,
--                        personal_reimbursements.member_note/review_note   2000  (screens: 1000, some none)
--   notation text        recording_notes.body                     20000 (a screen: none)
--   file names, types    storage_path and proof_path columns      1024  (resources already: 1024)
--                        mime_type columns                        255   (resources already: 255)
--
-- Deliberately without a limit: the audit copies (admin_audit_log, finance_audit_log, attendance_record_audit.note)
-- repeat values that are limited at their source, and a limit there could make the audit insert, and so the
-- audited action, fail; profiles.email (copied from the sign-in account); transactions (legacy, writes closed).
-- profiles.full_name is limited, which also limits the name a new sign-up can carry (the sign-up trigger copies
-- it from the account metadata): a name over 200 characters makes the sign-up fail instead of being stored.
--
-- Columns that already have a limit (announcements, finance_documents.title, finance_expenses.description/category,
-- finance_payments.description, funding_claims.title, member_deactivations.reason, the resources family) are
-- not repeated. Safe to run twice. A table or column that does not exist here is skipped.
-- Tests: 77_text_length_limits.test.sql.

do $$
declare
  spec record;
  v_name text;
begin
  for spec in
    select * from (values
      ('archive_items',            'title',                200),
      ('archive_items',            'description',         2000),
      ('archive_items',            'raga',                  80),
      ('archive_items',            'tala',                  80),
      ('archive_items',            'storage_path',        1024),
      ('attendance_eligibility',   'term_key',              40),
      ('attendance_eligibility',   'reason',              1000),
      ('attendance_excuses',       'review_note',         1000),
      ('attendance_excuses',       'proof_path',          1024),
      ('attendance_records',       'note',                1000),
      ('attendance_remediations',  'assignment',          1000),
      ('attendance_remediations',  'note',                1000),
      ('attendance_sessions',      'title',                200),
      ('attendance_sessions',      'cancel_reason',       1000),
      ('events',                   'title',                200),
      ('events',                   'description',         2000),
      ('events',                   'location',             200),
      ('finance_documents',        'storage_path',        1024),
      ('finance_documents',        'mime_type',            255),
      ('finance_expenses',         'vendor',               200),
      ('finance_expenses',         'event_name',           200),
      ('finance_expenses',         'event_schedule',      2000),
      ('finance_expenses',         'notes',               2000),
      ('finance_expenses',         'void_reason',         1000),
      ('finance_payments',         'category',              80),
      ('finance_payments',         'account_name',         120),
      ('finance_payments',         'counterparty',         200),
      ('finance_payments',         'void_reason',         1000),
      ('funding_claims',           'funder_name',          200),
      ('funding_claims',           'award_reference',      120),
      ('funding_claims',           'heellife_reference',   120),
      ('funding_claims',           'notes',               2000),
      ('funding_claims',           'void_reason',         1000),
      ('personal_reimbursements',  'member_note',         2000),
      ('personal_reimbursements',  'review_note',         2000),
      ('personal_reimbursements',  'void_reason',         1000),
      ('profiles',                 'full_name',            200),
      ('profiles',                 'phone',                 40),
      ('profiles',                 'class_year',            40),
      ('profiles',                 'specialty',            200),
      ('recording_notes',          'title',                200),
      ('recording_notes',          'body',               20000),
      ('recording_notes',          'storage_path',        1024),
      ('recording_notes',          'mime_type',            255),
      ('recordings',               'title',                200),
      ('recordings',               'description',         2000),
      ('recordings',               'storage_path',        1024),
      ('recordings',               'mime_type',            255),
      ('recordings',               'recording_kind',        80),
      ('recordings',               'raga',                  80),
      ('recordings',               'tala',                  80),
      ('recordings',               'sruthi',                80),
      ('recordings',               'tempo',                 80),
      ('resources',                'season_label',         120),
      ('subgroups',                'name',                 120),
      ('subgroups',                'description',         2000)
    ) as s(tbl, col, max_chars)
  loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = spec.tbl and c.column_name = spec.col
    ) then
      raise notice 'text limit: %.% does not exist here, skipped', spec.tbl, spec.col;
      continue;
    end if;
    v_name := spec.tbl || '_' || spec.col || '_max_length';
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', spec.tbl)::regclass and conname = v_name
    ) then
      execute format('alter table public.%I add constraint %I check (char_length(%I) <= %s) not valid',
        spec.tbl, v_name, spec.col, spec.max_chars);
    end if;
  end loop;
end $$;
