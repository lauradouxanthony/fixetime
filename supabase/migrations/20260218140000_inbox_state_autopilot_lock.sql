-- Lock autopilot par user pour éviter runs concurrents
-- Exécuter dans l’éditeur SQL Supabase si besoin.

alter table public.inbox_state add column if not exists autopilot_locked_until timestamptz null;

comment on column public.inbox_state.autopilot_locked_until is 'Lock anti-concurrence pour /api/cron/autopilot-dispatch : un seul run par user à la fois';
