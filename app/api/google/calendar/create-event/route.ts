import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

function isInternalCron(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  return key === process.env.FIXETIME_INTERNAL_CRON_KEY;
}

export async function POST(req: Request) {
  try {
    const isCron = isInternalCron(req);

    const body = await req.json().catch(() => ({}));
    const { title, start, end, description, location, attendees } = body;

    if (!title || !start || !end) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    // OK user_id : soit via session (UI), soit via body (server-to-server cron)
    let userId: string | null = null;

    if (!isCron) {
      const supabase = await supabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });
      userId = user.id;
    } else {
      if (body?.user_id) userId = String(body.user_id);
      if (!userId) return NextResponse.json({ error: "NO_USER_ID" }, { status: 401 });
    }

    const accessToken = await getValidGoogleAccessToken(userId);

    const eventPayload: any = {
      summary: title,
      start: { dateTime: start, timeZone: "Europe/Paris" },
      end: { dateTime: end, timeZone: "Europe/Paris" },
    };

    if (description) eventPayload.description = description;
    if (location) eventPayload.location = location;
    if (Array.isArray(attendees) && attendees.length > 0) {
      eventPayload.attendees = attendees.map((email: string) => ({ email }));
    }

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventPayload),
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "GOOGLE_CREATE_EVENT_ERROR", details: txt },
        { status: 400 }
      );
    }

    const json = await res.json();
    return NextResponse.json({ success: true, event: json });
  } catch (e) {
    console.error("GOOGLE_CREATE_EVENT_FATAL", e);
    return NextResponse.json(
      { error: "GOOGLE_CREATE_EVENT_FAILED" },
      { status: 500 }
    );
  }
}
