-- BLOC 6 : Colonnes pour les relances automatiques
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS relance_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_relance_at TIMESTAMPTZ;

-- Index pour la requête cron (prospects sans réponse)
CREATE INDEX IF NOT EXISTS idx_emails_relance
  ON public.emails(user_id, category, relance_count, last_relance_at)
  WHERE category = 'LOCATION' AND is_archived = false;
