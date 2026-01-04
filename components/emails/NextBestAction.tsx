"use client";

type Email = {
  subject?: string | null;
  decision?: string | null;
  estimated_time?: number | null;
  is_urgent?: boolean | null;
};

export function NextBestAction({ emails }: { emails: Email[] }) {
  if (!emails || emails.length === 0) return null;

  // Priorité stricte : urgent + traiter
  const candidates = emails
    .filter((e) => e.decision === "traiter")
    .sort((a, b) => {
      const au = a.is_urgent ? 1 : 0;
      const bu = b.is_urgent ? 1 : 0;
      return bu - au; // urgents d'abord
    });

  if (candidates.length === 0) return null;

  const next = candidates[0];

  return (
    <div className="rounded-xl border border-gray-800 bg-gradient-to-r from-gray-900 to-gray-800 p-4">
      <div className="text-xs text-gray-400 mb-1">
        Prochaine action recommandée
      </div>

      <div className="text-sm text-white font-medium">
        🔥 {next.subject || "Email à traiter"}
      </div>

      <div className="text-xs text-gray-400 mt-1">
        Impact élevé · ≈ {next.estimated_time ?? 5} min
      </div>
    </div>
  );
}
