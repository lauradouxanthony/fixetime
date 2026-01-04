"use client";

import { useState } from "react";

type Email = {
  decision?: string | null;
  estimated_time?: number | null;
  is_urgent?: boolean | null;
};

const mins = (n: number) => `${Math.max(0, Math.round(n))} min`;

export function ExecutiveSummary({ emails }: { emails: Email[] }) {
  if (!emails || emails.length === 0) return null;

  // 🔁 État repli / dépli
  const [open, setOpen] = useState(false);

  // Comptages
  const urgent = emails.filter((e) => e.is_urgent);
  const toTreat = emails.filter((e) => e.decision === "traiter");
  const toPlan = emails.filter((e) => e.decision === "planifier");
  const ignored = emails.filter((e) => e.decision === "ignorer");

  // Temps estimés (fallback 5 min)
  const sumTime = (arr: Email[]) =>
    arr.reduce((sum, e) => sum + (e.estimated_time ?? 5), 0);

  const urgentTime = sumTime(urgent);
  const treatTime = sumTime(toTreat);
  const planTime = sumTime(toPlan);

  const totalActionTime = treatTime + planTime;
  const hasPlan = toTreat.length > 0 || toPlan.length > 0;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
      {/* HEADER (toujours visible) */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-gray-400">Résumé exécutif</div>
          <div className="text-lg font-semibold text-white">
            Votre plan d’action
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasPlan && (
            <div className="text-xs px-3 py-1 rounded-full border border-gray-800 bg-gray-950 text-gray-300">
              ⏱️ Total ≈ {mins(totalActionTime)}
            </div>
          )}

          <button
            onClick={() => setOpen(!open)}
            className="text-xs px-3 py-1 rounded-full border border-gray-800 bg-gray-950 text-gray-300 hover:bg-gray-800 transition"
          >
            {open ? "Masquer" : "Voir le détail"}
          </button>
        </div>
      </div>

      {/* CONTENU DÉTAILLÉ (repliable) */}
      {open && (
        <>
          {/* Urgents (affiché seulement s’il y en a) */}
          {urgent.length > 0 && (
            <div className="text-sm text-white">
              🔥 <span className="font-semibold">{urgent.length}</span> urgents{" "}
              <span className="text-gray-400">(≈ {mins(urgentTime)})</span>
            </div>
          )}

          {/* Bloc Plan d’action */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-3 space-y-1">
            <div className="text-xs text-gray-400">À faire ensuite</div>

            {toTreat.length > 0 ? (
              <div className="text-sm text-white">
                ✅ Traiter{" "}
                <span className="font-semibold">{toTreat.length}</span> emails{" "}
                <span className="text-gray-400">(≈ {mins(treatTime)})</span>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                — Aucun email à traiter
              </div>
            )}

            {toPlan.length > 0 ? (
              <div className="text-sm text-white">
                🗓️ Planifier{" "}
                <span className="font-semibold">{toPlan.length}</span> réponses{" "}
                <span className="text-gray-400">(≈ {mins(planTime)})</span>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                — Rien à planifier
              </div>
            )}

            <div className="text-xs text-gray-500 pt-1">
              FixTime a déjà trié votre inbox. Vous n’avez plus qu’à exécuter.
            </div>
          </div>

          {/* Info légère */}
          {ignored.length > 0 && (
            <div className="text-xs text-gray-500">
              💤 {ignored.length} emails ignorables sur la période sélectionnée.
            </div>
          )}
        </>
      )}
    </div>
  );
}
