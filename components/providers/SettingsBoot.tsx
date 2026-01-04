"use client";

import { useSettings } from "@/hooks/useSettings";

export default function SettingsBoot({ children }: { children: React.ReactNode }) {
  // Charge settings dès le boot (et applique le thème via le hook)
  useSettings();
  return <>{children}</>;
}
