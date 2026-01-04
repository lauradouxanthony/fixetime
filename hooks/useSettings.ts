"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type AutomationLevel = "suggest" | "prepare" | "propose";
export type EmailCategoryAction = "important" | "analyze" | "ignore";

export type EmailRules = {
  always_important: string[];
  always_ignore: string[];
  keywords: {
    urgent: string[];
    ignore: string[];
  };
  clients?: EmailCategoryAction;
  bank?: EmailCategoryAction;
  partners?: EmailCategoryAction;
  newsletters?: EmailCategoryAction;
};

export type SettingsV1 = {
  theme: Theme;
  automation_level: AutomationLevel;
  assistant_enabled: boolean;
  email_rules: EmailRules;

  // ✅ ajout safe (optionnel) pour SettingsClient.tsx
  language?: "fr" | "en";
  time_format?: "12h" | "24h";
};


function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsV1 | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ SOURCE UNIQUE : API
  async function loadSettings() {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });

      if (!res.ok) {
        setSettings(null);
        setLoading(false);
        return;
      }

      const data: SettingsV1 = await res.json();

      setSettings(data);

      if (data.theme) {
        applyTheme(data.theme);
      }

      setLoading(false);
    } catch (e) {
      console.error("LOAD_SETTINGS_FAILED", e);
      setSettings(null);
      setLoading(false);
    }
  }

  async function updateSettings(partial: Partial<SettingsV1>) {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev));

    if (partial.theme) {
      applyTheme(partial.theme);
    }

    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  useEffect(() => {
    loadSettings();
  }, []);

  return { settings, loading, updateSettings };
}
