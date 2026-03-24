import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { graphFetch } from "@/lib/microsoft/graph";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";

export const runtime = "nodejs";

const SLOTS_TIMEOUT_MS = 10000;
function isInternalCron(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  return key === process.env.FIXETIME_INTERNAL_CRON_KEY;
}

type Slot = { start: string; end: string };

function isWeekend(d: Date) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function addMinutes(d: Date, min: number) {
  return new Date(d.getTime() + min * 60000);
}
const TZ = "Europe/Paris";

function getParisParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(d);
  const map: any = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

// construit un Date UTC qui correspond à "YYYY-MM-DD HH:mm" en Europe/Paris
function parisLocalToUTC(year: number, month: number, day: number, hour: number, minute: number) {
  // 1) on crée une date "comme si" c'était UTC
  const pretendUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // 2) on regarde ce que ça représente en Europe/Paris
  const parts = getParisParts(pretendUTC);

  // 3) diff (minutes) entre ce qu’on voulait et ce qu’on obtient
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);

  const deltaMs = wanted - got;
  return new Date(pretendUTC.getTime() + deltaMs);
}

function clampBusinessHoursParis(d: Date) {
  const out = new Date(d);
  out.setSeconds(0, 0);

  // clamp 9h-18h local server time; comme tu bosses Europe/Paris ça reste cohérent
  if (out.getHours() < 9) out.setHours(9, 0, 0, 0);
  if (out.getHours() >= 18) out.setHours(18, 0, 0, 0);
  return out;
}

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

async function hasMicrosoft(userId: string) {
  const { data } = await supabaseAdmin
    .from("microsoft_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.user_id;
}

async function hasGoogle(userId: string) {
  const { data } = await supabaseAdmin
    .from("gmail_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.user_id;
}

/** Outlook: reprend ta logique getSchedule mais renvoie des slots {start,end} */
async function getOutlookSlots(userId: string, durationMin: number, requestId?: string): Promise<Slot[]> {
  const now = new Date();
  const start = new Date(now);
  start.setMinutes(0, 0, 0);

  // fenêtre ~10 jours (pour obtenir 5 jours ouvrés)
  const end = new Date(now.getTime() + 10 * 86400000);

  const t0 = Date.now();
  console.log("AVAIL_SLOTS_MS_FREEBUSY_START", {
    ts: new Date().toISOString(),
    requestId: requestId ?? null,
    provider: "microsoft",
    start: start.toISOString(),
    end: end.toISOString(),
  });

  const res = await graphFetch(
    userId,
    "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
    {
      method: "POST",
      body: JSON.stringify({
        schedules: ["me"],
        startTime: { dateTime: start.toISOString(), timeZone: "UTC" },
        endTime: { dateTime: end.toISOString(), timeZone: "UTC" },
        availabilityViewInterval: 30,
      }),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    console.error("AVAIL_SLOTS_MS_FREEBUSY_ERROR", {
      ts: new Date().toISOString(),
      requestId: requestId ?? null,
      provider: "microsoft",
      duration_ms: Date.now() - t0,
      error: txt,
    });
    throw new Error(`OUTLOOK_FREEBUSY_ERROR:${txt}`);
  }

  const json = await res.json();
  const items = json?.value?.[0]?.scheduleItems ?? [];

  const busy = items
    .map((it: any) => ({
      start: new Date(it.start.dateTime),
      end: new Date(it.end.dateTime),
    }))
    .filter((x: any) => x.start && x.end);

  const slots: Slot[] = [];
  let day = new Date(now);

  const target = 20;
  while (slots.length < target) {
    day = new Date(day.getTime() + 86400000);
    if (isWeekend(day)) continue;
    const p = getParisParts(day);

    const dayStart = parisLocalToUTC(p.year, p.month, p.day, 9, 0);
    const dayEnd = parisLocalToUTC(p.year, p.month, p.day, 18, 0);

    let cursor = new Date(dayStart);
    cursor.setSeconds(0, 0);

    while (cursor < dayEnd && slots.length < 3) {
      const slotStart = new Date(cursor);
      const slotEnd = addMinutes(slotStart, durationMin);

      if (slotEnd > dayEnd) break;

      const conflicts = busy.some((b: any) =>
        overlap(slotStart, slotEnd, b.start, b.end)
      );

      if (!conflicts) {
        slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
      }

      cursor = addMinutes(cursor, 30);
    }
  }

  console.log("AVAIL_SLOTS_MS_FREEBUSY_END", {
    ts: new Date().toISOString(),
    requestId: requestId ?? null,
    provider: "microsoft",
    duration_ms: Date.now() - t0,
    slots_count: slots.length,
  });

  return slots;
}

/** Google: Freebusy API sur primary */
async function getGoogleSlots(userId: string, durationMin: number, requestId?: string): Promise<Slot[]> {
  const accessToken = await getValidGoogleAccessToken(userId);

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setMinutes(0, 0, 0);

  const timeMax = new Date(now.getTime() + 10 * 86400000);

  const t0 = Date.now();
  console.log("AVAIL_SLOTS_GOOGLE_FREEBUSY_START", {
    ts: new Date().toISOString(),
    requestId: requestId ?? null,
    provider: "google",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  });

  const fbRes = await fetchWithTimeout(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: "primary" }],
      }),
    },
    SLOTS_TIMEOUT_MS
  );

  if (!fbRes.ok) {
    const txt = await fbRes.text();
    console.error("AVAIL_SLOTS_GOOGLE_FREEBUSY_ERROR", {
      ts: new Date().toISOString(),
      requestId: requestId ?? null,
      provider: "google",
      duration_ms: Date.now() - t0,
      error: txt,
    });
    throw new Error(`GOOGLE_FREEBUSY_ERROR:${txt}`);
  }

  const fbJson = await fbRes.json();
  const busyRanges = fbJson?.calendars?.primary?.busy ?? [];

  const busy = busyRanges
    .map((b: any) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((x: any) => x.start && x.end);

  const slots: Slot[] = [];
  let day = new Date(now);

  const target = 20;
  while (slots.length < target) {
    day = new Date(day.getTime() + 86400000);
    if (isWeekend(day)) continue;
    const p = getParisParts(day);

    const dayStart = parisLocalToUTC(p.year, p.month, p.day, 9, 0);
    const dayEnd = parisLocalToUTC(p.year, p.month, p.day, 18, 0);

    let cursor = new Date(dayStart);
    cursor.setSeconds(0, 0);

    while (cursor < dayEnd && slots.length < 3) {
      const slotStart = new Date(cursor);
      const slotEnd = addMinutes(slotStart, durationMin);

      if (slotEnd > dayEnd) break;

      const conflicts = busy.some((b: any) =>
        overlap(slotStart, slotEnd, b.start, b.end)
      );

      if (!conflicts) {
        slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
      }

      cursor = addMinutes(cursor, 30);
    }
  }

  console.log("AVAIL_SLOTS_GOOGLE_FREEBUSY_END", {
    ts: new Date().toISOString(),
    requestId: requestId ?? null,
    provider: "google",
    duration_ms: Date.now() - t0,
    slots_count: slots.length,
  });

  return slots;
}

export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  try {
    const isCron = isInternalCron(req);

    const body = await req.json().catch(() => ({}));

    console.log("AVAIL_SLOTS_START", {
      ts: new Date().toISOString(),
      requestId,
      isCron,
      hasBody: !!body,
    });

    // OK user_id : soit via session (UI), soit via body (server-to-server autopilot)
    let userId: string | null = null;

    if (!isCron) {
      const supabase = await supabaseServer();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ ok: false, error: "NO_USER" }, { status: 401 });
      }
      userId = user.id;
    } else {
      if (body?.user_id) userId = String(body.user_id);
      if (!userId) {
        return NextResponse.json({ ok: false, error: "NO_USER_ID" }, { status: 401 });
      }
    }

    const durationMin = Math.max(15, Math.min(120, Number(body?.duration_min ?? 30)));

    const requestedProvider =
      body?.provider === "microsoft" || body?.provider === "google"
        ? body.provider
        : null;

    const hasMs = await hasMicrosoft(userId);
    const hasGg = await hasGoogle(userId);

    console.log("AVAIL_SLOTS_PROVIDER", {
      ts: new Date().toISOString(),
      requestId,
      userId,
      requestedProvider,
      hasMicrosoft: hasMs,
      hasGoogle: hasGg,
    });

    if (!hasMs && !hasGg) {
      return NextResponse.json(
        { ok: false, error: "NO_CALENDAR_CONNECTED", slots: [] },
        { status: 400 }
      );
    }

    // priorite : provider demandé, sinon microsoft si dispo, sinon google
    const provider =
      requestedProvider === "microsoft"
        ? hasMs
          ? "microsoft"
          : null
        : requestedProvider === "google"
          ? hasGg
            ? "google"
            : null
          : hasMs
            ? "microsoft"
            : "google";

    if (!provider) {
      return NextResponse.json({ ok: false, error: "PROVIDER_NOT_AVAILABLE" }, { status: 400 });
    }

    let slots: Slot[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    console.log("AVAIL_SLOTS_CALL_START", {
      ts: new Date().toISOString(),
      requestId,
      userId,
      provider,
      duration_min: durationMin,
      timeout_ms: SLOTS_TIMEOUT_MS,
    });

    try {
      const fetchSlots =
        provider === "microsoft"
          ? () => getOutlookSlots(userId!, durationMin, requestId)
          : () => getGoogleSlots(userId!, durationMin, requestId);
      const callStartedAt = Date.now();
      slots = await Promise.race([
        fetchSlots().then((s) => {
          if (timeoutId) clearTimeout(timeoutId);
          return s;
        }),
        new Promise<Slot[]>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("TIMEOUT")), SLOTS_TIMEOUT_MS);
        }),
      ]);

      console.log("AVAIL_SLOTS_CALL_END", {
        ts: new Date().toISOString(),
        requestId,
        provider,
        duration_ms: Date.now() - callStartedAt,
        slots_count: slots.length,
      });
    } catch (slotsErr: any) {
      if (slotsErr?.message === "TIMEOUT") {
        console.error("AVAIL_SLOTS_TIMEOUT", {
          ts: new Date().toISOString(),
          requestId,
          provider,
          duration_ms: Date.now() - startMs,
        });
        return NextResponse.json({ ok: false, error: "FREEBUSY_TIMEOUT" }, { status: 500 });
      }
      throw slotsErr;
    }

    console.log("AVAIL_SLOTS_END", {
      ts: new Date().toISOString(),
      requestId,
      provider,
      duration_ms: Date.now() - startMs,
      slots_count: slots.length,
    });

    return NextResponse.json({
      ok: true,
      success: true,
      provider,
      duration_min: durationMin,
      slots,
    });
  } catch (e: any) {
    console.error("AVAIL_SLOTS_ERROR", {
      ts: new Date().toISOString(),
      requestId,
      duration_ms: Date.now() - startMs,
      error: e?.message ?? e,
      stack: e?.stack,
    });
    return NextResponse.json(
      { ok: false, error: "FREEBUSY_FAILED" },
      { status: 500 }
    );
  }
}
