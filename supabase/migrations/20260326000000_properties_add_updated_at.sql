-- Ajoute la colonne updated_at manquante sur properties
-- (un trigger update_updated_at_column() référence NEW.updated_at
--  mais la colonne n'existait pas → erreur 42703 sur tout UPDATE)

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Mettre à jour les lignes existantes
UPDATE public.properties SET updated_at = NOW() WHERE updated_at IS NULL;
