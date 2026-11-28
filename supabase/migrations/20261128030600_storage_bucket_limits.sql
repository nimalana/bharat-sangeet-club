-- Phase 4.4, P3-01: every storage bucket enforces a size limit and a list of file types on the server.
--
-- RELEASE ORDER: apply AFTER the new frontend is live (section "Apply after the frontend is live" of
-- docs/RELEASE_ORDER.md). It refuses uploads the deployed screens still let a person start: a file over
-- a limit, or of a type that is not on a list. Nothing already stored is touched (a bucket limit applies
-- to new uploads only), and nothing a screen offers by its own `accept` list or size check is refused.
--
-- What was open (register P3-01, confirmed live): `club-archive` "is private but has no server-enforced size
-- or MIME restrictions", and so did `club-resources`, `recordings` and `recording-notations`. Only
-- `finance-private` (10 MiB, pdf/jpeg/png: 20260812193000) and `attendance-excuses` (8 MiB, images:
-- 20260813000000) had limits. The screens check some of this in the browser (finance 10 MiB, proof images 8 MiB,
-- `accept` lists); a browser check is a convenience, anyone with a session can call the Storage API
-- directly, so the bucket is where it is enforced.
--
-- The limits and lists below were chosen from what the code uploads, so that no screen breaks (the table
-- is also in 77_storage_bucket_limits.test.sql, which checks the types each screen produces):
--
--   bucket               limit     types                                        written by
--   club-archive         500 MiB   audio/*, video/*                             the archive dialog (accept audio/*,video/*)
--   recordings           500 MiB   audio/*, video/*                             the studio: MediaRecorder takes
--                                                                               (audio/webm;codecs=opus ...) and chosen files
--   recording-notations  25 MiB    pdf, doc, docx, txt, png, jpeg               the studio (accept .pdf .doc .docx .txt .png .jpg)
--   club-resources       100 MiB   the document, image, audio, video, archive   the resource library: any file, any folder;
--                                  and notation types listed below, and         a type the browser does not know is sent as
--                                  application/octet-stream                     application/octet-stream
--   finance-private      10 MiB    pdf, jpeg, png                               unchanged (already set)
--   attendance-excuses   8 MiB     images                                       unchanged (already set)
--
-- Why wildcards for audio and video: a browser reports a recorded take as `audio/webm;codecs=opus` or
-- `video/webm;codecs=vp9,opus`; the Storage service compares the type before the `;`-parameters only for a
-- `type/*` entry, so a list of exact types would refuse the studio's own recordings.
-- Why application/octet-stream is on the resource list: the library accepts any file, and a file whose type
-- the browser does not know (a score from a notation program, a .mscz) is sent as octet-stream. What the list
-- does keep out of that bucket is the types that run in a browser (text/html, image/svg+xml, javascript,
-- xhtml) and executables, named by what they claim to be; it is a second line, signed downloads are the first.
-- Why images are listed one by one on the resource list: `image/*` would admit image/svg+xml.
--
-- The sizes are proposals sized to what a choir recording or a score library needs, not measured from the
-- production buckets (not readable from here): see "open decisions" in the phase report. A project-wide
-- upload limit set in the Supabase dashboard (Storage settings) still applies on top: the smaller wins.
--
-- Idempotent and self-correcting: each bucket is upserted, so a run restores the values below if someone
-- changed them in the dashboard, and `public` is forced to false for the four club buckets.
-- Tests: 77_storage_bucket_limits.test.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('club-archive', 'club-archive', false, 524288000, array['audio/*', 'video/*']),
  ('recordings', 'recordings', false, 524288000, array['audio/*', 'video/*']),
  ('recording-notations', 'recording-notations', false, 26214400, array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'image/png', 'image/jpeg']),
  ('club-resources', 'club-resources', false, 104857600, array[
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/tiff', 'image/bmp',
    'audio/*', 'video/*',
    'application/zip', 'application/x-zip-compressed',
    'application/vnd.recordare.musicxml', 'application/vnd.recordare.musicxml+xml',
    'application/octet-stream'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
