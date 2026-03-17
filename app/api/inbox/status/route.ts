import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "NO_USER" },
        { status: 401 }
      );
    }

    const userId = user.id;

    const [stateRow, newestEmail, stats24h, gmailTok, outlookTok, settingsRow] = await Promise.all([
      supabaseAdmin
        .from("inbox_state")
        .select("provider, cursor, last_sync_at, last_analyze_at, last_seen_at, last_seen_gmail_internal_ms, analyze_locked_until, autopilot_locked_until")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("emails")
        .select("received_at")
        .eq("user_id", userId)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("emails")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      supabaseAdmin.from("gmail_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("microsoft_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("settings_v1").select("config").eq("user_id", userId).maybeSingle(),
    ]);

    const inboxState = stateRow?.data ?? null;
    const newest_received_at = newestEmail?.data?.received_at ?? null;
    const emails_24h = typeof stats24h?.count === "number" ? stats24h.count : null;

    const googleConnected = !!gmailTok?.data?.user_id;
    const microsoftConnected = !!outlookTok?.data?.user_id;

    const guardrails = (settingsRow?.data as any)?.config?.autopilot_guardrails ?? null;

    const now = Date.now();
    const analyzeLockedUntil = inboxState?.analyze_locked_until
      ? new Date(inboxState.analyze_locked_until).getTime()
      : 0;
    const autopilotLockedUntil = inboxState?.autopilot_locked_until
      ? new Date(inboxState.autopilot_locked_until).getTime()
      : 0;

    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      user_id: userId,
      inbox_state: inboxState,
      newest_received_at,
      emails_24h,
      tokens: {
        google: googleConnected,
        microsoft: microsoftConnected,
      },
      locks: {
        analyze_locked: analyzeLockedUntil > now,
        analyze_locked_until: inboxState?.analyze_locked_until ?? null,
        autopilot_locked: autopilotLockedUntil > now,
        autopilot_locked_until: inboxState?.autopilot_locked_until ?? null,
      },
      guardrails,
    });
  } catch (e: any) {
    console.error("INBOX_STATUS_ERROR", { message: e?.message ?? String(e), stack: e?.stack });
    return NextResponse.json(
      {
        ok: false,
        error: "INBOX_STATUS_FAILED",
        details: { message: e?.message ?? String(e) },
      },
      { status: 500 }
    );
  }
}

