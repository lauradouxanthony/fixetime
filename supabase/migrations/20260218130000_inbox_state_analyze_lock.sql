-- Ajout colonne analyze_locked_until pour lock anti-concurrence analyze-inbox
-- Exécuter dans l’éditeur SQL Supabase si besoin.

alter table public.inbox_state add column if not exists analyze_locked_until timestamptz null;

comment on column public.inbox_state.analyze_locked_until is 'Lock anti-concurrence pour /api/ai/analyze-inbox : un seul run par user à la fois';
