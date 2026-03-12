import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min max

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL!;
const CRON_KEY = process.env.FIXETIME_INTERNAL_CRON_KEY ?? "";

/**
 * GET /api/cron/sync-emails
 *
 * Appelé par Vercel Cron toutes les 5 minutes.
 * 1. Vérifie Authorization: Bearer <CRON_SECRET>
 * 2. Récupère tous les users avec un token Google
 * 3. Pour chaque user → gmail/sync (quick mode) + analyze-inbox
 */
export async function GET(req: Request) {
  const cronStart = Date.now();

  // 🔐 Vérification Authorization Vercel Cron
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn("[CRON SYNC] Unauthorized request — header:", auth?.slice(0, 20));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 1️⃣ Tous les users ayant Gmail connecté (token dans gmail_tokens)
  const { data: users, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("user_id")
    .not("refresh_token", "is", null); // uniquement ceux avec refresh_token valide

  if (error) {
    console.error("[CRON SYNC] Erreur lecture gmail_tokens:", error);
    return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
  }

  if (!users || users.length === 0) {
    console.log("[CRON SYNC] Aucun user avec token Gmail.");
    return NextResponse.json({ success: true, synced: 0, analyzed: 0 });
  }

  console.log(`[CRON SYNC] ${users.length} users à synchroniser`);

  let synced = 0;
  let analyzed = 0;
  const errors: string[] = [];

  for (const row of users) {
    const userId = row.user_id;

    // 2️⃣ Gmail sync — mode quick (50 messages récents INBOX)
    try {
      const syncRes = await fetch(`${BASE_URL}/api/gmail/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, mode: "quick" }),
      });

      if (syncRes.ok) {
        const syncData = await syncRes.json();
        synced++;
        console.log(
          `[CRON SYNC] user=${userId} sync OK — nouveaux=${syncData.inserted ?? 0} déjà_connus=${syncData.skipped ?? 0}`
        );
      } else {
        const txt = await syncRes.text();
        console.warn(`[CRON SYNC] user=${userId} sync HTTP ${syncRes.status}: ${txt.slice(0, 200)}`);
        errors.push(`sync:${userId}:${syncRes.status}`);
      }
    } catch (e: any) {
      console.warn(`[CRON SYNC] user=${userId} sync exception:`, e?.message);
      errors.push(`sync:${userId}:exception`);
    }

    // 3️⃣ Analyse IA — classe et analyse les nouveaux emails
    try {
      const analyzeRes = await fetch(`${BASE_URL}/api/ai/analyze-inbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fixetime-cron-key": CRON_KEY,
        },
        body: JSON.stringify({ user_id: userId, period: "7d" }), // 7j pour le mode quick
      });

      if (analyzeRes.ok) {
        const analyzeData = await analyzeRes.json();
        analyzed++;
        console.log(
          `[CRON SYNC] user=${userId} analyze OK — analysés=${analyzeData.analyzed ?? 0}`
        );
      } else {
        const txt = await analyzeRes.text();
        console.warn(`[CRON SYNC] user=${userId} analyze HTTP ${analyzeRes.status}: ${txt.slice(0, 200)}`);
        errors.push(`analyze:${userId}:${analyzeRes.status}`);
      }
    } catch (e: any) {
      console.warn(`[CRON SYNC] user=${userId} analyze exception:`, e?.message);
      errors.push(`analyze:${userId}:exception`);
    }
  }

  const durationMs = Date.now() - cronStart;
  console.log(
    `[CRON SYNC] ✅ Terminé en ${durationMs}ms — users=${users.length} synced=${synced} analyzed=${analyzed} errors=${errors.length}`
  );

  return NextResponse.json({
    success: true,
    users: users.length,
    synced,
    analyzed,
    errors: errors.length > 0 ? errors : undefined,
    durationMs,
  });
}
