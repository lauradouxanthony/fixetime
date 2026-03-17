import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { graphFetch } from "@/lib/microsoft/graph";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, start, end } = body;

    if (!title || !start || !end) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

    const res = await graphFetch(user.id, "https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      body: JSON.stringify({
        subject: title,
        start: { dateTime: start, timeZone: "Europe/Paris" },
        end: { dateTime: end, timeZone: "Europe/Paris" },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: "OUTLOOK_CREATE_EVENT_ERROR", details: txt }, { status: 400 });
    }

    const json = await res.json();
    return NextResponse.json({ success: true, event: json });
  } catch (e) {
    console.error("OUTLOOK_CREATE_EVENT_FATAL", e);
    return NextResponse.json({ error: "OUTLOOK_CREATE_EVENT_FAILED" }, { status: 500 });
  }
}
