"use client";

import { useState } from "react";

export default function RefreshButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1️⃣ Gmail sync
      const gmailRes = await fetch("/api/gmail/sync");
      if (!gmailRes.ok) {
        throw new Error("Erreur lors de l’analyse Gmail");
      }

      // 2️⃣ Calendar sync
      const calendarRes = await fetch("/api/calendar/sync");
      if (!calendarRes.ok) {
        throw new Error("Erreur lors de l’analyse Calendar");
      }

      // 3️⃣ Refresh de la page pour recharger les données
      window.location.reload();
    } catch (err: any) {
      setError(err.message ?? "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleRefresh}
        disabled={loading}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition
          ${
            loading
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : "bg-white text-black hover:bg-gray-200"
          }`}
      >
        {loading ? "Analyse en cours…" : "Actualiser maintenant"}
      </button>

      {error && (
        <span className="text-sm text-red-500">
          {error}
        </span>
      )}
    </div>
  );
}
