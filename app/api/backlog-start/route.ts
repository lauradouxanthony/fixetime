/**
 * POST /api/backlog-start — lance un job d'analyse (backlog 7j/30j).
 * Body: { window_days: 7 | 30, limit?: number }
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

const INTERNAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET ?? "change-me-in-production";

function traceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const LIMIT_7D = 300;
const LIMIT_30D = 1000;

export async function POST(req: Request) {
  const trace_id = traceId();
  try {
    const supabase = await supabaseServer();
    let user: { id: string } | null = null;
    const internalSecret = req.headers.get("x-internal-secret");
    const internalUserId = req.headers.get("x-internal-user-id");
    if (internalSecret === INTERNAL_SECRET && internalUserId) {
      user = { id: internalUserId };
    } else {
      const { data: { user: u } } = await supabase.auth.getUser();
      user = u;
    }
    if (!user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const windowDays = (body?.window_days === 30 ? 30 : 7) as 7 | 30;
    const singleEmailId = typeof body?.email_id === "string" ? body.email_id.trim() : null;
    const limit =
      singleEmailId
        ? 1
        : typeof body?.limit === "number"
          ? Math.min(body.limit, windowDays === 30 ? LIMIT_30D : LIMIT_7D)
          : windowDays === 30
            ? LIMIT_30D
            : LIMIT_7D;

    const fromIso = isoDaysAgo(windowDays);

    const { data: existingJob, error: existingJobErr } = await supabase
      .from("analyze_jobs")
      .select("id, queued, processed")
      .eq("user_id", user.id)
      .gt("queued", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingJobErr) {
      return NextResponse.json(
        { error: "LIST_JOBS_FAILED", detail: existingJobErr.message },
        { status: 500 }
      );
    }

    const remaining = (existingJob?.queued ?? 0) - (existingJob?.processed ?? 0);
    if (existingJob && remaining > 0) {
      return NextResponse.json({
        ok: true,
        job_id: (existingJob as { id: string }).id,
        queued: existingJob.queued,
        processed: existingJob.processed,
        remaining,
      });
    }

    let ids: string[];
    if (singleEmailId) {
      const { data: one, error: oneErr } = await supabase
        .from("emails")
        .select("id")
        .eq("id", singleEmailId)
        .eq("user_id", user.id)
        .is("analyzed_at", null)
        .maybeSingle();
      if (oneErr || !one) {
        return NextResponse.json({ ok: true, job_id: null, queued: 0, message: "Email non trouvé ou déjà analysé" });
      }
      ids = [(one as { id: string }).id];
    } else {
      const { data: emailsToMark, error: listError } = await supabase
        .from("emails")
        .select("id")
        .eq("user_id", user.id)
        .gte("received_at", fromIso)
        .eq("processing", false)
        .is("analyzed_at", null)
        .order("received_at", { ascending: false })
        .limit(limit);

      if (listError) {
        return NextResponse.json({ error: "LIST_FAILED" }, { status: 500 });
      }
      ids = (emailsToMark ?? []).map((r) => r.id);
    }

    if (ids.length === 0) {
      return NextResponse.json({
        ok: true,
        job_id: null,
        queued: 0,
        message: "Aucun email à analyser",
      });
    }

    const { error: updateError } = await supabase
      .from("emails")
      .update({ processing: true })
      .eq("user_id", user.id)
      .in("id", ids);

    if (updateError) {
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 });
    }

    const { data: job, error: jobError } = await supabase
      .from("analyze_jobs")
      .insert({
        user_id: user.id,
        queued: ids.length,
        processed: 0,
        errors: 0,
      })
      .select("id")
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: "JOB_INSERT_FAILED", detail: (jobError as { message?: string })?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      job_id: (job as { id: string }).id,
      queued: ids.length,
    });
  } catch (e) {
    console.error("ANALYZE_START_FATAL", { trace_id, error: e });
    return NextResponse.json({ error: "ANALYZE_START_FATAL" }, { status: 500 });
  }
}
