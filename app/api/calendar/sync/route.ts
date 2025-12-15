// app/api/calendar/sync/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    // 1) Récupération du user_id transmis par sync/all
    const userId = request.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "NO_USER_ID" }, { status: 400 });
    }

    // 2) Récupération du token Google
    const { data: tokenRow } = await supabaseAdmin
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json(
        { error: "NO_GOOGLE_TOKEN" },
        { status: 400 }
      );
    }

    // 3) Définir la plage synchronisée : -7 jours à +30 jours
    const now = new Date();
    const timeMin = new Date(now.getTime() - 7 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();

    // 4) Récupérer tous les calendriers
    const listRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      { headers: { Authorization: `Bearer ${tokenRow.access_token}` } }
    );

    const listJson = await listRes.json();
    const calendars = listJson.items ?? [];

    let totalInserted = 0;

    // 5) Parcourir tous les calendriers
    for (const cal of calendars) {
      const calId = cal.id;
      const calName = cal.summary ?? "Calendrier";

      const eventsRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          calId
        )}/events?timeMin=${timeMin}&timeMax=${timeMax}`,
        { headers: { Authorization: `Bearer ${tokenRow.access_token}` } }
      );

      const eventsJson = await eventsRes.json();
      const events = eventsJson.items ?? [];

      for (const ev of events) {
        await supabaseAdmin.from("calendar_events").upsert(
          {
            user_id: userId,
            google_event_id: ev.id,
            title: ev.summary ?? "Sans titre",
            description: ev.description ?? "",
            start_time: ev.start?.dateTime ?? ev.start?.date ?? null,
            end_time: ev.end?.dateTime ?? ev.end?.date ?? null,
            calendar_id: calId,
            calendar_name: calName,
          },
          { onConflict: "google_event_id" }
        );

        totalInserted++;
      }
    }

    return NextResponse.json({
      success: true,
      total_calendars: calendars.length,
      inserted_events: totalInserted,
    });
  } catch (err) {
    console.error("CALENDAR_SYNC_ERROR:", err);
    return NextResponse.json(
      { error: "CALENDAR_SYNC_FAILED" },
      { status: 500 }
    );
  }
}
