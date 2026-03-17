import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

function isDev() {
  return process.env.NODE_ENV === "development";
}

export async function POST(req: Request) {
  const startTime = Date.now();
  const trace_id = `cron-sync-${Date.now().toString(36)}`;

  const providedKey =
    req.headers.get("x-fixetime-cron-key") ??
    req.headers.get("x-cron-key") ??
    (req.headers.get("authorization")?.startsWith("Bearer ") ? req.headers.get("authorization")!.slice(7) : null);
  const expectedKey = process.env.FIXETIME_INTERNAL_CRON_KEY ?? process.env.CRON_KEY ?? (isDev() ? "dev123" : null);

  if (!expectedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      { success: false, error: "unauthorized", duration_ms: Date.now() - startTime },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const targetUserId = url.searchParams.get("user_id") ?? process.env.CRON_USER_ID ?? null;
  const debug = url.searchParams.get("debug") === "1";
  const window_days = url.searchParams.get("window_days") === "30" ? 30 : 7;

  let userIds: string[] = [];
  if (targetUserId) {
    userIds = [targetUserId];
  } else {
    const { data: gmailUsers } = await supabaseAdmin.from("gmail_tokens").select("user_id").not("refresh_token", "is", null);
    const { data: msUsers } = await supabaseAdmin.from("microsoft_tokens").select("user_id").not("refresh_token", "is", null);
    const seen = new Set<string>();
    for (const r of gmailUsers ?? []) {
      if (r?.user_id) seen.add(r.user_id);
    }
    for (const r of msUsers ?? []) {
      if (r?.user_id) seen.add(r.user_id);
    }
    userIds = Array.from(seen);
  }

  if (userIds.length === 0) {
    console.log("[CRON_SYNC_INBOX]", { trace_id, message: "no_users" });
    return NextResponse.json({
      success: true,
      message: "no_users",
      users_synced: 0,
      total_inserted: 0,
      results: [],
      duration_ms: Date.now() - startTime,
    });
  }

  let totalInserted = 0;
  const results: { user_id: string; inserted: number; status: string; skipped?: boolean }[] = [];

  console.log("[CRON_SYNC_INBOX] START", { trace_id, user_count: userIds.length, window_days });

  for (const userId of userIds) {
    results.push({ user_id: userId, inserted: 0, status: "skipped" });
  }

  const duration_ms = Date.now() - startTime;
  console.log("[CRON_SYNC_INBOX] END", { trace_id, users_synced: results.length, total_inserted: totalInserted, duration_ms });
  return NextResponse.json({
    success: true,
    trace_id,
    users_synced: results.length,
    total_inserted: totalInserted,
    results,
    duration_ms,
  });
}
