import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logActivity } from "@/lib/activity/logActivity";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const startedAt = Date.now();
  let userId: string | null = null;
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }
    userId = user.id;

    await logActivity({
      userId: user.id,
      type: "analyze_now_started",
      actor: "human",
      title: "Analyse manuelle declenchee",
      meta: { status: "info" },
    });

    const [{ data: gTok }, { data: mTok }] = await Promise.all([
      supabaseAdmin
        .from("gmail_tokens")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("microsoft_tokens")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const hasGoogle = !!gTok?.user_id;
    const hasMicrosoft = !!mTok?.user_id;

    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    console.log("INBOX_SYNC_START", {
      userId,
      hasGoogle,
      hasMicrosoft,
      origin,
    });

    let gmailInserted = 0;
    let outlookUpserted = 0;

    if (hasGoogle) {
      try {
        const res = await fetch(`${origin}/api/gmail/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ user_id: user.id }),
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (res.ok) {
          gmailInserted = Number(json?.inserted ?? 0);
        } else {
          console.error("GMAIL_SYNC_FAILED", { status: res.status, json });
        }
      } catch (e: any) {
        console.error("GMAIL_SYNC_FAILED", { message: e?.message ?? String(e) });
      }
    }

    if (hasMicrosoft) {
      try {
        const res = await fetch(`${origin}/api/outlook/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ user_id: user.id }),
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (res.ok) {
          outlookUpserted = Number(json?.upserted ?? 0);
        } else {
          console.error("OUTLOOK_SYNC_FAILED", { status: res.status, json });
        }
      } catch (e: any) {
        console.error("OUTLOOK_SYNC_FAILED", { message: e?.message ?? String(e) });
      }
    }

    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("assistant_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    if ((settingsRow as any)?.assistant_enabled === false) {
      await logActivity({
        userId: user.id,
        type: "analyze_now_completed",
        actor: "human",
        title: "Sync OK — Assistant désactivé, pas d'analyse",
        meta: { status: "assistant_disabled" },
      });

      const { data: newest } = await supabaseAdmin
        .from("emails")
        .select("received_at")
        .eq("user_id", user.id)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      console.log("INBOX_SYNC_END", {
        userId,
        gmail_inserted: gmailInserted,
        outlook_upserted: outlookUpserted,
        newest_received_at: newest?.received_at ?? null,
        duration_ms: Date.now() - startedAt,
        assistant_enabled: false,
      });

      return NextResponse.json({
        success: true,
        started: true,
        sync: {
          gmail_inserted: gmailInserted,
          outlook_upserted: outlookUpserted,
        },
        analyze: { analyzed: 0, status: "assistant_disabled", remaining: null },
        newest_received_at: newest?.received_at ?? null,
        duration_ms: Date.now() - startedAt,
      });
    }

    const analyzeRes = await fetch(`${origin}/api/ai/analyze-inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie,
        "x-fixetime-analyze-now": "true",
      },
      body: JSON.stringify({
        user_id: user.id,
        period: "30d",
        limit: 15,
        force: false,
      }),
      cache: "no-store",
    });

    const analyzeJson = await analyzeRes.json().catch(() => null);

    if (!analyzeRes.ok) {
      console.error("INBOX_SYNC_ERROR", {
        userId,
        phase: "analyze",
        status: analyzeRes.status,
        body: analyzeJson,
      });
      return NextResponse.json(
        { error: "ANALYZE_INBOX_FAILED", details: analyzeJson },
        { status: 500 }
      );
    }

    await logActivity({
      userId: user.id,
      type: "analyze_now_completed",
      actor: "human",
      title: "Analyse terminee",
      meta: { status: "success" },
    });

    const { data: newest } = await supabaseAdmin
      .from("emails")
      .select("received_at")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log("INBOX_SYNC_END", {
      userId,
      gmail_inserted: gmailInserted,
      outlook_upserted: outlookUpserted,
      analyzed: analyzeJson?.analyzed ?? null,
      newest_received_at: newest?.received_at ?? null,
      duration_ms: Date.now() - startedAt,
    });

    return NextResponse.json({
      success: true,
      started: true,
      sync: {
        gmail_inserted: gmailInserted,
        outlook_upserted: outlookUpserted,
      },
      analyze: analyzeJson,
      newest_received_at: newest?.received_at ?? null,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("INBOX_SYNC_ERROR", {
      userId,
      message: e?.message ?? String(e),
      stack: e?.stack,
    });
    if (userId) {
      await logActivity({
        userId,
        type: "analyze_now_error",
        actor: "system",
        title: "Erreur analyse manuelle",
        meta: { status: "error" },
      });
    }
    return NextResponse.json({ error: "ANALYZE_NOW_FAILED" }, { status: 500 });
  }
}

