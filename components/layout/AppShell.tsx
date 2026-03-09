"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "rgb(250 250 250)" }}>
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
