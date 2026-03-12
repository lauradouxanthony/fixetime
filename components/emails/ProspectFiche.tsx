"use client";

import { useState, useEffect } from "react";
import type { ProspectData } from "@/types/email";

/* ─── Types ─── */
type FieldStatus = "ok" | "missing";

interface FieldMeta {
  key: keyof ProspectData;
  label: string;
  placeholder: string;
  type: "text" | "number" | "select";
  options?: { value: string; label: string }[];
}

const FIELDS: FieldMeta[] = [
  { key: "nom", label: "Nom / Prénom", placeholder: "Ex: Thomas Martin", type: "text" },
  { key: "telephone", label: "Téléphone", placeholder: "Ex: 06 12 34 56 78", type: "text" },
  { key: "situation_pro", label: "Situation pro", placeholder: "Choisir…", type: "select",
    options: [
      { value: "CDI", label: "CDI" },
      { value: "CDD", label: "CDD" },
      { value: "AUTO_ENTREPRENEUR", label: "Auto-entrepreneur" },
      { value: "ETUDIANT", label: "Étudiant" },
      { value: "RETRAITE", label: "Retraité" },
    ]
  },
  { key: "revenus_mensuels", label: "Revenus nets/mois (€)", placeholder: "Ex: 3200", type: "number" },
  { key: "loyer_max", label: "Loyer visé (€)", placeholder: "Ex: 850", type: "number" },
  { key: "nb_personnes", label: "Nb personnes foyer", placeholder: "Ex: 2", type: "number" },
  { key: "animaux", label: "Animaux ?", placeholder: "Choisir…", type: "select",
    options: [
      { value: "OUI", label: "Oui" },
      { value: "NON", label: "Non" },
    ]
  },
  { key: "garant", label: "Garant ?", placeholder: "Choisir…", type: "select",
    options: [
      { value: "OUI", label: "Oui" },
      { value: "NON", label: "Non" },
      { value: "A_CONFIRMER", label: "À confirmer" },
    ]
  },
];

/* ─── Heuristique fallback ─── */
export interface ProspectDataLegacy {
  nom: string | null;
  tel: string | null;
  situation: string | null;
  revenus: number | null;
  loyerMax: number | null;
  animaux: string | null;
  personnes: number | null;
  garant: string | null;
}

export function extractProspect(body: string | null | undefined): ProspectData {
  if (!body) return {};
  const text = body;
  const lower = text.toLowerCase();
  const lines = text.split(/\r?\n/);

  // Nom
  let nom: string | null = null;
  const nomPatterns = [
    /(?:je m['']appelle|je suis|prénom\s*:?\s*|nom\s*:?\s*)([A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+(?:\s+[A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+)*)/,
    /^([A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+\s+[A-ZÀÂÄ][A-ZÀÂÄ][A-ZÀÂÄ]+)$/m,
  ];
  for (const p of nomPatterns) {
    const m = text.match(p);
    if (m?.[1] && m[1].length >= 3 && m[1].length <= 50) { nom = m[1].trim(); break; }
  }
  if (!nom) {
    const nonEmpty = lines.map(l => l.trim()).filter(l => l.length > 2 && l.length < 45);
    const last = nonEmpty[nonEmpty.length - 1] ?? null;
    if (last && last.split(/\s+/).length >= 2 && !/[.@]/.test(last)) nom = last;
  }

  // Tel
  const telMatch = text.match(/(?:(?:\+33|0033|0)[1-9](?:[.\- ]?\d{2}){4})/);
  const telephone = telMatch ? telMatch[0].replace(/[.\- ]/g, " ").trim() : null;

  // Situation
  const SITUATIONS: [string, ProspectData["situation_pro"]][] = [
    ["étudiant", "ETUDIANT"], ["etudiante", "ETUDIANT"], ["école", "ETUDIANT"], ["université", "ETUDIANT"],
    ["cdi", "CDI"], ["cdd", "CDD"],
    ["auto-entrepreneur", "AUTO_ENTREPRENEUR"], ["autoentrepreneur", "AUTO_ENTREPRENEUR"],
    ["freelance", "AUTO_ENTREPRENEUR"], ["indépendant", "AUTO_ENTREPRENEUR"],
    ["retraité", "RETRAITE"], ["retraitée", "RETRAITE"],
  ];
  let situation_pro: ProspectData["situation_pro"] = null;
  for (const [kw, label] of SITUATIONS) {
    if (lower.includes(kw)) { situation_pro = label; break; }
  }

  // Revenus & loyer
  let revenus_mensuels: number | null = null;
  let loyer_max: number | null = null;
  for (const line of lines) {
    const l = line.toLowerCase();
    const m = line.match(/(\d[\d\s]*)\s*(?:€|euros?)/i);
    if (!m) continue;
    const val = parseFloat(m[1].replace(/\s/g, ""));
    if (!val || val < 100) continue;
    if (l.includes("salaire") || l.includes("revenu") || l.includes("gagne") || l.includes("touche")) {
      if (!revenus_mensuels) revenus_mensuels = val;
    } else if (l.includes("loyer") || l.includes("budget") || l.includes("mensuel")) {
      if (!loyer_max) loyer_max = val;
    }
  }

  // Animaux
  let animaux: ProspectData["animaux"] = null;
  if (lower.includes("pas d'animal") || lower.includes("sans animal") || lower.includes("pas d'animaux")) animaux = "NON";
  else if (lower.includes("chat") || lower.includes("chien") || lower.includes("animal")) animaux = "OUI";

  // Nb personnes
  let nb_personnes: number | null = null;
  const persMatch = text.match(/(\d+)\s*(?:personnes?|occupants?)/i);
  if (persMatch) nb_personnes = parseInt(persMatch[1]);
  else if (lower.includes("seul") || lower.includes("célibataire")) nb_personnes = 1;
  else if (lower.includes("couple")) nb_personnes = 2;

  // Garant (remplace date_emmenagement)
  let garant: ProspectData["garant"] = null;
  if (lower.includes("sans garant") || lower.includes("pas de garant") || lower.includes("n'ai pas de garant")) garant = "NON";
  else if (lower.includes("garant") || lower.includes("caution")) garant = "OUI";

  return { nom, telephone, situation_pro, revenus_mensuels, loyer_max, animaux, nb_personnes, garant };
}

/* ─── Couleurs ─── */
function scoreColor(pct: number): string {
  if (pct >= 75) return "rgb(22 163 74)";
  if (pct >= 40) return "rgb(234 88 12)";
  return "rgb(220 38 38)";
}

/* ─── Score circle solvabilité ─── */
function SolvabiliteCircle({ revenus, loyer, multiplicateur = 3 }: { revenus: number | null; loyer: number | null; multiplicateur?: number }) {
  if (!revenus || !loyer) return null;
  const ratio = revenus / loyer;
  const solvable = ratio >= multiplicateur;
  const color = ratio >= multiplicateur ? "rgb(22 163 74)" : ratio >= multiplicateur * 0.75 ? "rgb(234 88 12)" : "rgb(220 38 38)";
  // SVG circle: 36px, strokeWidth=4, r=14, circumference≈87.96
  const R = 14; const C = 2 * Math.PI * R;
  const cap = multiplicateur * 1.5; // au-delà de cap, on considère 100%
  const fill = Math.min(ratio / cap, 1);
  const dash = fill * C;
  return (
    <div className="flex flex-col items-center gap-0.5" title={`Ratio revenus/loyer: ${ratio.toFixed(1)}x (seuil: ${multiplicateur}x)`}>
      <svg width="44" height="44" viewBox="0 0 44 44" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="22" cy="22" r={R} fill="none" stroke="rgb(226 232 240)" strokeWidth="4" />
        <circle
          cx="22" cy="22" r={R} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute text-xs font-bold" style={{ color, marginTop: "-32px", fontSize: "10px", position: "relative", top: "-38px" }}>
        {ratio.toFixed(1)}x
      </div>
      <div className="text-xs" style={{ color: "rgb(100 116 139)", fontSize: "10px", marginTop: "-4px" }}>
        {solvable ? "✅ Solvable" : "❌ Insolvable"}
      </div>
    </div>
  );
}

function formatValue(key: keyof ProspectData, val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  if (key === "revenus_mensuels" || key === "loyer_max") return `${Number(val).toLocaleString("fr-FR")} €`;
  if (key === "nb_personnes") return `${val} personne${Number(val) > 1 ? "s" : ""}`;
  if (key === "animaux") return val === "OUI" ? "Oui" : "Non";
  if (key === "garant") {
    if (val === "OUI") return "Oui ✅";
    if (val === "NON") return "Non ❌";
    if (val === "A_CONFIRMER") return "À confirmer";
    return String(val);
  }
  if (key === "situation_pro") {
    const map: Record<string, string> = {
      CDI: "CDI", CDD: "CDD", AUTO_ENTREPRENEUR: "Auto-entrepreneur",
      ETUDIANT: "Étudiant", RETRAITE: "Retraité",
    };
    return map[val as string] ?? String(val);
  }
  return String(val);
}

/* ─── Props ─── */
interface ProspectFicheProps {
  body?: string | null;
  prospectData?: ProspectData | null;
  emailId?: string;
  onSave?: (data: ProspectData) => Promise<void>;
  isAI?: boolean; // true = données extraites par l'IA
}

export default function ProspectFiche({ body, prospectData, emailId, onSave, isAI = false }: ProspectFicheProps) {
  // Initialiser avec les données IA ou heuristique
  const [data, setData] = useState<ProspectData>(() => {
    if (prospectData && Object.values(prospectData).some(v => v !== null && v !== undefined)) {
      return prospectData;
    }
    return extractProspect(body);
  });

  const [editingKey, setEditingKey] = useState<keyof ProspectData | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [dirty, setDirty] = useState(false);

  // BUG #2 FIX : reset COMPLET quand on change d'email (emailId change)
  // Cela évite que les données du prospect précédent restent affichées
  useEffect(() => {
    if (prospectData && Object.values(prospectData).some(v => v !== null && v !== undefined)) {
      setData(prospectData);
    } else {
      setData(extractProspect(body));
    }
    setEditingKey(null);
    setDirty(false);
    setSavedOk(false);
  }, [emailId]); // ← dépend de emailId, pas de prospectData

  // Mettre à jour si les données IA arrivent après coup (même email, body chargé async)
  useEffect(() => {
    if (prospectData && Object.values(prospectData).some(v => v !== null && v !== undefined)) {
      setData(prospectData);
    }
  }, [JSON.stringify(prospectData)]); // eslint-disable-line react-hooks/exhaustive-deps

  const okCount = FIELDS.filter(f => {
    const v = data[f.key];
    return v !== null && v !== undefined && v !== "";
  }).length;
  const pct = Math.round((okCount / FIELDS.length) * 100);
  const color = scoreColor(pct);

  const startEdit = (f: FieldMeta) => {
    setEditingKey(f.key);
    setEditValue(formatRaw(f.key, data[f.key]));
  };

  function formatRaw(key: keyof ProspectData, val: unknown): string {
    if (val === null || val === undefined) return "";
    return String(val);
  }

  const commitEdit = () => {
    if (editingKey === null) return;
    const f = FIELDS.find(f => f.key === editingKey)!;
    let newVal: string | number | null = editValue.trim() || null;
    if (f.type === "number" && newVal !== null) {
      const n = parseFloat(String(newVal).replace(/\s/g, ""));
      newVal = isNaN(n) ? null : n;
    }
    setData(d => ({ ...d, [editingKey]: newVal }));
    setEditingKey(null);
    setEditValue("");
    setDirty(true);
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(data);
      setSavedOk(true);
      setDirty(false);
      setTimeout(() => setSavedOk(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-4 space-y-4 animate-fade-in"
      style={{ borderColor: "rgb(226 232 240)", background: "white" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
              Fiche prospect
            </div>
            {isAI && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(79,70,229,0.1)", color: "rgb(79 70 229)" }}>
                ✨ IA
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold" style={{ color }}>
              {okCount}/{FIELDS.length} infos
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${color}18`, color }}>
              {pct}%
            </span>
          </div>
          {/* Progress bar */}
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
        {/* Score circle solvabilité */}
        <SolvabiliteCircle
          revenus={typeof data.revenus_mensuels === "number" ? data.revenus_mensuels : null}
          loyer={typeof data.loyer_max === "number" ? data.loyer_max : null}
        />
      </div>

      {/* Fields */}
      <div className="space-y-1.5">
        {FIELDS.map((field) => {
          const val = data[field.key];
          const hasValue = val !== null && val !== undefined && val !== "";
          const isEditing = editingKey === field.key;
          const displayVal = formatValue(field.key, val);

          return (
            <div
              key={field.key}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg group"
              style={{
                background: hasValue ? "rgba(22,163,74,0.04)" : "rgb(248 250 252)",
                border: `1px solid ${hasValue ? "rgba(22,163,74,0.15)" : "rgb(226 232 240)"}`,
              }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-xs" style={{ minWidth: "16px" }}>
                  {hasValue ? "✅" : "❓"}
                </span>
                <span className="text-xs flex-shrink-0" style={{ color: "rgb(100 116 139)", minWidth: "130px" }}>
                  {field.label}
                </span>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-1 flex-1">
                  {field.type === "select" ? (
                    <select
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      autoFocus
                      className="flex-1 rounded border px-2 py-1 text-xs focus:outline-none"
                      style={{ borderColor: "rgb(79 70 229)", color: "rgb(30 41 59)" }}
                    >
                      <option value="">— Non renseigné</option>
                      {field.options?.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") { setEditingKey(null); } }}
                      placeholder={field.placeholder}
                      autoFocus
                      className="flex-1 rounded border px-2 py-1 text-xs focus:outline-none"
                      style={{ borderColor: "rgb(79 70 229)", color: "rgb(30 41 59)" }}
                    />
                  )}
                  <button onClick={commitEdit} className="text-xs px-2 py-1 rounded font-medium text-white" style={{ background: "rgb(79 70 229)" }}>✓</button>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => startEdit(field)}
                >
                  <span className="text-xs font-medium" style={{ color: hasValue ? "rgb(30 41 59)" : "rgb(148 163 184)" }}>
                    {displayVal || "Cliquer pour renseigner"}
                  </span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "rgb(79 70 229)" }}>✏️</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save button */}
      {(dirty || onSave) && (
        <div className="flex justify-end pt-1">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-50"
            style={{ background: savedOk ? "rgb(22 163 74)" : "rgb(79 70 229)" }}
          >
            {saving ? "Sauvegarde…" : savedOk ? "✅ Sauvegardé" : "💾 Sauvegarder"}
          </button>
        </div>
      )}

      {/* Status message */}
      {pct < 40 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(220,38,38,0.06)", color: "rgb(185 28 28)", border: "1px solid rgba(220,38,38,0.15)" }}>
          ⚠️ Dossier incomplet — l'IA demandera les informations manquantes dans le brouillon.
        </div>
      )}
      {pct >= 40 && pct < 75 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(234,88,12,0.06)", color: "rgb(194 65 12)", border: "1px solid rgba(234,88,12,0.15)" }}>
          📋 Dossier partiel — quelques infos manquantes à compléter.
        </div>
      )}
      {pct >= 75 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(22,163,74,0.06)", color: "rgb(21 128 61)", border: "1px solid rgba(22,163,74,0.15)" }}>
          ✅ Dossier bien renseigné — le brouillon peut proposer directement un RDV.
        </div>
      )}
    </div>
  );
}
