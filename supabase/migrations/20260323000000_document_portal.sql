-- ============================================================
-- Migration : portail de dépôt de documents prospects
-- ============================================================

CREATE TABLE IF NOT EXISTS public.document_portal_tokens (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id       UUID NOT NULL REFERENCES public.emails(id)
                 ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id)
                 ON DELETE CASCADE,
  token          UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  prospect_email TEXT,
  prospect_name  TEXT,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT
                 (now() + INTERVAL '7 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at   TIMESTAMPTZ,
  used_at        TIMESTAMPTZ
);

ALTER TABLE public.document_portal_tokens
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_manage_tokens"
  ON public.document_portal_tokens
  FOR ALL USING (user_id = auth.uid());

-- ── Storage bucket prospect-docs ──────────────────────────────
INSERT INTO storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prospect-docs', 'prospect-docs', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png',
        'image/webp','image/heic']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "agent_read_docs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'prospect-docs'
    AND auth.uid() IS NOT NULL
  );

-- Allow service role to upload (used by upload route via supabaseAdmin)
CREATE POLICY "service_upload_docs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'prospect-docs'
  );
