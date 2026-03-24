-- ────────────────────────────────────────────────────────────────────────────
-- Migration : RLS sur les tables emails, settings_v1, gmail_tokens
-- Chaque utilisateur ne peut accéder qu'à ses propres lignes.
-- ────────────────────────────────────────────────────────────────────────────

-- RLS emails
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_emails"
  ON public.emails
  FOR ALL
  USING (user_id = auth.uid());

-- RLS settings_v1
ALTER TABLE public.settings_v1 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_settings"
  ON public.settings_v1
  FOR ALL
  USING (user_id = auth.uid());

-- RLS gmail_tokens
ALTER TABLE public.gmail_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_tokens"
  ON public.gmail_tokens
  FOR ALL
  USING (user_id = auth.uid());
