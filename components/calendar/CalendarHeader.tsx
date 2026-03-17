"use client";

import { useEffect, useState } from "react";

type ViewMode = "day" | "week";

export function CalendarHeader({
  date,
  mode,
  onPrev,
  onNext,
  onToday,
  onChangeMode,
  onRefresh,
  refreshing,
  connected,
}: {
  date: Date;
  mode: ViewMode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onChangeMode: (m: ViewMode) => void;
  onRefresh: () => void;
  refreshing: boolean;
  connected: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const label = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b bg-white"
      style={{ borderColor: "rgb(226 232 240)" }}
    >
      <div>
        <h1 className="text-lg font-semibold capitalize" style={{ color: "rgb(30 41 59)" }}>
          {label}
        </h1>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              background: connected ? "rgb(240 253 244)" : "rgb(254 242 242)",
              color: connected ? "rgb(22 163 74)" : "rgb(220 38 38)",
            }}
          >
            {connected ? "● Google Calendar" : "● Non connecté"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Aujourd'hui */}
        <button
          onClick={onToday}
          className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(241 245 249)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)"; }}
        >
          Aujourd'hui
        </button>

        {/* Prev / Next */}
        <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "rgb(226 232 240)" }}>
          <button
            onClick={onPrev}
            className="px-3 py-1.5 text-sm transition-colors"
            style={{ color: "rgb(71 85 105)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            ←
          </button>
          <div style={{ width: "1px", background: "rgb(226 232 240)", height: "24px" }} />
          <button
            onClick={onNext}
            className="px-3 py-1.5 text-sm transition-colors"
            style={{ color: "rgb(71 85 105)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            →
          </button>
        </div>

        {/* Vue Jour / Semaine */}
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "rgb(226 232 240)" }}>
          {(["day", "week"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onChangeMode(m)}
              className="px-3 py-1.5 text-sm font-medium transition-all"
              style={mode === m ? {
                background: "rgb(79 70 229)",
                color: "white",
              } : {
                background: "white",
                color: "rgb(71 85 105)",
              }}
            >
              {m === "day" ? "Jour" : "Semaine"}
            </button>
          ))}
        </div>

        {/* Sync */}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: "rgb(79 70 229)" }}
        >
          {refreshing ? "Sync…" : "↻ Sync"}
        </button>
      </div>
    </div>
  );
}
