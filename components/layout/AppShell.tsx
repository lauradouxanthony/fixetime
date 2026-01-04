"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar />

      <main className="flex-1 flex flex-col bg-background">
        <header className="border-b border-border px-8 py-4">
          <h1 className="text-lg font-semibold">
            Votre journée optimisée
          </h1>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
