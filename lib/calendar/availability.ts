import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { graphFetch } from "@/lib/microsoft/graph";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";

const CALENDAR_FETCH_TIMEOUT_MS = 12000;

type BusyRange = { start: string; end: string };

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toISO(d: Date) {
  return d.toISOString();
}

function isWeekend(d: Date) {
  const day = d.getDay(); // 0=dim,6=sam
  return day === 0 || day === 6;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function uniqueMergeBusy(busyLists: BusyRange[][]): BusyRange[] {
  const all = busyLists.flat().filter(Boolean);
  if (all.length === 0) return [];

  const sorted = all
    .map((r) => ({ start: new Date(r.start), end: new Date(r.end) }))
    .filter((r) => !isNaN(r.start.getTime()) && !isNaN(r.end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [];
  for (const r of sorted) {
    if (!merged.length) {
      merged.push(r);
      continue;
    }
    const last = merged[merged.length - 1];
    if (r.start <= last.end) {
      // merge
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push(r);
    }
  }

  return merged.map((m) => ({ start: toISO(m.start), end: toISO(m.end) }));
}

async function getGoogleBusy(userId: string, timeMin: string, timeMax: string) {
  const token = await getValidGoogleAccessToken(userId);

  const res = await fetchWithTimeout(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: "Europe/Paris",
        items: [{ id: "primary" }],
      }),
    },
    CALENDAR_FETCH_TIMEOUT_MS
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[GOOGLE FREEBUSY] ERROR:", txt);
    return [] as BusyRange[];
  }

  const json = await res.json();
  const busy = json?.calendars?.primary?.busy ?? [];
  return busy as BusyRange[];
}

async function getMicrosoftBusy(userId: string, timeMin: string, timeMax: string) {
  // 1) récupérer l’email/UPN du user
  const meRes = await graphFetch(userId, "https://graph.microsoft.com/v1.0/me");
  if (!meRes.ok) {
    const txt = await meRes.text().catch(() => "");
    console.error("[MS /me] ERROR:", txt);
    return [] as BusyRange[];
  }
  const me = await meRes.json();
  const upn = me?.userPrincipalName;
  if (!upn) return [];

  // 2) getSchedule = Free/Busy
  const scheduleRes = await graphFetch(
    userId,
    "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
    {
      method: "POST",
      body: JSON.stringify({
        schedules: [upn],
        startTime: { dateTime: timeMin, timeZone: "Europe/Paris" },
        endTime: { dateTime: timeMax, timeZone: "Europe/Paris" },
        availabilityViewInterval: 30,
      }),
    }
  );

  if (!scheduleRes.ok) {
    const txt = await scheduleRes.text().catch(() => "");
    console.error("[MS getSchedule] ERROR:", txt);
    return [] as BusyRange[];
  }

  const scheduleJson = await scheduleRes.json();

  // scheduleItems contiennent les plages occupées
  const items = scheduleJson?.value?.[0]?.scheduleItems ?? [];
  const busy: BusyRange[] = items
    .map((it: any) => {
      const start = it?.start?.dateTime;
      const end = it?.end?.dateTime;
      if (!start || !end) return null;
      // Important: Microsoft renvoie souvent des dateTime "local" sans Z.
      // On les passe tels quels: Date() les interprète correctement en local runtime.
      return { start, end } as BusyRange;
    })
    .filter(Boolean);

  return busy;
}

export async function getAvailabilitySlots(opts: {
  userId: string;
  daysAhead: number;
  durationMin: number;
  maxSlots: number;
  useGoogle: boolean;
  useMicrosoft: boolean;
  timezone: string; // "Europe/Paris"
  workDayStartHour: number; // 9
  workDayEndHour: number; // 18
}) {
  const now = new Date();

  // Fenêtre globale : maintenant -> + daysAhead (en incluant uniquement jours ouvrés dans le scan)
  const startWindow = new Date(now);
  startWindow.setSeconds(0, 0);

  const endWindow = addDays(startWindow, opts.daysAhead + 7); // marge pour couvrir les jours ouvrés

  const timeMin = toISO(startWindow);
  const timeMax = toISO(endWindow);

  // Busy providers
  const busyLists: BusyRange[][] = [];

  if (opts.useGoogle) {
    busyLists.push(await getGoogleBusy(opts.userId, timeMin, timeMax));
  }

  if (opts.useMicrosoft) {
    busyLists.push(await getMicrosoftBusy(opts.userId, timeMin, timeMax));
  }

  const mergedBusy = uniqueMergeBusy(busyLists).map((r) => ({
    start: new Date(r.start),
    end: new Date(r.end),
  }));

  // Génération de slots candidats (pas de weekend, 9h-18h, pas de soirée)
  const slots: { start: string; end: string }[] = [];

  let checkedDays = 0;
  let cursorDay = new Date(now);
  cursorDay.setHours(0, 0, 0, 0);

  while (checkedDays < opts.daysAhead && slots.length < opts.maxSlots) {
    if (!isWeekend(cursorDay)) {
      checkedDays++;

      const dayStart = new Date(cursorDay);
      dayStart.setHours(opts.workDayStartHour, 0, 0, 0);

      const dayEnd = new Date(cursorDay);
      dayEnd.setHours(opts.workDayEndHour, 0, 0, 0);

      // Si c’est aujourd’hui, on commence au prochain créneau de 30min
      let t = new Date(dayStart);
      if (cursorDay.toDateString() === now.toDateString()) {
        const startAt = new Date(now);
        startAt.setSeconds(0, 0);
        // arrondi au prochain 30 min
        const m = startAt.getMinutes();
        const rounded = m <= 0 ? 0 : m <= 30 ? 30 : 60;
        startAt.setMinutes(rounded === 60 ? 0 : rounded);
        if (rounded === 60) startAt.setHours(startAt.getHours() + 1);
        if (startAt > t) t = startAt;
      }

      while (t < dayEnd && slots.length < opts.maxSlots) {
        const start = new Date(t);
        const end = new Date(start.getTime() + opts.durationMin * 60_000);

        if (end > dayEnd) break;

        // check overlap busy
        const isBusy = mergedBusy.some((b) => overlaps(start, end, b.start, b.end));

        if (!isBusy) {
          slots.push({ start: toISO(start), end: toISO(end) });
        }

        // pas de 5 min: on incrémente par 30 min
        t = new Date(t.getTime() + 30 * 60_000);
      }
    }

    cursorDay = addDays(cursorDay, 1);
  }

  return slots;
}
