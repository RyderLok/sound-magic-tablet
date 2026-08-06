-- Piko Sounds — run in Supabase SQL Editor (idempotent; safe to re-run)
-- Required for iPad LocalPikoGateway (anon key) + Mac Python (service_role).

create extension if not exists "pgcrypto";

-- 1) Metadata table
create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null default 'sound',
  duration_ms integer not null default 0,
  sample_rate integer not null default 16000,
  upload_status text not null default 'uploaded'
    check (upload_status in ('uploaded', 'error')),
  storage_path text not null,
  source text not null default 'esp32',
  analysis jsonb null,
  brush jsonb null
);

create index if not exists sounds_created_at_idx
  on public.sounds (created_at desc);

alter table public.sounds enable row level security;

-- 2) Private storage bucket "sounds"
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sounds',
  'sounds',
  false,
  52428800, -- 50MB
  array['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3) Table policies (anon = iPad App / browser; service_role bypasses RLS)
drop policy if exists "sounds_select_anon" on public.sounds;
create policy "sounds_select_anon"
  on public.sounds for select
  to anon, authenticated
  using (true);

drop policy if exists "sounds_insert_anon" on public.sounds;
create policy "sounds_insert_anon"
  on public.sounds for insert
  to anon, authenticated
  with check (true);

drop policy if exists "sounds_update_anon" on public.sounds;
create policy "sounds_update_anon"
  on public.sounds for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "sounds_delete_anon" on public.sounds;
create policy "sounds_delete_anon"
  on public.sounds for delete
  to anon, authenticated
  using (true);

-- 4) Storage object policies for bucket "sounds"
drop policy if exists "sounds_objects_select_anon" on storage.objects;
create policy "sounds_objects_select_anon"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'sounds');

drop policy if exists "sounds_objects_insert_anon" on storage.objects;
create policy "sounds_objects_insert_anon"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'sounds');

drop policy if exists "sounds_objects_update_anon" on storage.objects;
create policy "sounds_objects_update_anon"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'sounds')
  with check (bucket_id = 'sounds');

drop policy if exists "sounds_objects_delete_anon" on storage.objects;
create policy "sounds_objects_delete_anon"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'sounds');
