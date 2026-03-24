-- Table activity_log pour Live Feed et Dashboard ROI
-- Ne depend pas de emails.body, source de verite pour les evenements.

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  actor text not null check (actor in ('ai', 'human', 'system')),
  type text not null,
  title text not null,
  email_id uuid null references public.emails(id) on delete set null,
  lead_id uuid null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_activity_log_user_created
  on public.activity_log (user_id, created_at desc);

create index if not exists idx_activity_log_type
  on public.activity_log (type);

create index if not exists idx_activity_log_email_id
  on public.activity_log (email_id) where email_id is not null;

alter table public.activity_log enable row level security;

create policy "activity_log_select_own"
  on public.activity_log for select
  using (auth.uid() = user_id);

create policy "activity_log_insert_own"
  on public.activity_log for insert
  with check (auth.uid() = user_id);

-- Pas de policy UPDATE/DELETE: les logs sont immuables.
-- Le service role (supabaseAdmin) bypass RLS.

-- Si la table existait deja sans lead_id:
alter table public.activity_log add column if not exists lead_id uuid null;
