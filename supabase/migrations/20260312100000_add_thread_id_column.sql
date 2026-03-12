-- Migration : thread_id pour la détection des fils de conversation Gmail
-- Permet de détecter si un email est une réponse dans un thread existant
-- et de merger le prospect_data accumulé sur tout le fil.

ALTER TABLE public.emails
ADD COLUMN IF NOT EXISTS thread_id TEXT;

CREATE INDEX IF NOT EXISTS idx_emails_thread_id
ON public.emails(thread_id)
WHERE thread_id IS NOT NULL;
