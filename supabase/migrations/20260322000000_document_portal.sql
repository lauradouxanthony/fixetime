-- ────────────────────────────────────────────────────────────────────────────
-- Portail de dépôt de documents prospects
-- ────────────────────────────────────────────────────────────────────────────

-- Table des tokens de portail
CREATE TABLE IF NOT EXISTS public.document_portal_tokens (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id       UUID NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token          UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  prospect_email TEXT,
  prospect_name  TEXT,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at   TIMESTAMPTZ,
  used_at        TIMESTAMPTZ
);

-- Index rapide sur le token (lookup portail public)
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_tokens_token
  ON public.document_portal_tokens(token);

-- Index sur email_id (check token existant depuis le drawer)
CREATE INDEX IF NOT EXISTS idx_portal_tokens_email_id
  ON public.document_portal_tokens(email_id, user_id);

-- RLS : chaque agent ne voit que ses propres tokens
ALTER TABLE public.document_portal_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_manage_tokens" ON public.document_portal_tokens
  FOR ALL USING (user_id = auth.uid());

-- ── Supabase Storage : bucket prospect-docs (accès privé) ────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prospect-docs',
  'prospect-docs',
  false,
  10485760,  -- 10 Mo max par fichier
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Les agents authentifiés peuvent lire les fichiers (les uploads passent par service role)
CREATE POLICY "agent_read_prospect_docs" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'prospect-docs' AND auth.uid() IS NOT NULL);
