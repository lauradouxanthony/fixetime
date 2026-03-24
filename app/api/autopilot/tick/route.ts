import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncInboxForUser } from "@/lib/email/syncInbox";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const startTime = Date.now();

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "NO_USER" }, { status: 401 });
  }

  const userId = user.id;

  const { data: settings } = await supabaseAdmin
    .from("settings_v1")
    .select("assistant_enabled, automation_level")
    .eq("user_id", userId)
    .maybeSingle();

  const assistantEnabled = (settings as any)?.assistant_enabled === true;
  const automationLevel = (settings as any)?.automation_level ?? "draft";

  if (!assistantEnabled) {
    return NextResponse.json({
      tick_status: "DISABLED",
      enabled: false,
      reason: "assistant_disabled",
      duration_ms: Date.now() - startTime,
    });
  }

  const isDraftMode = automationLevel === "draft";
  const isAutopilotMode = automationLevel === "autopilot";

  if (!isDraftMode && !isAutopilotMode) {
    return NextResponse.json({
      tick_status: "INVALID_CONFIG",
      enabled: false,
      reason: `invalid_automation_level: ${automationLevel}`,
      duration_ms: Date.now() - startTime,
    });
  }

  const now = new Date();
  const lockUntil = new Date(now.getTime() + 20_000).toISOString();

  const { data: lockState } = await supabaseAdmin
    .from("inbox_state")
    .select("autopilot_locked_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (lockState?.autopilot_locked_until && new Date(lockState.autopilot_locked_until).getTime() > Date.now()) {
    return NextResponse.json({
      tick_status: "LOCKED",
      enabled: true,
      duration_ms: Date.now() - startTime,
    });
  }

  await supabaseAdmin
    .from("inbox_state")
    .upsert(
      {
        user_id: userId,
        autopilot_locked_until: lockUntil,
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id" }
    );

  try {
    const origin = new URL(req.url).origin || `http://${req.headers.get("host") || "localhost:3000"}`;
    const cookie = req.headers.get("cookie") || "";

    let syncResult: any = { inserted: 0, processed: 0, success: false };
    let analyzeResult: any = { analyzed: 0, skipped: 0, remaining: null, skip_reasons: {}, success: false };
    let dispatchResult: any = { replies_sent: 0, proposals_sent: 0, success: false };

    try {
      const syncStart = Date.now();
      const syncRes = await syncInboxForUser({
        userId,
        limit: 10,
        maxDurationMs: 4000,
        mode: "latest",
        forceMinutes: 2,
        debug: false,
      });
      syncResult = {
        success: syncRes.status === "ok" || syncRes.status === "partial-timeout",
        inserted: syncRes.inserted,
        processed: syncRes.processed,
        duration_ms: Date.now() - syncStart,
      };
    } catch (e: any) {
      console.error("[AUTOPILOT_TICK] Sync failed", e);
      syncResult = { success: false, error: String(e), inserted: 0, processed: 0 };
    }

    try {
      const analyzeStart = Date.now();
      const analyzeRes = await fetch(`${origin}/api/ai/analyze-inbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fixetime-analyze-now": "true",
          cookie,
        },
        body: JSON.stringify({
          user_id: userId,
          limit: 3,
          period: "7d",
          force: false,
        }),
        signal: AbortSignal.timeout(9000),
      });
      const analyzeJson = await analyzeRes.json().catch(() => null);
      analyzeResult = {
        success: analyzeRes.ok && analyzeJson?.success !== false,
        analyzed: analyzeJson?.analyzed ?? 0,
        skipped: analyzeJson?.skipped ?? 0,
        remaining: analyzeJson?.remaining ?? null,
        skip_reasons: analyzeJson?.skip_reasons ?? {},
        duration_ms: Date.now() - analyzeStart,
      };
    } catch (e: any) {
      console.error("[AUTOPILOT_TICK] Analyze failed", e);
      analyzeResult = {
        success: false,
        error: String(e),
        analyzed: 0,
        skipped: 0,
        remaining: null,
        skip_reasons: {},
      };
    }

    if (isAutopilotMode) {
      try {
        const dispatchStart = Date.now();
        const dispatchRes = await fetch(`${origin}/api/cron/autopilot-dispatch?user_id=${userId}`, {
          method: "POST",
          headers: {
            "x-fixetime-cron-key": process.env.FIXETIME_INTERNAL_CRON_KEY || "dev123",
            cookie,
          },
          signal: AbortSignal.timeout(6000),
        });
        const dispatchJson = await dispatchRes.json().catch(() => null);
        dispatchResult = {
          success: dispatchRes.ok && dispatchJson?.success !== false,
          replies_sent: dispatchJson?.replies_sent ?? 0,
          proposals_sent: dispatchJson?.proposals_sent ?? 0,
          duration_ms: Date.now() - dispatchStart,
        };
      } catch (e: any) {
        console.error("[AUTOPILOT_TICK] Dispatch failed", e);
        dispatchResult = { success: false, error: String(e), replies_sent: 0, proposals_sent: 0 };
      }
    } else {
      dispatchResult = { success: true, skipped: "draft_mode", replies_sent: 0, proposals_sent: 0 };
    }

    return NextResponse.json({
      tick_status: "OK",
      enabled: true,
      automation_level: automationLevel,
      sync: syncResult,
      analyze: analyzeResult,
      dispatch: dispatchResult,
      duration_ms: Date.now() - startTime,
    });
  } finally {
    await supabaseAdmin
      .from("inbox_state")
      .update({
        autopilot_locked_until: now.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }
}
