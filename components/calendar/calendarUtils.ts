export type CalendarEvent = {
  id: string;
  title: string | null;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  calendar_name?: string | null;
};

/* -------------------- HELPERS DATE -------------------- */

export function toDateSafe(s?: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatHM(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function clampDayRange(date: Date, startHour = 8, endHour = 18) {
  const start = new Date(date);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(date);
  end.setHours(endHour, 0, 0, 0);
  return { start, end };
}

/* -------------------- CORE LOGIC -------------------- */

// détecte les events "journée entière" (Google Calendar)
function isAllDay(start: Date, end: Date) {
  return end.getTime() - start.getTime() >= 23 * 60 * 60 * 1000;
}

export function normalizeEventsForDay(events: CalendarEvent[], date: Date) {
  const items = events
    .map((e) => {
      const start = toDateSafe(e.start_time);
      const end = toDateSafe(e.end_time);
      if (!start || !end) return null;

      // ❌ on ignore les events full-day
      if (isAllDay(start, end)) return null;

      return { ...e, start, end };
    })
    .filter(Boolean) as Array<CalendarEvent & { start: Date; end: Date }>;

  return items
    .filter((e) => sameDay(e.start, date) || sameDay(e.end, date))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function detectConflicts(
  dayEvents: Array<CalendarEvent & { start: Date; end: Date }>
) {
  const conflicts: Array<{
    a: CalendarEvent & { start: Date; end: Date };
    b: CalendarEvent & { start: Date; end: Date };
    reason: string;
  }> = [];

  for (let i = 0; i < dayEvents.length - 1; i++) {
    const a = dayEvents[i];
    const b = dayEvents[i + 1];

    if (a.end.getTime() > b.start.getTime()) {
      conflicts.push({
        a,
        b,
        reason: `Chevauchement ${formatHM(a.start)}–${formatHM(
          a.end
        )} avec ${formatHM(b.start)}–${formatHM(b.end)}`,
      });
    }
  }

  return conflicts;
}

export function freeSlots(
  dayEvents: Array<CalendarEvent & { start: Date; end: Date }>,
  date: Date,
  startHour = 8,
  endHour = 18
): Array<{ start: Date; end: Date; minutes: number }> {

  const { start: dayStart, end: dayEnd } = clampDayRange(
    date,
    startHour,
    endHour
  );

  const busy = dayEvents
    .map((e) => ({
      start: e.start < dayStart ? dayStart : e.start,
      end: e.end > dayEnd ? dayEnd : e.end,
    }))
    .filter((b) => b.end.getTime() > b.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: typeof busy = [];
  for (const b of busy) {
    const last = merged[merged.length - 1];
    if (!last) merged.push(b);
    else if (b.start.getTime() <= last.end.getTime()) {
      last.end = new Date(Math.max(last.end.getTime(), b.end.getTime()));
    } else merged.push(b);
  }

  const slots: Array<{ start: Date; end: Date; minutes: number }> = [];
  let cursor = dayStart;

  for (const b of merged) {
    if (b.start.getTime() > cursor.getTime()) {
      const mins = Math.round(
        (b.start.getTime() - cursor.getTime()) / 60000
      );
      slots.push({ start: cursor, end: b.start, minutes: mins });
    }
    cursor = new Date(Math.max(cursor.getTime(), b.end.getTime()));
  }

  if (cursor.getTime() < dayEnd.getTime()) {
    const mins = Math.round(
      (dayEnd.getTime() - cursor.getTime()) / 60000
    );
    slots.push({ start: cursor, end: dayEnd, minutes: mins });
  }

  return slots.filter((s) => s.minutes >= 10);
}

export function totalMeetingMinutes(
  dayEvents: Array<CalendarEvent & { start: Date; end: Date }>,
  date: Date,
  startHour = 8,
  endHour = 18
) {
  const { start: dayStart, end: dayEnd } = clampDayRange(
    date,
    startHour,
    endHour
  );

  return Math.round(
    dayEvents.reduce((sum, e) => {
      const s = new Date(
        Math.max(e.start.getTime(), dayStart.getTime())
      );
      const e2 = new Date(
        Math.min(e.end.getTime(), dayEnd.getTime())
      );

      const diff = e2.getTime() - s.getTime();
      return diff > 0 ? sum + diff / 60000 : sum;
    }, 0)
  );
}

export function loadLabel(mins: number) {
  if (mins >= 300)
    return {
      label: "Charge élevée",
      cls: "bg-red-900/40 text-red-300 border-red-800/60",
    };
  if (mins >= 180)
    return {
      label: "Charge moyenne",
      cls: "bg-yellow-900/40 text-yellow-300 border-yellow-800/60",
    };
  return {
    label: "Charge faible",
    cls: "bg-green-900/40 text-green-300 border-green-800/60",
  };
}
