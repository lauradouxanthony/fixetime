import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export async function GET() {
  try {
    // 1️⃣ Récupération de l'utilisateur connecté via Supabase (session)
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NO_USER" }, { status: 401 });
    }

    const userId = user.id;

    // 2️⃣ Vérifier qu’un token Google existe
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

    // 3️⃣ Récupérer un access_token Google TOUJOURS valide
    const accessToken = await getValidGoogleAccessToken(userId);

    // 4️⃣ Définir la plage synchronisée : -7 jours → +30 jours
    const now = new Date();
    const timeMin = new Date(now.getTime() - 7 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();

    // 5️⃣ Récupérer tous les calendriers Google
    const listRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!listRes.ok) {
      const errorText = await listRes.text();
      return NextResponse.json(
        { error: "CALENDAR_LIST_ERROR", details: errorText },
        { status: 400 }
      );
    }

    const listJson = await listRes.json();
    const calendars = listJson.items ?? [];

    let totalInserted = 0;

    // 6️⃣ Parcourir tous les calendriers
    for (const cal of calendars) {
      const calId = cal.id;
      const calName = cal.summary ?? "Calendrier";

      const eventsRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          calId
        )}/events?timeMin=${timeMin}&timeMax=${timeMax}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!eventsRes.ok) {
        continue; // on ignore ce calendrier si erreur
      }

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
          {
            onConflict: "google_event_id",
          }
        );

        totalInserted++;
      }
    }

    // 7️⃣ Réponse OK
    return NextResponse.json({
      success: true,
      total_calendars: calendars.length,
      inserted_events: totalInserted,
    });
  } catch (error) {
    console.error("CALENDAR_SYNC_ERROR:", error);
    return NextResponse.json(
      { error: "CALENDAR_SYNC_FAILED" },
      { status: 500 }
    );
  }
}
