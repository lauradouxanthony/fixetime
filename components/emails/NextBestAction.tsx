"use client";

import type { Email } from "@/types/email";

export function NextBestAction({ emails, onViewAction }: { emails: readonly Email[]; onViewAction?: () => void }) {
  if (!emails || emails.length === 0) return null;

  const slotsProposed = emails.filter((e) => e.lead_status === "slots_proposed");
  const qualifying = emails.filter((e) => e.lead_status === "qualifying");
  const newLead = emails.filter((e) => e.lead_status === "new_lead" || (e.lead_status ?? "raw") === "raw");
  const toTreat = emails.filter((e) => e.decision === "traiter").sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0));

  const action =
    slotsProposed.length > 0
      ? { count: slotsProposed.length, label: "candidats en attente de créneau", filter: "slots_proposed" }
      : qualifying.length > 0
        ? { count: qualifying.length, label: "candidats en qualification", filter: "qualifying" }
        : newLead.length > 0
          ? { count: newLead.length, label: "nouveaux candidats", filter: "new_lead" }
          : toTreat.length > 0
            ? { count: toTreat.length, label: "emails à traiter", filter: null }
            : null;

  if (!action) return null;

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2 flex items-center justify-between gap-3">
      <span className="text-[11px] text-slate-400">
        <span className="text-slate-300 font-medium">{action.count} {action.label}</span>
      </span>
      {action.filter && (
        <button
          type="button"
          onClick={onViewAction}
          className="text-[11px] text-sky-400 hover:text-sky-300 font-medium transition-colors"
        >
          Voir
        </button>
      )}
    </div>
  );
}
