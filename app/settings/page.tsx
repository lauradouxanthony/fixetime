"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";

type Tab = "locatif" | "faq" | "calendrier" | "ia";
type FaqEntry = { id: string; question: string; reponse: string };

const DAYS_FR = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/* ── API HELPERS ── */

async function loadSection<T>(section: string, defaultVal: T): Promise<T> {
  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const rules = data?.email_rules;
      if (rules && typeof rules === "object" && rules[`ft_${section}`] !== undefined) {
        return rules[`ft_${section}`] as T;
      }
    }
  } catch { /* silent */ }
  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(`fixetime_${section}`);
    if (stored) return JSON.parse(stored) as T;
  } catch { /* silent */ }
  return defaultVal;
}

async function saveSection(section: string, data: unknown): Promise<void> {
  // Always save to localStorage
  try { localStorage.setItem(`fixetime_${section}`, JSON.stringify(data)); } catch { /* silent */ }
  // Save to API
  try {
    // Read current email_rules first
    const res = await fetch("/api/settings", { cache: "no-store" });
    const current = res.ok ? await res.json() : {};
    const currentRules = (current?.email_rules && typeof current.email_rules === "object")
      ? current.email_rules : {};
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_rules: { ...currentRules, [`ft_${section}`]: data } }),
    });
  } catch { /* silent - localStorage is the fallback */ }
}

/* ── COMPOSANTS UI ── */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-sm font-medium rounded-lg transition-all"
      style={active ? { background: "rgb(238 242 255)", color: "rgb(79 70 229)" } : { color: "rgb(100 116 139)" }}
    >
      {children}
    </button>
  );
}

function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-xl border bg-white p-5 space-y-4" style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      {title && <h3 className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>{title}</h3>}
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium block mb-1" style={{ color: "rgb(71 85 105)" }}>{children}</label>;
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
      style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
    />
  );
}

function SaveButton({ onClick, saved, loading }: { onClick: () => void; saved: boolean; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-50"
      style={{ background: saved ? "rgb(22 163 74)" : "rgb(79 70 229)" }}
    >
      {loading ? "Enregistrement…" : saved ? "✅ Enregistré" : "Enregistrer"}
    </button>
  );
}

/* ── TAB 1 : RÈGLES LOCATIVES ── */
function TabLocatif() {
  const [multiplicateur, setMultiplicateur] = useState(3);
  const [profils, setProfils] = useState({ cdi: true, cdd: true, auto: false, retraite: true, garant: true });
  const [docs, setDocs] = useState({ fiches_paie: true, contrat: true, avis_imposition: true, piece_identite: true, rib: false });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSection("locatif", { multiplicateur: 3, profils, docs }).then((d: any) => {
      if (d.multiplicateur) setMultiplicateur(d.multiplicateur);
      if (d.profils) setProfils(d.profils);
      if (d.docs) setDocs(d.docs);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    await saveSection("locatif", { multiplicateur, profils, docs });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      <Card title="Critère de solvabilité">
        <div>
          <Label>Multiplicateur revenus minimum</Label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={2} max={5} step={0.5}
              value={multiplicateur}
              onChange={(e) => setMultiplicateur(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="text-lg font-bold w-12 text-center" style={{ color: "rgb(79 70 229)" }}>
              {multiplicateur}x
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>
            Revenus ≥ {multiplicateur}x le loyer pour valider la solvabilité
          </p>
        </div>
      </Card>

      <Card title="Profils acceptés">
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: "cdi", label: "CDI" },
            { key: "cdd", label: "CDD" },
            { key: "auto", label: "Auto-entrepreneur" },
            { key: "retraite", label: "Retraité" },
            { key: "garant", label: "Garant accepté" },
          ].map((p) => (
            <label key={p.key} className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg" style={{ border: "1px solid rgb(226 232 240)" }}>
              <input
                type="checkbox"
                checked={profils[p.key as keyof typeof profils]}
                onChange={(e) => setProfils({ ...profils, [p.key]: e.target.checked })}
                className="accent-indigo-600"
              />
              <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>{p.label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="Documents obligatoires">
        <div className="space-y-2">
          {[
            { key: "fiches_paie", label: "Fiches de paie (3 mois)" },
            { key: "contrat", label: "Contrat de travail" },
            { key: "avis_imposition", label: "Avis d'imposition" },
            { key: "piece_identite", label: "Pièce d'identité" },
            { key: "rib", label: "RIB" },
          ].map((d) => (
            <label key={d.key} className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg" style={{ border: "1px solid rgb(226 232 240)" }}>
              <input
                type="checkbox"
                checked={docs[d.key as keyof typeof docs]}
                onChange={(e) => setDocs({ ...docs, [d.key]: e.target.checked })}
                className="accent-indigo-600"
              />
              <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>{d.label}</span>
            </label>
          ))}
        </div>
      </Card>

      <div className="flex justify-end"><SaveButton onClick={save} saved={saved} loading={saving} /></div>
    </div>
  );
}

/* ── TAB 2 : FAQ AGENCE ── */
function TabFaq() {
  const [entries, setEntries] = useState<FaqEntry[]>([
    { id: "1", question: "Les charges sont-elles comprises ?", reponse: "Non, les charges sont en supplément." },
    { id: "2", question: "Animaux acceptés ?", reponse: "Selon le propriétaire, à préciser lors de la visite." },
  ]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSection<FaqEntry[]>("faq", entries).then((d) => { if (d.length > 0) setEntries(d); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    await saveSection("faq", entries);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const add = () => setEntries([...entries, { id: Date.now().toString(), question: "", reponse: "" }]);
  const remove = (id: string) => setEntries(entries.filter((e) => e.id !== id));
  const update = (id: string, field: "question" | "reponse", value: string) =>
    setEntries(entries.map((e) => e.id === id ? { ...e, [field]: value } : e));

  return (
    <div className="space-y-4">
      <Card title="Questions / Réponses fréquentes">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          L'IA utilise ces réponses pour traiter les emails de type "Info" automatiquement.
        </p>
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border p-3 space-y-2" style={{ borderColor: "rgb(226 232 240)" }}>
              <div>
                <Label>Question</Label>
                <Input value={entry.question} onChange={(v) => update(entry.id, "question", v)} placeholder="Ex: Charges comprises ?" />
              </div>
              <div>
                <Label>Réponse de l'IA</Label>
                <Input value={entry.reponse} onChange={(v) => update(entry.id, "reponse", v)} placeholder="Ex: Les charges sont de 80€/mois." />
              </div>
              <button onClick={() => remove(entry.id)} className="text-xs" style={{ color: "rgb(220 38 38)" }}>
                Supprimer
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={add}
          className="w-full py-2 rounded-lg text-sm border transition-colors"
          style={{ borderColor: "rgb(226 232 240)", color: "rgb(79 70 229)", borderStyle: "dashed" }}
        >
          + Ajouter une règle FAQ
        </button>
      </Card>
      <div className="flex justify-end"><SaveButton onClick={save} saved={saved} loading={saving} /></div>
    </div>
  );
}

/* ── TAB 3 : CALENDRIER ── */
function TabCalendrier() {
  const [dureeVisite, setDureeVisite] = useState(60);
  const [heureDebut, setHeureDebut] = useState(9);
  const [heureFin, setHeureFin] = useState(18);
  const [delaiPrevenanceH, setDelaiPrevenanceH] = useState(24);
  const [joursExclus, setJoursExclus] = useState<number[]>([5, 6]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSection("calendrier", { dureeVisite, heureDebut, heureFin, delaiPrevenanceH, joursExclus }).then((d: any) => {
      if (d.dureeVisite) setDureeVisite(d.dureeVisite);
      if (d.heureDebut !== undefined) setHeureDebut(d.heureDebut);
      if (d.heureFin !== undefined) setHeureFin(d.heureFin);
      if (d.delaiPrevenanceH) setDelaiPrevenanceH(d.delaiPrevenanceH);
      if (d.joursExclus) setJoursExclus(d.joursExclus);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    await saveSection("calendrier", { dureeVisite, heureDebut, heureFin, delaiPrevenanceH, joursExclus });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleJour = (idx: number) =>
    setJoursExclus((prev) => prev.includes(idx) ? prev.filter((j) => j !== idx) : [...prev, idx]);

  return (
    <div className="space-y-4">
      <Card title="Durée des visites">
        <div className="flex gap-2 flex-wrap">
          {[30, 45, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDureeVisite(d)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={dureeVisite === d ? { background: "rgb(79 70 229)", color: "white" } : { background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
            >
              {d} min
            </button>
          ))}
        </div>
      </Card>

      <Card title="Plages horaires">
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Heure de début</Label>
              <select
                value={heureDebut}
                onChange={(e) => setHeureDebut(Number(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              >
                {[8, 9, 10].map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
            <div className="flex-1">
              <Label>Heure de fin</Label>
              <select
                value={heureFin}
                onChange={(e) => setHeureFin(Number(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              >
                {[17, 18, 19, 20].map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs" style={{ color: "rgb(148 163 184)" }}>
            Créneaux proposés : jamais avant {heureDebut}h ni après {heureFin}h
          </p>
        </div>
      </Card>

      <Card title="Délai de prévenance">
        <div className="flex gap-2 flex-wrap">
          {[24, 48, 72].map((h) => (
            <button
              key={h}
              onClick={() => setDelaiPrevenanceH(h)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={delaiPrevenanceH === h ? { background: "rgb(79 70 229)", color: "white" } : { background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
            >
              {h}h minimum
            </button>
          ))}
        </div>
      </Card>

      <Card title="Jours exclus">
        <div className="flex gap-2 flex-wrap">
          {DAYS_FR.map((jour, idx) => (
            <button
              key={idx}
              onClick={() => toggleJour(idx)}
              className="px-3 py-1.5 rounded-lg text-sm transition-all"
              style={joursExclus.includes(idx) ? { background: "rgba(220,38,38,0.1)", color: "rgb(220 38 38)", border: "1px solid rgba(220,38,38,0.2)" } : { background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
            >
              {jour}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: "rgb(148 163 184)" }}>
          Aucun créneau ne sera proposé ces jours-là.
        </p>
      </Card>

      <div className="flex justify-end"><SaveButton onClick={save} saved={saved} loading={saving} /></div>
    </div>
  );
}

/* ── TAB 4 : CONFIG IA ── */
function TabIA() {
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"DRAFT" | "AUTOPILOTE">("DRAFT");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Load pipeline_mode from API
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.pipeline_mode === "AUTOPILOTE") setMode("AUTOPILOTE");
      })
      .catch(() => {});
    // Load instructions
    loadSection("ia", { instructions: "" }).then((d: any) => {
      if (d.instructions) setInstructions(d.instructions);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    await Promise.all([
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_mode: mode }),
      }),
      saveSection("ia", { instructions }),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      <Card title="Mode pipeline">
        <div className="space-y-3">
          {[
            { key: "DRAFT", label: "DRAFT", desc: "L'IA génère des brouillons, vous approuvez avant envoi." },
            { key: "AUTOPILOTE", label: "AUTOPILOTE", desc: "L'IA gère la conversation jusqu'au RDV confirmé sans intervention." },
          ].map((opt) => (
            <label
              key={opt.key}
              className="flex items-start gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all"
              style={mode === opt.key ? { background: "rgb(238 242 255)", border: "1.5px solid rgb(79 70 229)" } : { border: "1.5px solid rgb(226 232 240)" }}
            >
              <input
                type="radio"
                name="mode"
                checked={mode === opt.key as "DRAFT" | "AUTOPILOTE"}
                onChange={() => setMode(opt.key as "DRAFT" | "AUTOPILOTE")}
                className="mt-0.5 accent-indigo-600"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>{opt.label}</div>
                <div className="text-xs mt-0.5" style={{ color: "rgb(100 116 139)" }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </Card>

      <Card title="Instructions spéciales pour l'IA">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          L'IA en tiendra compte lors de l'analyse et de la rédaction des emails.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="Ex: Toujours répondre en vouvoyant. Mentionner notre adresse. Ne jamais accepter les chèques."
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
          style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
        />
      </Card>

      <div className="flex justify-end"><SaveButton onClick={save} saved={saved} loading={saving} /></div>
    </div>
  );
}

/* ── PAGE PRINCIPALE ── */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("locatif");

  const tabs: { key: Tab; label: string }[] = [
    { key: "locatif", label: "🏠 Règles locatives" },
    { key: "faq", label: "💬 FAQ Agence" },
    { key: "calendrier", label: "📅 Calendrier" },
    { key: "ia", label: "🤖 Config IA" },
  ];

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="p-6 max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "rgb(30 41 59)" }}>Paramètres</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgb(100 116 139)" }}>
              Configurez FixTime pour votre agence immobilière.
            </p>
          </div>

          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}>
            {tabs.map((t) => (
              <TabButton key={t.key} active={activeTab === t.key} onClick={() => setActiveTab(t.key)}>
                {t.label}
              </TabButton>
            ))}
          </div>

          {activeTab === "locatif" && <TabLocatif />}
          {activeTab === "faq" && <TabFaq />}
          {activeTab === "calendrier" && <TabCalendrier />}
          {activeTab === "ia" && <TabIA />}
        </div>
      </div>
    </AppShell>
  );
}
