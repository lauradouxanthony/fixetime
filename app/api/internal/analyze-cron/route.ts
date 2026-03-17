import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Endpoint CRON interne pour lancer l'analyse inbox.
 *
 * Sécurisé par le header `x-fixetime-cron-key` qui doit matcher
 * `process.env.FIXETIME_INTERNAL_CRON_KEY`.
 *
 * Deux modes:
 * - Body `{ "user_id": "..." }` → lance une passe d'analyse pour un seul user.
 * - Sinon → parcourt les jobs `analyze_jobs` avec status = "running".
 *
 * Exemple Vercel Cron (toutes les 2 minutes):
 * - path: `/api/internal/analyze-cron`
 * - method: `POST`
 * - headers: `x-fixetime-cron-key: <FIXETIME_INTERNAL_CRON_KEY>`
 */
export async function POST(req: Request) {
  const cronKey = req.headers.get("x-fixetime-cron-key");
  if (!cronKey || cronKey !== process.env.FIXETIME_INTERNAL_CRON_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  // 1️⃣ Mode direct: un seul user_id fourni dans le body
  if (body?.user_id) {
    await fetch(`${appUrl}/api/ai/analyze-inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fixetime-analyze-now": "true",
        "x-fixetime-cron-key": process.env.FIXETIME_INTERNAL_CRON_KEY || "",
      },
      body: JSON.stringify({
        user_id: body.user_id,
      }),
    });

    return NextResponse.json({ ok: true, mode: "single_user", user_id: body.user_id });
  }

  // 2️⃣ Mode multi-users via table analyze_jobs (héritage _cron_disabled/analyze)
  const { data: jobs } = await supabaseAdmin
    .from("analyze_jobs")
    .select("*")
    .eq("status", "running");

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ ok: true, message: "no jobs" });
  }

  for (const job of jobs) {
    // 2.1) Une passe d'analyse via l'endpoint existant
    await fetch(`${appUrl}/api/ai/analyze-inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fixetime-analyze-now": "true",
        "x-fixetime-cron-key": process.env.FIXETIME_INTERNAL_CRON_KEY || "",
      },
      body: JSON.stringify({
        user_id: job.user_id,
      }),
    });

    // 2.2) Vérifier s'il reste des emails à traiter
    const { count: remaining } = await supabaseAdmin
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", job.user_id)
      .or("decision.is.null,summary.is.null");

    // 2.3) S'il n'y a plus rien → on ferme le job
    if ((remaining ?? 0) === 0) {
      await supabaseAdmin
        .from("analyze_jobs")
        .update({ status: "idle" })
        .eq("id", job.id);
    }
  }

  return NextResponse.json({ ok: true, mode: "jobs" });
}
