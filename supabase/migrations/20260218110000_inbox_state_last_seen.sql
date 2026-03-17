-- Mode "NEW MAILS FIRST": seuil temporel pour ne ingérer que les messages plus récents que le dernier run.
-- Exécuter dans l’éditeur SQL Supabase si besoin.

alter table public.inbox_state add column if not exists last_seen_at timestamptz;
alter table public.inbox_state add column if not exists last_seen_gmail_internal_ms bigint;

comment on column public.inbox_state.last_seen_at is 'Dernière date (ISO) vue côté app, dérivée de last_seen_gmail_internal_ms';
comment on column public.inbox_state.last_seen_gmail_internal_ms is 'Max internalDate (epoch ms) Gmail vu au dernier run; filtrer messages où internalDate > cette valeur';
