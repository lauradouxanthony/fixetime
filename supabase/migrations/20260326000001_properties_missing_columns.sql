-- Colonnes manquantes sur properties
-- type, description, available n'avaient pas été créées lors de la migration initiale

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS available BOOLEAN DEFAULT TRUE;

-- Tous les biens existants sont disponibles par défaut
UPDATE public.properties SET available = TRUE WHERE available IS NULL;
