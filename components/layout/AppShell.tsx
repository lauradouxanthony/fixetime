import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<null | string>(null);

  async function refreshData() {
    setLoading(true);
    setStatus("Mise à jour...");

    try {
      const res = await fetch("/api/sync/all");
      const json = await res.json();

      if (!json.success) {
        setStatus("Erreur lors de la synchronisation");
      } else {
        setStatus("Synchronisé ✔️");
      }
    } catch (e) {
      console.error(e);
      setStatus("Erreur serveur");
    }

    setTimeout(() => setStatus(null), 2500);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex">
      <Sidebar />

      <main className="flex-1 flex flex-col bg-slate-900/60">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
          
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Tableau de bord
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              Votre journée optimisée
            </h1>
          </div>

          {/* Zone actions */}
          <div className="flex items-center gap-3">
            {status && (
              <span className="text-xs text-slate-300">{status}</span>
            )}

            <button
              onClick={refreshData}
              disabled={loading}
              className="text-xs bg-sky-600 hover:bg-sky-700 transition px-4 py-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Synchronisation..." : "Actualiser maintenant"}
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {children}
        </div>

      </main>
    </div>
  );
}
