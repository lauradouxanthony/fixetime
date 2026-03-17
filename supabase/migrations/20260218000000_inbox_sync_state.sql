-- Table de curseur de sync inbox par user/provider (sync incrémentale bornée).
-- Exécuter dans l’éditeur SQL Supabase si vous n’utilisez pas supabase migrate.

CREATE TABLE IF NOT EXISTS inbox_sync_state (
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  cursor text,
  last_sync_at timestamptz,
  last_status text CHECK (last_status IN ('ok', 'error', 'timeout')),
  last_error text,
  PRIMARY KEY (user_id, provider)
);

COMMENT ON TABLE inbox_sync_state IS 'Curseur de sync inbox (pageToken Gmail / deltaLink Graph) pour reprise incrémentale.';
