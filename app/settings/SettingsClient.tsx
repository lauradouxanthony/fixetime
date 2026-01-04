"use client";

import { useSettings } from "@/lib/hooks/useSettings";

export default function SettingsClient() {
  const { settings, loading, updateSettings } = useSettings();

  if (loading || !settings) {
    return (
      <p className="text-sm text-slate-400">
        Chargement des paramètres…
      </p>
    );
  }

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-xl font-semibold">Paramètres</h1>
        <p className="text-sm text-slate-400">
          Personnalisez le fonctionnement de FixTime.
        </p>
      </div>

      {/* PROFIL */}
      <section className="rounded-xl border border-slate-800 p-4 space-y-4">
        <h2 className="text-sm font-semibold">Profil & Général</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400">Langue</label>
            <select
              value={settings.language}
              onChange={(e) =>
                updateSettings({ language: e.target.value as "fr" | "en" })
              }
              className="mt-1 w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-sm"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400">Format horaire</label>
            <select
              value={settings.time_format}
              onChange={(e) =>
                updateSettings({
                  time_format: e.target.value as "12h" | "24h",
                })
              }
              className="mt-1 w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-sm"
            >
              <option value="24h">24h</option>
              <option value="12h">12h</option>
            </select>
          </div>
        </div>
      </section>

      {/* IA */}
      <section className="rounded-xl border border-slate-800 p-4 space-y-3">
        <h2 className="text-sm font-semibold">
          Fonctionnement de l’assistant IA
        </h2>

        {[
          { key: "suggestions", label: "Suggestions uniquement" },
          { key: "semi", label: "Semi-automatique" },
          { key: "advanced", label: "Automatisation avancée" },
        ].map((opt) => (
          <label
            key={opt.key}
            className="flex items-center gap-3 rounded-lg border border-slate-700 p-3 cursor-pointer"
          >
            <input
              type="radio"
              checked={settings.automation_level === opt.key}
              onChange={() =>
                updateSettings({
                  automation_level: opt.key as any,
                })
              }
            />
            <span className="text-sm">{opt.label}</span>
          </label>
        ))}
      </section>

    </div>
  );
}
