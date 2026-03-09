import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// Flag auto Vercel (true en prod Vercel, false en local)
const IS_VERCEL = process.env.VERCEL === "1";

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) {
  return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
}

    // URL dynamique : utilise l'origin de la requête entrante pour éviter les erreurs de port
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const cookie = req.headers.get("cookie") ?? "";

    // =========================
    // 1) SYNC GMAIL
    // =========================
    const syncPromise = fetch(`${baseUrl}/api/gmail/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: user.id,
      }),
      cache: "no-store",
    });
    

    let syncRes: Response | null = null;
    let syncJson: any = null;

    if (!IS_VERCEL) {
      // 👉 comportement EXACT comme avant en local
      syncRes = await syncPromise;
      syncJson = await syncRes.json().catch(() => ({}));

      if (!syncRes.ok) {
        return NextResponse.json(
          { error: "SYNC_FAILED", details: syncJson },
          { status: 500 }
        );
      }
    }

    // =========================
    // 2) ANALYSE IA
    // =========================
    const aiPromise = fetch(`${baseUrl}/api/ai/analyze-inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // ✅ clé interne pour authentification cron
        "x-fixetime-cron-key": process.env.FIXETIME_INTERNAL_CRON_KEY || "",
        // ✅ cookie de session transmis en fallback (auth server-to-server)
        ...(cookie ? { "cookie": cookie } : {}),
      },
      body: JSON.stringify({
        user_id: user.id,
        period: "30d",
      }),
      cache: "no-store",
    });
    
    

    let aiRes: Response | null = null;
    let aiJson: any = null;

    if (!IS_VERCEL) {
      // 👉 comportement EXACT comme avant en local
      aiRes = await aiPromise;
      aiJson = await aiRes.json().catch(() => ({}));

      if (!aiRes.ok) {
        return NextResponse.json(
          { error: "AI_ANALYZE_FAILED", details: aiJson, sync: syncJson },
          { status: 500 }
        );
      }
    }

    // =========================
    // 3) RÉPONSE
    // =========================
    return NextResponse.json({
      success: true,

      // En prod Vercel → juste un déclenchement
      started: IS_VERCEL,

      // En local → comportement inchangé
      sync: IS_VERCEL ? null : syncJson,
      ai: IS_VERCEL ? null : aiJson,
    });
  } catch (e) {
    console.error("ANALYZE_NOW_FATAL", e);
    return NextResponse.json({ error: "ANALYZE_NOW_FAILED" }, { status: 500 });
  }
}
