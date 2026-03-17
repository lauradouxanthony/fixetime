"use client";

import type { PipelineRow } from "@/lib/pipeline/derivePipelineRow";
import type { Email } from "@/types/email";

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "—";
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

function scoreBadgeCls(score: number): string {
  if (score >= 8) return "bg-green-600 text-white";
  if (score >= 5) return "bg-orange-500 text-white";
  return "bg-slate-600 text-slate-200";
}

type PipelineTableProps = {
  emails: Email[];
  pipelineRows: PipelineRow[];
  selectedId: string | null;
  onSelect: (email: Email) => void;
  loading: boolean;
};

export function PipelineTable({
  emails,
  pipelineRows,
  selectedId,
  onSelect,
  loading,
}: PipelineTableProps) {
  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-slate-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (emails.length === 0 || pipelineRows.length === 0) {
    return (
      <div className="p-6 text-sm text-slate-500 text-center">
        Aucun candidat pour ces filtres.
      </div>
    );
  }

  const rowByEmailId = new Map(pipelineRows.map((r) => [r.id, r]));

  return (
    <div className="divide-y divide-slate-800">
      {emails.map((email) => {
        const row = rowByEmailId.get(email.id);
        if (!row) return null;
        const isSelected = selectedId === email.id;
        return (
          <button
            key={email.id}
            type="button"
            onClick={() => onSelect(email)}
            className={`w-full text-left px-4 py-3 transition-colors ${
              isSelected ? "bg-sky-900/40 border-l-2 border-sky-500" : "hover:bg-slate-800/50 border-l-2 border-transparent"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white truncate">{row.candidate_name}</span>
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${scoreBadgeCls(row.lead_score)}`}>
                    {row.lead_score}/10
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded ${
                      row.intent === "LOCATION" ? "bg-blue-900/50 text-blue-200" : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {row.intent === "LOCATION" ? "LOCATION" : "INFO"}
                  </span>
                  <span className="text-[11px] text-slate-500">{row.status_label}</span>
                  {row.property_rent != null && row.property_rent > 0 && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-200">
                      Loyer: {row.property_rent}€
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5" title={row.last_action_label}>
                  {row.last_action_label} {row.last_action_at ? ` · ${formatTimeAgo(row.last_action_at)}` : ""}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
