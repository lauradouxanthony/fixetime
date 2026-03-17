alter table gmail_tokens
  add column if not exists needs_reconnect boolean not null default false;

