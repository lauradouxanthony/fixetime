import { freeSlots } from "./calendarUtils";

type CalendarEvent = {
  start_time: string;
  end_time: string;
};

export function findBestSlot({
  events,
  date,
  requiredMinutes,
}: {
  events: CalendarEvent[];
  date: Date;
  requiredMinutes: number;
}) {
  const parsed = events
    .map((e) => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    }))
    .filter((e) => !isNaN(e.start.getTime()) && !isNaN(e.end.getTime()));

  const slots = freeSlots(
    parsed.map((e) => ({
      start: e.start,
      end: e.end,
    })) as any,
    date
  );

  // On prend le premier slot assez long
  return slots.find((s) => s.minutes >= requiredMinutes) || null;
}
