-- Curseur inbox par user (pageToken Gmail) pour éviter de relire la même page.
-- Exécuter dans l’éditeur SQL Supabase si besoin.

create table if not exists public.inbox_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'google',
  cursor text null,
  updated_at timestamptz not null default now()
);

-- Pour éviter les surprises en dev, désactiver RLS (simple)
alter table public.inbox_state disable row level security;

comment on table public.inbox_state is 'Curseur de sync inbox par user (pageToken Gmail). Relu au début, mis à jour à la fin.';
