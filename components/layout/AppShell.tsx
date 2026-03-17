"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar fixe */}
      <Sidebar />

      {/* Colonne principale */}
      <div className="flex flex-col flex-1">
        {/* Header fixe */}
        <header className="shrink-0 border-b border-border px-8 py-4">
          <h1 className="text-lg font-semibold">Votre journée optimisée</h1>
        </header>

        {/* Contenu principal - scroll naturel avec la page */}
        <main className="flex-1 px-8 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
