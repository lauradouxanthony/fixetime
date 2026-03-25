// lib/calendar/createEventUnified.ts
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { graphFetch } from "@/lib/microsoft/graph";

type Provider = "microsoft" | "google";

type CreateEventArgs = {
  title: string;
  start: string; // ISO
  end: string;   // ISO
  description?: string;
  attendees?: string[];
  location?: string;
};

export async function createCalendarEvent(
  userId: string,
  provider: Provider,
  args: CreateEventArgs
) {
  // =========================
  // MICROSOFT (Outlook)
  // =========================
  if (provider === "microsoft") {
    const res = await graphFetch(userId, "https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      body: JSON.stringify({
        subject: args.title,
        body: args.description
          ? { contentType: "Text", content: args.description }
          : undefined,
        start: { dateTime: args.start, timeZone: "Europe/Paris" },
        end: { dateTime: args.end, timeZone: "Europe/Paris" },
        location: args.location ? { displayName: args.location } : undefined,
        attendees: Array.isArray(args.attendees) && args.attendees.length > 0
          ? args.attendees.map((email) => ({
              emailAddress: { address: email },
              type: "required",
            }))
          : undefined,
        // Rappel 1h avant la visite
        reminderMinutesBeforeStart: 60,
        isReminderOn: true,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("OUTLOOK_CREATE_EVENT_ERROR", res.status, txt);
      throw new Error(`OUTLOOK_CREATE_EVENT_FAILED:${res.status}`);
    }

    const json = await res.json().catch(() => null);
    return { success: true, event: json };
  }

  // =========================
  // GOOGLE CALENDAR
  // =========================
  const accessToken = await getValidGoogleAccessToken(userId);

  const payload: any = {
    summary: args.title,
    description: args.description ?? undefined,
    location: args.location ?? undefined,
    start: { dateTime: args.start, timeZone: "Europe/Paris" },
    end: { dateTime: args.end, timeZone: "Europe/Paris" },
  };

  if (Array.isArray(args.attendees) && args.attendees.length > 0) {
    payload.attendees = args.attendees.map((email) => ({ email }));
  }

  // Rappels : email 24h avant + popup 1h avant
  payload.reminders = {
    useDefault: false,
    overrides: [
      { method: "email", minutes: 1440 },
      { method: "popup", minutes: 60 },
    ],
  };

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const txt = await res.text().catch(() => "");
  if (!res.ok) {
    console.error("GOOGLE_CREATE_EVENT_ERROR", res.status, txt);
    throw new Error(`GOOGLE_CREATE_EVENT_FAILED:${res.status}`);
  }

  const json = JSON.parse(txt);
  return { success: true, event: json };
}
