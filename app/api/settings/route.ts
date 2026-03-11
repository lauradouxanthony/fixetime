import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// NOTE : la table settings_v1 a les colonnes suivantes (confirmé) :
//   user_id, theme, automation_level, assistant_enabled, email_rules (JSONB)
//
// pipeline_mode n'existe PAS comme colonne dédiée → on le stocke dans email_rules.pipeline_mode
// et on le retourne comme champ top-level dans la réponse GET pour la compatibilité client.

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      console.warn("[SETTINGS GET] Non authentifié");
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("settings_v1")
      .select("theme, automation_level, assistant_enabled, email_rules")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[SETTINGS GET] Erreur Supabase:", error);
      return NextResponse.json({ error: "settings_error", details: error.message }, { status: 500 });
    }

    if (!data) {
      console.log("[SETTINGS GET] Aucune ligne pour user:", user.id, "→ retour {}");
      return NextResponse.json({});
    }

    // pipeline_mode est stocké dans email_rules.pipeline_mode (pas de colonne dédiée)
    const emailRules = (data.email_rules && typeof data.email_rules === "object")
      ? data.email_rules as Record<string, unknown>
      : {};
    const pipeline_mode = (emailRules.pipeline_mode as string) ?? "DRAFT";

    const response = { ...data, pipeline_mode };

    // Logs demandés pour debug
    console.log("GET retourne:", response);
    console.log("[SETTINGS GET] email_rules keys:", Object.keys(emailRules));

    return NextResponse.json(response);
  } catch (e) {
    console.error("[SETTINGS GET] Erreur interne:", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      console.warn("[SETTINGS POST] Non authentifié");
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const body = await req.json();

    // Logs demandés pour debug
    console.log("POST reçu:", body);
    console.log("[SETTINGS POST] user:", user.id, "| keys:", Object.keys(body));

    // Colonnes qui existent réellement dans settings_v1
    const updates: Record<string, unknown> = {};
    if (body.theme !== undefined) updates.theme = body.theme;
    if (body.automation_level !== undefined) updates.automation_level = body.automation_level;
    if (body.assistant_enabled !== undefined) updates.assistant_enabled = body.assistant_enabled;

    // pipeline_mode est un champ virtuel → stocké dans email_rules
    const hasPipelineMode = body.pipeline_mode !== undefined;
    const hasEmailRules   = body.email_rules !== undefined;

    if (hasPipelineMode || hasEmailRules) {
      // Lire les règles actuelles en base
      const { data: existing } = await supabaseAdmin
        .from("settings_v1")
        .select("email_rules")
        .eq("user_id", user.id)
        .maybeSingle();

      const existingRules = (existing?.email_rules && typeof existing.email_rules === "object")
        ? existing.email_rules as Record<string, unknown>
        : {};

      const incomingRules = (hasEmailRules && typeof body.email_rules === "object")
        ? body.email_rules as Record<string, unknown>
        : {};

      const pipelineMerge = hasPipelineMode ? { pipeline_mode: body.pipeline_mode } : {};

      updates.email_rules = { ...existingRules, ...incomingRules, ...pipelineMerge };
      console.log("[SETTINGS POST] email_rules après merge:", Object.keys(updates.email_rules as object));
    }

    if (Object.keys(updates).length === 0) {
      console.warn("[SETTINGS POST] Aucune mise à jour à effectuer");
      return NextResponse.json({ success: true, noop: true });
    }

    const { error } = await supabaseAdmin
      .from("settings_v1")
      .upsert(
        { user_id: user.id, ...updates },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[SETTINGS POST] Erreur upsert:", error);
      return NextResponse.json({ error: "update_failed", details: error.message }, { status: 500 });
    }

    console.log("[SETTINGS POST] ✅ Sauvegardé avec succès pour user:", user.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[SETTINGS POST] Erreur interne:", e);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
}
