import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logActivity } from "@/lib/activity/logActivity";

export async function POST(req: Request) {
  const t0 = Date.now();
  console.log("[ANALYZE-NOW] ▶ Démarrée", new Date().toISOString());

  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const trigger = body?.trigger ?? "auto"; // "manual" | "auto"
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const cookie = req.headers.get("cookie") ?? "";

    console.log(`[ANALYZE-NOW] user=${user.id} trigger=${trigger}`);

    // =========================
    // 1) SYNC GMAIL — PRIORITAIRE : on attend qu'il finisse
    //    mode=quick pour refresh manuel (50 msgs INBOX, rapide)
    //    mode=full  pour cron (200 msgs, complet)
    // =========================
    const syncRes = await fetch(`${baseUrl}/api/gmail/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        mode: trigger === "manual" ? "quick" : "full",
      }),
      cache: "no-store",
    });

    const syncJson = await syncRes.json().catch(() => ({}));
    const syncMs = Date.now() - t0;

    if (!syncRes.ok) {
      console.error("[ANALYZE-NOW] ❌ Sync Gmail échoué:", syncJson);
    } else {
      console.log(
        `[ANALYZE-NOW] ✅ Sync Gmail OK en ${syncMs}ms — nouveaux=${syncJson.inserted ?? "?"} parcourus=${syncJson.fetched ?? "?"}`
      );
    }

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
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ user_id: user.id, period: "30d" }),
      cache: "no-store",
    }).then(async (aiRes) => {
      const aiJson = await aiRes.json().catch(() => ({}));
      console.log(`[ANALYZE-NOW] ✅ Analyse IA terminée: ${JSON.stringify(aiJson)}`);
    }).catch((err) => {
      console.error("[ANALYZE-NOW] ❌ Analyse IA erreur background:", err);
    });

    // =========================
    // 3) BACKFILL property_id — BACKGROUND : re-assigner les emails LOCATION sans bien
    // =========================
    fetch(`${baseUrl}/api/emails/backfill-property`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      cache: "no-store",
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if ((j.updated ?? 0) > 0) console.log(`[ANALYZE-NOW] Backfill property_id: ${j.updated} email(s) mis à jour`);
    }).catch(() => {});

    // =========================
    // 4) RÉPONSE IMMÉDIATE après sync
    // =========================
    return NextResponse.json({
      success: true,
      trigger,
      sync: syncJson,
      ai: "running_background",
    });

  } catch (e) {
    console.error("[ANALYZE-NOW] FATAL:", e);
    return NextResponse.json({ error: "ANALYZE_NOW_FAILED" }, { status: 500 });
  }
}

