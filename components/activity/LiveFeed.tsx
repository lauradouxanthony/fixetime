"use client";

import useSWR from "swr";

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffH < 24) return `il y a ${diffH}h`;
  if (diffD < 7) return `il y a ${diffD}j`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

type ActivityItem = {
  id: string;
  created_at: string;
  actor: string;
  type: string;
  title: string;
  email_id?: string | null;
  meta?: Record<string, unknown>;
};

export function LiveFeed() {
  const { data, error, isLoading, mutate } = useSWR<{ items: ActivityItem[] }>(
    "/api/activity/recent?limit=20",
    (url) => fetch(url, { cache: "no-store", credentials: "include" }).then((r) => r.json()),
    { refreshInterval: 30000 }
  );

  const items = data?.items ?? [];

  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
      <div className="p-3 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Live Feed</span>
        <button
          type="button"
          onClick={() => mutate()}
          className="text-[10px] text-slate-500 hover:text-slate-400"
        >
          Actualiser
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && (
          <div className="text-xs text-slate-500 py-4 text-center">Chargement…</div>
        )}
        {error && (
          <div className="text-xs text-amber-500 py-2">Erreur chargement</div>
        )}
        {!isLoading && !error && items.length === 0 && (
          <div className="text-xs text-slate-500 py-4 text-center">Aucune activité récente</div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="text-[11px] p-2 rounded-lg bg-slate-800/50 border border-slate-800/80"
          >
            <p className="text-slate-200 truncate" title={item.title}>{item.title}</p>
            <p className="text-slate-500 mt-0.5">{formatTimeAgo(item.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
