import type { CalendarEvent } from "@/components/calendar/calendarUtils";
import { freeSlots } from "@/components/calendar/calendarUtils";

export type OptimalSlot = {
  start: Date;
  end: Date;
  minutes: number;
};

function toDateSafe(s?: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function setTime(d: Date, hours: number, minutes = 0) {
  const x = new Date(d);
  x.setHours(hours, minutes, 0, 0);
  return x;
}

/**
 * Créneau optimal pour "planifier" :
 * - uniquement dans le futur
 * - dans la fenêtre de travail (8h–18h par défaut)
 * - basé sur les vrais events (si aucun event => on propose "maintenant" dans la fenêtre)
 */

export function getOptimalSlotForEmail(
  calendarEvents: CalendarEvent[] | null | undefined,
  date: Date,
  minMinutes: number,
  options?: { now?: Date }
): OptimalSlot | null {

  console.log("GET OPTIMAL SLOT INPUT:", {
    calendarEventsCount: Array.isArray(calendarEvents) ? calendarEvents.length : null,
    date: date?.toISOString?.() ?? String(date),
    minMinutes,
    now: (options?.now ?? new Date()).toISOString(),
  });
  
  const safeEvents = Array.isArray(calendarEvents) ? calendarEvents : [];
  const now = options?.now ?? new Date();
  const workStartHour = 8;
  const workEndHour = 18;
  

  // Fenêtre de travail sur "date"
  const day = startOfDay(date);
  let workStart = setTime(day, workStartHour, 0);
  let workEnd = setTime(day, workEndHour, 0);

  // Si on calcule pour "aujourd'hui", on ne peut pas proposer avant maintenant
  // On prend le max(workStart, now)
  const lowerBound = new Date(Math.max(workStart.getTime(), now.getTime()));

  // Si lowerBound est déjà après la fin de journée => on dit "pas de créneau aujourd'hui"
  // (la UI pourra ensuite essayer sur demain si tu veux, étape suivante)
 // Si on est déjà après la fin de journée => on force demain
// Si aujourd’hui est terminé → on calcule sur demain AVEC les events
if (lowerBound.getTime() >= workEnd.getTime()) {
  const tomorrow = new Date(day);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tomorrowStart = setTime(tomorrow, workStartHour, 0);
  const tomorrowEnd = setTime(tomorrow, workEndHour, 0);

  // Rejoue l’algorithme normal sur demain
  return getOptimalSlotForEmail(
    calendarEvents,
    tomorrow,
    minMinutes,
    { now: tomorrowStart }
  );
}

  // Events => Dates
  const eventsWithDates: Array<{ start: Date; end: Date }> = [];
  for (const e of safeEvents) {
    const start = toDateSafe(e.start_time);
    const end = toDateSafe(e.end_time);
    if (!start || !end) continue;
    if (end.getTime() <= start.getTime()) continue;

    // On ne garde que ce qui intersecte la fenêtre de travail
    if (end.getTime() <= workStart.getTime()) continue;
    if (start.getTime() >= workEnd.getTime()) continue;

    eventsWithDates.push({
      start: new Date(Math.max(start.getTime(), workStart.getTime())),
      end: new Date(Math.min(end.getTime(), workEnd.getTime())),
    });
  }

  // freeSlots donne les créneaux libres de la journée (8h–18h via calendarUtils)
  // MAIS on doit filtrer tout ce qui commence avant lowerBound
  let slots = freeSlots(eventsWithDates as any, day);
console.log("FREE SLOTS RESULT:", slots);

if (slots.length === 0) {
  // fallback simple : tout le temps restant aujourd’hui
  const minutes =
    Math.floor((workEnd.getTime() - lowerBound.getTime()) / 60000);

  if (minutes >= minMinutes) {
    slots = [
      {
        start: lowerBound,
        end: workEnd,
        minutes,
      },
    ];
  }
}
  
  // 1) On coupe les slots dans le passé
  const futureSlots = slots
    .map((s) => {
      const start = new Date(Math.max(s.start.getTime(), lowerBound.getTime()));
      const end = s.end;
      const minutes = Math.floor((end.getTime() - start.getTime()) / 60000);
      return { start, end, minutes };
    })
    .filter((s) => s.minutes >= minMinutes);

  // 2) Si freeSlots renvoie "toute la journée" (aucun event), ça marche quand même :
  // le start sera recoupé à "lowerBound" => donc "maintenant → 18h"
  const best = futureSlots[0] ?? null;
if (!best) return null;

// ✅ on retourne un créneau "de travail" (durée = minMinutes), pas toute la fenêtre libre
const end = new Date(best.start.getTime() + minMinutes * 60000);

return {
  start: best.start,
  end,
  minutes: minMinutes,
};

}
export function getSuggestedSlotsForEmail(
  calendarEvents: CalendarEvent[] | null | undefined,
  baseDate: Date,
  minMinutes: number,
  options?: { daysAhead?: number }
): OptimalSlot[] {
  const days = options?.daysAhead ?? 3;
  const slots: OptimalSlot[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + i);

    const slot = getOptimalSlotForEmail(
      calendarEvents,
      date,
      minMinutes,
      i === 0 ? { now: new Date() } : undefined
    );

    if (slot) slots.push(slot);
  }

  return slots;
}

