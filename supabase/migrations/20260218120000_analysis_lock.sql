-- Lock global par user pour éviter 2 analyses en parallèle
-- Exécuter dans l’éditeur SQL Supabase si besoin.

create table if not exists public.analysis_lock (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locked_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.analysis_lock disable row level security;

comment on table public.analysis_lock is 'Lock anti-concurrence pour /api/ai/analyze-inbox : un seul run par user à la fois';

create index if not exists idx_analysis_lock_locked_until on public.analysis_lock(locked_until);
