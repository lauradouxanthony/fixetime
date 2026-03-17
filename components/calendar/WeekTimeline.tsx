import type { CalendarEvent } from "./calendarUtils";

export function WeekTimeline({
  events,
}: {
  events: CalendarEvent[];
}) {
  const days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((label, i) => {
        const dayEvents = events.filter((e) => {
            if (!e.start_time) return false;
          
            const d = new Date(e.start_time);
            const dayIndex = (d.getDay() + 6) % 7; // lundi = 0
            return dayIndex === i;
          });
          

        return (
          <div
            key={label}
            className="rounded-xl border border-gray-800 bg-gray-900 p-2 text-xs"
          >
            <div className="font-semibold text-gray-300 mb-2">
              {label}
            </div>

            {dayEvents.length === 0 ? (
              <div className="text-gray-500">—</div>
            ) : (
              dayEvents.map((e) => (
                <div
                  key={e.id}
                  className="mb-2 rounded-md bg-gray-800 p-2"
                >
                  <div className="text-white text-xs font-medium truncate">
                    {e.title || "Sans titre"}
                  </div>
                  <div className="text-gray-400 text-[11px]">
                  {e.start_time
  ? new Date(e.start_time).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    })
  : ""}

                  </div>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
