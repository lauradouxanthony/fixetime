import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    // 🔐 Sécurité simple (clé cron)
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 1️⃣ Récupérer les users ayant Gmail connecté
    const { data: users, error } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id");

    if (error || !users || users.length === 0) {
      return NextResponse.json({ success: true, analyzed: 0 });
    }

    let processed = 0;

    // 2️⃣ Pour chaque user → déclencher l’analyse
    for (const row of users) {
      const userId = row.user_id;

      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: "fake@internal.fixetime", // jamais envoyé
      });

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/ai/analyze-inbox`, {
        method: "POST",
        headers: {
          "x-internal-user-id": userId,
        },
      });

      processed++;
    }

    return NextResponse.json({
      success: true,
      usersProcessed: processed,
    });
  } catch (e) {
    console.error("CRON_ANALYZE_FAILED", e);
    return NextResponse.json(
      { error: "cron_failed" },
      { status: 500 }
    );
  }
}
