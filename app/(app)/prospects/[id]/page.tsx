"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

/* ── Types ── */
interface Prospect {
  id: string;
  email: string;
  nom: string | null;
  prenom: string | null;
  telephone: string | null;
  situation_pro: string | null;
  revenus_mensuels: number | null;
  garant: boolean | null;
  garant_revenus: number | null;
  nb_personnes: number | null;
  animaux: boolean | null;
  etape_process: string;
  property_id: string | null;
  lead_score: number | null;
  visite_date: string | null;
  visite_status: string | null;
  dossier_complet: boolean | null;
  dossier_validated_at: string | null;
  last_reply_at: string | null;
  relance_count: number | null;
  created_at: string;
}

interface Property {
  id: string;
  title: string;
  address: string | null;
  rent: number;
  required_docs: string[];
}

interface Email {
  id: string;
  subject: string | null;
  sender: string | null;
  body: string | null;
  ai_reply: string | null;
  received_at: string | null;
  category: string | null;
  attachments: { filename: string; docType?: string; status?: string; url?: string }[];
}

interface Document {
  emailId: string;
  subject: string;
  receivedAt: string | null;
  filename: string;
  docType?: string;
  status?: string;
  url?: string;
}

interface TimelineEntry {
  id: string;
  action_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  email_id: string | null;
}

/* ── Helpers ── */
const ETAPE_LABELS: Record<string, string> = {
  NEW: "Nouveau",
  QUALIFICATION: "Qualification",
  VISITE_PROPOSEE: "Visite proposée",
  VISITE_CONFIRMEE: "Visite confirmée",
  DOSSIER_DEMANDE: "Dossier demandé",
  DOSSIER_RECU: "Dossier reçu",
  VALIDE: "Validé",
  REFUSE: "Refusé",
};

const ETAPE_COLORS: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  QUALIFICATION: "bg-blue-100 text-blue-700",
  VISITE_PROPOSEE: "bg-yellow-100 text-yellow-700",
  VISITE_CONFIRMEE: "bg-amber-100 text-amber-700",
  DOSSIER_DEMANDE: "bg-orange-100 text-orange-700",
  DOSSIER_RECU: "bg-purple-100 text-purple-700",
  VALIDE: "bg-green-100 text-green-700",
  REFUSE: "bg-red-100 text-red-700",
};

const SITUATION_LABELS: Record<string, string> = {
  CDI: "CDI",
  CDD: "CDD",
  AUTO_ENTREPRENEUR: "Auto-entrepreneur",
  FREELANCE: "Freelance",
  ETUDIANT: "Étudiant",
  RETRAITE: "Retraité",
  SANS_EMPLOI: "Sans emploi",
};

const ACTION_TIMELINE_LABELS: Record<string, { label: string; icon: string }> = {
  info_mise_a_jour: { label: "Informations mises à jour", icon: "✏️" },
  visite_effectuee: { label: "Visite effectuée", icon: "🏠" },
  visite_annulee: { label: "Visite annulée", icon: "❌" },
  demander_dossier: { label: "Dossier demandé", icon: "📂" },
  valider: { label: "Candidature validée", icon: "✅" },
  refuser: { label: "Candidature refusée", icon: "🚫" },
  ai_reply_generated: { label: "Réponse IA générée", icon: "🤖" },
  changement_creneau: { label: "Changement de créneau", icon: "🔄" },
  docs_recus_hors_etape: { label: "Documents reçus", icon: "📎" },
  refus_visite_provisoire: { label: "Refus visite provisoire", icon: "⚠️" },
};

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ── Inline editable field ── */
function EditableField({
  label, value, onSave, type = "text", options,
}: {
  label: string;
  value: string | number | boolean | null;
  onSave: (val: string | number | boolean | null) => Promise<void>;
  type?: "text" | "number" | "select" | "boolean" | "email" | "tel";
  options?: { value: string; label: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(() => {
    if (value === null || value === undefined) return "";
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    let parsed: string | number | boolean | null = draft;
    if (type === "number") parsed = draft === "" ? null : parseFloat(draft);
    if (type === "boolean") parsed = draft === "true";
    await onSave(parsed);
    setSaving(false);
    setEditing(false);
  };

  const displayValue = () => {
    if (value === null || value === undefined || value === "") return <span className="text-slate-400 italic">Non renseigné</span>;
    if (type === "boolean") return value ? "Oui" : "Non";
    if (type === "select" && options) {
      return options.find((o) => o.value === String(value))?.label ?? String(value);
    }
    return String(value);
  };

  if (!editing) {
    return (
      <div className="group flex items-center justify-between gap-2 py-1">
        <div>
          <span className="text-xs text-slate-500">{label}</span>
          <div className="text-sm text-slate-900 font-medium">{displayValue()}</div>
        </div>
        <button
          onClick={() => { setDraft(value === null ? "" : String(value)); setEditing(true); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="py-1">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex items-center gap-2 mt-0.5">
        {type === "select" && options ? (
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="text-sm border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Non renseigné</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : type === "boolean" ? (
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="text-sm border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="true">Oui</option>
            <option value="false">Non</option>
          </select>
        ) : (
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
            className="text-sm border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-xs"
          />
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "…" : "OK"}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:text-slate-700">
          ✕
        </button>
      </div>
    </div>
  );
}

/* ── Main Component ── */
export default function ProspectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [emails, setEmails] = useState<Email[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  /* Fetch */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/prospects/${id}`);
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Erreur");
        return;
      }
      const data = await res.json();
      setProspect(data.prospect);
      setProperty(data.property);
      setEmails(data.emails ?? []);
      setDocuments(data.documents ?? []);
      setTimeline(data.timeline ?? []);
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* Patch field */
  const patchField = useCallback(async (field: string, value: string | number | boolean | null) => {
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      const data = await res.json();
      setProspect(data.prospect);
    }
  }, [id]);

  /* Quick action */
  const runAction = useCallback(async (action: string) => {
    setActionLoading(action);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(action);
        await fetchData();
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        console.error("Action failed:", data);
      }
    } finally {
      setActionLoading(null);
    }
  }, [id, fetchData]);

  /* PDF export */
  const handleExportPdf = async () => {
    setExportLoading(true);
    try {
      const res = await fetch(`/api/prospects/${id}/export-pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `prospect-${id}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExportLoading(false);
    }
  };

  /* Ratio solvabilité */
  const ratio = prospect?.revenus_mensuels && property?.rent
    ? prospect.revenus_mensuels / property.rent
    : null;

  /* ── Render ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Chargement de la fiche prospect…</p>
        </div>
      </div>
    );
  }

  if (error || !prospect) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500 font-medium">{error ?? "Prospect introuvable"}</p>
          <button onClick={() => router.push("/pipeline")} className="mt-4 text-sm text-indigo-600 hover:underline">
            ← Retour au pipeline
          </button>
        </div>
      </div>
    );
  }

  const displayName = [prospect.prenom, prospect.nom].filter(Boolean).join(" ") || prospect.email;

  return (
    <div className="min-h-screen bg-slate-50 pb-32">

      {/* ═══════════════════════════════════════════════════ */}
      {/* SECTION 1 — Header                                  */}
      {/* ═══════════════════════════════════════════════════ */}
      <div className="bg-white border-b border-slate-200 px-6 py-5 sticky top-0 z-20 shadow-sm">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <Link href="/pipeline" className="mt-1 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{displayName}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-sm text-slate-500">{prospect.email}</span>
                  {prospect.telephone && (
                    <span className="text-sm text-slate-500">· {prospect.telephone}</span>
                  )}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ETAPE_COLORS[prospect.etape_process] ?? "bg-slate-100 text-slate-700"}`}>
                    {ETAPE_LABELS[prospect.etape_process] ?? prospect.etape_process}
                  </span>
                  {prospect.lead_score !== null && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                      Score {prospect.lead_score}/10
                    </span>
                  )}
                  {prospect.dossier_complet && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
                      ✓ Dossier complet
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleExportPdf}
              disabled={exportLoading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              {exportLoading ? "Export…" : "Export PDF"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* ════════════════════════════════════════════════ */}
        {/* SECTION 2 — Qualification                        */}
        {/* ════════════════════════════════════════════════ */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Qualification</h2>
            {property && (
              <div className="text-xs text-slate-500">
                Bien : <span className="font-medium text-slate-700">{property.title}</span>
                {property.rent ? ` — ${property.rent}€/mois` : ""}
              </div>
            )}
          </div>
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2">
              <EditableField
                label="Prénom"
                value={prospect.prenom}
                type="text"
                onSave={(v) => patchField("prenom", v)}
              />
              <EditableField
                label="Nom"
                value={prospect.nom}
                type="text"
                onSave={(v) => patchField("nom", v)}
              />
              <EditableField
                label="Téléphone"
                value={prospect.telephone}
                type="tel"
                onSave={(v) => patchField("telephone", v)}
              />
              <EditableField
                label="Situation professionnelle"
                value={prospect.situation_pro}
                type="select"
                options={Object.entries(SITUATION_LABELS).map(([value, label]) => ({ value, label }))}
                onSave={(v) => patchField("situation_pro", v)}
              />
              <EditableField
                label="Revenus nets/mois (€)"
                value={prospect.revenus_mensuels}
                type="number"
                onSave={(v) => patchField("revenus_mensuels", v)}
              />
              <EditableField
                label="Garant"
                value={prospect.garant}
                type="boolean"
                onSave={(v) => patchField("garant", v)}
              />
              <EditableField
                label="Revenus du garant (€)"
                value={prospect.garant_revenus}
                type="number"
                onSave={(v) => patchField("garant_revenus", v)}
              />
              <EditableField
                label="Nombre de personnes"
                value={prospect.nb_personnes}
                type="number"
                onSave={(v) => patchField("nb_personnes", v)}
              />
              <EditableField
                label="Animaux"
                value={prospect.animaux}
                type="boolean"
                onSave={(v) => patchField("animaux", v)}
              />
            </div>

            {/* Jauge solvabilité */}
            {ratio !== null && property?.rent && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">Ratio solvabilité</span>
                  <span className={`text-sm font-semibold ${ratio >= 3 ? "text-green-600" : ratio >= 2 ? "text-amber-600" : "text-red-600"}`}>
                    {ratio.toFixed(1)}x
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${ratio >= 3 ? "bg-green-500" : ratio >= 2 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${Math.min((ratio / 4) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>0x</span>
                  <span className="text-amber-500">2x</span>
                  <span className="text-green-500">3x</span>
                  <span>4x+</span>
                </div>
                <p className={`text-xs mt-1 ${ratio >= 3 ? "text-green-600" : ratio >= 2 ? "text-amber-600" : "text-red-600"}`}>
                  {ratio >= 3 ? "✓ Solvable" : ratio >= 2 ? "⚠ Limite" : "✗ Insolvable"} — {prospect.revenus_mensuels}€ revenus / {property.rent}€ loyer
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════ */}
        {/* SECTION 3 — Dossier locataire                   */}
        {/* ════════════════════════════════════════════════ */}
        {(property?.required_docs?.length ?? 0) > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Dossier locataire</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {documents.length} / {property!.required_docs.length} doc{property!.required_docs.length > 1 ? "s" : ""}
                  </span>
                  {/* Progress bar */}
                  <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${Math.min((documents.length / property!.required_docs.length) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 space-y-2">
              {property!.required_docs.map((doc) => {
                const found = documents.find((d) =>
                  d.filename?.toLowerCase().includes(doc.toLowerCase().slice(0, 5)) ||
                  (d.docType ?? "").toLowerCase().includes(doc.toLowerCase().slice(0, 5))
                );
                return (
                  <div key={doc} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50">
                    <div className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${found ? "bg-green-100 text-green-600" : "bg-slate-200 text-slate-400"}`}>
                        {found ? "✓" : "○"}
                      </span>
                      <span className="text-sm text-slate-700">{doc}</span>
                      {found && (
                        <span className="text-xs text-slate-400">{found.filename}</span>
                      )}
                    </div>
                    {found && (
                      <div className="flex items-center gap-1">
                        {found.url && (
                          <a href={found.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">
                            Voir
                          </a>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          found.status === "validé" ? "bg-green-100 text-green-700" :
                          found.status === "rejeté" ? "bg-red-100 text-red-700" :
                          "bg-slate-100 text-slate-600"
                        }`}>
                          {found.status === "validé" ? "Validé" : found.status === "rejeté" ? "Rejeté" : "En attente"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Documents reçus hors liste */}
              {documents.filter((d) => !property!.required_docs.some((req) =>
                d.filename?.toLowerCase().includes(req.toLowerCase().slice(0, 5)) ||
                (d.docType ?? "").toLowerCase().includes(req.toLowerCase().slice(0, 5))
              )).map((d, i) => (
                <div key={`extra-${i}`} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-blue-50">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-xs bg-blue-100 text-blue-600">📎</span>
                    <span className="text-sm text-blue-800">{d.filename}</span>
                    <span className="text-xs text-blue-400">Document supplémentaire</span>
                  </div>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-2 py-0.5 rounded bg-white border border-blue-200 text-blue-600 hover:bg-blue-50">
                      Voir
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════ */}
        {/* SECTION 4 — Historique emails                   */}
        {/* ════════════════════════════════════════════════ */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">
              Historique emails
              <span className="ml-2 text-sm font-normal text-slate-400">({emails.length})</span>
            </h2>
          </div>
          {emails.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-400">Aucun email lié à ce prospect</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {emails.map((em) => {
                const isExpanded = expandedEmails.has(em.id);
                const atts = Array.isArray(em.attachments) ? em.attachments : [];
                return (
                  <div key={em.id} className="px-6 py-4">
                    <button
                      className="w-full text-left"
                      onClick={() => setExpandedEmails((prev) => {
                        const next = new Set(prev);
                        if (next.has(em.id)) next.delete(em.id); else next.add(em.id);
                        return next;
                      })}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-900 truncate">{em.subject ?? "(Sans sujet)"}</span>
                            {atts.length > 0 && (
                              <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{atts.length} pj</span>
                            )}
                            {em.ai_reply && (
                              <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full">IA</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{formatDateTime(em.received_at)}</p>
                        </div>
                        <svg className={`w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="mt-3 space-y-3">
                        {em.body && (
                          <div className="bg-slate-50 rounded-lg p-3">
                            <p className="text-xs font-medium text-slate-500 mb-1">Message du prospect</p>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{em.body}</p>
                          </div>
                        )}
                        {em.ai_reply && (
                          <div className="bg-indigo-50 rounded-lg p-3">
                            <p className="text-xs font-medium text-indigo-500 mb-1">Réponse IA</p>
                            <p className="text-sm text-indigo-900 whitespace-pre-wrap leading-relaxed">{em.ai_reply}</p>
                          </div>
                        )}
                        {atts.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {atts.map((a, i) => (
                              <div key={i} className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2.5 py-1.5">
                                <span className="text-xs">📎</span>
                                {a.url ? (
                                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">{a.filename}</a>
                                ) : (
                                  <span className="text-xs text-slate-700">{a.filename}</span>
                                )}
                                {a.docType && <span className="text-xs text-slate-400">({a.docType})</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ════════════════════════════════════════════════ */}
        {/* SECTION 5 — Timeline                            */}
        {/* ════════════════════════════════════════════════ */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Timeline</h2>
          </div>
          {timeline.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-400">Aucun événement pour ce prospect</div>
          ) : (
            <div className="px-6 py-4">
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />
                <div className="space-y-4">
                  {timeline.map((entry) => {
                    const conf = ACTION_TIMELINE_LABELS[entry.action_type] ?? { label: entry.action_type, icon: "·" };
                    return (
                      <div key={entry.id} className="relative flex gap-4 pl-10">
                        <div className="absolute left-2.5 -translate-x-1/2 w-5 h-5 rounded-full bg-white border-2 border-indigo-300 flex items-center justify-center text-xs">
                          {conf.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">{conf.label}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{entry.description}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(entry.created_at)}</p>
                          {entry.metadata?.etape_avant && entry.metadata?.etape_apres && entry.metadata.etape_avant !== entry.metadata.etape_apres && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {String(entry.metadata.etape_avant)} → {String(entry.metadata.etape_apres)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* SECTION 6 — Quick actions (sticky bottom bar)       */}
      {/* ═══════════════════════════════════════════════════ */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 px-6 py-3 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Étape selector (inline) */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Étape :</span>
              <select
                value={prospect.etape_process}
                onChange={(e) => patchField("etape_process", e.target.value)}
                className={`text-xs px-2 py-1 rounded-lg border border-slate-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 ${ETAPE_COLORS[prospect.etape_process] ?? ""}`}
              >
                {Object.entries(ETAPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {actionSuccess && (
              <span className="text-xs text-green-600 font-medium animate-pulse">✓ Action effectuée</span>
            )}
            <ActionButton
              label="🏠 Visite effectuée"
              action="visite_effectuee"
              loading={actionLoading}
              onRun={runAction}
              colorClass="bg-green-600 hover:bg-green-700"
            />
            <ActionButton
              label="❌ Visite annulée"
              action="visite_annulee"
              loading={actionLoading}
              onRun={runAction}
              colorClass="bg-amber-500 hover:bg-amber-600"
            />
            <ActionButton
              label="📂 Demander dossier"
              action="demander_dossier"
              loading={actionLoading}
              onRun={runAction}
              colorClass="bg-indigo-600 hover:bg-indigo-700"
            />
            <ActionButton
              label="✅ Valider"
              action="valider"
              loading={actionLoading}
              onRun={runAction}
              colorClass="bg-emerald-600 hover:bg-emerald-700"
            />
            <ActionButton
              label="🚫 Refuser"
              action="refuser"
              loading={actionLoading}
              onRun={runAction}
              colorClass="bg-red-600 hover:bg-red-700"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── ActionButton component ── */
function ActionButton({
  label, action, loading, onRun, colorClass,
}: {
  label: string;
  action: string;
  loading: string | null;
  onRun: (a: string) => void;
  colorClass: string;
}) {
  const isLoading = loading === action;
  return (
    <button
      onClick={() => onRun(action)}
      disabled={loading !== null}
      className={`px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${colorClass}`}
    >
      {isLoading ? "…" : label}
    </button>
  );
}
