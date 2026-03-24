"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import AppShell from "@/components/layout/AppShell";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { EtapeProcess } from "@/types/email";

const supabase = supabaseBrowser();

type Lead = {
  id: string;
  sender: string | null;
  subject: string | null;
  summary: string | null;
  body: string | null;
  received_at: string | null;
  category: string | null;
  is_urgent: boolean | null;
  is_important: boolean | null;
  classification_reason: string | null;
  property_id?: string | null;
  attachments?: unknown[] | null;
  prospect_data: {
    nom?: string | null;
    situation_pro?: string | null;
    revenus_mensuels?: number | null;
    loyer_max?: number | null;
    telephone?: string | null;
    garant?: string | null;
    etape_process?: EtapeProcess | null;
  } | null;
};

type AttachmentItem = {
  source?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  storagePath?: string;
  docType?: string;
  confidence?: number;
  label?: string;
  validated_by_human?: boolean;
  uploaded_at?: string;
  // Gmail format
  docTypes?: Record<string, boolean>;
  attachmentId?: string;
  gmailLink?: string;
};

type PortalStatus = {
  hasToken: boolean;
  token?: string;
  portalUrl?: string;
  lastSentAt?: string | null;
  expiresAt?: string;
};

type PropertyInfo = { id: string; title: string; rent: number };

const ETAPE_CONFIG: Record<EtapeProcess, { label: string; color: string; bg: string; border: string }> = {
  NEW:              { label: "Nouveau",          color: "rgb(100 116 139)", bg: "rgb(248 250 252)",  border: "rgb(226 232 240)" },
  QUALIFICATION:    { label: "Qualification",    color: "rgb(234 88 12)",   bg: "rgb(255 247 237)",  border: "rgb(254 215 170)" },
  VISITE_PROPOSEE:  { label: "Visite proposée",  color: "rgb(2 132 199)",   bg: "rgb(240 249 255)",  border: "rgb(186 230 253)" },
  VISITE_CONFIRMEE: { label: "Visite confirmée", color: "rgb(22 163 74)",   bg: "rgb(240 253 244)",  border: "rgb(187 247 208)" },
  DOSSIER_DEMANDE:  { label: "Dossier demandé",  color: "rgb(234 179 8)",   bg: "rgb(254 252 232)",  border: "rgb(253 224 71)"  },
  DOSSIER_RECU:     { label: "Dossier reçu",     color: "rgb(147 51 234)",  bg: "rgb(250 245 255)",  border: "rgb(233 213 255)" },
  VALIDE:           { label: "Validé",           color: "rgb(22 163 74)",   bg: "rgb(240 253 244)",  border: "rgb(134 239 172)" },
  REFUSE:           { label: "Refusé",           color: "rgb(220 38 38)",   bg: "rgb(254 242 242)",  border: "rgb(252 165 165)" },
};

// Colonnes affichées dans le Kanban (on masque VALIDE/REFUSE par défaut)
const VISIBLE_STAGES: EtapeProcess[] = [
  "NEW", "QUALIFICATION", "VISITE_PROPOSEE", "VISITE_CONFIRMEE", "DOSSIER_DEMANDE", "DOSSIER_RECU",
];

function getEtapeFromLead(lead: Lead): EtapeProcess {
  const etape = lead.prospect_data?.etape_process;
  if (etape && etape in ETAPE_CONFIG) return etape;
  if (lead.classification_reason === "RDV_CONFIRMÉ") return "VISITE_CONFIRMEE";
  if (lead.category === "LOCATION" && lead.is_urgent) return "QUALIFICATION";
  return "NEW";
}

function hoursAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
}

function SolvabilityBadge({ revenus, loyer, multiplicateur = 3 }: { revenus: number | null; loyer: number | null; multiplicateur?: number }) {
  if (!revenus || !loyer) return null;
  const ratio = revenus / loyer;
  const ok = ratio >= multiplicateur;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        background: ok ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)",
        color: ok ? "rgb(22 163 74)" : "rgb(220 38 38)",
      }}
    >
      {ratio.toFixed(1)}x {ok ? "✓" : "✗"}
    </span>
  );
}

function LeadCard({
  lead,
  onVisiteEffectuee,
  onVisiteAnnulee,
  onMoveToStage,
  onSelect,
}: {
  lead: Lead;
  onVisiteEffectuee: (id: string) => void;
  onVisiteAnnulee: (id: string) => void;
  onMoveToStage: (id: string, etape: EtapeProcess) => void;
  onSelect: (lead: Lead) => void;
}) {
  const etape = getEtapeFromLead(lead);
  const config = ETAPE_CONFIG[etape];
  const pd = lead.prospect_data;
  const nom = pd?.nom || (lead.sender || "Inconnu").replace(/<.*>/, "").trim();
  const hours = hoursAgo(lead.received_at);
  const tooOld = hours !== null && hours > 48;
  const spMap: Record<string, string> = { CDI: "CDI", CDD: "CDD", AUTO_ENTREPRENEUR: "Auto.", ETUDIANT: "Étudiant", RETRAITE: "Retraité" };
  const situationLabel = pd?.situation_pro ? (spMap[pd.situation_pro] ?? pd.situation_pro) : null;

  return (
    <div
      className="rounded-xl border p-3 space-y-2 bg-white transition-shadow hover:shadow-md cursor-pointer"
      style={{
        borderColor: tooOld ? "rgba(220,38,38,0.3)" : "rgb(226 232 240)",
      }}
      onClick={() => onSelect(lead)}
    >
      {/* Nom + badge étape */}
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm truncate" style={{ color: "rgb(30 41 59)" }}>
          {nom}
        </div>
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}
        >
          {config.label}
        </span>
      </div>

      {/* Sujet */}
      <div className="text-xs truncate" style={{ color: "rgb(100 116 139)" }}>
        {lead.subject || "(Sans objet)"}
      </div>

      {/* Situation + solvabilité */}
      <div className="flex items-center gap-2 flex-wrap">
        {situationLabel && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
            {situationLabel}
          </span>
        )}
        <SolvabilityBadge revenus={pd?.revenus_mensuels ?? null} loyer={pd?.loyer_max ?? null} />
        {tooOld && hours !== null && (
          <span className="text-xs font-semibold" style={{ color: "rgb(220 38 38)" }}>
            ⏰ {Math.floor(hours / 24)}j
          </span>
        )}
      </div>

      {/* Résumé */}
      {lead.summary && (
        <div className="text-xs line-clamp-2" style={{ color: "rgb(148 163 184)" }}>
          {lead.summary}
        </div>
      )}

      {/* ── BLOC 4 : Barre progression dossier (DOSSIER_DEMANDE / DOSSIER_RECU) ── */}
      {(etape === "DOSSIER_DEMANDE" || etape === "DOSSIER_RECU") && (() => {
        const atts = (lead.attachments ?? []) as any[];
        const totalDocs = 4;
        const docsFound = new Set<string>();
        atts.forEach(att => {
          const dt = att.docTypes as Record<string, boolean> | undefined;
          if (dt) { for (const [k, v] of Object.entries(dt)) { if (v) docsFound.add(k); } }
        });
        if (docsFound.has("contrat_travail")) docsFound.add("contrat");
        const count = Math.min(docsFound.size, totalDocs);
        const pct = Math.round((count / totalDocs) * 100);
        const barColor = pct >= 100 ? "rgb(22,163,74)" : pct >= 50 ? "rgb(234,88,12)" : "rgb(220,38,38)";
        return (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: "rgb(100 116 139)" }}>Dossier</span>
              <span className="text-xs font-medium" style={{ color: barColor }}>
                {count}/{totalDocs} docs
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
          </div>
        );
      })()}

      {/* ── BLOC 5 : Boutons visite effectuée / annulée ─────────────── */}
      {etape === "VISITE_CONFIRMEE" && (
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            onClick={(e) => { e.stopPropagation(); onVisiteEffectuee(lead.id); }}
            className="text-xs py-1.5 rounded-lg font-medium text-center"
            style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22 163 74)" }}
          >
            ✅ Visite effectuée
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onVisiteAnnulee(lead.id); }}
            className="text-xs py-1.5 rounded-lg font-medium text-center"
            style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)" }}
          >
            ❌ Annulée
          </button>
        </div>
      )}

      {/* Déplacer vers */}
      <div className="flex gap-1 flex-wrap pt-0.5 border-t" style={{ borderColor: "rgb(241 245 249)" }}>
        <span className="text-xs self-center" style={{ color: "rgb(148 163 184)" }}>→</span>
        {(["QUALIFICATION", "VISITE_PROPOSEE", "VALIDE", "REFUSE"] as EtapeProcess[])
          .filter(s => s !== etape)
          .map(s => (
            <button
              key={s}
              onClick={(e) => { e.stopPropagation(); onMoveToStage(lead.id, s); }}
              className="text-xs px-1.5 py-0.5 rounded-md"
              style={{
                background: ETAPE_CONFIG[s].bg,
                color: ETAPE_CONFIG[s].color,
                border: `1px solid ${ETAPE_CONFIG[s].border}`,
              }}
            >
              {ETAPE_CONFIG[s].label}
            </button>
          ))}
      </div>
    </div>
  );
}

/* ─── ProspectDrawer ─── */
function ProspectDrawer({ lead, onClose, onMoveToStage, onVisiteEffectuee, onVisiteAnnulee }: {
  lead: Lead;
  onClose: () => void;
  onMoveToStage: (id: string, etape: EtapeProcess) => void;
  onVisiteEffectuee: (id: string) => void;
  onVisiteAnnulee: (id: string) => void;
}) {
  const pd = lead.prospect_data;
  const etape = getEtapeFromLead(lead);
  const config = ETAPE_CONFIG[etape];
  const nom = pd?.nom || (lead.sender || "Inconnu").replace(/<.*>/, "").trim();
  const revenus = pd?.revenus_mensuels ?? null;
  const loyer = pd?.loyer_max ?? null;
  const ratio = revenus && loyer ? (revenus / loyer) : null;
  const solvable = ratio ? ratio >= 3 : null;

  const [timeline, setTimeline] = useState<Array<{ id: string; action_type: string; description: string | null; created_at: string }>>([]);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const { toast } = useToast();

  // Portal state
  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null);
  const [sendingPortal, setSendingPortal] = useState(false);
  const [localAttachments, setLocalAttachments] = useState<AttachmentItem[]>(
    () => ((lead as unknown as { attachments?: AttachmentItem[] }).attachments ?? [])
  );

  const ACTION_ICONS: Record<string, string> = {
    EMAIL_RECU: "📧", IA_REPONDU: "🤖", PROSPECT_REPONDU: "📧",
    VISITE_PROPOSEE: "📅", VISITE_CONFIRMEE: "✅", VISITE_EFFECTUEE: "🏠",
    DOSSIER_DEMANDE: "📋", DOCUMENT_RECU: "📎", VALIDE: "🎉",
    REFUSE: "❌", RELANCE: "🔁", NOTE_INTERNE: "📝",
  };

  useEffect(() => {
    fetch(`/api/leads/${lead.id}/timeline`)
      .then(r => r.json())
      .then(d => setTimeline(d.timeline ?? []))
      .catch(() => {});
  }, [lead.id]);

  useEffect(() => {
    setLocalAttachments(
      ((lead as unknown as { attachments?: AttachmentItem[] }).attachments ?? [])
    );
    fetch(`/api/portal/status?emailId=${lead.id}`)
      .then(r => r.json())
      .then(d => setPortalStatus(d as PortalStatus))
      .catch(() => {});
  }, [lead.id]);

  const saveNote = async () => {
    if (!noteText.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await fetch(`/api/leads/${lead.id}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: "NOTE_INTERNE", description: noteText.trim(), metadata: { internal: true } }),
      });
      setNoteText("");
      toast("Note sauvegardée ✅", "success");
      const r = await fetch(`/api/leads/${lead.id}/timeline`);
      const d = await r.json();
      setTimeline(d.timeline ?? []);
    } finally {
      setSavingNote(false);
    }
  };

  const spMap: Record<string, string> = { CDI: "CDI", CDD: "CDD", AUTO_ENTREPRENEUR: "Auto-entrepreneur", ETUDIANT: "Étudiant", RETRAITE: "Retraité" };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(15,23,42,0.4)" }} onClick={onClose}>
      <div
        className="h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10" style={{ borderColor: "rgb(226 232 240)" }}>
          <div>
            <div className="font-semibold text-base" style={{ color: "rgb(30 41 59)" }}>{nom}</div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}>
              {config.label}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-6 space-y-6 flex-1">

          {/* IDENTITÉ */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>Identité</h3>
            <div className="grid grid-cols-2 gap-3">
              {pd?.telephone && (
                <div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Téléphone</div>
                  <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>📞 {pd.telephone}</div>
                </div>
              )}
              {lead.sender && (
                <div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Email</div>
                  <div className="text-sm truncate" style={{ color: "rgb(71 85 105)" }}>{lead.sender.replace(/<.*>/, "").trim()}</div>
                </div>
              )}
              {pd?.situation_pro && (
                <div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Situation pro</div>
                  <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>{spMap[pd.situation_pro] ?? pd.situation_pro}</div>
                </div>
              )}
              {revenus && (
                <div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Revenus nets/mois</div>
                  <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>{revenus.toLocaleString("fr-FR")} €</div>
                </div>
              )}
              {loyer && (
                <div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Loyer visé</div>
                  <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>{loyer.toLocaleString("fr-FR")} €/mois</div>
                </div>
              )}
              {pd?.garant && (
                <div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Garant</div>
                  <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>{pd.garant}</div>
                </div>
              )}
            </div>

            {/* Ratio solvabilité */}
            {ratio !== null && (
              <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{
                background: solvable ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)",
                border: `1px solid ${solvable ? "rgba(22,163,74,0.2)" : "rgba(220,38,38,0.2)"}`,
              }}>
                <span className="font-bold" style={{ color: solvable ? "rgb(22 163 74)" : "rgb(220 38 38)" }}>
                  {ratio.toFixed(1)}x
                </span>
                <span className="text-sm" style={{ color: solvable ? "rgb(22 163 74)" : "rgb(220 38 38)" }}>
                  {solvable ? "✓ Solvable (≥ 3x)" : "⚠ Risque — revenus insuffisants"}
                </span>
              </div>
            )}
          </div>

          {/* DOCUMENTS REQUIS — selon situation_pro */}
          {pd?.situation_pro && (() => {
            type DocItem = { key: string; label: string };
            const DOC_PROFILES: Record<string, DocItem[]> = {
              CDI: [
                { key: "fiches_paie",     label: "Fiches de paie (3 mois)" },
                { key: "contrat",         label: "Contrat de travail" },
                { key: "avis_imposition", label: "Avis d'imposition" },
                { key: "piece_identite",  label: "Pièce d'identité" },
              ],
              CDD: [
                { key: "fiches_paie",     label: "Fiches de paie (3 mois)" },
                { key: "contrat",         label: "Contrat de travail (+ durée)" },
                { key: "avis_imposition", label: "Avis d'imposition" },
                { key: "piece_identite",  label: "Pièce d'identité" },
              ],
              ETUDIANT: [
                { key: "carte_etudiant",  label: "Carte étudiante" },
                { key: "scolarite",       label: "Certificat de scolarité" },
                { key: "piece_identite",  label: "Pièce d'identité" },
                { key: "garant_id",       label: "Garant : pièce identité" },
                { key: "garant_paie",     label: "Garant : fiches de paie" },
                { key: "garant_impos",    label: "Garant : avis d'imposition" },
              ],
              AUTO_ENTREPRENEUR: [
                { key: "kbis",            label: "Kbis (< 3 mois)" },
                { key: "bilan",           label: "Bilans (3 dernières années)" },
                { key: "releves",         label: "Relevés bancaires (3 mois)" },
                { key: "piece_identite",  label: "Pièce d'identité" },
              ],
              RETRAITE: [
                { key: "pension",         label: "Relevés de pension (3 mois)" },
                { key: "avis_imposition", label: "Avis d'imposition" },
                { key: "piece_identite",  label: "Pièce d'identité" },
              ],
            };
            const spKey = pd.situation_pro as string;
            const docs = DOC_PROFILES[spKey] ?? DOC_PROFILES.CDI;

            // Calculer les docs reçus à partir des PJ (depuis lead.attachments si disponible)
            const attachments: AttachmentItem[] = localAttachments;
            const receivedKeys = new Set<string>();
            attachments.forEach((att) => {
              // Gmail style
              if (att.docTypes) {
                Object.entries(att.docTypes).forEach(([k, v]) => { if (v) receivedKeys.add(k); });
              }
              // Portal style
              if (att.source === "portal" && att.docType) {
                receivedKeys.add(att.docType);
              }
            });

            const receivedCount = docs.filter(d => receivedKeys.has(d.key)).length;
            const total = docs.length;
            const dossierStatus = receivedCount >= total ? "COMPLET" : receivedCount >= 2 ? "PARTIEL" : "INCOMPLET";
            const statusStyle = dossierStatus === "COMPLET"
              ? { bg: "rgba(22,163,74,0.1)", color: "rgb(22 163 74)", label: "✅ Dossier complet" }
              : dossierStatus === "PARTIEL"
              ? { bg: "rgba(234,88,12,0.1)", color: "rgb(234 88 12)", label: `📋 Partiel (${receivedCount}/${total})` }
              : { bg: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)", label: `⚠️ Incomplet (${receivedCount}/${total})` };

            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
                    📋 Documents requis
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ background: statusStyle.bg, color: statusStyle.color }}>
                    {statusStyle.label}
                  </span>
                </div>
                {/* Barre de progression dossier */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs" style={{ color: "rgb(100 116 139)" }}>
                    <span>{receivedCount}/{total} documents validés</span>
                    <span>{Math.round((receivedCount / Math.max(total, 1)) * 100)}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(226,232,240,0.6)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.round((receivedCount / Math.max(total, 1)) * 100)}%`,
                        background: dossierStatus === "COMPLET"
                          ? "rgb(22 163 74)"
                          : dossierStatus === "PARTIEL"
                          ? "rgb(234 88 12)"
                          : "rgb(220 38 38)",
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  {docs.map(doc => {
                    const portalAtt = attachments.find(a => a.source === "portal" && a.docType === doc.key);
                    const gmailAtt = attachments.find(a => !a.source && a.docTypes?.[doc.key]);
                    const matchedAtt = portalAtt ?? gmailAtt;
                    const isValidated = matchedAtt?.validated_by_human === true;

                    const openFile = async () => {
                      if (portalAtt?.storagePath) {
                        const r = await fetch(`/api/portal/doc-url?path=${encodeURIComponent(portalAtt.storagePath)}`);
                        const d = await r.json();
                        if (d.url) window.open(d.url, "_blank");
                      } else if (gmailAtt?.gmailLink) {
                        window.open(gmailAtt.gmailLink, "_blank");
                      }
                    };

                    const validateDoc = async (validated: boolean) => {
                      if (!portalStatus?.token || !portalAtt?.storagePath) return;
                      const res = await fetch(`/api/portal/${portalStatus.token}/validate`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ storagePath: portalAtt.storagePath, validated }),
                      });
                      if (res.ok) {
                        setLocalAttachments(prev => prev.map(a =>
                          a.storagePath === portalAtt.storagePath
                            ? { ...a, validated_by_human: validated }
                            : a
                        ));
                        toast(validated ? "✓ Document validé" : "✗ Document rejeté", validated ? "success" : "error");
                      }
                    };

                    if (!matchedAtt) {
                      return (
                        <div key={doc.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                          style={{ background: "rgba(226,232,240,0.4)" }}>
                          <span className="text-sm flex-shrink-0" style={{ color: "rgb(148 163 184)" }}>✗</span>
                          <span className="text-xs flex-1" style={{ color: "rgb(100 116 139)" }}>{doc.label}</span>
                          <span className="text-xs flex-shrink-0" style={{ color: "rgb(148 163 184)" }}>Manquant</span>
                        </div>
                      );
                    }
                    if (isValidated) {
                      return (
                        <div key={doc.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                          style={{ background: "rgba(22,163,74,0.06)" }}>
                          <span className="text-sm flex-shrink-0" style={{ color: "rgb(22 163 74)" }}>✓</span>
                          <span className="text-xs flex-1" style={{ color: "rgb(22 163 74)" }}>{doc.label}</span>
                          <span className="text-xs flex-shrink-0 font-medium" style={{ color: "rgb(22 163 74)" }}>Validé</span>
                        </div>
                      );
                    }
                    return (
                      <div key={doc.key} className="flex flex-col gap-1 px-2 py-1.5 rounded-lg"
                        style={{ background: "rgba(234,88,12,0.06)" }}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm flex-shrink-0" style={{ color: "rgb(234 88 12)" }}>⏳</span>
                          <button
                            onClick={openFile}
                            className="text-xs flex-1 text-left underline underline-offset-2 truncate"
                            style={{ color: "rgb(234 88 12)" }}
                          >
                            {matchedAtt.filename ?? doc.label}
                          </button>
                          <span className="text-xs flex-shrink-0 font-medium" style={{ color: "rgb(234 88 12)" }}>À valider</span>
                        </div>
                        {portalAtt && portalStatus?.token && (
                          <div className="flex gap-1 pl-6">
                            <button
                              onClick={() => validateDoc(true)}
                              className="text-xs px-2 py-0.5 rounded font-medium"
                              style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22 163 74)" }}
                            >
                              ✓ Valider
                            </button>
                            <button
                              onClick={() => validateDoc(false)}
                              className="text-xs px-2 py-0.5 rounded font-medium"
                              style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)" }}
                            >
                              ✗ Rejeter
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── PORTAIL DE DÉPÔT ──────────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
              📎 Lien de dépôt de documents
            </h3>

            {portalStatus?.hasToken ? (
              <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "rgb(199 210 254)", background: "rgb(238 242 255)" }}>
                <div className="flex items-center gap-2 text-xs" style={{ color: "rgb(79 70 229)" }}>
                  <span>✓</span>
                  <span>
                    Lien envoyé{portalStatus.lastSentAt
                      ? ` le ${new Date(portalStatus.lastSentAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
                      : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (portalStatus.portalUrl) {
                        navigator.clipboard.writeText(portalStatus.portalUrl);
                        toast("Lien copié !", "success");
                      }
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg font-medium"
                    style={{ background: "rgba(79,70,229,0.12)", color: "rgb(79 70 229)" }}
                  >
                    📋 Copier
                  </button>
                  <button
                    disabled={sendingPortal}
                    onClick={async () => {
                      setSendingPortal(true);
                      const res = await fetch("/api/portal/create-token", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ emailId: lead.id, sendEmail: true }),
                      });
                      const d = await res.json();
                      setSendingPortal(false);
                      if (res.ok || res.status === 207) {
                        setPortalStatus({ hasToken: true, token: d.token, portalUrl: d.portalUrl, lastSentAt: d.lastSentAt, expiresAt: d.expiresAt });
                        if (d.gmailError) {
                          toast("Gmail indisponible — lien ci-dessus à copier", "error");
                        } else {
                          toast(`Lien renvoyé ✓`, "success");
                        }
                      }
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg font-medium disabled:opacity-50"
                    style={{ background: "rgba(79,70,229,0.12)", color: "rgb(79 70 229)" }}
                  >
                    {sendingPortal ? "Envoi…" : "🔄 Renvoyer"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                disabled={sendingPortal}
                onClick={async () => {
                  setSendingPortal(true);
                  const res = await fetch("/api/portal/create-token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ emailId: lead.id, sendEmail: true }),
                  });
                  const d = await res.json();
                  setSendingPortal(false);
                  if (res.ok || res.status === 207) {
                    setPortalStatus({ hasToken: true, token: d.token, portalUrl: d.portalUrl, lastSentAt: d.lastSentAt, expiresAt: d.expiresAt });
                    if (d.gmailError) {
                      toast("Lien créé — Gmail indisponible, copiez-le ci-dessus", "error");
                    } else {
                      const senderEmail = lead.sender?.match(/<(.+)>/)?.[1] ?? lead.sender ?? "";
                      toast(`Lien envoyé à ${senderEmail} ✓`, "success");
                    }
                  } else {
                    toast("Erreur lors de la création du lien", "error");
                  }
                }}
                className="w-full text-sm px-3 py-2 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "rgb(79 70 229)", color: "white" }}
              >
                {sendingPortal ? (
                  <>
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Envoi en cours…
                  </>
                ) : (
                  <>📎 Envoyer le lien de dépôt</>
                )}
              </button>
            )}
          </div>

          {/* ÉTAPE + ACTIONS */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>Étape & Actions</h3>
            <div className="flex flex-wrap gap-2">
              {etape === "VISITE_CONFIRMEE" && (
                <>
                  <button onClick={() => { onVisiteEffectuee(lead.id); onClose(); }}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22 163 74)" }}>
                    ✅ Visite effectuée
                  </button>
                  <button onClick={() => { onVisiteAnnulee(lead.id); onClose(); }}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)" }}>
                    ❌ Visite annulée
                  </button>
                </>
              )}
              {(["QUALIFICATION", "VISITE_PROPOSEE", "VISITE_CONFIRMEE", "DOSSIER_DEMANDE", "VALIDE", "REFUSE"] as EtapeProcess[])
                .filter(s => s !== etape)
                .map(s => (
                  <button key={s} onClick={() => { onMoveToStage(lead.id, s); onClose(); }}
                    className="text-xs px-2.5 py-1 rounded-lg"
                    style={{ background: ETAPE_CONFIG[s].bg, color: ETAPE_CONFIG[s].color, border: `1px solid ${ETAPE_CONFIG[s].border}` }}>
                    → {ETAPE_CONFIG[s].label}
                  </button>
                ))}
            </div>
          </div>

          {/* TIMELINE */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>Historique</h3>
            {timeline.length === 0 ? (
              <div className="text-xs py-2" style={{ color: "rgb(148 163 184)" }}>Aucun historique enregistré</div>
            ) : (
              <div className="space-y-1">
                {timeline.slice().reverse().map(entry => {
                  const icon = ACTION_ICONS[entry.action_type] ?? "•";
                  const date = new Date(entry.created_at);
                  const dateStr = date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                  const timeStr = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={entry.id} className="flex items-start gap-2 py-1.5 border-b" style={{ borderColor: "rgb(241 245 249)" }}>
                      <span className="text-sm flex-shrink-0">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs" style={{ color: "rgb(30 41 59)" }}>{entry.description ?? entry.action_type}</div>
                      </div>
                      <div className="text-xs flex-shrink-0" style={{ color: "rgb(148 163 184)" }}>{dateStr} {timeStr}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* NOTES INTERNES */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>📝 Notes internes</h3>
            {timeline.filter(e => e.action_type === "NOTE_INTERNE").map(note => (
              <div key={note.id} className="rounded-lg p-3 text-sm" style={{ background: "rgb(250 250 252)", border: "1px solid rgb(226 232 240)" }}>
                <div style={{ color: "rgb(30 41 59)" }}>{note.description}</div>
                <div className="text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>
                  {new Date(note.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                  {" "}
                  {new Date(note.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Ajouter une note interne…"
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-indigo-300"
              style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
            />
            <button
              onClick={saveNote}
              disabled={savingNote || !noteText.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "rgb(79 70 229)" }}
            >
              {savingNote ? "Sauvegarde…" : "💾 Sauvegarder"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRefused, setShowRefused] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [properties, setProperties] = useState<PropertyInfo[]>([]);
  // Filtres vue liste
  const [filterEtape, setFilterEtape] = useState<EtapeProcess | "">("");
  const [filterProperty, setFilterProperty] = useState<string>("");
  const [filterSolvable, setFilterSolvable] = useState<"" | "oui" | "non">("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const { toast } = useToast();

  const ETAPE_ORDER: Partial<Record<string, number>> = {
    NEW: 0, QUALIFICATION: 1, VISITE_PROPOSEE: 2,
    VISITE_CONFIRMEE: 3, DOSSIER_DEMANDE: 4,
    DOSSIER_RECU: 5, VALIDE: 6, REFUSE: 7,
  };

  function normalizeSender(sender: string | null): string {
    if (!sender) return "";
    return (sender.match(/<(.+)>/)?.[1] ?? sender).toLowerCase().trim();
  }

  const IMMO_KEYWORDS = [
    "visite", "location", "louer", "appartement", "logement",
    "t1", "t2", "t3", "chambre", "studio", "loyer", "bail",
    "locataire", "demande", "intéressé", "appart", "re:",
  ];

  function hasImmoSubject(lead: Lead): boolean {
    const s = (lead.subject ?? "").toLowerCase();
    return IMMO_KEYWORDS.some((kw) => s.includes(kw));
  }

  function deduplicateLeads(leads: Lead[]): Lead[] {
    const best = new Map<string, Lead>();
    for (const lead of leads) {
      const key = normalizeSender(lead.sender) || lead.id;
      const existing = best.get(key);
      if (!existing) { best.set(key, lead); continue; }

      const immoA = hasImmoSubject(existing);
      const immoB = hasImmoSubject(lead);

      // Priorité absolue à l'email avec sujet immobilier
      if (immoB && !immoA) { best.set(key, lead); continue; }
      if (immoA && !immoB) { continue; }

      // Les deux immo ou aucun → comparer étape puis date
      const etapeA = (existing.prospect_data as any)?.etape_process ?? "NEW";
      const etapeB = (lead.prospect_data as any)?.etape_process ?? "NEW";
      const eA = ETAPE_ORDER[etapeA] ?? 0;
      const eB = ETAPE_ORDER[etapeB] ?? 0;
      if (eB > eA) { best.set(key, lead); continue; }
      if (eB === eA) {
        const dA = new Date(existing.received_at ?? 0).getTime();
        const dB = new Date(lead.received_at ?? 0).getTime();
        if (dB > dA) best.set(key, lead);
      }
    }
    return Array.from(best.values());
  }

  const fetchLeads = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/auth/login"; return; }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    // Tenter de récupérer property_id (graceful si colonne manquante)
    let selectFields = "id, sender, subject, summary, body, received_at, category, is_urgent, is_important, classification_reason, prospect_data, attachments";
    const { data } = await supabase
      .from("emails")
      .select(selectFields)
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false })
      .limit(200);

    if (data) {
      const COMMERCIAL_DOMAINS = [
        "@revolut.com", "@facebookmail.com", "@meta.com",
        "@google.com", "@linkedin.com", "@twitter.com",
        "@netflix.com", "@amazon.com", "@paypal.com",
        "@stripe.com", "@notion.so", "@slack.com",
      ];
      const filtered = (data as unknown as Lead[]).filter(lead => {
        const pd = lead.prospect_data;
        // Vrai prospect : données IA extraites
        const hasProspectData = pd && (pd.nom || pd.situation_pro || pd.revenus_mensuels);
        if (hasProspectData) return true;
        // Ou sujet contient un mot-clé immobilier
        if (hasImmoSubject(lead)) return true;
        // Sinon : exclure si domaine commercial connu
        const email = normalizeSender(lead.sender);
        return !COMMERCIAL_DOMAINS.some(d => email.endsWith(d) || email.includes(d));
      });

      const deduped = deduplicateLeads(filtered);

      // Exclure les leads sans nom ET sans sujet immobilier (parasites résiduels)
      const clean = deduped.filter(lead => {
        const pd = lead.prospect_data;
        const hasName = !!(pd?.nom);
        return hasName || hasImmoSubject(lead);
      });

      setLeads(clean);
    }

    // Charger les biens pour les filtres
    try {
      const propsRes = await fetch("/api/properties");
      if (propsRes.ok) {
        const propsData = await propsRes.json();
        setProperties((propsData.properties ?? []).map((p: any) => ({ id: p.id, title: p.title, rent: p.rent })));
      }
    } catch { /* graceful */ }

    setLoading(false);
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const handleVisiteEffectuee = async (id: string) => {
    const res = await fetch(`/api/leads/${id}/visite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "effectuee" }),
    });
    if (res.ok) {
      toast("✅ Visite marquée comme effectuée — Dossier demandé par IA", "success");
      await fetchLeads();
    } else {
      toast("Erreur lors de la mise à jour", "error");
    }
  };

  const handleVisiteAnnulee = async (id: string) => {
    const res = await fetch(`/api/leads/${id}/visite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "annulee" }),
    });
    if (res.ok) {
      toast("❌ Visite annulée — Prospect remis en Qualification", "success");
      await fetchLeads();
    } else {
      toast("Erreur lors de la mise à jour", "error");
    }
  };

  const handleMoveToStage = async (id: string, etape: EtapeProcess) => {
    const { data: email } = await supabase.from("emails").select("prospect_data").eq("id", id).single();
    const pd = ((email as any)?.prospect_data as Record<string, unknown> | null) ?? {};
    const updated = { ...pd, etape_process: etape };
    await supabase.from("emails").update({ prospect_data: updated }).eq("id", id);
    setLeads(prev => prev.map(l => l.id === id ? { ...l, prospect_data: { ...l.prospect_data, etape_process: etape } } : l));
    toast(`Déplacé → ${ETAPE_CONFIG[etape].label}`, "success");
  };

  const activeLeads = leads.filter(l => getEtapeFromLead(l) !== "REFUSE" && getEtapeFromLead(l) !== "VALIDE");
  const refusedLeads = leads.filter(l => getEtapeFromLead(l) === "REFUSE" || getEtapeFromLead(l) === "VALIDE");

  const stageLeads = (stage: EtapeProcess) => activeLeads.filter(l => getEtapeFromLead(l) === stage);

  const urgentCount = leads.filter(l => l.is_urgent).length;
  const staleCount = leads.filter(l => { const h = hoursAgo(l.received_at); return h !== null && h > 48; }).length;
  const visiteProposeCount = stageLeads("VISITE_PROPOSEE").length + stageLeads("VISITE_CONFIRMEE").length;
  const dossierCount = stageLeads("DOSSIER_DEMANDE").length + stageLeads("DOSSIER_RECU").length;

  // Vue liste avec filtres
  const getPropertyTitle = (propertyId: string | null | undefined) => {
    if (!propertyId) return null;
    return properties.find(p => p.id === propertyId)?.title ?? null;
  };

  const filteredListLeads = leads.filter(l => {
    if (filterEtape && getEtapeFromLead(l) !== filterEtape) return false;
    if (filterProperty && (l.property_id ?? "") !== filterProperty) return false;
    if (filterSolvable) {
      const pd = l.prospect_data;
      const revenus = pd?.revenus_mensuels ?? null;
      const loyer = pd?.loyer_max ?? null;
      if (!revenus || !loyer) return false;
      const solvable = revenus / loyer >= 3;
      if (filterSolvable === "oui" && !solvable) return false;
      if (filterSolvable === "non" && solvable) return false;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>Prospects</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                {activeLeads.length} actifs · 30 jours
                {urgentCount > 0 && <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>🔥 {urgentCount} urgent{urgentCount > 1 ? "s" : ""}</span>}
                {staleCount > 0 && <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>⏰ {staleCount} sans réponse &gt;48h</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {visiteProposeCount > 0 && (
                <div className="text-center">
                  <div className="text-lg font-bold" style={{ color: "rgb(2 132 199)" }}>{visiteProposeCount}</div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Visites</div>
                </div>
              )}
              {dossierCount > 0 && (
                <div className="text-center">
                  <div className="text-lg font-bold" style={{ color: "rgb(147 51 234)" }}>{dossierCount}</div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Dossiers</div>
                </div>
              )}
              {/* Toggle Kanban / Liste */}
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "rgb(226 232 240)" }}>
                {(["kanban", "list"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className="px-3 py-1.5 text-xs font-medium transition-colors"
                    style={viewMode === mode
                      ? { background: "rgb(79 70 229)", color: "white" }
                      : { background: "white", color: "rgb(100 116 139)" }
                    }
                  >
                    {mode === "kanban" ? "⊞ Kanban" : "☰ Liste"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowRefused(v => !v)}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "rgb(241 245 249)", color: "rgb(100 116 139)" }}
              >
                {showRefused ? "Masquer refusés" : `Refusés/Validés (${refusedLeads.length})`}
              </button>
            </div>
          </div>

          {/* Filtres (vue liste seulement) */}
          {viewMode === "list" && (
            <div className="flex items-center gap-3 mt-3 pt-3 border-t" style={{ borderColor: "rgb(241 245 249)" }}>
              <span className="text-xs font-medium" style={{ color: "rgb(100 116 139)" }}>Filtrer :</span>
              <select
                value={filterEtape}
                onChange={(e) => setFilterEtape(e.target.value as EtapeProcess | "")}
                className="text-xs border rounded-lg px-2.5 py-1.5 outline-none"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
              >
                <option value="">Toutes les étapes</option>
                {(Object.keys(ETAPE_CONFIG) as EtapeProcess[]).map(e => (
                  <option key={e} value={e}>{ETAPE_CONFIG[e].label}</option>
                ))}
              </select>
              {properties.length > 0 && (
                <select
                  value={filterProperty}
                  onChange={(e) => setFilterProperty(e.target.value)}
                  className="text-xs border rounded-lg px-2.5 py-1.5 outline-none"
                  style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
                >
                  <option value="">Tous les biens</option>
                  {properties.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              )}
              <select
                value={filterSolvable}
                onChange={(e) => setFilterSolvable(e.target.value as "" | "oui" | "non")}
                className="text-xs border rounded-lg px-2.5 py-1.5 outline-none"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
              >
                <option value="">Solvabilité : tous</option>
                <option value="oui">✓ Solvables</option>
                <option value="non">✗ Non solvables</option>
              </select>
              {(filterEtape || filterProperty || filterSolvable) && (
                <button
                  onClick={() => { setFilterEtape(""); setFilterProperty(""); setFilterSolvable(""); }}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ color: "rgb(220 38 38)", background: "rgba(220,38,38,0.08)" }}
                >
                  × Effacer
                </button>
              )}
              <span className="text-xs ml-auto" style={{ color: "rgb(148 163 184)" }}>
                {filteredListLeads.length} résultat{filteredListLeads.length > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* ── Vue Liste ── */}
        {viewMode === "list" && (
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>Chargement…</div>
            ) : filteredListLeads.length === 0 ? (
              <div className="text-center py-16" style={{ color: "rgb(148 163 184)" }}>
                <div className="text-3xl mb-2">🔍</div>
                <div className="text-sm">Aucun prospect trouvé</div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "rgb(226 232 240)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "rgb(248 250 252)", borderBottom: "1px solid rgb(226 232 240)" }}>
                      {["Prospect", "Bien", "Revenus / Loyer / Ratio", "Étape", "Activité", "Actions"].map(h => (
                        <th key={h} className="text-left text-xs font-semibold px-4 py-3" style={{ color: "rgb(100 116 139)" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredListLeads.map((lead, i) => {
                      const etape = getEtapeFromLead(lead);
                      const config = ETAPE_CONFIG[etape];
                      const pd = lead.prospect_data;
                      const nom = pd?.nom || (lead.sender || "Inconnu").replace(/<.*>/, "").trim();
                      const revenus = pd?.revenus_mensuels ?? null;
                      const loyer = pd?.loyer_max ?? null;
                      const ratio = revenus && loyer ? (revenus / loyer).toFixed(1) : null;
                      const solvable = ratio ? parseFloat(ratio) >= 3 : null;
                      const propertyTitle = getPropertyTitle(lead.property_id);
                      const hours = hoursAgo(lead.received_at);
                      const spLabels: Record<string, string> = { CDI: "CDI", CDD: "CDD", AUTO_ENTREPRENEUR: "Auto.", ETUDIANT: "Étudiant", RETRAITE: "Retraité" };
                      return (
                        <tr
                          key={lead.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedLead(lead)}
                          style={{
                            borderBottom: i < filteredListLeads.length - 1 ? "1px solid rgb(241 245 249)" : undefined,
                            background: "white",
                          }}
                        >
                          {/* Prospect */}
                          <td className="px-4 py-3">
                            <div className="font-medium" style={{ color: "rgb(30 41 59)" }}>{nom}</div>
                            {pd?.situation_pro && (
                              <div className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                                {spLabels[pd.situation_pro] ?? pd.situation_pro}
                              </div>
                            )}
                            {pd?.telephone && (
                              <div className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                                📞 {pd.telephone}
                              </div>
                            )}
                          </td>

                          {/* Bien */}
                          <td className="px-4 py-3">
                            {propertyTitle ? (
                              <div className="text-xs font-medium" style={{ color: "rgb(79 70 229)" }}>
                                🏠 {propertyTitle}
                              </div>
                            ) : (
                              <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>—</div>
                            )}
                          </td>

                          {/* Revenus / Loyer / Ratio */}
                          <td className="px-4 py-3">
                            {revenus || loyer ? (
                              <div className="space-y-0.5">
                                {revenus && <div className="text-xs" style={{ color: "rgb(71 85 105)" }}>{revenus.toLocaleString("fr-FR")} €/mois</div>}
                                {loyer && <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Loyer : {loyer.toLocaleString("fr-FR")} €</div>}
                                {ratio && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                    style={{
                                      background: solvable ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)",
                                      color: solvable ? "rgb(22 163 74)" : "rgb(220 38 38)",
                                    }}>
                                    {ratio}x {solvable ? "✓" : "✗"}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>—</span>
                            )}
                          </td>

                          {/* Étape */}
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-1 rounded-full font-medium"
                              style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}>
                              {config.label}
                            </span>
                          </td>

                          {/* Activité */}
                          <td className="px-4 py-3">
                            {lead.received_at ? (
                              <div className="text-xs" style={{ color: hours && hours > 48 ? "rgb(220 38 38)" : "rgb(100 116 139)" }}>
                                {hours !== null && hours > 24
                                  ? `Il y a ${Math.floor(hours / 24)}j`
                                  : hours !== null
                                  ? `Il y a ${hours}h`
                                  : new Date(lead.received_at).toLocaleDateString("fr-FR")}
                              </div>
                            ) : <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>—</span>}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex gap-1.5">
                              <a
                                href={`/emails?id=${lead.id}`}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
                                style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}
                              >
                                Voir
                              </a>
                              {etape === "VISITE_CONFIRMEE" && (
                                <button
                                  onClick={() => handleVisiteEffectuee(lead.id)}
                                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
                                  style={{ background: "rgba(22,163,74,0.1)", color: "rgb(22 163 74)" }}
                                >
                                  ✅ Visite
                                </button>
                              )}
                              <button
                                onClick={() => handleMoveToStage(lead.id, "REFUSE")}
                                className="text-xs px-2.5 py-1.5 rounded-lg"
                                style={{ background: "rgba(220,38,38,0.06)", color: "rgb(220 38 38)" }}
                              >
                                ✗
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Vue Kanban ── */}
        <div className={`flex-1 overflow-x-auto p-6 ${viewMode !== "kanban" ? "hidden" : ""}`}>
          {loading ? (
            <div className="flex gap-4">
              {VISIBLE_STAGES.slice(0, 4).map(s => (
                <div key={s} className="w-64 flex-shrink-0 space-y-3">
                  <SkeletonCard /><SkeletonCard />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-4 h-full">
              {VISIBLE_STAGES.map((stage) => {
                const config = ETAPE_CONFIG[stage];
                const items = stageLeads(stage);
                return (
                  <div key={stage} className="w-64 flex-shrink-0 flex flex-col gap-3">
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: config.bg, border: `1px solid ${config.border}` }}
                    >
                      <span className="text-sm font-semibold" style={{ color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white" style={{ color: config.color }}>
                        {items.length}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                      {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 rounded-xl border border-dashed" style={{ borderColor: config.border }}>
                          <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Aucun prospect</div>
                        </div>
                      ) : (
                        items.map(lead => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onVisiteEffectuee={handleVisiteEffectuee}
                            onVisiteAnnulee={handleVisiteAnnulee}
                            onMoveToStage={handleMoveToStage}
                            onSelect={(lead) => setSelectedLead(lead)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Colonne Refusés/Validés (toggleable) */}
              {showRefused && (
                <div className="w-64 flex-shrink-0 flex flex-col gap-3">
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}>
                    <span className="text-sm font-semibold" style={{ color: "rgb(100 116 139)" }}>Refusés / Validés</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white" style={{ color: "rgb(100 116 139)" }}>{refusedLeads.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {refusedLeads.map(lead => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onVisiteEffectuee={handleVisiteEffectuee}
                        onVisiteAnnulee={handleVisiteAnnulee}
                        onMoveToStage={handleMoveToStage}
                        onSelect={(lead) => setSelectedLead(lead)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

        {/* Drawer prospect */}
        {selectedLead && (
          <ProspectDrawer
            lead={selectedLead}
            onClose={() => setSelectedLead(null)}
            onMoveToStage={handleMoveToStage}
            onVisiteEffectuee={handleVisiteEffectuee}
            onVisiteAnnulee={handleVisiteAnnulee}
          />
        )}
    </AppShell>
  );
}
