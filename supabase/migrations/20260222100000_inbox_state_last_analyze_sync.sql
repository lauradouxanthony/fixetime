-- Colonnes last_analyze_at et last_sync_at pour inbox_state
-- Exécuter dans l'éditeur SQL Supabase si besoin.

alter table public.inbox_state add column if not exists last_analyze_at timestamptz null;
alter table public.inbox_state add column if not exists last_sync_at timestamptz null;

comment on column public.inbox_state.last_analyze_at is 'Dernière passe d''analyse IA réussie';
comment on column public.inbox_state.last_sync_at is 'Dernière sync inbox (Gmail/Outlook)';

