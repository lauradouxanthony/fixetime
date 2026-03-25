-- RLS sur inbox_state
-- Était explicitement désactivé pour le dev (20260218100000_inbox_state.sql)
-- On l'active maintenant pour la production.

ALTER TABLE public.inbox_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_inbox_state"
  ON public.inbox_state
  FOR ALL
  USING (user_id = auth.uid());
