import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const cookie = req.headers.get("cookie") ?? "";

    // =========================
    // 1) SYNC GMAIL — PRIORITAIRE : on attend qu'il finisse
    //    → les emails apparaissent immédiatement dans la liste
    // =========================
    const syncRes = await fetch(`${baseUrl}/api/gmail/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id }),
      cache: "no-store",
    });

    const syncJson = await syncRes.json().catch(() => ({}));

    if (!syncRes.ok) {
      console.error("[ANALYZE-NOW] Sync Gmail échoué:", syncJson);
      // On continue quand même pour l'analyse IA
    }

    console.log("[ANALYZE-NOW] Sync Gmail:", syncJson);

    // =========================
    // 2) ANALYSE IA — BACKGROUND : on ne bloque pas le retour
    //    → le frontend peut afficher les nouveaux emails de suite
    //    → l'IA classe en arrière-plan (~30-60s)
    // =========================
    fetch(`${baseUrl}/api/ai/analyze-inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fixetime-cron-key": process.env.FIXETIME_INTERNAL_CRON_KEY || "",
        ...(cookie ? { "cookie": cookie } : {}),
      },
      body: JSON.stringify({ user_id: user.id, period: "30d" }),
      cache: "no-store",
    }).then(async (aiRes) => {
      const aiJson = await aiRes.json().catch(() => ({}));
      console.log("[ANALYZE-NOW] Analyse IA terminée:", aiJson);
    }).catch((err) => {
      console.error("[ANALYZE-NOW] Analyse IA erreur background:", err);
    });

    // =========================
    // 3) RÉPONSE IMMÉDIATE après sync
    // =========================
    return NextResponse.json({
      success: true,
      sync: syncJson,
      ai: "running_background",
    });

  } catch (e) {
    console.error("ANALYZE_NOW_FATAL", e);
    return NextResponse.json({ error: "ANALYZE_NOW_FAILED" }, { status: 500 });
  }
}
