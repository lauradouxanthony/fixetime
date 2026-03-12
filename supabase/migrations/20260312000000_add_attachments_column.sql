-- Migration : ajouter la colonne attachments (JSONB) à la table emails
-- Stocke les métadonnées des pièces jointes Gmail détectées lors du sync
-- Format : [{filename, mimeType, attachmentId, size}]

ALTER TABLE public.emails
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
