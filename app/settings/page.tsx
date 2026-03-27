"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";

type Tab = "locatif" | "documents" | "faq" | "calendrier" | "ia" | "compte";
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
  try {
    const stored = localStorage.getItem(`fixetime_${section}`);
    if (stored) return JSON.parse(stored) as T;
  } catch { /* silent */ }
  return defaultVal;
}

async function saveSection(section: string, data: unknown): Promise<boolean> {
  // Sauvegarde locale immédiate (fallback hors-ligne)
  try { localStorage.setItem(`fixetime_${section}`, JSON.stringify(data)); } catch { /* silent */ }
  // POST direct — le serveur merge avec l'existant (read-then-write côté serveur)
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_rules: { [`ft_${section}`]: data } }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[saveSection] POST échoué:", res.status, err);
      return false;
    }
    console.log("[saveSection] ✅ Section sauvegardée:", section);
    return true;
  } catch (e) {
    console.error("[saveSection] Erreur réseau:", e);
    return false;
  }
}

/* ── COMPOSANTS UI ── */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap"
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
const ALL_CHAMPS_QUALIFICATION = [
  { key: "situation_pro",         label: "Situation professionnelle (CDI/CDD/etc)", defaultOn: true },
  { key: "revenus_mensuels",      label: "Revenus nets mensuels", defaultOn: true },
  { key: "garant",                label: "Garant", defaultOn: true },
  { key: "animaux",               label: "Animaux", defaultOn: true },
  { key: "nb_personnes",          label: "Nombre de personnes dans le foyer", defaultOn: false },
  { key: "date_entree_souhaitee", label: "Date d'entrée souhaitée", defaultOn: false },
  { key: "duree_location",        label: "Durée de location souhaitée", defaultOn: false },
  { key: "vehicule",              label: "Véhicule (pour parking)", defaultOn: false },
];
const DEFAULT_CHAMPS = ALL_CHAMPS_QUALIFICATION.filter(c => c.defaultOn).map(c => c.key);

function TabLocatif() {
  const { toast } = useToast();
  const [nomAgence, setNomAgence] = useState("");
  const [typesBiens, setTypesBiens] = useState({ appartement: true, maison: false, studio: true, loft: false, parking: false });
  const [multiplicateur, setMultiplicateur] = useState(3);
  const [profils, setProfils] = useState({ cdi: true, cdd: true, auto: false, retraite: true, garant: true });
  const [garantObligatoire, setGarantObligatoire] = useState({ cdd: true, auto: true, etudiant: true, retraite: false });
  const [animaux, setAnimaux] = useState<"oui" | "non" | "selon">("selon");
  const [docs, setDocs] = useState({ fiches_paie: true, contrat: true, avis_imposition: true, piece_identite: true, rib: false });
  const [champsQualification, setChampsQualification] = useState<string[]>(DEFAULT_CHAMPS);
  const [customQuestion, setCustomQuestion] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSection("locatif", {
      nomAgence: "", typesBiens, multiplicateur: 3, profils,
      garantObligatoire, animaux: "selon", docs, champsQualification: DEFAULT_CHAMPS, customQuestion: "",
    }).then((d: Record<string, unknown>) => {
      if (d.nomAgence !== undefined) setNomAgence(d.nomAgence as string);
      if (d.typesBiens) setTypesBiens(d.typesBiens as typeof typesBiens);
      if (d.multiplicateur) setMultiplicateur(d.multiplicateur as number);
      if (d.profils) setProfils(d.profils as typeof profils);
      if (d.garantObligatoire) setGarantObligatoire(d.garantObligatoire as typeof garantObligatoire);
      if (d.animaux) setAnimaux(d.animaux as typeof animaux);
      if (d.docs) setDocs(d.docs as typeof docs);
      if (Array.isArray(d.champsQualification)) setChampsQualification(d.champsQualification as string[]);
      if (typeof d.customQuestion === "string") setCustomQuestion(d.customQuestion);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    const ok = await saveSection("locatif", { nomAgence, typesBiens, multiplicateur, profils, garantObligatoire, animaux, docs, champsQualification, customQuestion });
    setSaving(false);
    if (ok) {
      setSaved(true);
      toast("Règles locatives sauvegardées ✅", "success");
      setTimeout(() => setSaved(false), 2000);
    } else {
      toast("Erreur de sauvegarde — vérifiez votre connexion", "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card title="🏢 Identité de l'agence">
        <div>
          <Label>Nom de l'agence</Label>
          <Input value={nomAgence} onChange={setNomAgence} placeholder="Ex: Agence Dupont Immobilier" />
          <p className="text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>
            Utilisé par l'IA pour se présenter dans les emails.
          </p>
        </div>
        <div>
          <Label>Types de biens gérés</Label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: "appartement", label: "Appartement" },
              { key: "maison", label: "Maison" },
              { key: "studio", label: "Studio" },
              { key: "loft", label: "Loft" },
              { key: "parking", label: "Parking" },
            ].map((b) => (
              <label key={b.key} className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg" style={{ border: "1px solid rgb(226 232 240)" }}>
                <input
                  type="checkbox"
                  checked={typesBiens[b.key as keyof typeof typesBiens]}
                  onChange={(e) => setTypesBiens({ ...typesBiens, [b.key]: e.target.checked })}
                  className="accent-indigo-600"
                />
                <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>{b.label}</span>
              </label>
            ))}
          </div>
        </div>
      </Card>

      <Card title="💰 Critère de solvabilité">
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

      <Card title="👤 Profils acceptés">
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

      <Card title="🔐 Garant obligatoire pour">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          L'IA demandera systématiquement un garant pour ces profils.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: "cdd", label: "CDD" },
            { key: "auto", label: "Auto-entrepreneur" },
            { key: "etudiant", label: "Étudiant" },
            { key: "retraite", label: "Retraité" },
          ].map((p) => (
            <label key={p.key} className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg" style={{ border: "1px solid rgb(226 232 240)" }}>
              <input
                type="checkbox"
                checked={garantObligatoire[p.key as keyof typeof garantObligatoire]}
                onChange={(e) => setGarantObligatoire({ ...garantObligatoire, [p.key]: e.target.checked })}
                className="accent-indigo-600"
              />
              <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>{p.label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="🐾 Animaux acceptés">
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "oui", label: "✅ Oui" },
            { key: "non", label: "❌ Non" },
            { key: "selon", label: "🤔 Selon le bailleur" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setAnimaux(opt.key as typeof animaux)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={animaux === opt.key
                ? { background: "rgb(79 70 229)", color: "white" }
                : { background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="📋 Documents obligatoires (défaut)">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          Liste de base — personnalisez par profil dans l'onglet Documents.
        </p>
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

      <Card title="📝 Informations à collecter">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          Champs que l'IA demandera lors de la qualification d'un prospect.
        </p>
        <div className="space-y-2">
          {ALL_CHAMPS_QUALIFICATION.map((c) => (
            <label key={c.key} className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg" style={{ border: "1px solid rgb(226 232 240)" }}>
              <input
                type="checkbox"
                checked={champsQualification.includes(c.key)}
                onChange={(e) => {
                  if (e.target.checked) setChampsQualification([...champsQualification, c.key]);
                  else setChampsQualification(champsQualification.filter((k) => k !== c.key));
                }}
                className="accent-indigo-600"
              />
              <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>{c.label}</span>
            </label>
          ))}
        </div>
        <div className="pt-2">
          <Label>Question personnalisée (optionnel)</Label>
          <Input
            value={customQuestion}
            onChange={setCustomQuestion}
            placeholder="Ex: Avez-vous un véhicule ?"
          />
        </div>
      </Card>

      <div className="flex justify-end"><SaveButton onClick={save} saved={saved} loading={saving} /></div>
    </div>
  );
}

/* ── TAB 2 : DOCUMENTS PAR PROFIL ── */

type DocItem = { label: string; required: boolean };
type DocProfileData = { docs: DocItem[] };
type DocumentsSettings = {
  CDI: DocProfileData;
  CDD: DocProfileData;
  ETUDIANT: DocProfileData;
  AUTO_ENTREPRENEUR: DocProfileData;
  RETRAITE: DocProfileData;
};

const DEFAULT_DOCS_V2: DocumentsSettings = {
  CDI: {
    docs: [
      { label: "3 dernières fiches de paie", required: true },
      { label: "Contrat de travail CDI", required: true },
      { label: "Dernier avis d'imposition", required: true },
      { label: "Pièce d'identité", required: true },
    ],
  },
  CDD: {
    docs: [
      { label: "3 dernières fiches de paie", required: true },
      { label: "Contrat de travail CDD", required: true },
      { label: "Dernier avis d'imposition", required: true },
      { label: "Pièce d'identité", required: true },
      { label: "2 derniers relevés bancaires", required: true },
    ],
  },
  ETUDIANT: {
    docs: [
      { label: "Carte étudiante", required: true },
      { label: "Justificatif de bourse ou financement", required: true },
      { label: "Pièce d'identité", required: true },
      { label: "Garant obligatoire (fiches de paie + pièce d'identité)", required: true },
    ],
  },
  AUTO_ENTREPRENEUR: {
    docs: [
      { label: "3 derniers bilans ou avis d'imposition", required: true },
      { label: "Pièce d'identité", required: true },
      { label: "2 derniers relevés bancaires", required: true },
      { label: "Extrait Kbis ou SIREN", required: true },
    ],
  },
  RETRAITE: {
    docs: [
      { label: "3 derniers relevés de pension", required: true },
      { label: "Dernier avis d'imposition", required: true },
      { label: "Pièce d'identité", required: true },
    ],
  },
};

const PROFILE_LABELS: Record<keyof DocumentsSettings, string> = {
  CDI: "CDI / Salarié",
  CDD: "CDD",
  ETUDIANT: "Étudiant",
  AUTO_ENTREPRENEUR: "Indépendant",
  RETRAITE: "Retraité",
};

function DocProfileEditor({
  docs,
  onChange,
}: {
  docs: DocItem[];
  onChange: (docs: DocItem[]) => void;
}) {
  const [newLabel, setNewLabel] = useState("");

  const add = () => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    onChange([...docs, { label: trimmed, required: true }]);
    setNewLabel("");
  };

  const remove = (idx: number) => onChange(docs.filter((_, i) => i !== idx));

  const toggleRequired = (idx: number) =>
    onChange(docs.map((d, i) => i === idx ? { ...d, required: !d.required } : d));

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {docs.map((doc, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}
          >
            {/* Required toggle */}
            <input
              type="checkbox"
              checked={doc.required}
              onChange={() => toggleRequired(idx)}
              className="accent-indigo-600 flex-shrink-0"
              title="Obligatoire"
            />
            <span className="text-xs flex-1" style={{ color: "rgb(30 41 59)" }}>{doc.label}</span>
            <span
              className="text-xs flex-shrink-0 px-1.5 py-0.5 rounded"
              style={doc.required
                ? { background: "rgb(238 242 255)", color: "rgb(79 70 229)" }
                : { background: "rgb(248 250 252)", color: "rgb(148 163 184)", border: "1px solid rgb(226 232 240)" }}
            >
              {doc.required ? "Obligatoire" : "Optionnel"}
            </span>
            <button
              onClick={() => remove(idx)}
              className="text-xs flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors hover:opacity-70"
              style={{ color: "rgb(220 38 38)" }}
              title="Supprimer"
            >
              ×
            </button>
          </div>
        ))}
        {docs.length === 0 && (
          <div className="text-xs text-center py-4" style={{ color: "rgb(148 163 184)" }}>
            Aucun document configuré
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Ajouter un document…"
          className="flex-1 rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
          style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
        />
        <button
          onClick={add}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)" }}
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

function TabDocuments() {
  const { toast } = useToast();
  const [data, setData] = useState<DocumentsSettings>(DEFAULT_DOCS_V2);
  const [activeProfile, setActiveProfile] = useState<keyof DocumentsSettings>("CDI");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSection<DocumentsSettings>("documents_v2", DEFAULT_DOCS_V2).then((d) => {
      // Basic shape check — must have CDI key
      if (d && d.CDI) setData(d);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const ok = await saveSection("documents_v2", data);
    setSaving(false);
    if (ok) {
      setSaved(true);
      toast("Documents sauvegardés ✅", "success");
      setTimeout(() => setSaved(false), 2000);
    } else {
      toast("Erreur de sauvegarde — vérifiez votre connexion", "error");
    }
  };

  const profileKeys = Object.keys(PROFILE_LABELS) as (keyof DocumentsSettings)[];

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
          Configurez la liste de documents demandée par l&apos;IA selon le profil du candidat.
          Cochez la case pour marquer un document comme obligatoire ou optionnel.
        </p>
      </Card>

      {/* Profile tabs */}
      <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}>
        {profileKeys.map((key) => (
          <button
            key={key}
            onClick={() => setActiveProfile(key)}
            className="px-3 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap"
            style={activeProfile === key
              ? { background: "rgb(238 242 255)", color: "rgb(79 70 229)" }
              : { color: "rgb(100 116 139)" }}
          >
            {PROFILE_LABELS[key]}
            <span
              className="ml-1.5 text-xs rounded-full px-1.5 py-0.5"
              style={activeProfile === key
                ? { background: "rgb(79 70 229)", color: "white" }
                : { background: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
            >
              {data[key].docs.length}
            </span>
          </button>
        ))}
      </div>

      <Card title={`📄 ${PROFILE_LABELS[activeProfile]}`}>
        <DocProfileEditor
          docs={data[activeProfile].docs}
          onChange={(docs) => setData({ ...data, [activeProfile]: { docs } })}
        />
      </Card>

      <div className="flex justify-end"><SaveButton onClick={save} saved={saved} loading={saving} /></div>
    </div>
  );
}

/* ── TAB 3 : FAQ AGENCE ── */
function TabFaq() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<FaqEntry[]>([
    { id: "1", question: "Comment se déroule la visite ?", reponse: "La visite dure environ 30 minutes, accompagnée de notre agent. Munissez-vous d'une pièce d'identité." },
    { id: "2", question: "Quels documents faut-il fournir pour constituer un dossier ?", reponse: "Les 3 dernières fiches de paie, le contrat de travail, le dernier avis d'imposition et une pièce d'identité." },
  ]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadSection<FaqEntry[]>("faq", entries).then((d) => { if (d.length > 0) setEntries(d); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    const ok = await saveSection("faq", entries);
    setSaving(false);
    if (ok) {
      setSaved(true);
      toast("FAQ sauvegardée ✅", "success");
      setTimeout(() => setSaved(false), 2000);
    } else {
      toast("Erreur de sauvegarde — vérifiez votre connexion", "error");
    }
  };

  const generateFaq = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/settings/generate-faq", { method: "POST" });
      const data = await res.json();
      if (data.suggestions?.length > 0) {
        const newEntries: FaqEntry[] = data.suggestions.map((s: { question: string; reponse: string }) => ({
          id: `${Date.now()}-${Math.random()}`,
          question: s.question,
          reponse: s.reponse,
        }));
        setEntries((prev) => [...prev, ...newEntries]);
        toast(`${newEntries.length} questions générées par l'IA ✨`, "success");
      } else {
        toast("Aucune suggestion générée", "warning");
      }
    } catch {
      toast("Erreur lors de la génération", "error");
    } finally {
      setGenerating(false);
    }
  };

  const add = () => setEntries([...entries, { id: Date.now().toString(), question: "", reponse: "" }]);
  const remove = (id: string) => setEntries(entries.filter((e) => e.id !== id));
  const update = (id: string, field: "question" | "reponse", value: string) =>
    setEntries(entries.map((e) => e.id === id ? { ...e, [field]: value } : e));

  return (
    <div className="space-y-4">
      <Card title="Questions / Réponses fréquentes">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1">
            <p className="text-xs font-medium" style={{ color: "rgb(71 85 105)" }}>
              Renseignez ici uniquement les questions générales sur votre agence (processus, documents requis, signature…).
            </p>
            <p className="text-xs" style={{ color: "rgb(148 163 184)" }}>
              Les infos spécifiques à chaque bien (animaux, charges, ascenseur, disponibilité) se configurent directement dans la fiche de chaque bien.
            </p>
          </div>
          <button
            onClick={generateFaq}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 flex-shrink-0"
            style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)", border: "1px solid rgb(199 210 254)" }}
          >
            {generating ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Génération…
              </>
            ) : (
              <>✨ Générer FAQ IA</>
            )}
          </button>
        </div>

        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border p-3 space-y-2 animate-fade-in" style={{ borderColor: "rgb(226 232 240)" }}>
              <div>
                <Label>Question</Label>
                <Input value={entry.question} onChange={(v) => update(entry.id, "question", v)} placeholder="Ex: Comment se déroule la visite ?" />
              </div>
              <div>
                <Label>Réponse de l'IA</Label>
                <Input value={entry.reponse} onChange={(v) => update(entry.id, "reponse", v)} placeholder="Ex: La visite dure environ 30 minutes, accompagnée de notre agent." />
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

/* ── TAB 4 : CALENDRIER ── */
function TabCalendrier() {
  const { toast } = useToast();
  const [dureeVisite, setDureeVisite] = useState(60);
  const [heureDebut, setHeureDebut] = useState(9);
  const [heureFin, setHeureFin] = useState(18);
  const [delaiPrevenanceH, setDelaiPrevenanceH] = useState(24);
  const [maxVisitesJour, setMaxVisitesJour] = useState(4);
  const [joursExclus, setJoursExclus] = useState<number[]>([5, 6]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSection("calendrier", { dureeVisite, heureDebut, heureFin, delaiPrevenanceH, maxVisitesJour, joursExclus }).then((d: Record<string, unknown>) => {
      if (d.dureeVisite) setDureeVisite(d.dureeVisite as number);
      if (d.heureDebut !== undefined) setHeureDebut(d.heureDebut as number);
      if (d.heureFin !== undefined) setHeureFin(d.heureFin as number);
      if (d.delaiPrevenanceH) setDelaiPrevenanceH(d.delaiPrevenanceH as number);
      if (d.maxVisitesJour) setMaxVisitesJour(d.maxVisitesJour as number);
      if (d.joursExclus) setJoursExclus(d.joursExclus as number[]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    const ok = await saveSection("calendrier", { dureeVisite, heureDebut, heureFin, delaiPrevenanceH, maxVisitesJour, joursExclus });
    setSaving(false);
    if (ok) {
      setSaved(true);
      toast("Calendrier sauvegardé ✅", "success");
      setTimeout(() => setSaved(false), 2000);
    } else {
      toast("Erreur de sauvegarde — vérifiez votre connexion", "error");
    }
  };

  const toggleJour = (idx: number) =>
    setJoursExclus((prev) => prev.includes(idx) ? prev.filter((j) => j !== idx) : [...prev, idx]);

  return (
    <div className="space-y-4">
      <Card title="⏱ Durée des visites">
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

      <Card title="📅 Maximum de visites par jour">
        <div>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={10} step={1}
              value={maxVisitesJour}
              onChange={(e) => setMaxVisitesJour(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="text-lg font-bold w-16 text-center" style={{ color: "rgb(79 70 229)" }}>
              {maxVisitesJour} / jour
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>
            L'IA ne proposera pas plus de {maxVisitesJour} créneaux par jour.
          </p>
        </div>
      </Card>

      <Card title="🕐 Plages horaires">
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

      <Card title="⏰ Délai de prévenance">
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

      <Card title="🚫 Jours exclus">
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

/* ── TAB 5 : CONFIG IA ── */
function buildPromptPreview(params: {
  nomAgence: string;
  multiplicateur: number;
  animaux: string;
  garantObligatoire: Record<string, boolean>;
  typesBiens: Record<string, boolean>;
  instructions: string;
}): string {
  const biens = Object.entries(params.typesBiens).filter(([, v]) => v).map(([k]) => k).join(", ") || "non spécifié";
  const garants = Object.entries(params.garantObligatoire).filter(([, v]) => v).map(([k]) => k).join(", ") || "aucun";
  const animauxLabel = params.animaux === "oui" ? "Oui" : params.animaux === "non" ? "Non" : "Selon le bailleur";

  return `CONTEXTE AGENCE
───────────────
Agence : ${params.nomAgence || "Non renseignée"}
Biens gérés : ${biens}
Solvabilité : revenus ≥ ${params.multiplicateur}x le loyer
Garant obligatoire pour : ${garants}
Animaux : ${animauxLabel}
${params.instructions ? `\nINSTRUCTIONS SPÉCIALES\n───────────────\n${params.instructions}` : ""}`.trim();
}

function TabIA() {
  const { toast } = useToast();
  const router = useRouter();
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"DRAFT" | "AUTOPILOTE">("DRAFT");
  const [tonDeVoix, setTonDeVoix] = useState<"Professionnel et formel" | "Chaleureux et dynamique" | "Neutre et efficace">("Professionnel et formel");
  const [prioriteProfils, setPrioriteProfils] = useState("");
  const [seuilAutopilote, setSeuilAutopilote] = useState(3.5);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewParams, setPreviewParams] = useState({
    nomAgence: "",
    multiplicateur: 3,
    animaux: "selon",
    garantObligatoire: { cdd: true, auto: true, etudiant: true, retraite: false },
    typesBiens: { appartement: true, maison: false, studio: true, loft: false, parking: false },
    instructions: "",
  });

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.pipeline_mode === "AUTOPILOTE") setMode("AUTOPILOTE");
        const rules = data?.email_rules || {};
        const locatif = rules.ft_locatif || {};
        const ia = rules.ft_ia || {};
        const instrVal = ia.instructions || "";
        setInstructions(instrVal);
        if (ia.ton_de_voix) setTonDeVoix(ia.ton_de_voix as typeof tonDeVoix);
        if (ia.priorite_profils) setPrioriteProfils(ia.priorite_profils as string);
        if (typeof ia.seuil_autopilote === "number") setSeuilAutopilote(ia.seuil_autopilote);
        setPreviewParams({
          nomAgence: locatif.nomAgence || "",
          multiplicateur: locatif.multiplicateur || 3,
          animaux: locatif.animaux || "selon",
          garantObligatoire: locatif.garantObligatoire || { cdd: true, auto: true, etudiant: true, retraite: false },
          typesBiens: locatif.typesBiens || { appartement: true, maison: false, studio: true, loft: false, parking: false },
          instructions: instrVal,
        });
      })
      .catch(() => {});
  }, []);

  // Sync instructions into previewParams live
  const handleInstructionsChange = (v: string) => {
    setInstructions(v);
    setPreviewParams((p) => ({ ...p, instructions: v }));
  };

  const save = async () => {
    setSaving(true);
    const [modeRes, iaOk] = await Promise.all([
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_mode: mode }),
      }),
      saveSection("ia", { instructions, ton_de_voix: tonDeVoix, priorite_profils: prioriteProfils, seuil_autopilote: seuilAutopilote }),
    ]);
    setSaving(false);
    const modeOk = modeRes.ok;
    if (modeOk && iaOk) {
      setSaved(true);
      toast("Configuration IA sauvegardée ✅", "success");
      setTimeout(() => setSaved(false), 2000);
    } else {
      console.error("[TabIA save] modeOk:", modeOk, "| iaOk:", iaOk);
      toast("Erreur de sauvegarde — vérifiez votre connexion", "error");
    }
  };

  const testIA = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Bonjour ! Donne-moi un résumé rapide de l'activité de mon agence.",
          history: [],
        }),
      });
      const data = await res.json();
      if (data.reply) {
        setTestResult(data.reply);
        toast("Test IA réussi ✓", "success");
      } else {
        setTestResult("Erreur : " + (data.error ?? "Réponse vide"));
        toast("Erreur lors du test", "error");
      }
    } catch {
      setTestResult("Erreur de connexion à l'API.");
      toast("Erreur de connexion", "error");
    } finally {
      setTestLoading(false);
    }
  };

  const promptPreview = buildPromptPreview(previewParams);

  return (
    <div className="space-y-4">
      <Card title="🔄 Mode pipeline">
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

      <Card title="📝 Instructions spéciales pour l'IA">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          L'IA en tiendra compte lors de l'analyse et de la rédaction des emails.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => handleInstructionsChange(e.target.value)}
          rows={4}
          placeholder="Ex: Toujours répondre en vouvoyant. Mentionner notre adresse. Ne jamais accepter les chèques."
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
          style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
        />
      </Card>

      <Card title="🎙 Ton de voix de l'IA">
        <p className="text-xs mb-3" style={{ color: "rgb(100 116 139)" }}>Définit le registre de langage utilisé dans chaque réponse générée.</p>
        <div className="space-y-2">
          {(["Professionnel et formel", "Chaleureux et dynamique", "Neutre et efficace"] as const).map((opt) => (
            <label key={opt} className="flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition-all"
              style={tonDeVoix === opt ? { background: "rgb(238 242 255)", border: "1.5px solid rgb(79 70 229)" } : { border: "1.5px solid rgb(226 232 240)" }}>
              <input type="radio" name="tonDeVoix" checked={tonDeVoix === opt} onChange={() => setTonDeVoix(opt)} className="accent-indigo-600" />
              <span className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>{opt}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="🎯 Priorisation des profils">
        <p className="text-xs mb-2" style={{ color: "rgb(100 116 139)" }}>Indique à l'IA comment hiérarchiser les profils pour proposer des créneaux ou accorder une priorité.</p>
        <input
          type="text"
          value={prioriteProfils}
          onChange={(e) => setPrioriteProfils(e.target.value)}
          placeholder="Ex: Priorise les CDI pour les visites du samedi"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
        />
      </Card>

      <Card title="⚡ Seuil autopilote">
        <p className="text-xs mb-3" style={{ color: "rgb(100 116 139)" }}>
          L'IA envoie automatiquement (sans validation) si les revenus du prospect atteignent ce ratio.
        </p>
        <div className="flex items-center gap-4">
          <input
            type="range" min={2.5} max={5} step={0.5}
            value={seuilAutopilote}
            onChange={(e) => setSeuilAutopilote(parseFloat(e.target.value))}
            className="flex-1 accent-indigo-600"
          />
          <span className="text-lg font-bold w-12 text-right" style={{ color: "rgb(79 70 229)" }}>{seuilAutopilote}x</span>
        </div>
        <p className="text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>
          Autopilote activé si revenus ≥ {seuilAutopilote}x le loyer (CDI requis)
        </p>
      </Card>

      {/* Preview prompt collapsible */}
      <Card title="👁 Aperçu du contexte IA">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          Voici ce que l'IA reçoit comme contexte à chaque email analysé.
        </p>
        <button
          onClick={() => setShowPreview((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium transition-colors"
          style={{ color: "rgb(79 70 229)" }}
        >
          <span
            className="transition-transform duration-200 inline-block"
            style={{ transform: showPreview ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▶
          </span>
          {showPreview ? "Masquer l'aperçu" : "Afficher l'aperçu du prompt"}
        </button>
        {showPreview && (
          <pre
            className="rounded-lg p-3 text-xs whitespace-pre-wrap leading-relaxed animate-fade-in overflow-auto"
            style={{
              background: "rgb(15 23 42)",
              color: "rgb(148 163 184)",
              fontFamily: "monospace",
              maxHeight: "280px",
              border: "1px solid rgb(30 41 59)",
            }}
          >
            {promptPreview}
          </pre>
        )}
      </Card>

      {/* Tester l'IA */}
      <Card title="🧪 Tester l'IA">
        <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
          Envoyez un message test pour vérifier que l'IA a accès à votre contexte agence.
        </p>
        <div className="flex gap-2">
          <button
            onClick={testIA}
            disabled={testLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)", border: "1px solid rgb(199 210 254)" }}
          >
            {testLoading ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Test en cours…
              </>
            ) : (
              <>🧪 Tester l'IA</>
            )}
          </button>
          <button
            onClick={() => router.push("/chat")}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
          >
            Ouvrir le chat →
          </button>
        </div>

        {testResult && (
          <div
            className="rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed animate-fade-in"
            style={{ background: "rgb(248 250 252)", color: "rgb(30 41 59)", border: "1px solid rgb(226 232 240)" }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold" style={{ background: "rgb(79 70 229)" }}>IA</div>
              <span className="text-xs font-medium" style={{ color: "rgb(100 116 139)" }}>Réponse de l'assistant</span>
            </div>
            {testResult}
          </div>
        )}
      </Card>

      <div className="flex justify-end"><SaveButton onClick={save} saved={saved} loading={saving} /></div>
    </div>
  );
}

/* ── TAB 6 : COMPTE ── */
function TabCompte() {
  const { toast } = useToast();
  type EmailStatus =
    | { connected: false }
    | { connected: true; provider: "gmail" | "outlook"; email: string; revoked: boolean };

  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/email-status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStatus(d as EmailStatus))
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  const reconnect = (provider: "gmail" | "outlook") => {
    window.location.href =
      provider === "gmail" ? "/api/auth/google" : "/api/auth/microsoft";
  };

  return (
    <div className="space-y-4">
      <Card title="📧 Connexion email">
        {loading ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "rgb(100 116 139)" }}>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Vérification en cours…
          </div>
        ) : status?.connected ? (
          <div className="space-y-3">
            {status.revoked ? (
              <div
                className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background: "rgba(234,88,12,0.06)", border: "1px solid rgba(234,88,12,0.2)" }}
              >
                <span className="text-lg flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "rgb(234 88 12)" }}>
                    Token révoqué — reconnectez-vous
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: "rgb(100 116 139)" }}>
                    {status.email}
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.2)" }}
              >
                <span className="text-lg flex-shrink-0">
                  {status.provider === "gmail" ? "📧" : "📮"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "rgb(22 163 74)" }}>
                    ✓ {status.provider === "gmail" ? "Gmail connecté" : "Outlook connecté"}
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: "rgb(100 116 139)" }}>
                    {status.email}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                reconnect(status.provider);
                toast("Redirection vers l'autorisation…", "success");
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)", border: "1px solid rgb(199 210 254)" }}
            >
              🔄 Reconnecter {status.provider === "gmail" ? "Gmail" : "Outlook"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
              Aucun compte email connecté. Connectez Gmail ou Outlook pour activer la synchronisation.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  reconnect("gmail");
                  toast("Redirection vers Google…", "success");
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)", border: "1px solid rgb(199 210 254)" }}
              >
                📧 Connecter Gmail
              </button>
              <button
                onClick={() => {
                  reconnect("outlook");
                  toast("Redirection vers Microsoft…", "success");
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
              >
                📮 Connecter Outlook
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── PAGE PRINCIPALE ── */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("locatif");

  const tabs: { key: Tab; label: string }[] = [
    { key: "compte", label: "🔗 Compte" },
    { key: "locatif", label: "🏠 Règles locatives" },
    { key: "documents", label: "📄 Documents" },
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

          <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}>
            {tabs.map((t) => (
              <TabButton key={t.key} active={activeTab === t.key} onClick={() => setActiveTab(t.key)}>
                {t.label}
              </TabButton>
            ))}
          </div>

          {/* Tabs toujours montés — display:none préserve le state React entre onglets */}
          <div style={{ display: activeTab === "locatif" ? "block" : "none" }}><TabLocatif /></div>
          <div style={{ display: activeTab === "documents" ? "block" : "none" }}><TabDocuments /></div>
          <div style={{ display: activeTab === "faq" ? "block" : "none" }}><TabFaq /></div>
          <div style={{ display: activeTab === "calendrier" ? "block" : "none" }}><TabCalendrier /></div>
          <div style={{ display: activeTab === "ia" ? "block" : "none" }}><TabIA /></div>
          <div style={{ display: activeTab === "compte" ? "block" : "none" }}><TabCompte /></div>
        </div>
      </div>
    </AppShell>
  );
}
