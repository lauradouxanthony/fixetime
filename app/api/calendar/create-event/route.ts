import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";

const CREATE_EVENT_FETCH_TIMEOUT_MS = 12000;

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
    const body = await req.json().catch(() => ({}));
    const { title, start, end } = body ?? {};

    if (!title || !start || !end) {
      return NextResponse.json(
        { error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    // user connecté
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NO_USER" }, { status: 401 });
    }

    const { data: tokenRow } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id")
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
          summary: title,
          start: {
            dateTime: start,
            timeZone: "Europe/Paris",
          },
          end: {
            dateTime: end,
            timeZone: "Europe/Paris",
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: "email", minutes: 1440 }, // 24h avant
              { method: "popup", minutes: 60 },   // 1h avant
            ],
          },
        }),
      },
      CREATE_EVENT_FETCH_TIMEOUT_MS
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        {
          error: "GOOGLE_CALENDAR_ERROR",
          googleError: errText,
          status: res.status,
        },
        { status: 400 }
      );
    }
    

    return NextResponse.json({ success: true });
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
