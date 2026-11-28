-- Phase 4.4, P3-01 (migration 20261128030600): every storage bucket enforces a size limit and a list of
-- file types on the server, and no screen's upload is refused by them.
--
-- The Storage service (not the database) checks an upload against the bucket row. This test therefore
--   A. pins the rows: private, with a limit and a list, the values of the migration;
--   B. replays the service's rule for a type (an exact match, or `type/*`) over the types each screen really
--      sends, and over the types that must never be stored (the ones that run in a browser);
--   C. checks the limits are not below what a screen already lets a person upload (finance 10 MiB, proofs 8 MiB);
--   D. checks the migration is idempotent and puts a bucket back when someone changed it in the dashboard.
begin;

-- storage-api: an allowed type ending in /* admits every subtype of that type; any other entry must equal the type sent
create function test.m77b_accepts(p_bucket text, p_type text) returns boolean language sql as $$
  select coalesce((
    select b.allowed_mime_types is null or exists (
      select 1 from unnest(b.allowed_mime_types) a
      where case when a like '%/*' then starts_with(p_type, left(a, length(a) - 1)) else a = p_type end)
    from storage.buckets b where b.id = p_bucket), false);
$$;

do $$
declare
  b record;
  t text;
  problems text[] := '{}';
  -- what each screen sends (the browser's File.type, MediaRecorder's type, or octet-stream for an unknown file)
  recordings_types text[] := array['audio/webm;codecs=opus', 'audio/webm', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
                                   'audio/x-m4a', 'audio/ogg;codecs=opus', 'audio/aac', 'audio/flac', 'video/quicktime'];
  notation_types text[] := array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/png', 'image/jpeg'];
  resource_types text[] := array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/msword', 'text/csv', 'text/plain', 'image/jpeg', 'image/png', 'image/heic',
                                 'image/webp', 'image/gif', 'audio/mpeg', 'video/mp4', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream',
                                 'application/vnd.recordare.musicxml+xml'];
  finance_types text[] := array['application/pdf', 'image/jpeg', 'image/png'];
  excuse_types text[] := array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  -- what must never be stored, in any bucket
  never_types text[] := array['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/javascript', 'text/javascript', 'application/x-msdownload', 'application/x-sh',
                              'application/x-httpd-php', 'text/x-python', 'application/java-archive', 'application/x-msdos-program', 'application/vnd.microsoft.portable-executable'];
begin
  -- A. the rows -------------------------------------------------------------------------------------------
  assert (select count(*) from storage.buckets) = 6, 'six buckets: ' || (select string_agg(id, ', ') from storage.buckets);
  for b in select * from storage.buckets order by id loop
    if b.public then problems := problems || (b.id || ' is public'); end if;
    if b.file_size_limit is null or b.file_size_limit <= 0 then problems := problems || (b.id || ' has no size limit'); end if;
    if b.allowed_mime_types is null or cardinality(b.allowed_mime_types) = 0 then problems := problems || (b.id || ' has no type list'); end if;
  end loop;
  if cardinality(problems) > 0 then raise exception 'BUCKETS: %', array_to_string(problems, '; '); end if;
  assert (select file_size_limit from storage.buckets where id = 'club-archive') = 500 * 1024 * 1024;
  assert (select file_size_limit from storage.buckets where id = 'recordings') = 500 * 1024 * 1024;
  assert (select file_size_limit from storage.buckets where id = 'recording-notations') = 25 * 1024 * 1024;
  assert (select file_size_limit from storage.buckets where id = 'club-resources') = 100 * 1024 * 1024;
  assert (select file_size_limit from storage.buckets where id = 'finance-private') = 10 * 1024 * 1024, 'finance-private is as it was';
  assert (select file_size_limit from storage.buckets where id = 'attendance-excuses') = 8 * 1024 * 1024, 'attendance-excuses is as it was';
  assert (select allowed_mime_types from storage.buckets where id = 'club-archive') = array['audio/*', 'video/*'];
  assert (select allowed_mime_types from storage.buckets where id = 'recordings') = array['audio/*', 'video/*'];
  assert (select allowed_mime_types from storage.buckets where id = 'finance-private') = array['application/pdf', 'image/jpeg', 'image/png'], 'finance-private types are as they were';

  -- B. every type a screen sends is accepted by the bucket it goes to -----------------------------------------
  foreach t in array recordings_types loop
    if not test.m77b_accepts('recordings', t) then problems := problems || ('recordings refuses ' || t); end if;
    if not test.m77b_accepts('club-archive', t) then problems := problems || ('club-archive refuses ' || t); end if;
  end loop;
  foreach t in array notation_types loop
    if not test.m77b_accepts('recording-notations', t) then problems := problems || ('recording-notations refuses ' || t); end if;
  end loop;
  foreach t in array resource_types loop
    if not test.m77b_accepts('club-resources', t) then problems := problems || ('club-resources refuses ' || t); end if;
  end loop;
  foreach t in array finance_types loop
    if not test.m77b_accepts('finance-private', t) then problems := problems || ('finance-private refuses ' || t); end if;
  end loop;
  foreach t in array excuse_types loop
    if not test.m77b_accepts('attendance-excuses', t) then problems := problems || ('attendance-excuses refuses ' || t); end if;
  end loop;
  if cardinality(problems) > 0 then raise exception 'BUCKETS, a screen would be refused: %', array_to_string(problems, '; '); end if;

  -- ... and the types that run in a browser or on a machine are refused by every bucket
  for b in select id from storage.buckets loop
    foreach t in array never_types loop
      if test.m77b_accepts(b.id, t) then problems := problems || (b.id || ' accepts ' || t); end if;
    end loop;
  end loop;
  if cardinality(problems) > 0 then raise exception 'BUCKETS, active content accepted: %', array_to_string(problems, '; '); end if;

  -- the buckets are not interchangeable: a type that belongs to another bucket is refused
  assert not test.m77b_accepts('recordings', 'application/pdf'), 'no pdf among recordings';
  assert not test.m77b_accepts('club-archive', 'application/pdf') and not test.m77b_accepts('club-archive', 'image/png'), 'the archive takes audio and video only';
  assert not test.m77b_accepts('recording-notations', 'audio/mpeg') and not test.m77b_accepts('recording-notations', 'video/mp4'), 'no media among notation files';
  assert not test.m77b_accepts('finance-private', 'video/mp4') and not test.m77b_accepts('finance-private', 'application/zip'), 'no media or archives among finance files';
  assert not test.m77b_accepts('attendance-excuses', 'application/pdf'), 'proofs are images';
  assert not test.m77b_accepts('club-resources', 'text/html') and not test.m77b_accepts('club-resources', 'image/svg+xml'), 'the library keeps out what runs in a browser, even with octet-stream allowed';
  -- the rule itself, on a few cases, so the replay above means something
  assert test.m77b_accepts('recordings', 'audio/webm;codecs=opus'), 'a wildcard admits parameterised types';
  assert not test.m77b_accepts('finance-private', 'application/pdf;charset=x'), 'an exact entry does not (the screens send plain types there)';
  assert not test.m77b_accepts('no-such-bucket', 'audio/mpeg'), 'a bucket that does not exist accepts nothing';

  -- C. sizes: not below what a screen already allows -------------------------------------------------------
  assert (select file_size_limit from storage.buckets where id = 'finance-private') >= 10 * 1024 * 1024, 'finance screens allow 10 MiB (MAX_FINANCE_DOCUMENT_BYTES)';
  assert (select file_size_limit from storage.buckets where id = 'attendance-excuses') >= 8 * 1024 * 1024, 'the proof image check allows 8 MiB';
  assert (select min(file_size_limit) from storage.buckets where id in ('club-archive', 'recordings', 'club-resources')) >= 100 * 1024 * 1024, 'media and library limits are at least 100 MiB';
end $$;

-- D. idempotent, and self-correcting ------------------------------------------------------------------------------
create temp table m77b_before as select id, public, file_size_limit, allowed_mime_types from storage.buckets;
\ir ../migrations/20261128030600_storage_bucket_limits.sql
do $$
begin
  assert (select count(*) from storage.buckets b join m77b_before p using (id) where b.public is not distinct from p.public and b.file_size_limit is not distinct from p.file_size_limit
          and b.allowed_mime_types is not distinct from p.allowed_mime_types) = 6, 'running the migration again changes nothing';
  -- someone opens a bucket and removes its limits in the dashboard
  update storage.buckets set public = true, file_size_limit = null, allowed_mime_types = null where id in ('club-resources', 'recordings', 'club-archive', 'recording-notations');
end $$;
\ir ../migrations/20261128030600_storage_bucket_limits.sql
do $$
begin
  assert (select count(*) from storage.buckets b join m77b_before p using (id) where b.public is not distinct from p.public and b.file_size_limit is not distinct from p.file_size_limit
          and b.allowed_mime_types is not distinct from p.allowed_mime_types) = 6, 'a run puts the four buckets back as they were: private, with limits';
  -- someone widens a list and raises a limit instead of removing them (a value that is set is put back too)
  update storage.buckets set allowed_mime_types = allowed_mime_types || array['text/html', 'image/svg+xml'], file_size_limit = 5368709120 where id in ('club-resources', 'recordings');
  update storage.buckets set allowed_mime_types = array['application/pdf'], file_size_limit = 1 where id = 'club-archive';
end $$;
\ir ../migrations/20261128030600_storage_bucket_limits.sql
do $$
begin
  assert (select count(*) from storage.buckets b join m77b_before p using (id) where b.public is not distinct from p.public and b.file_size_limit is not distinct from p.file_size_limit
          and b.allowed_mime_types is not distinct from p.allowed_mime_types) = 6, 'a run puts a widened list and a raised limit back as they were';
  -- the two earlier buckets are not touched by it
  update storage.buckets set file_size_limit = 1 where id = 'finance-private';
end $$;
\ir ../migrations/20261128030600_storage_bucket_limits.sql
do $$
begin
  assert (select file_size_limit from storage.buckets where id = 'finance-private') = 1, 'finance-private is left to its own migration';
end $$;

rollback;
