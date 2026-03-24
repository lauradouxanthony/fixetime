-- ============================================================
-- Migration : table prospect_timeline
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prospect_timeline (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_id    UUID NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_timeline_email_id
  ON public.prospect_timeline(email_id);

CREATE INDEX IF NOT EXISTS idx_prospect_timeline_user_id
  ON public.prospect_timeline(user_id);

ALTER TABLE public.prospect_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_timeline"
  ON public.prospect_timeline
  FOR ALL USING (user_id = auth.uid());
