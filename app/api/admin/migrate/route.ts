/**
 * POST /api/admin/migrate
 * Endpoint one-shot pour appliquer les migrations manquantes sur Supabase.
 * Protégé par CRON_SECRET.
 *
 * Utilise la Supabase Management API si SUPABASE_ACCESS_TOKEN est défini.
 * Sinon, retourne le SQL à appliquer manuellement dans le SQL Editor Supabase.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PROJECT_REF = "ekyfnsshjntpslzpqein";

const MIGRATION_SQL = `
-- Step 1: Rename name→title (colonne actuelle = name, attendue = title)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='properties' AND column_name='name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='properties' AND column_name='title'
  ) THEN
    ALTER TABLE public.properties RENAME COLUMN name TO title;
  END IF;
END$$;

-- Step 2: Add missing columns
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS available BOOLEAN DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS required_docs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now() NOT NULL;

-- Step 3: RLS policy (idempotent)
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own properties" ON public.properties;
CREATE POLICY "Users can manage their own properties"
  ON public.properties
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Step 4: Add email columns
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relance_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_relance_at TIMESTAMPTZ;

-- Step 5: Indexes
CREATE INDEX IF NOT EXISTS idx_properties_user_id ON public.properties(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_property_id ON public.emails(property_id) WHERE property_id IS NOT NULL;

-- Step 6: prospect_timeline table
CREATE TABLE IF NOT EXISTS public.prospect_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email_id UUID REFERENCES public.emails(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prospect_timeline_email_id ON public.prospect_timeline(email_id);
CREATE INDEX IF NOT EXISTS idx_prospect_timeline_user_id ON public.prospect_timeline(user_id);
ALTER TABLE public.prospect_timeline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their timeline" ON public.prospect_timeline;
CREATE POLICY "Users can manage their timeline"
  ON public.prospect_timeline FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

SELECT 'Migration applied successfully' AS result;
`;

export async function POST(req: Request) {
  // Vérif auth
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json({
      error: "SUPABASE_ACCESS_TOKEN not set",
      instructions: "Add SUPABASE_ACCESS_TOKEN to .env.local (from https://supabase.com/dashboard/account/tokens)",
      sql: MIGRATION_SQL.trim(),
      manual_url: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql`,
    }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: MIGRATION_SQL }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: "Migration failed", details: data, sql: MIGRATION_SQL.trim() }, { status: 500 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    return NextResponse.json({ error: "Exception", message: err?.message, sql: MIGRATION_SQL.trim() }, { status: 500 });
  }
}

// GET retourne le SQL pour application manuelle
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    sql: MIGRATION_SQL.trim(),
    manual_url: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql`,
    columns_missing: ["title", "type", "description", "available", "required_docs", "updated_at", "prospect_timeline"],
  });
}
