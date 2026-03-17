import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/ai/analyze-email
 * Analyse UNIQUEMENT l'email donné (analyse ciblée).
 * body: { email_id, user_id? }
 */
export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const emailId = body?.email_id ?? body?.emailId;

    if (!emailId || typeof emailId !== "string") {
      return NextResponse.json({ error: "MISSING_EMAIL_ID" }, { status: 400 });
    }

    let userId: string | null = body?.user_id ?? null;
    if (!userId) {
      const supabase = await supabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });
      userId = user.id;
    }

    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    const res = await fetchWithTimeout(
      `${origin}/api/ai/analyze-backlog`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          user_id: userId,
          email_id: emailId,
          limit: 1,
        }),
        timeoutMs: 25000,
      }
    );

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return NextResponse.json(
        { error: "ANALYZE_EMAIL_FAILED", details: json },
        { status: res.status }
      );
    }

    console.log("[api] analyze-email end", { requestId, duration_ms: Date.now() - startMs });
    return NextResponse.json({
      success: true,
      email_id: emailId,
      analyzed: json?.analyzed ?? 0,
      remaining: json?.remaining ?? null,
    });
  } catch (e: any) {
    console.error("[api] analyze-email error", { requestId, duration_ms: Date.now() - startMs, error: e?.message ?? e });
    return NextResponse.json(
      { error: "ANALYZE_EMAIL_FAILED", message: e?.message },
      { status: 500 }
    );
  }
}
