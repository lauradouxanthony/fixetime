-- FIX 5 : Champs FAQ par bien (animaux, parking, charges, meublé, disponibilité, notes)
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS animaux_acceptes BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS parking_inclus BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS charges_mensuelles INTEGER,
  ADD COLUMN IF NOT EXISTS meuble BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS disponible_a_partir_de DATE,
  ADD COLUMN IF NOT EXISTS notes_specifiques TEXT;
