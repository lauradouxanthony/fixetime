-- Ajoute la contrainte UNIQUE manquante sur emails.gmail_message_id
-- Sans cette contrainte, l'upsert onConflict:"gmail_message_id" échoue avec
-- erreur PostgreSQL 42P10 et aucun email n'est inséré.
-- Idempotent : DO $$...IF NOT EXISTS évite l'erreur si déjà présente

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emails_gmail_message_id_key'
  ) THEN
    ALTER TABLE public.emails
    ADD CONSTRAINT emails_gmail_message_id_key UNIQUE (gmail_message_id);
  END IF;
END $$;
