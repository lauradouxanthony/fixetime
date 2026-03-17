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
  // ✅ FIX HYDRATION (SSR vs Client locale)
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const label = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-white">Visites & tournée</h1>
        <p className="text-xs text-gray-400 mt-0.5">Créneaux, RDV confirmés, conflits</p>
        <div className="text-sm text-gray-500 capitalize mt-1">
          {label}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onToday}
          className="px-3 py-1 rounded-md text-sm bg-gray-800 hover:bg-gray-700"
        >
          Aujourd’hui
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            className="px-3 py-1 rounded-md text-sm bg-gray-800 hover:bg-gray-700"
          >
            ←
          </button>
          <button
            onClick={onNext}
            className="px-3 py-1 rounded-md text-sm bg-gray-800 hover:bg-gray-700"
          >
            →
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onChangeMode("day")}
            className={`px-3 py-1 rounded-md text-sm ${
              mode === "day" ? "bg-blue-600" : "bg-gray-800"
            }`}
          >
            Jour
          </button>
          <button
            onClick={() => onChangeMode("week")}
            className={`px-3 py-1 rounded-md text-sm ${
              mode === "week" ? "bg-blue-600" : "bg-gray-800"
            }`}
          >
            Semaine
          </button>
        </div>

        <div className="text-xs px-3 py-1 rounded-full border border-gray-800 bg-gray-950 text-gray-300">
          {connected ? "🟢 Google Calendar connecté" : "🔴 Non connecté"}
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-5 py-2.5 rounded-lg bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-lg shadow-emerald-900/30"
        >
          {refreshing ? "Actualisation…" : "🔄 Actualiser"}
        </button>
      </div>
    </div>
  );
}
