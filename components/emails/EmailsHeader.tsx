"use client";

import { useState, useRef, useEffect } from "react";

type Period = "today" | "7d" | "30d";

type LeadFilter =
  | "all"
  | "new_lead"
  | "qualifying"
  | "slots_proposed"
  | "booked"
  | "rejected"
  | "qualified"
  | "unqualified"
  | "other";

export function EmailsHeader({
  activeFilter,
  onChangeFilter,
  onRefresh,
  refreshing,
  period,
  onChangePeriod,
  filterCounts,
  hideFilters = false,
}: {
  activeFilter: LeadFilter;
  onChangeFilter: (filter: LeadFilter) => void;
  onRefresh: () => void;
  refreshing: boolean;
  period: Period;
  onChangePeriod: (p: Period) => void;
  filterCounts?: { all: number; new_lead: number; qualifying: number; slots_proposed: number; booked: number; rejected: number };
  hideFilters?: boolean;
}) {
  const [localAnalyzing, setLocalAnalyzing] = useState(false);
  const analyzingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (analyzingTimeoutRef.current) clearTimeout(analyzingTimeoutRef.current);
    };
  }, []);

  const pill = (active: boolean) =>
    `px-3 py-1 rounded-md text-sm ${active ? "bg-blue-600" : "bg-gray-800"}`;

  const chip = (active: boolean, tone: "neutral" | "warn" | "success" = "neutral") => {
    const base = `px-3 py-1 rounded-md text-sm ${active ? "text-white" : "text-gray-200"} `;
    if (!active) return base + "bg-gray-800";

    if (tone === "warn") return base + "bg-orange-600";
    if (tone === "success") return base + "bg-green-600";
    return base + "bg-gray-700";
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Title + actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col">
  <h1 className="text-xl font-bold">Pipeline des Leads</h1>
  <div className="text-xs text-gray-400">
    Nouveaux → Qualification → RDV proposé → Confirmé
  </div>
  <div className="text-xs text-gray-400">
    On ne traite plus des emails — on traite des dossiers locatifs.
  </div>
</div>


        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              if (analyzingTimeoutRef.current) clearTimeout(analyzingTimeoutRef.current);
              onRefresh();
              setLocalAnalyzing(true);
              analyzingTimeoutRef.current = setTimeout(() => {
                analyzingTimeoutRef.current = null;
                if (isMountedRef.current) setLocalAnalyzing(false);
              }, 2000);
            }}
            disabled={localAnalyzing || refreshing}
            className="px-4 py-2 rounded-md bg-green-600 text-sm disabled:opacity-50"
          >
            {localAnalyzing || refreshing ? "Analyse lancée…" : "Analyser maintenant"}
          </button>

          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md bg-gray-700 text-sm hover:bg-gray-600"
          >
            🔄 Mettre à jour
          </button>
        </div>
      </div>

      {/* Period */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button onClick={() => onChangePeriod("today")} className={pill(period === "today")}>
            Aujourd’hui
          </button>
          <button onClick={() => onChangePeriod("7d")} className={pill(period === "7d")}>
            7 jours
          </button>
          <button onClick={() => onChangePeriod("30d")} className={pill(period === "30d")}>
            30 jours
          </button>
        </div>

        {/* Filtres rapides : Tous / Nouveaux / Qualification / Slots / Visites / Refusés */}
        {!hideFilters && (
          <div className="flex gap-2 flex-wrap">
            {[
              { key: "all" as const, label: "Tous" },
              { key: "new_lead" as const, label: "Nouveaux" },
              { key: "qualifying" as const, label: "Qualification", tone: "warn" as const },
              { key: "slots_proposed" as const, label: "Slots" },
              { key: "booked" as const, label: "Visites", tone: "success" as const },
              { key: "rejected" as const, label: "Refusés" },
            ].map(({ key, label, tone }) => (
              <button
                key={key}
                onClick={() => onChangeFilter(key)}
                className={chip(activeFilter === key, tone ?? "neutral")}
              >
                {label}
                {filterCounts && filterCounts[key] !== undefined && (
                  <span className="ml-1.5 opacity-80">({filterCounts[key]})</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
