"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Settings = {
  assistant_enabled: boolean;
  automation_level: "draft" | "autopilot"; // Normalisé: "draft" ou "autopilot"
  email_rules: {                              // ✅ AJOUTE ÇA
    always_important: string[];
    always_ignore: string[];
    keywords: {
      urgent: string[];
      ignore: string[];
    };
  };
  config: {
    ui?: {
      theme?: "dark" | "light";
      density?: "comfortable" | "compact";
    };
    rental_rules: {
      income_multiplier: number;
      accepted_employment_status?: string[];
      required_documents: string[];
      allow_guarantor: boolean;
      guarantor_required_for_status?: string[];
    };
    faq_items?: Array<{ id: string; question: string; answer: string; updated_at?: string }>;
    scheduling_rules: {
      timezone: string;
      workdays: number[];
      hours: { start: string; end: string };
      slot_duration_min: number;
      days_ahead?: number;
      min_notice_hours?: number;
      travel_buffer_min?: number;
      proposal_count?: number;
      spread_mode?: "multi_day" | "same_day_ok";
      exclude_lunch: boolean;
      constraints_text: string;
    };
    properties: Array<{
      id?: string;
      name?: string;
      address?: string;
      rent?: number;
    }>;
    agent_persona: {
      agent_name: string;
      tone: string;
      signature: string;
    };
  };
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadSettings() {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    setSettings(json?.settings ?? null);
  }

  async function updateSettings(patch: Partial<Settings>) {
    // UI optimiste
    setSettings((prev) => (prev ? ({ ...prev, ...patch } as Settings) : prev));

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "UNKNOWN_ERROR" }));
      console.error("[useSettings] Update failed:", error);
      await loadSettings();
      throw new Error(error.error || "SETTINGS_UPDATE_FAILED");
    }

    const json = await res.json();
    if (json.settings) {
      setSettings(json.settings);
    }
  }

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      await loadSettings();
      if (!cancelled) setLoading(false);
    };

    init();
    return () => { cancelled = true; };
  }, []);

  return { settings, loading, updateSettings };
}
