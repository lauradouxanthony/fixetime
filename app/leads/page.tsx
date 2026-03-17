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
            const attachments: any[] = (lead as any).attachments ?? [];
            const receivedKeys = new Set<string>();
            attachments.forEach((att: any) => {
              const docTypes = att.docTypes as Record<string, boolean> | undefined;
              if (docTypes) {
                Object.entries(docTypes).forEach(([k, v]) => { if (v) receivedKeys.add(k); });
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
                <div className="space-y-1">
                  {docs.map(doc => {
                    const received = receivedKeys.has(doc.key);
                    return (
                      <div key={doc.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                        style={{ background: received ? "rgba(22,163,74,0.06)" : "rgba(226,232,240,0.4)" }}>
                        <span className="text-sm flex-shrink-0">{received ? "✅" : "❌"}</span>
                        <span className="text-xs flex-1" style={{ color: received ? "rgb(22 163 74)" : "rgb(100 116 139)" }}>
                          {doc.label}
                        </span>
                        <span className="text-xs flex-shrink-0" style={{ color: received ? "rgb(22 163 74)" : "rgb(148 163 184)" }}>
                          {received ? "Reçu" : "Manquant"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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

  const fetchLeads = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/auth/login"; return; }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    // Tenter de récupérer property_id (graceful si colonne manquante)
    let selectFields = "id, sender, subject, summary, body, received_at, category, is_urgent, is_important, classification_reason, prospect_data";
    const { data } = await supabase
      .from("emails")
      .select(selectFields)
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false })
      .limit(200);

    if (data) setLeads(data as unknown as Lead[]);

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
