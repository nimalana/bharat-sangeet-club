do $$
begin
  create type public.recording_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists public.recordings (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null default '',
  subgroup_id bigint references public.subgroups(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  mime_type text not null default 'audio/webm',
  media_kind text not null default 'audio' check (media_kind in ('audio', 'video')),
  status public.recording_status not null default 'draft',
  audience text not null default 'subgroup' check (audience in ('subgroup', 'club', 'public')),
  recording_kind text not null default 'practice',
  event_date date,
  raga text,
  tala text,
  sruthi text,
  tempo text,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists recordings_subgroup_status_idx
  on public.recordings(subgroup_id, status, created_at desc);

create table if not exists public.recording_notes (
  id bigint generated always as identity primary key,
  recording_id bigint not null references public.recordings(id) on delete cascade,
  title text not null default 'Notation',
  note_type text not null check (note_type in ('text', 'file')),
  body text not null default '',
  storage_path text unique,
  mime_type text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists recording_notes_recording_idx
  on public.recording_notes(recording_id, created_at);

alter table public.recordings enable row level security;
alter table public.recording_notes enable row level security;

grant select, insert, update, delete on public.recordings, public.recording_notes to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "Members view accessible recordings"
on public.recordings for select to authenticated
using (
  private.is_executive()
  or uploaded_by = (select auth.uid())
  or (
    status = 'published'
    and (
      audience = 'club'
      or audience = 'public'
      or (
        audience = 'subgroup'
        and subgroup_id is not null
        and exists (
          select 1 from public.subgroup_memberships membership
          where membership.subgroup_id = recordings.subgroup_id
            and membership.member_id = (select auth.uid())
            and membership.status = 'active'
        )
      )
    )
  )
);

create policy "Members create subgroup recordings"
on public.recordings for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and subgroup_id is not null
  and exists (
    select 1 from public.subgroup_memberships membership
    where membership.subgroup_id = recordings.subgroup_id
      and membership.member_id = (select auth.uid())
      and membership.status = 'active'
  )
);

create policy "Members edit their recordings"
on public.recordings for update to authenticated
using (private.is_executive() or uploaded_by = (select auth.uid()))
with check (
  private.is_executive()
  or (
    uploaded_by = (select auth.uid())
    and subgroup_id is not null
    and exists (
      select 1 from public.subgroup_memberships membership
      where membership.subgroup_id = recordings.subgroup_id
        and membership.member_id = (select auth.uid())
        and membership.status = 'active'
    )
  )
);

create policy "Members delete their recordings"
on public.recordings for delete to authenticated
using (private.is_executive() or uploaded_by = (select auth.uid()));

create policy "Members view notation for accessible recordings"
on public.recording_notes for select to authenticated
using (exists (select 1 from public.recordings recording where recording.id = recording_notes.recording_id));

create policy "Members add notation to accessible recordings"
on public.recording_notes for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.recordings recording
    where recording.id = recording_notes.recording_id
      and (private.is_executive() or recording.uploaded_by = (select auth.uid()) or recording.status = 'published')
  )
);

create policy "Members edit their notation"
on public.recording_notes for update to authenticated
using (private.is_executive() or uploaded_by = (select auth.uid()))
with check (private.is_executive() or uploaded_by = (select auth.uid()));

create policy "Members delete their notation"
on public.recording_notes for delete to authenticated
using (private.is_executive() or uploaded_by = (select auth.uid()));

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('recording-notations', 'recording-notations', false)
on conflict (id) do nothing;

create policy "Members upload recordings"
on storage.objects for insert to authenticated
with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Members read accessible recordings"
on storage.objects for select to authenticated
using (
  bucket_id = 'recordings'
  and exists (
    select 1 from public.recordings recording
    where recording.storage_path = name
  )
);

create policy "Members update their recording files"
on storage.objects for update to authenticated
using (
  bucket_id = 'recordings'
  and exists (
    select 1 from public.recordings recording
    where recording.storage_path = name
      and (private.is_executive() or recording.uploaded_by = (select auth.uid()))
  )
)
with check (bucket_id = 'recordings');

create policy "Members delete their recording files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recordings'
  and exists (
    select 1 from public.recordings recording
    where recording.storage_path = name
      and (private.is_executive() or recording.uploaded_by = (select auth.uid()))
  )
);

create policy "Members upload recording notation"
on storage.objects for insert to authenticated
with check (bucket_id = 'recording-notations' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Members read accessible recording notation"
on storage.objects for select to authenticated
using (
  bucket_id = 'recording-notations'
  and exists (
    select 1 from public.recording_notes note
    where note.storage_path = name
  )
);

create policy "Members delete their recording notation"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recording-notations'
  and exists (
    select 1 from public.recording_notes note
    where note.storage_path = name
      and (private.is_executive() or note.uploaded_by = (select auth.uid()))
  )
);

insert into public.recordings (
  title, description, subgroup_id, uploaded_by, storage_path, mime_type, media_kind,
  status, audience, recording_kind, event_date, raga, tala, created_at, updated_at, published_at
)
select
  item.title,
  item.description,
  item.subgroup_id,
  item.uploaded_by,
  item.storage_path,
  case when item.storage_path ilike '%.mp4' then 'video/mp4' else 'audio/*' end,
  case when item.storage_path ilike '%.mp4' then 'video' else 'audio' end,
  'published',
  'subgroup',
  'performance',
  item.event_date,
  item.raga,
  item.tala,
  item.created_at,
  item.created_at,
  item.created_at
from public.archive_items item
where item.type = 'recording'
  and item.subgroup_id is not null
on conflict (storage_path) do nothing;
