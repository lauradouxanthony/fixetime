// lib/googleCalendar.ts
import { google } from "googleapis";

/**
 * Crée un client Google Calendar authentifié avec l'access token du user.
 */
export function getCalendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  return google.calendar({ version: "v3", auth });
}

/**
 * Récupère la liste des évènements d'un intervalle donné.
 * Par défaut : événements à partir d'aujourd'hui.
 */
export async function listCalendarEvents(calendar: any, maxResults: number = 50) {
  const now = new Date().toISOString();

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: now,
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return response.data.items || [];
}

/**
 * Transforme un event Google brut en structure propre pour Supabase.
 */
export function formatCalendarEvent(googleEvent: any, userId: string) {
  return {
    user_id: userId,
    google_event_id: googleEvent.id,
    title: googleEvent.summary || "Sans titre",
    description: googleEvent.description || "",
    start_time: googleEvent.start?.dateTime || null,
    end_time: googleEvent.end?.dateTime || null,
    location: googleEvent.location || "",
    is_conflict: false, // sera calculé après insertion
  };
}
