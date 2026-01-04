import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

    const body = await req.json();
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
      return NextResponse.json({ error: "NO_GOOGLE_TOKEN" }, { status: 400 });
    }

    const accessToken = await getValidGoogleAccessToken(user.id);

    // 👉 on crée l'event dans le calendrier principal ("primary")
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
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
    });

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
    console.error("BLOCK_SLOT_ERROR", e);
    return NextResponse.json({ error: "BLOCK_SLOT_FAILED" }, { status: 500 });
  }
}
