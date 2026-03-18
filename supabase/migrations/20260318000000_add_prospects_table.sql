-- Migration : table prospects (modèle prospect-centrique)
-- Chaque prospect = une personne unique (clé: user_id + email)
-- Les emails pointent vers leur prospect via prospect_id

CREATE TABLE IF NOT EXISTS public.prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identité (clé de déduplication = email)
  email TEXT NOT NULL,
  nom TEXT,
  prenom TEXT,
  telephone TEXT,

  -- Qualification
  situation_pro TEXT,  -- 'CDI' | 'CDD' | 'AUTO_ENTREPRENEUR' | 'ETUDIANT' | 'RETRAITE' | 'autre'
  revenus_mensuels NUMERIC,
  garant BOOLEAN DEFAULT FALSE,
  garant_revenus NUMERIC,
  nb_personnes INTEGER,
  animaux BOOLEAN DEFAULT FALSE,

  -- Pipeline
  etape_process TEXT NOT NULL DEFAULT 'NEW',
  -- NEW | QUALIFICATION | VISITE_PROPOSEE | VISITE_CONFIRMEE
  -- | DOSSIER_DEMANDE | DOSSIER_RECU | VALIDE | REFUSE

  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  lead_score INTEGER DEFAULT 0,

  -- Visites
  visite_date TIMESTAMPTZ,
  visite_status TEXT,  -- 'proposee' | 'confirmee' | 'effectuee' | 'annulee'

  -- Relances
  relance_count INTEGER DEFAULT 0,
  last_relance_at TIMESTAMPTZ,
  last_reply_at TIMESTAMPTZ,

  -- Statut dossier
  dossier_complet BOOLEAN DEFAULT FALSE,
  dossier_validated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id, email)
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_prospects_user_etape ON public.prospects(user_id, etape_process);
CREATE INDEX IF NOT EXISTS idx_prospects_user_email ON public.prospects(user_id, email);
CREATE INDEX IF NOT EXISTS idx_prospects_property ON public.prospects(property_id) WHERE property_id IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.handle_prospects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prospects_updated_at
  BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.handle_prospects_updated_at();

-- RLS
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prospects_user_isolation" ON public.prospects
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ajouter prospect_id sur emails
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS prospect_id UUID REFERENCES public.prospects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emails_prospect_id ON public.emails(prospect_id)
  WHERE prospect_id IS NOT NULL;
