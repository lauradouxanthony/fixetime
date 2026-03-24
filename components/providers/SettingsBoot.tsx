"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";

export default function SettingsBoot({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [mounted, setMounted] = useState(false);
  const theme = settings?.config?.ui?.theme ?? "dark";
  const density = settings?.config?.ui?.density ?? "comfortable";

  // Appliquer le theme et la densité dès le mount (évite flash blanc)
  useEffect(() => {
    setMounted(true);
    const html = document.documentElement;
    
    // Thème
    if (theme === "light") {
      html.classList.remove("dark");
      html.classList.add("theme-light");
    } else {
      html.classList.add("dark");
      html.classList.remove("theme-light");
    }
    
    // Densité
    html.classList.remove("density-comfortable", "density-compact");
    html.classList.add(`density-${density}`);
  }, [theme, density]);

  // Appliquer immédiatement au premier render (avant que settings soit chargé)
  useEffect(() => {
    const html = document.documentElement;
    // S'assurer que dark est présent par défaut
    if (!html.classList.contains("dark") && !mounted) {
      html.classList.add("dark");
    }
    if (!html.classList.contains("density-comfortable") && !html.classList.contains("density-compact") && !mounted) {
      html.classList.add("density-comfortable");
    }
  }, [mounted]);

  return <>{children}</>;
}
