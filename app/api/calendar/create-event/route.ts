import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, start, end } = body;

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

    // token Google valide
    const accessToken = await getValidGoogleAccessToken(user.id);

    // création event Google Calendar
    const res = await fetch(
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
        }),
        
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("GOOGLE CALENDAR RAW ERROR:", errText);
    
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
    console.error("CREATE_EVENT_ERROR", e);
    return NextResponse.json(
      { error: "CREATE_EVENT_FAILED" },
      { status: 500 }
    );
  }
}
