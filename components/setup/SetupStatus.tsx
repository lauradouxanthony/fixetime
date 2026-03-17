"use client";

import useSWR from "swr";

type SetupStatus = {
  google_connected: boolean;
  microsoft_connected: boolean;
  calendar_available: boolean;
  faq_count: number;
  properties_count: number;
  ready_for_autopilot: boolean;
  recommendations: string[];
};

export function SetupStatus() {
  const { data: status, error, isLoading } = useSWR<SetupStatus>(
    "/api/setup/status",
    (url) => fetch(url, { cache: "no-store", credentials: "include" }).then((r) => r.json())
  );

  if (isLoading || error || !status) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-2">État du setup</h2>
        <p className="text-xs text-slate-500">{isLoading ? "Chargement…" : "Impossible de charger."}</p>
      </div>
    );
  }

  const ready = status.ready_for_autopilot;
  const recs = status.recommendations ?? [];

  return (
    <div className={`rounded-xl border p-4 ${ready ? "border-emerald-800/60 bg-emerald-900/20" : "border-amber-800/60 bg-amber-900/20"}`}>
      <h2 className="text-sm font-semibold text-white mb-2">Prêt pour l’Autopilot</h2>
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${ready ? "bg-emerald-600/30 text-emerald-300" : "bg-amber-600/30 text-amber-300"}`}>
          {ready ? "Ready" : "Not ready"}
        </span>
      </div>
      <ul className="text-xs text-slate-400 space-y-1">
        <li>{status.google_connected ? "✓" : "✗"} Google connecté</li>
        <li>{status.microsoft_connected ? "✓" : "✗"} Microsoft connecté</li>
        <li>{status.calendar_available ? "✓" : "✗"} Calendrier disponible</li>
        <li>FAQ: {status.faq_count} entrée(s) {status.faq_count >= 5 ? "✓" : "(recommandé: 5+)"}</li>
        <li>Biens: {status.properties_count} {status.properties_count >= 1 ? "✓" : ""}</li>
      </ul>
      {recs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/60">
          <p className="text-xs font-medium text-amber-200 mb-1">Recommandations</p>
          <ul className="text-xs text-slate-400 space-y-0.5">
            {recs.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
