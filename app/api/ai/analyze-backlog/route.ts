import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/analyze-backlog
 *
 * Lance un batch d'analyse immédiat sur les emails non analysés.
 * Utilisé par :
 * - UI "Analyser maintenant"
 * - Cron /api/cron/analyze-backlog
 *
 * Query/body : limit (number, default 20), user_id? (pour cron)
 */
// Appel UI manuel : session cookie présente, pas de user_id injecté dans le body
function isManualUiCall(req: Request, body: any): boolean {
  return !body?.user_id && !!req.headers.get("cookie");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const emailId = body?.email_id ?? body?.emailId ?? null;

    // Détecter si appel manuel depuis l'UI (pas cron)
    const isManualUi = isManualUiCall(req, body);

    // Cron/background : jusqu'à 50 emails, timeout long
    // UI manuelle : 3 emails max, timeout court (réponse rapide)
    const MANUAL_UI_LIMIT = 3;
    const MANUAL_UI_TIMEOUT_MS = 15000;
    const CRON_TIMEOUT_MS = 85000;

    const limit = isManualUi
      ? MANUAL_UI_LIMIT
      : Math.min(Math.max(1, Number(body?.limit) || 20), 50);
    const timeoutMs = isManualUi ? MANUAL_UI_TIMEOUT_MS : CRON_TIMEOUT_MS;

    let userId: string | null = body?.user_id ?? null;

    if (!userId) {
      const supabase = await supabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "NO_USER" }, { status: 401 });
      }
      userId = user.id;
    }

    // Si assistant désactivé, ne pas lancer l'analyse (spec)
    const { data: settings } = await supabaseAdmin
      .from("settings_v1")
      .select("assistant_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if ((settings as any)?.assistant_enabled === false) {
      return NextResponse.json({
        success: true,
        analyzed: 0,
        skipped: true,
        reason: "assistant_disabled",
      });
    }

    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    const res = await fetchWithTimeout(
      `${origin}/api/ai/analyze-inbox`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fixetime-analyze-now": "true",
          cookie,
        },
        body: JSON.stringify({
          user_id: userId,
          limit: emailId ? 1 : limit,
          period: "30d",
          force: !!emailId,
          email_id: emailId || undefined,
        }),
        timeoutMs,
      }
    );

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return NextResponse.json(
        { error: "ANALYZE_BACKLOG_FAILED", details: json },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      analyzed: json?.analyzed ?? 0,
      skipped: json?.skipped ?? 0,
      remaining: json?.remaining ?? null,
      duration_ms: json?.duration_ms ?? null,
      ...(emailId && { email_id: emailId }),
    });
  } catch (e: any) {
    console.error("[ANALYZE-BACKLOG]", e);
    return NextResponse.json(
      { error: "ANALYZE_BACKLOG_FAILED", message: e?.message },
      { status: 500 }
    );
  }
}
