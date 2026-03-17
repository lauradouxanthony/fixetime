import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  // 1️⃣ récupérer les jobs actifs
  const { data: jobs } = await supabaseAdmin
    .from("analyze_jobs")
    .select("*")
    .eq("status", "running");

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ ok: true, message: "no jobs" });
  }

  for (const job of jobs) {
    // 2️⃣ appeler TON analyse existante
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/ai/analyze-inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fixetime-analyze-now": "true",
        "x-fixetime-cron-key": process.env.FIXETIME_INTERNAL_CRON_KEY!,
      },
      body: JSON.stringify({
        user_id: job.user_id,
      }),
    });

    // 3️⃣ vérifier s’il reste des emails
    const { count: remaining } = await supabaseAdmin
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", job.user_id)
      .or("decision.is.null,summary.is.null");

    // 4️⃣ s’il n’y a plus rien → on ferme le job
    if ((remaining ?? 0) === 0) {
      await supabaseAdmin
        .from("analyze_jobs")
        .update({ status: "idle" })
        .eq("id", job.id);
    }
  }

  return NextResponse.json({ ok: true });
}
