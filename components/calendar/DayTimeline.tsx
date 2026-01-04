"use client";

import type { CalendarEvent } from "./calendarUtils";
import { formatHM } from "./calendarUtils";

export function DayTimeline({
  events,
  onSelect,
}: {
  events: Array<CalendarEvent & { start: Date; end: Date }>;
  onSelect: (ev: CalendarEvent & { start: Date; end: Date }) => void;
}) {
  if (!events.length) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
        Aucun événement sur cette journée.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      {events.map((ev) => (
        <button
          key={ev.id}
          onClick={() => onSelect(ev)}
          className="w-full text-left p-4 border-b border-gray-800 hover:bg-gray-800/60"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-white font-medium truncate">
                {ev.title || "Sans titre"}
              </div>
              <div className="text-xs text-gray-400 truncate">
                {ev.calendar_name ? `📅 ${ev.calendar_name}` : "📅 Calendrier"}
              </div>
            </div>

            <div className="text-xs text-gray-300 whitespace-nowrap">
              {formatHM(ev.start)} – {formatHM(ev.end)}
            </div>
          </div>

          {ev.description ? (
            <div className="mt-2 text-xs text-gray-400 line-clamp-2">
              {ev.description}
            </div>
          ) : null}
        </button>
      ))}
    </div>
  );
}
