-- Ajoute la contrainte UNIQUE manquante sur emails.gmail_message_id
-- Sans cette contrainte, l'upsert onConflict:"gmail_message_id" échoue avec
-- erreur PostgreSQL 42P10 et aucun email n'est inséré.

ALTER TABLE public.emails
ADD CONSTRAINT emails_gmail_message_id_key UNIQUE (gmail_message_id);
