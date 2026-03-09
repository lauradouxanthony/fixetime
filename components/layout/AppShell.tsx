"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex" style={{ background: "rgb(250 250 250)" }}>
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
