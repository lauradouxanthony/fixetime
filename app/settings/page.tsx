"use client";

import { useState } from "react";
import { useSettings } from "@/hooks/useSettings";

/* ---------------- UI: "Bientôt disponible" ---------------- */

function SoonBadge() {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
      Bientôt
    </span>
  );
}

function DisabledBlock({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="opacity-50 pointer-events-none space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <SoonBadge />
      </div>
      {description && (
        <p className="text-xs text-slate-500">{description}</p>
      )}
    </div>
  );
}

/* ---------------- TYPES LOCAUX (V1) ---------------- */

type EmailCategoryAction = "important" | "analyze" | "ignore";

type EmailCategoryKey =
  | "clients"
  | "bank"
  | "partners"
  | "newsletters";

/* ---------------- PAGE ---------------- */

export default function SettingsPage() {
  const { settings, updateSettings, loading } = useSettings();

  /* 🔒 STATE LOCAL – aucune dépendance backend pour l’instant */
  const [emailPrefs, setEmailPrefs] = useState<
    Record<EmailCategoryKey, EmailCategoryAction>
  >({
    clients: "important",
    bank: "important",
    partners: "analyze",
    newsletters: "ignore",
  });

  if (loading) {
    return <p className="text-sm text-slate-400">Chargement…</p>;
  }

  if (!settings) {
    return (
      <p className="text-sm text-slate-400">
        Impossible de charger les paramètres.
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* HEADER */}
      <section>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-slate-500">
          Personnalisez FixTime selon vos préférences.
        </p>
      </section>

      {/* ---------------- THEME ---------------- */}
      <section className="rounded-2xl bg-card border border-border p-5 flex justify-between items-center">
        <div>
          <p className="text-sm font-medium">Thème</p>
          <p className="text-xs text-slate-500">Clair / Sombre</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => updateSettings({ theme: "light" })}
            className={`px-3 py-2 rounded-md border ${
              settings.theme === "light"
                ? "border-sky-500 bg-sky-500/10"
                : "border-border"
            }`}
          >
            Clair
          </button>

          <button
            onClick={() => updateSettings({ theme: "dark" })}
            className={`px-3 py-2 rounded-md border ${
              settings.theme === "dark"
                ? "border-sky-500 bg-sky-500/10"
                : "border-border"
            }`}
          >
            Sombre
          </button>
        </div>
      </section>
 {/* ---------------- RULES: SENDERS ---------------- */}
<section className="rounded-2xl bg-card border border-border p-5 space-y-4">
  <h2 className="text-sm font-semibold">Expéditeurs prioritaires</h2>

  <p className="text-xs text-slate-500">
    Ces règles ont priorité absolue sur l’IA.
  </p>

  <div className="space-y-3">
    <div>
      <label className="text-xs text-slate-500">
        Toujours importants (ex: @client.com)
      </label>
      <input
        type="text"
        className="w-full mt-1 rounded-md bg-background border border-border px-3 py-2 text-sm"
        placeholder="@client.com, @banque.fr"
        value={settings.email_rules.always_important.join(", ")}
        onChange={(e) =>
          updateSettings({
            email_rules: {
              ...settings.email_rules,
              always_important: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            },
          })
        }
      />
    </div>

    <div>
      <label className="text-xs text-slate-500">
        Toujours ignorés (ex: @promo.com)
      </label>
      <input
        type="text"
        className="w-full mt-1 rounded-md bg-background border border-border px-3 py-2 text-sm"
        placeholder="@promo.com, @newsletter.com"
        value={settings.email_rules.always_ignore.join(", ")}
        onChange={(e) =>
          updateSettings({
            email_rules: {
              ...settings.email_rules,
              always_ignore: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            },
          })
        }
      />
    </div>
  </div>
</section>
     
     {/* ---------------- RULES: KEYWORDS ---------------- */}
<section className="rounded-2xl bg-card border border-border p-5 space-y-4">
<h2 className="text-sm font-semibold">Mots-clés métier</h2>

<p className="text-xs text-slate-500">
Utilisés pour prioriser ou ignorer certains emails.
</p>

<div className="space-y-3">
<div>
<label className="text-xs text-slate-500">
Mots-clés urgents
</label>
<input
type="text"
className="w-full mt-1 rounded-md bg-background border border-border px-3 py-2 text-sm"
placeholder="facture, URSSAF, impôts"
value={settings.email_rules.keywords.urgent.join(", ")}
onChange={(e) =>
updateSettings({
email_rules: {
...settings.email_rules,
keywords: {
...settings.email_rules.keywords,
urgent: e.target.value
.split(",")
.map((v) => v.trim())
.filter(Boolean),
},
},
})
}
/>
</div>

<div>
<label className="text-xs text-slate-500">
Mots-clés à ignorer
</label>
<input
type="text"
className="w-full mt-1 rounded-md bg-background border border-border px-3 py-2 text-sm"
placeholder="promo, newsletter"
value={settings.email_rules.keywords.ignore.join(", ")}
onChange={(e) =>
updateSettings({
email_rules: {
...settings.email_rules,
keywords: {
...settings.email_rules.keywords,
ignore: e.target.value
.split(",")
.map((v) => v.trim())
.filter(Boolean),
},
},
})
}
/>
</div>
</div>
</section>
 {/* ---------------- AUTOMATION (SOON) ---------------- */}
<section className="rounded-2xl bg-card border border-border p-5 space-y-3 opacity-50 pointer-events-none">
  <div className="flex items-center justify-between">
    <h2 className="text-sm font-semibold">Assistant IA</h2>
    <SoonBadge />
  </div>

  <p className="text-xs text-slate-500">
    Bientôt disponible — vous pourrez choisir le niveau d’automatisation.
  </p>

  {[
    { key: "suggest", label: "Suggestions uniquement" },
    { key: "prepare", label: "Préparation assistée" },
    { key: "propose", label: "Propositions d’actions" },
  ].map((opt) => (
    <label
      key={opt.key}
      className={`flex gap-3 items-center p-3 rounded-xl border ${
        settings.automation_level === opt.key
          ? "border-sky-500 bg-sky-500/10"
          : "border-border"
      }`}
    >
      <input
        type="radio"
        checked={settings.automation_level === opt.key}
        readOnly
      />
      <span className="text-sm">{opt.label}</span>
    </label>
  ))}
</section>


      {/* ---------------- EMAIL PREFERENCES (V1) ---------------- */}
      <section className="rounded-2xl bg-card border border-border p-5 space-y-4 opacity-50 pointer-events-none">
      <div className="flex items-center justify-between">
  <h2 className="text-sm font-semibold">Préférences emails</h2>
  <SoonBadge />
</div>

        <p className="text-xs text-slate-500">
          Ces règles ont priorité sur l’IA.
        </p>

        <div className="space-y-3 text-sm">
          {(
            [
              { key: "clients", label: "Emails clients" },
              { key: "bank", label: "Banque / finance" },
              { key: "partners", label: "Partenaires" },
              { key: "newsletters", label: "Newsletters" },
            ] as const
          ).map((row) => (
            <div
              key={row.key}
              className="flex justify-between items-center"
            >
              <span>{row.label}</span>

              <select
  className="rounded-md bg-background border border-border px-2 py-1"
  value={settings.email_rules[row.key] ?? "analyze"}
  onChange={(e) =>
    updateSettings({
      email_rules: {
        ...settings.email_rules,
        [row.key]: e.target.value,
      },
    })
  }
>

  <option value="important">Important</option>
  <option value="analyze">À analyser</option>
  <option value="ignore">Ignorer</option>
</select>

            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500 italic">
          (connexion à l’IA et stockage à l’étape suivante)
        </p>
      </section>
     

{/* ---------------- EMAILS: HISTORIQUE IA (SOON) ---------------- */}
<section className="rounded-2xl bg-card border border-border p-5 space-y-4">
  <h2 className="text-sm font-semibold">Historique & contrôle</h2>

  <DisabledBlock
    title="Historique des décisions IA"
    description="Voir comment FixTime a classé vos emails dans le temps."
  />

  <DisabledBlock
    title="Réglages avancés par dossiers"
    description="Appliquer des règles différentes selon les labels Gmail."
  />
</section>

{/* ---------------- ASSISTANT: OPTIONS (SOON) ---------------- */}
<section className="rounded-2xl bg-card border border-border p-5 space-y-4">
  <h2 className="text-sm font-semibold">Assistant FixTime (bientôt)</h2>

  <DisabledBlock
    title="Ton de l’assistant"
    description="Direct / neutre / détaillé."
  />

  <DisabledBlock
    title="Horaires de travail"
    description="Limiter les suggestions aux heures ouvrées."
  />

  <DisabledBlock
    title="Validation obligatoire"
    description="Même au niveau 3, rien n’est exécuté sans confirmation."
  />
</section>

{/* ---------------- APPARENCE: OPTIONS (SOON) ---------------- */}
<section className="rounded-2xl bg-card border border-border p-5 space-y-4">
  <h2 className="text-sm font-semibold">Apparence (bientôt)</h2>

  <DisabledBlock title="Densité de l’interface" description="Compact / Confort / Large." />
  <DisabledBlock title="Mode Focus" description="Masquer le non essentiel." />
</section>

{/* ---------------- GENERAL SETTINGS (SOON) ---------------- */}
<section className="rounded-2xl bg-card border border-border p-5 space-y-4">
  <h2 className="text-sm font-semibold">Paramètres généraux (bientôt)</h2>

  <DisabledBlock title="Langue (FR / EN)" />
  <DisabledBlock title="Fuseau horaire" />
  <DisabledBlock title="Format de date" />
</section>

{/* ---------------- ROADMAP (SOON) ---------------- */}
<section className="rounded-2xl bg-muted border border-border p-5 space-y-2">
  <h2 className="text-sm font-semibold">🚀 À venir dans FixTime</h2>
  <ul className="text-xs text-slate-500 list-disc pl-5 space-y-1">
    <li>Automatisation avancée (préparer / proposer)</li>
    <li>Suggestions contextuelles (apprentissage)</li>
    <li>Multi-langue</li>
    <li>Gestion d’équipe</li>
  </ul>
</section>

    </div>
  );
}
