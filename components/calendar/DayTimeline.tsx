"use client";

import type { CalendarEvent } from "./calendarUtils";
import { formatHM, freeSlots } from "./calendarUtils";

/* ── AI vs MANUAL detection ── */
function isAIEvent(ev: CalendarEvent): boolean {
  const title = (ev.title || "").toLowerCase();
  const desc = (ev.description || "").toLowerCase();
  return (
    title.startsWith("visite :") ||
    title.includes("fixtime") ||
    desc.includes("fixtime") ||
    desc.includes("généré par l'ia")
  );
}

function EventBadge({ isAI }: { isAI: boolean }) {
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium"
      style={isAI ? {
        background: "rgba(79,70,229,0.1)",
        color: "rgb(79 70 229)",
      } : {
        background: "rgba(100,116,139,0.1)",
        color: "rgb(100 116 139)",
      }}
    >
      {isAI ? "✨ IA" : "Manuel"}
    </span>
  );
}

export function DayTimeline({
  events,
  onSelect,
  date,
  onBlockSlot,
}: {
  events: Array<CalendarEvent & { start: Date; end: Date }>;
  onSelect: (ev: CalendarEvent & { start: Date; end: Date }) => void;
  date?: Date;
  onBlockSlot?: (slot: { start: Date; end: Date; minutes: number }) => void;
}) {
  const slots = date ? freeSlots(events, date, 9, 18) : [];

  if (!events.length) {
    return (
      <div className="space-y-3">
        <div
          className="rounded-xl border p-6 text-center"
          style={{ borderColor: "rgb(226 232 240)", background: "white" }}
        >
          <div className="text-2xl mb-2">📅</div>
          <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>Aucun événement sur cette journée.</div>
        </div>
        {slots.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium px-1" style={{ color: "rgb(100 116 139)" }}>
              Créneaux disponibles
            </div>
            {slots.slice(0, 3).map((s, i) => (
              <div
                key={i}
                onClick={() => onBlockSlot?.(s)}
                className="rounded-lg px-4 py-2 flex items-center gap-2 transition-all"
                style={{
                  background: "rgba(22,163,74,0.06)",
                  border: "1px solid rgba(22,163,74,0.2)",
                  cursor: onBlockSlot ? "pointer" : "default",
                }}
                onMouseEnter={(e) => { if (onBlockSlot) (e.currentTarget as HTMLElement).style.background = "rgba(22,163,74,0.12)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(22,163,74,0.06)"; }}
              >
                <span style={{ color: "rgb(22 163 74)" }}>●</span>
                <span className="text-xs font-medium" style={{ color: "rgb(22 163 74)" }}>
                  {formatHM(s.start)} – {formatHM(s.end)}
                </span>
                <span className="text-xs ml-auto" style={{ color: "rgb(100 116 139)" }}>
                  {s.minutes} min libres
                </span>
                {onBlockSlot && <span className="text-xs" style={{ color: "rgb(22 163 74)" }}>＋ Bloquer</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Events */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "rgb(226 232 240)", background: "white" }}>
        {events.map((ev, i) => {
          const ai = isAIEvent(ev);
          return (
            <button
              key={ev.id}
              onClick={() => onSelect(ev)}
              className="w-full text-left px-4 py-3 transition-colors"
              style={{
                borderBottom: i < events.length - 1 ? "1px solid rgb(226 232 240)" : "none",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: ai ? "rgb(79 70 229)" : "rgb(100 116 139)" }}
                    />
                    <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
                      {ev.title || "Sans titre"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                      {ev.calendar_name || "Calendrier"}
                    </span>
                    <EventBadge isAI={ai} />
                  </div>
                </div>
                <div className="text-xs whitespace-nowrap flex-shrink-0" style={{ color: "rgb(100 116 139)" }}>
                  {formatHM(ev.start)} – {formatHM(ev.end)}
                </div>
              </div>
              {ev.description && (
                <div className="mt-1.5 text-xs line-clamp-2 pl-4" style={{ color: "rgb(100 116 139)" }}>
                  {ev.description}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Free slots */}
      {slots.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium px-1" style={{ color: "rgb(100 116 139)" }}>
            Créneaux libres ({slots.length})
          </div>
          {slots.map((s, i) => (
            <div
              key={i}
              onClick={() => onBlockSlot?.(s)}
              className="rounded-lg px-4 py-2 flex items-center gap-2 transition-all"
              style={{
                background: "rgba(22,163,74,0.06)",
                border: "1px solid rgba(22,163,74,0.15)",
                cursor: onBlockSlot ? "pointer" : "default",
              }}
              onMouseEnter={(e) => { if (onBlockSlot) (e.currentTarget as HTMLElement).style.background = "rgba(22,163,74,0.12)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(22,163,74,0.06)"; }}
            >
              <span className="text-xs" style={{ color: "rgb(22 163 74)" }}>●</span>
              <span className="text-xs font-medium" style={{ color: "rgb(22 163 74)" }}>
                {formatHM(s.start)} – {formatHM(s.end)}
              </span>
              <span className="text-xs ml-auto" style={{ color: "rgb(100 116 139)" }}>
                {s.minutes} min disponibles
              </span>
              {onBlockSlot && <span className="text-xs font-medium" style={{ color: "rgb(22 163 74)" }}>＋ Bloquer</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
