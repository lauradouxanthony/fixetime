import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const userId = data.user.id;

  let agency_settings: any = null;
  let settings: any = null;

  // agency_settings (optionnel, ne doit jamais throw si table absente)
  try {
    const { data: agencyRow, error } = await supabaseAdmin
      .from("agency_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error) agency_settings = agencyRow ?? null;
  } catch {
    agency_settings = null;
  }

  // settings_v1 (optionnel)
  try {
    const { data: settingsRow, error } = await supabaseAdmin
      .from("settings_v1")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error) settings = settingsRow ?? null;
  } catch {
    settings = null;
  }

  return NextResponse.json({
    ok: true,
    agency_settings,
    settings,
  });
}

