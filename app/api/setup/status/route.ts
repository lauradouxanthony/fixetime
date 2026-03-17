import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SetupStatus = {
  google_connected: boolean;
  microsoft_connected: boolean;
  calendar_available: boolean;
  faq_count: number;
  properties_count: number;
  ready_for_autopilot: boolean;
  recommendations: string[];
};

/** GET /api/setup/status — statut onboarding pour "Ready for Autopilot". */
export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

  const userId = data.user.id;
  const recs: string[] = [];

  const [gmail, microsoft, settings, props] = await Promise.all([
    supabaseAdmin.from("gmail_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("microsoft_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("settings_v1").select("config").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("properties").select("id").eq("user_id", userId),
  ]);

  const google_connected = !!gmail?.data?.user_id;
  const microsoft_connected = !!microsoft?.data?.user_id;
  const calendar_available = google_connected || microsoft_connected;
  const faq_count = Array.isArray((settings?.data as any)?.config?.faq_items) ? (settings?.data as any).config.faq_items.length : 0;
  const properties_count = Array.isArray(props?.data) ? props.data.length : 0;

  if (!calendar_available) recs.push("Connecter au moins un compte (Google ou Microsoft) pour le calendrier.");
  if (faq_count < 5) recs.push(`Ajouter des entrées à la FAQ (recommandé: 5+, actuel: ${faq_count}).`);
  if (properties_count < 1) recs.push("Ajouter au moins un bien pour les visites LOCATION.");

  const ready_for_autopilot = calendar_available && properties_count >= 1;

  const status: SetupStatus = {
    google_connected,
    microsoft_connected,
    calendar_available,
    faq_count,
    properties_count,
    ready_for_autopilot,
    recommendations: recs,
  };

  return NextResponse.json(status);
}
