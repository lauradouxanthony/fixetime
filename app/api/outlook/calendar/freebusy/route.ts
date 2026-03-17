import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { graphFetch } from "@/lib/microsoft/graph";

export const runtime = "nodejs";

function isWeekend(d: Date) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function clampToBusinessHours(d: Date) {
  const out = new Date(d);
  out.setSeconds(0, 0);
  if (out.getHours() < 9) out.setHours(9, 0, 0, 0);
  if (out.getHours() >= 18) out.setHours(18, 0, 0, 0);
  return out;
}

function addMinutes(d: Date, min: number) {
  return new Date(d.getTime() + min * 60000);
}

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const durationMin = Number(body?.duration_min ?? 30);

    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);

    // fenêtre 5 jours ouvrés
    const end = new Date(now.getTime() + 10 * 86400000);

    const res = await graphFetch(user.id, "https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
      method: "POST",
      body: JSON.stringify({
        schedules: ["me"],
        startTime: { dateTime: start.toISOString(), timeZone: "UTC" },
        endTime: { dateTime: end.toISOString(), timeZone: "UTC" },
        availabilityViewInterval: 30,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: "OUTLOOK_FREEBUSY_ERROR", details: txt }, { status: 400 });
    }

    const json = await res.json();
    const items = json?.value?.[0]?.scheduleItems ?? [];

    const busy = items
      .map((it: any) => ({
        start: new Date(it.start.dateTime),
        end: new Date(it.end.dateTime),
      }))
      .filter((x: any) => x.start && x.end);

    // construire des slots libres (9-18) sur 5 jours ouvrés
    const slots: string[] = [];
    let day = new Date(now);

    while (slots.length < 12) {
      day = new Date(day.getTime() + 86400000);
      if (isWeekend(day)) continue;

      const dayStart = new Date(day);
      dayStart.setHours(9, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(18, 0, 0, 0);

      let cursor = clampToBusinessHours(dayStart);

      while (cursor < dayEnd && slots.length < 12) {
        const slotStart = new Date(cursor);
        const slotEnd = addMinutes(slotStart, durationMin);

        if (slotEnd > dayEnd) break;

        const conflicts = busy.some((b: any) => overlap(slotStart, slotEnd, b.start, b.end));
        if (!conflicts) {
          slots.push(slotStart.toISOString());
        }

        cursor = addMinutes(cursor, 30);
      }
    }

    return NextResponse.json({ success: true, duration_min: durationMin, slots });
  } catch (e) {
    console.error("OUTLOOK_FREEBUSY_FATAL", e);
    return NextResponse.json({ error: "OUTLOOK_FREEBUSY_FAILED" }, { status: 500 });
  }
}
