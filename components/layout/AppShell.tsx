"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex">
      <Sidebar />

      <main className="flex-1 flex flex-col bg-slate-900/60">
        {/* HEADER */}
        <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Tableau de bord
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              Votre journée optimisée
            </h1>
          </div>

          {/* ✅ BOUTON SUPPRIMÉ ICI : il reste seulement celui dans DashboardClient */}
          <div />
        </header>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
