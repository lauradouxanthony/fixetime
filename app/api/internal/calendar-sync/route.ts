import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

function isInternalCron(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  return key === process.env.FIXETIME_INTERNAL_CRON_KEY;
}

export async function POST(req: Request) {
  // 🔐 Sécurité cron
  if (!isInternalCron(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // 1️⃣ Tous les users avec token Google
    const { data: users, error } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id");

    if (error || !users || users.length === 0) {
      return NextResponse.json({ success: true, synced: 0 });
    }

    let totalEvents = 0;

    // 2️⃣ Fenêtre de sync
    const now = new Date();
    const timeMin = new Date(now.getTime() - 7 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();

    for (const row of users) {
      const userId = row.user_id;

      // 3️⃣ Token Google valide
      const accessToken = await getValidGoogleAccessToken(userId);
      if (!accessToken) continue;

      // 4️⃣ Calendriers Google
      const calendarsRes = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!calendarsRes.ok) continue;

      const calendarsJson = await calendarsRes.json();
      const calendars = calendarsJson.items ?? [];

      for (const cal of calendars) {
        const eventsRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
            cal.id
          )}/events?timeMin=${timeMin}&timeMax=${timeMax}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!eventsRes.ok) continue;

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
              calendar_id: cal.id,
              calendar_name: cal.summary ?? "Calendrier",
            },
            { onConflict: "google_event_id" }
          );

          totalEvents++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      synced_events: totalEvents,
    });
  } catch (err) {
    console.error("CALENDAR_CRON_ERROR", err);
    return NextResponse.json(
      { error: "CALENDAR_CRON_FAILED" },
      { status: 500 }
    );
  }
}
