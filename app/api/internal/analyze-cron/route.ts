import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL!;
const CRON_KEY = process.env.FIXETIME_INTERNAL_CRON_KEY!;

export async function POST(req: Request) {
  try {
    // 🔐 Vercel Cron envoie Authorization: Bearer <CRON_SECRET>
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 1️⃣ Tous les users ayant Gmail connecté
    const { data: users, error } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id");

    if (error || !users || users.length === 0) {
      return NextResponse.json({ success: true, analyzed: 0 });
    }

    let processed = 0;

    // 2️⃣ Pour chaque user : sync Gmail puis analyse IA
    for (const row of users) {
      const userId = row.user_id;

      // Sync Gmail (fire-and-forget, best-effort)
      try {
        await fetch(`${BASE_URL}/api/gmail/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
        });
      } catch (e) {
        console.warn(`[CRON] gmail sync failed for ${userId}`, e);
      }

      // Analyse IA — on passe x-fixetime-cron-key + user_id dans le body
      // (reconnu par /api/ai/analyze-inbox)
      try {
        await fetch(`${BASE_URL}/api/ai/analyze-inbox`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-fixetime-cron-key": CRON_KEY,
          },
          body: JSON.stringify({ user_id: userId, period: "30d" }),
        });
        processed++;
      } catch (e) {
        console.warn(`[CRON] analyze failed for ${userId}`, e);
      }
    }

    return NextResponse.json({ success: true, usersProcessed: processed });
  } catch (e) {
    console.error("CRON_ANALYZE_FAILED", e);
    return NextResponse.json({ error: "cron_failed" }, { status: 500 });
  }
}
