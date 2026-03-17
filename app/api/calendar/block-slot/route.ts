import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";

const BLOCK_FETCH_TIMEOUT_MS = 12000;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === "TIMEOUT";
}

function isNoToken(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return m === "NO_GOOGLE_TOKEN" || m === "NO_REFRESH_TOKEN" || m === "NO_MICROSOFT_TOKEN" || m === "NO_MICROSOFT_REFRESH_TOKEN";
}

function isReauth(err: unknown): { provider: "google" | "microsoft" } | null {
  if (!(err instanceof Error)) return null;
  const m = err.message;
  if (m === "GOOGLE_TOKEN_REVOKED") return { provider: "google" };
  if (m === "NO_MICROSOFT_TOKEN" || m === "NO_MICROSOFT_REFRESH_TOKEN") return { provider: "microsoft" };
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { emailId, title, start, end, notes } = body || {};

    if (!start || !end) {
      return NextResponse.json({ error: "MISSING_START_END" }, { status: 400 });
    }

    // token
    const { data: tokenRow } = await supabaseAdmin
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json({ ok: true, skipped: true, reason: "NO_TOKEN" }, { status: 200 });
    }

    const accessToken = await getValidGoogleAccessToken(user.id);

    const res = await fetchWithTimeout(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: title ?? "FixTime — Créneau",
          description: notes ?? "",
          start: { dateTime: start },
          end: { dateTime: end },
        }),
      },
      BLOCK_FETCH_TIMEOUT_MS
    );

    const json = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: "GOOGLE_CREATE_EVENT_FAILED", details: json },
        { status: 400 }
      );
    }

    // optionnel : log en DB (si tu veux)
    // await supabaseAdmin.from("calendar_blocks").insert({ ... })

    return NextResponse.json({ success: true, event: json });
  } catch (e) {
    if (isTimeout(e)) {
      return NextResponse.json({ ok: false, error: "TIMEOUT" }, { status: 200 });
    }
    if (isNoToken(e)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "NO_TOKEN" }, { status: 200 });
    }
    const reauth = isReauth(e);
    if (reauth) {
      return NextResponse.json({ ok: true, skipped: true, needs_reauth: true, provider: reauth.provider }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 200 });
  }
}
