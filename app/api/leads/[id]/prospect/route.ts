import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ProspectData } from "@/types/email";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: emailId } = await params;

    // Auth
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // Vérifier que l'email appartient à l'utilisateur
    const { data: email, error: fetchError } = await supabaseAdmin
      .from("emails")
      .select("id, prospect_data")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !email) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    // Données entrantes
    const body = await req.json();
    const incoming: Partial<ProspectData> = body.prospect_data ?? body;

    // Merge non-destructif : ne pas écraser les champs déjà remplis
    const existing: Partial<ProspectData> = (email as any).prospect_data ?? {};
    const merged: ProspectData = { ...incoming };

    // Garder les valeurs existantes non-nulles sauf si l'utilisateur les a explicitement modifiées
    // (Le frontend envoie toutes les valeurs, donc on prend tout ce qui vient du frontend)
    // Pour un vrai merge non-destructif depuis l'IA, utiliser merge_mode: "ai"
    if (body.merge_mode === "ai") {
      for (const [k, v] of Object.entries(existing)) {
        const key = k as keyof ProspectData;
        if (v !== null && v !== undefined && v !== "") {
          (merged as any)[key] = v; // Garder existant si non-nul
        }
      }
    }

    // Sauvegarder
    const { error: updateError } = await supabaseAdmin
      .from("emails")
      .update({ prospect_data: merged })
      .eq("id", emailId);

    if (updateError) {
      console.error("[PROSPECT] Update error:", updateError);
      return NextResponse.json({ error: "UPDATE_FAILED", details: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, prospect_data: merged });
  } catch (err) {
    console.error("[PROSPECT] Error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: emailId } = await params;

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, prospect_data, sender, body, category")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (error || !email) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ prospect_data: (email as any).prospect_data ?? null });
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
