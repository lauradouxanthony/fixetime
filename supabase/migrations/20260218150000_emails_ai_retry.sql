-- Colonnes pour retry OpenAI et tracking erreurs
-- Exécuter dans l’éditeur SQL Supabase si besoin.

alter table public.emails add column if not exists ai_retry_after timestamptz null;
alter table public.emails add column if not exists ai_timeout_count integer not null default 0;
alter table public.emails add column if not exists ai_error_count integer not null default 0;
alter table public.emails add column if not exists ai_last_error_at timestamptz null;

comment on column public.emails.ai_retry_after is 'Date après laquelle l''email peut être retraité après timeout/erreur OpenAI';
comment on column public.emails.ai_timeout_count is 'Nombre de timeouts OpenAI pour cet email';
comment on column public.emails.ai_error_count is 'Nombre d''erreurs OpenAI (non-timeout) pour cet email';
comment on column public.emails.ai_last_error_at is 'Date de la dernière erreur OpenAI';

create index if not exists idx_emails_ai_retry_after on public.emails(ai_retry_after) where ai_retry_after is not null;
