-- Assure l'idempotence des insertions d'emails
-- Gmail : unicité (user_id, gmail_message_id)
alter table emails
  add constraint emails_user_gmail_unique
  unique (user_id, gmail_message_id);

-- Outlook / autres providers : unicité (user_id, provider, provider_message_id)
alter table emails
  add constraint emails_user_provider_msg_unique
  unique (user_id, provider, provider_message_id);

