-- Piko Sounds — run once in Supabase SQL Editor
-- Storage: create a private bucket named "sounds" in Dashboard → Storage
-- (or rely on the Python service creating objects under that bucket name)

create extension if not exists "pgcrypto";

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

-- Service role bypasses RLS; keep RLS on for anon/authenticated clients.
alter table public.sounds enable row level security;

-- Optional: allow authenticated read if you later expose client-side access.
-- create policy "sounds_select_auth"
--   on public.sounds for select
--   to authenticated
--   using (true);
