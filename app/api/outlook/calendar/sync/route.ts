import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { graphFetch } from "@/lib/microsoft/graph";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

    const userId = user.id;

    // plage : -7j -> +30j (comme Google)
    const now = new Date();
    const start = new Date(now.getTime() - 7 * 86400000).toISOString();
    const end = new Date(now.getTime() + 30 * 86400000).toISOString();

    // Graph CalendarView: liste events du calendrier principal
    // NOTE: startDateTime/endDateTime doivent être en query
    const url =
      `https://graph.microsoft.com/v1.0/me/calendarView` +
      `?startDateTime=${encodeURIComponent(start)}` +
      `&endDateTime=${encodeURIComponent(end)}` +
      `&$top=200` +
      `&$select=id,subject,bodyPreview,start,end,location`;

    const res = await graphFetch(userId, url, { method: "GET" });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: "OUTLOOK_CAL_SYNC_ERROR", details: txt }, { status: 400 });
    }

    const json = await res.json();
    const events = json?.value ?? [];

    let inserted = 0;

    for (const ev of events) {
      const startTime = ev?.start?.dateTime ? new Date(ev.start.dateTime).toISOString() : null;
      const endTime = ev?.end?.dateTime ? new Date(ev.end.dateTime).toISOString() : null;

      const { error } = await supabaseAdmin.from("calendar_events").upsert(
        {
          user_id: userId,
          provider: "microsoft",
          provider_event_id: ev.id,
          google_event_id: null,
          title: ev?.subject ?? "Sans titre",
          description: ev?.bodyPreview ?? "",
          start_time: startTime,
          end_time: endTime,
          location: ev?.location?.displayName ?? null,
          calendar_id: "primary",
          calendar_name: "Outlook Calendar",
        },
        { onConflict: "user_id,provider,provider_event_id" }
      );

      if (!error) inserted++;
    }

    return NextResponse.json({ success: true, inserted_events: inserted });
  } catch (e) {
    console.error("OUTLOOK_CALENDAR_SYNC_FATAL", e);
    return NextResponse.json({ error: "OUTLOOK_CALENDAR_SYNC_FAILED" }, { status: 500 });
  }
}
