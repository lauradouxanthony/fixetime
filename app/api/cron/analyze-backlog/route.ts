import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 20;
const CRON_INTERVAL_DEV_SEC = 90;  // 1.5 min en dev
const CRON_INTERVAL_PROD_SEC = 150; // 2.5 min en prod

function isDev() {
  return process.env.NODE_ENV === "development";
}

/**
 * POST /api/cron/analyze-backlog
 *
 * Cron qui parcourt les users avec assistant_enabled=true et des emails non analysés,
 * et lance un batch d'analyse pour chacun.
 */
export async function POST(req: Request) {
  const startTime = Date.now();

  const cronKey = req.headers.get("x-fixetime-cron-key") ?? req.headers.get("x-cron-key");
  const expectedKey = process.env.FIXETIME_INTERNAL_CRON_KEY ?? "dev123";

  if (cronKey !== expectedKey) {
    return NextResponse.json(
      { success: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  // Users avec assistant activé
  const { data: settingsRows } = await supabaseAdmin
    .from("settings_v1")
    .select("user_id")
    .eq("assistant_enabled", true)
    .limit(50);

  const userIds = (settingsRows ?? []).map((r) => r.user_id).filter(Boolean);

  if (userIds.length === 0) {
    return NextResponse.json({
      success: true,
      users_processed: 0,
      total_analyzed: 0,
      duration_ms: Date.now() - startTime,
    });
  }

  let totalAnalyzed = 0;

  for (const userId of userIds) {
    // Vérifier qu'il reste des emails non analysés
    const sinceISO = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count } = await supabaseAdmin
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("received_at", sinceISO)
      .or("lead_json.is.null,lead_status.is.null,decision.is.null");

    if ((count ?? 0) === 0) continue;

    try {
      const res = await fetchWithTimeout(
        `${origin}/api/ai/analyze-backlog`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-fixetime-cron-key": expectedKey,
          },
          body: JSON.stringify({
            user_id: userId,
            limit: BATCH_LIMIT,
          }),
          timeoutMs: 80000,
        }
      );

      const json = await res.json().catch(() => null);
      if (json?.analyzed) {
        totalAnalyzed += json.analyzed;
      }
    } catch (e: any) {
      console.error(`[CRON analyze-backlog] User ${userId} failed:`, e?.message);
    }
  }

  return NextResponse.json({
    success: true,
    users_processed: userIds.length,
    total_analyzed: totalAnalyzed,
    duration_ms: Date.now() - startTime,
  });
}
