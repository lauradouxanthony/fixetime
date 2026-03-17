-- Lock anti-concurrence pour sync inbox (manual + cron)
-- Un seul run de sync par user à la fois.
alter table public.inbox_state
  add column if not exists sync_running_until timestamptz null,
  add column if not exists sync_trace_id text null;

comment on column public.inbox_state.sync_running_until is 'Lock: sync en cours jusqu''à ce timestamp (null = pas de sync)';
comment on column public.inbox_state.sync_trace_id is 'trace_id du run de sync en cours (pour les logs)';
