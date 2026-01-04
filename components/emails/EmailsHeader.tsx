"use client";

import { useState } from "react";

type Period = "today" | "7d" | "30d";

export function EmailsHeader({
  activeFilter,
  onChangeFilter,
  onRefresh,
  refreshing,
  period,
  onChangePeriod,
}: {
  activeFilter: "all" | "urgent" | "important" | "traiter" | "planifier";
  onChangeFilter: (f: "all" | "urgent" | "important" | "traiter" | "planifier") => void;
  onRefresh: () => void;
  refreshing: boolean;
  period: Period;
  onChangePeriod: (p: Period) => void;
}) {

  const [localAnalyzing, setLocalAnalyzing] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-xl font-bold">Emails</h1>

      <div className="flex gap-2">
        <button
          onClick={() => onChangePeriod("today")}
          className={`px-3 py-1 rounded-md text-sm ${
            period === "today" ? "bg-blue-600" : "bg-gray-800"
          }`}
        >
          Aujourd’hui
        </button>

        <button
          onClick={() => onChangePeriod("7d")}
          className={`px-3 py-1 rounded-md text-sm ${
            period === "7d" ? "bg-blue-600" : "bg-gray-800"
          }`}
        >
          7 jours
        </button>

        <button
          onClick={() => onChangePeriod("30d")}
          className={`px-3 py-1 rounded-md text-sm ${
            period === "30d" ? "bg-blue-600" : "bg-gray-800"
          }`}
        >
          30 jours
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
  <button
    onClick={() => onChangeFilter("all")}
    className={`px-3 py-1 rounded-md text-sm ${
      activeFilter === "all" ? "bg-gray-700" : "bg-gray-800"
    }`}
  >
    Tous
  </button>

  <button
    onClick={() => onChangeFilter("traiter")}
    className={`px-3 py-1 rounded-md text-sm ${
      activeFilter === "traiter" ? "bg-red-600" : "bg-gray-800"
    }`}
  >
    À traiter
  </button>

  <button
    onClick={() => onChangeFilter("planifier")}
    className={`px-3 py-1 rounded-md text-sm ${
      activeFilter === "planifier" ? "bg-yellow-500 text-black" : "bg-gray-800"
    }`}
  >
    À planifier
  </button>

  <button
    onClick={() => onChangeFilter("urgent")}
    className={`px-3 py-1 rounded-md text-sm ${
      activeFilter === "urgent" ? "bg-red-900" : "bg-gray-800"
    }`}
  >
    Urgents
  </button>

  <button
    onClick={() => onChangeFilter("important")}
    className={`px-3 py-1 rounded-md text-sm ${
      activeFilter === "important" ? "bg-blue-700" : "bg-gray-800"
    }`}
  >
    Importants
  </button>
</div>


<button
  onClick={() => {
    onRefresh(); // 🔥 déclenche le backend (analyse réelle)

    setLocalAnalyzing(true); // 🎨 UX uniquement

    setTimeout(() => {
      setLocalAnalyzing(false);
    }, 2000);
  }}
  disabled={localAnalyzing}
  className="px-4 py-2 rounded-md bg-green-600 text-sm disabled:opacity-50"
>
  {localAnalyzing ? "Analyse lancée…" : "Analyser maintenant"}
</button>

    </div>
  );
}
