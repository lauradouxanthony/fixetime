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
  ai_reply?: string | null;
  thread_count?: number;
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

const VISIBLE_STAGES: EtapeProcess[] = [
  "NEW", "QUALIFICATION", "VISITE_PROPOSEE", "VISITE_CONFIRMEE", "DOSSIER_DEMANDE", "DOSSIER_RECU",
];

// ── Feux tricolores ──────────────────────────────────────────────────────────
const MECONTENTEMENT_KEYWORDS = [
  "n'importe quoi", "scandale", "honte", "inadmissible",
  "parler à quelqu'un", "parler a quelqu'un", "responsable", "inacceptable",
  "avocat", "plainte",
];

type TrafficLight = "AUTOPILOTE" | "DRAFT" | "ALERTE";

function getTrafficLight(lead: Lead, multiplicateur = 3): TrafficLight {
  const pd = lead.prospect_data;
  const etape = getEtapeFromLead(lead);
  const hours = hoursAgo(lead.received_at);
  const body = (lead.body ?? "").toLowerCase();

  // 🔴 ALERTE — intervention humaine requise
  if (hours !== null && hours > 48) return "ALERTE";
  if (MECONTENTEMENT_KEYWORDS.some((kw) => body.includes(kw))) return "ALERTE";
  if (pd?.revenus_mensuels && pd?.loyer_max && pd.revenus_mensuels / pd.loyer_max < 2) return "ALERTE";

  // 🟡 DRAFT — agent doit valider
  const atts = (lead.attachments ?? []) as any[];
  const hasUnvalidatedDocs = atts.some((att) => {
    const dt = att.docTypes as Record<string, boolean> | undefined;
    return dt && Object.values(dt).some(Boolean) && !att.validated_by_human;
  });
  if (hasUnvalidatedDocs) return "DRAFT";
  if (etape === "DOSSIER_RECU") return "DRAFT";

  const situation = pd?.situation_pro;
  if (situation === "AUTO_ENTREPRENEUR") return "DRAFT";
  const revenus = pd?.revenus_mensuels;
  const loyer = pd?.loyer_max;
  if (revenus && loyer) {
    const ratio = revenus / loyer;
    if (ratio >= 2 && ratio < multiplicateur) return "DRAFT"; // profil limite
  }

  // 🟢 AUTOPILOTE — IA gère seule
  return "AUTOPILOTE";
}

const TRAFFIC_LIGHT_CONFIG: Record<TrafficLight, { color: string; bg: string; label: string; dot: string }> = {
  AUTOPILOTE: { color: "rgb(22 163 74)",  bg: "rgba(22,163,74,0.1)",  label: "Autopilote", dot: "#16a34a" },
  DRAFT:      { color: "rgb(234 88 12)",  bg: "rgba(234,88,12,0.1)",  label: "À valider",  dot: "#ea580c" },
  ALERTE:     { color: "rgb(220 38 38)",  bg: "rgba(220,38,38,0.1)",  label: "Alerte",     dot: "#dc2626" },
};

function TrafficDot({ lead }: { lead: Lead }) {
  const tl = getTrafficLight(lead);
  const cfg = TRAFFIC_LIGHT_CONFIG[tl];
  return (
    <span
      title={cfg.label}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: cfg.dot,
        flexShrink: 0,
      }}
    />
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function daysAgoLabel(dateStr: string | null): string | null {
  const h = hoursAgo(dateStr);
  if (h === null) return null;
  if (h < 1) return "À l'instant";
  if (h < 24) return `Il y a ${h}h`;
  return `Il y a ${Math.floor(h / 24)}j`;
}

// ── Score de priorité prospect ───────────────────────────────────────────────
type ProspectPriority = "CHAUD" | "TIEDE" | "FROID";

function computeProspectPriority(lead: Lead): ProspectPriority {
  const pd = lead.prospect_data;
  const etape = getEtapeFromLead(lead);

  const revenus = pd?.revenus_mensuels ?? null;
  const loyer = pd?.loyer_max ?? null;
  const isSolvable = revenus && loyer ? revenus / loyer >= 3 : false;

  // Dossier complet : etape DOSSIER_RECU ou 4+ docs uploadés
  const atts = (lead.attachments ?? []) as Array<{ docTypes?: Record<string, boolean> }>;
  const docsFound = new Set<string>();
  atts.forEach((att) => {
    const dt = att.docTypes;
    if (dt) { for (const [k, v] of Object.entries(dt)) { if (v) docsFound.add(k); } }
  });
  const dossierComplet = etape === "DOSSIER_RECU" || docsFound.size >= 4;
  const visitePrevue = etape === "VISITE_CONFIRMEE";

  // 🔴 Chaud : solvable + (visite confirmée OU dossier complet)
  if (isSolvable && (visitePrevue || dossierComplet)) return "CHAUD";

  // 🟡 Tiède : qualifié + solvable
  const isQualifie = !!(pd?.situation_pro || pd?.revenus_mensuels);
  if (isQualifie && isSolvable) return "TIEDE";

  // 🟢 Froid par défaut
  return "FROID";
}

const PRIORITY_CONFIG: Record<ProspectPriority, { emoji: string; label: string; color: string; bg: string }> = {
  CHAUD:  { emoji: "🔴", label: "Chaud",  color: "rgb(220 38 38)",  bg: "rgba(220,38,38,0.08)"  },
  TIEDE:  { emoji: "🟡", label: "Tiède",  color: "rgb(202 138 4)",  bg: "rgba(202,138,4,0.08)"  },
  FROID:  { emoji: "🟢", label: "Froid",  color: "rgb(22 163 74)",  bg: "rgba(22,163,74,0.08)"  },
};

// ── SolvabilityBadge amélioré (vert ≥3x | orange 2-3x | rouge <2x | gris) ──
function SolvabilityBadge({ revenus, loyer, multiplicateur = 3 }: { revenus: number | null; loyer: number | null; multiplicateur?: number }) {
  if (!revenus || !loyer) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(100,116,139,0.1)", color: "rgb(100 116 139)" }}>
        — ratio
      </span>
    );
  }
  const ratio = revenus / loyer;
  let color: string;
  let bg: string;
  if (ratio >= multiplicateur) {
    color = "rgb(22 163 74)"; bg = "rgba(22,163,74,0.1)";
  } else if (ratio >= 2) {
    color = "rgb(234 88 12)"; bg = "rgba(234,88,12,0.1)";
  } else {
    color = "rgb(220 38 38)"; bg = "rgba(220,38,38,0.1)";
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color }}>
      {ratio.toFixed(1)}x {ratio >= multiplicateur ? "✓" : "✗"}
    </span>
  );
}

// ── Extraction intelligente du nom d'affichage ────────────────────────────
function extractDisplayName(lead: Lead): string {
  const pd = lead.prospect_data;
  const sender = lead.sender ?? "";

  // 1. Données IA : prenom + nom séparés (si l'IA les a distingués)
  const prenom = (pd as Record<string, unknown> | null)?.prenom as string | null | undefined;
  if (pd?.nom && prenom) return `${prenom} ${pd.nom}`;

  // 2. Données IA : nom seul (ignorer si ça ressemble à un email ou si stocké comme "null")
  if (pd?.nom && String(pd.nom) !== "null" && !pd.nom.includes("@")) return pd.nom;

  // 3. Extraire le nom depuis le format Gmail "Name <email@domain.com>"
  const nameMatch = sender.match(/^(.+?)\s*<[^>]+>$/);
  if (nameMatch) {
    const name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    if (name.length >= 2 && !name.includes("@")) return name;
  }

  // 4. Si l'expéditeur est juste une adresse email → capitaliser la partie locale
  //    si elle contient des séparateurs (. _ -) ; sinon afficher l'email complet
  const emailAddr =
    sender.match(/<([^>]+)>/)?.[1] ??
    (sender.includes("@") ? sender.trim() : null);
  if (emailAddr) {
    const local = emailAddr.split("@")[0];
    const parts = local.split(/[._-]+/).filter(Boolean);
    // Nom sans séparateur → l'email complet est plus lisible que "Lauradouxanthony"
    if (parts.length <= 1) return emailAddr;
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }

  // 5. Fallback
  return sender || "Inconnu";
}

// ── LeadCard enrichie ────────────────────────────────────────────────────────
function LeadCard({
  lead,
  propertyName,
  onVisiteEffectuee,
  onVisiteAnnulee,
  onMoveToStage,
  onSelect,
}: {
  lead: Lead;
  propertyName: string | null;
  onVisiteEffectuee: (id: string) => void;
  onVisiteAnnulee: (id: string) => void;
  onMoveToStage: (id: string, etape: EtapeProcess) => void;
  onSelect: (lead: Lead) => void;
}) {
  const etape = getEtapeFromLead(lead);
  const config = ETAPE_CONFIG[etape];
  const pd = lead.prospect_data;
  const nom = extractDisplayName(lead);
  const priority = computeProspectPriority(lead);
  const priorityCfg = PRIORITY_CONFIG[priority];
  const hours = hoursAgo(lead.received_at);
  const tooOld = hours !== null && hours > 48;
  const noAiReply = tooOld && !lead.ai_reply;
  const spMap: Record<string, { label: string; color: string; bg: string }> = {
    CDI:              { label: "CDI",           color: "rgb(22 163 74)",  bg: "rgba(22,163,74,0.1)"  },
    CDD:              { label: "CDD",           color: "rgb(234 88 12)", bg: "rgba(234,88,12,0.1)" },
    AUTO_ENTREPRENEUR:{ label: "Indépendant",   color: "rgb(147 51 234)",bg: "rgba(147,51,234,0.1)" },
    ETUDIANT:         { label: "Étudiant",      color: "rgb(2 132 199)", bg: "rgba(2,132,199,0.1)"  },
    RETRAITE:         { label: "Retraité",      color: "rgb(100 116 139)",bg:"rgba(100,116,139,0.1)" },
  };
  const sitStyle = pd?.situation_pro ? (spMap[pd.situation_pro] ?? null) : null;

  return (
    <div
      className="rounded-xl border p-3 space-y-2 bg-white transition-shadow hover:shadow-md cursor-pointer"
      style={{ borderColor: tooOld ? "rgba(220,38,38,0.35)" : "rgb(226 232 240)" }}
      onClick={() => onSelect(lead)}
    >
      {/* Ligne 1 : point tricolore + nom + badge étape */}
      <div className="flex items-center gap-2">
        <TrafficDot lead={lead} />
        <div className="font-medium text-sm flex-1 min-w-0 leading-tight break-words" style={{ color: "rgb(30 41 59)" }}>
          {nom}
        </div>
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}
        >
          {config.label}
        </span>
      </div>

      {/* Ligne 2 : badge contrat + ratio solvabilité */}
      <div className="flex items-center gap-2 flex-wrap">
        {sitStyle && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: sitStyle.bg, color: sitStyle.color }}>
            {sitStyle.label}
          </span>
        )}
        <SolvabilityBadge revenus={pd?.revenus_mensuels ?? null} loyer={pd?.loyer_max ?? null} />
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: priorityCfg.bg, color: priorityCfg.color }}
          title={`Priorité : ${priorityCfg.label}`}
        >
          {priorityCfg.emoji} {priorityCfg.label}
        </span>
      </div>

      {/* Ligne 3 : bien visé */}
      {propertyName && (
        <div className="text-xs truncate" style={{ color: "rgb(79 70 229)" }}>
          🏠 {propertyName}
        </div>
      )}

      {/* Ligne 4 : date + thread count + alerte réponse IA */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs" style={{ color: tooOld ? "rgb(220 38 38)" : "rgb(148 163 184)" }}>
          {daysAgoLabel(lead.received_at) ?? "—"}
        </span>
        <div className="flex items-center gap-2">
          {(lead.thread_count ?? 1) > 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
              {lead.thread_count} emails
            </span>
          )}
          {noAiReply && (
            <span className="text-xs font-semibold" style={{ color: "rgb(220 38 38)" }}>
              🔴
            </span>
          )}
        </div>
      </div>

      {/* Résumé */}
      {lead.summary && (
        <div className="text-xs line-clamp-2" style={{ color: "rgb(148 163 184)" }}>
          {lead.summary}
        </div>
      )}

      {/* Barre progression dossier (DOSSIER_DEMANDE / DOSSIER_RECU) */}
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
              <span className="text-xs font-medium" style={{ color: barColor }}>{count}/{totalDocs} docs</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
            </div>
          </div>
        );
      })()}

      {/* Boutons visite effectuée / annulée */}
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
function ProspectDrawer({ lead, onClose, onMoveToStage, onVisiteEffectuee, onVisiteAnnulee, propertyRent, champsQualification }: {
  lead: Lead;
  onClose: () => void;
  onMoveToStage: (id: string, etape: EtapeProcess) => void;
  onVisiteEffectuee: (id: string) => void;
  onVisiteAnnulee: (id: string) => void;
  propertyRent?: number | null;
  champsQualification?: string[];
}) {
  const pd = lead.prospect_data;
  const etape = getEtapeFromLead(lead);
  const config = ETAPE_CONFIG[etape];
  const nom = extractDisplayName(lead);
  const revenus = pd?.revenus_mensuels ?? null;
  const loyer = propertyRent ?? null;  // loyer du bien (property.rent), pas du prospect
  const ratio = revenus && loyer ? (revenus / loyer) : null;
  const solvable = ratio ? ratio >= 3 : null;
  const tl = getTrafficLight(lead);
  const tlCfg = TRAFFIC_LIGHT_CONFIG[tl];

  // Compteur de qualification
  const activeChamps = champsQualification ?? DEFAULT_CHAMPS_QUALIFICATION;
  const pdAny = pd as Record<string, unknown> | null;
  const champsRemplis = activeChamps.filter(k => {
    const v = pdAny?.[k];
    return v !== null && v !== undefined && String(v).trim() !== "" && String(v) !== "null";
  });
  const qualifScore = champsRemplis.length;
  const qualifTotal = activeChamps.length;

  const [timeline, setTimeline] = useState<Array<{ id: string; action_type: string; description: string | null; created_at: string }>>([]);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [summaryNote, setSummaryNote] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null);
  const [sendingPortal, setSendingPortal] = useState(false);
  const { toast } = useToast();

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

  const sendPortalLink = async () => {
    if (sendingPortal) return;
    setSendingPortal(true);
    try {
      const res = await fetch("/api/portal/create-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: lead.id, sendEmail: true }),
      });
      const data = await res.json();
      if (res.ok || res.status === 207) {
        const sentAt = data.lastSentAt ?? new Date().toISOString();
        setPortalStatus({ hasToken: true, lastSentAt: sentAt, portalUrl: data.portalUrl ?? null });
        if (res.status === 207) {
          toast("Lien créé mais envoi Gmail échoué — copiez le lien manuellement", "error");
        } else {
          const prospectEmail = data.prospectEmail ?? "le prospect";
          toast(`Lien envoyé à ${prospectEmail} ✅`, "success");
        }
      } else {
        toast("Erreur lors de la création du lien", "error");
      }
    } catch {
      toast("Erreur réseau", "error");
    } finally {
      setSendingPortal(false);
    }
  };

  const generateSummary = async () => {
    if (generatingSummary) return;
    setGeneratingSummary(true);
    setSummaryNote(null);
    try {
      const res = await fetch(`/api/prospects/${lead.id}/generate-summary`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSummaryNote(data.summary ?? null);
        toast("Note de synthèse générée ✅", "success");
      } else {
        toast("Erreur lors de la génération", "error");
      }
    } catch {
      toast("Erreur réseau", "error");
    } finally {
      setGeneratingSummary(false);
    }
  };

  const exportZip = async () => {
    if (exportingZip) return;
    setExportingZip(true);
    try {
      const res = await fetch(`/api/prospects/${lead.id}/export-zip`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const cd = res.headers.get("Content-Disposition") ?? "";
        const fnMatch = cd.match(/filename="([^"]+)"/);
        a.download = fnMatch?.[1] ?? `Dossier_${lead.id}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Dossier ZIP téléchargé 📦", "success");
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error === "NO_ATTACHMENTS" ? "Aucune pièce jointe à exporter" : "Erreur lors de l'export", "error");
      }
    } catch {
      toast("Erreur réseau", "error");
    } finally {
      setExportingZip(false);
    }
  };

  const spBadge: Record<string, { label: string; color: string; bg: string }> = {
    CDI:               { label: "CDI",         color: "rgb(22 163 74)",  bg: "rgba(22,163,74,0.1)"  },
    CDD:               { label: "CDD",         color: "rgb(234 88 12)", bg: "rgba(234,88,12,0.1)" },
    AUTO_ENTREPRENEUR: { label: "Indépendant", color: "rgb(147 51 234)",bg: "rgba(147,51,234,0.1)" },
    ETUDIANT:          { label: "Étudiant",    color: "rgb(2 132 199)", bg: "rgba(2,132,199,0.1)"  },
    RETRAITE:          { label: "Retraité",    color: "rgb(100 116 139)",bg:"rgba(100,116,139,0.1)" },
  };

  const DOC_PROFILES: Record<string, { key: string; label: string }[]> = {
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

  const spKey = pd?.situation_pro as string | undefined;
  const docs = spKey ? (DOC_PROFILES[spKey] ?? DOC_PROFILES.CDI) : DOC_PROFILES.CDI;
  const attachments: any[] = (lead as any).attachments ?? [];
  const receivedKeys = new Set<string>();
  attachments.forEach((att: any) => {
    const docTypes = att.docTypes as Record<string, boolean> | undefined;
    if (docTypes) Object.entries(docTypes).forEach(([k, v]) => { if (v) receivedKeys.add(k); });
  });
  const validatedKeys = new Set<string>();
  attachments.forEach((att: any) => {
    if (att.validated_by_human) {
      const docTypes = att.docTypes as Record<string, boolean> | undefined;
      if (docTypes) Object.entries(docTypes).forEach(([k, v]) => { if (v) validatedKeys.add(k); });
    }
  });
  const validatedCount = docs.filter(d => validatedKeys.has(d.key)).length;
  const receivedCount = docs.filter(d => receivedKeys.has(d.key)).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(15,23,42,0.4)" }} onClick={onClose}>
      <div
        className="h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: tlCfg.dot, flexShrink: 0 }} />
              <div className="font-semibold text-base truncate" style={{ color: "rgb(30 41 59)" }}>{nom}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}>
                {config.label}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: tlCfg.bg, color: tlCfg.color }}>
                {tl === "AUTOPILOTE" ? "🟢" : tl === "DRAFT" ? "🟡" : "🔴"} {tlCfg.label}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                background: qualifScore >= qualifTotal ? "rgba(22,163,74,0.1)" : qualifScore >= 2 ? "rgba(234,88,12,0.1)" : "rgba(226,232,240,0.6)",
                color: qualifScore >= qualifTotal ? "rgb(22 163 74)" : qualifScore >= 2 ? "rgb(234 88 12)" : "rgb(100 116 139)",
              }}>
                {qualifScore}/{qualifTotal} infos
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-4">✕</button>
        </div>

        <div className="p-6 space-y-6 flex-1">

          {/* BLOC IDENTITÉ */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>👤 Identité</h3>
            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "rgb(226 232 240)" }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Nom</div>
                  <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                    {pd?.nom && !pd.nom.includes("@") ? pd.nom : extractDisplayName(lead)}
                  </div>
                </div>
                <div>
                  <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Email</div>
                  {lead.sender ? (() => {
                    const emailAddr = lead.sender.replace(/.*<(.+)>.*/, "$1").trim();
                    return (
                      <a href={`mailto:${emailAddr}`}
                        className="text-sm truncate block hover:underline"
                        style={{ color: "rgb(79 70 229)" }}>
                        {emailAddr}
                      </a>
                    );
                  })() : <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>—</div>}
                </div>
                <div>
                  <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Téléphone</div>
                  {pd?.telephone ? (
                    <a href={`tel:${pd.telephone}`} className="text-sm font-medium hover:underline" style={{ color: "rgb(30 41 59)" }}>
                      📞 {pd.telephone}
                    </a>
                  ) : <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>—</div>}
                </div>
                <div>
                  <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Situation pro</div>
                  {pd?.situation_pro ? (() => {
                    const s = spBadge[pd.situation_pro] ?? { label: pd.situation_pro, color: "rgb(100 116 139)", bg: "rgba(100,116,139,0.1)" };
                    return (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: s.bg, color: s.color }}>
                        {s.label}
                      </span>
                    );
                  })() : <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>Inconnu</div>}
                </div>
              </div>
            </div>
          </div>

          {/* BLOC QUALIFICATION */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>📊 Qualification</h3>
            <div className="rounded-xl border p-4" style={{ borderColor: "rgb(226 232 240)" }}>
              <div className="grid grid-cols-2 gap-3">
                {activeChamps.includes("revenus_mensuels") && (
                  <div>
                    <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Revenus</div>
                    <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                      {revenus ? `${revenus.toLocaleString("fr-FR")} €/mois` : "—"}
                    </div>
                  </div>
                )}
                {activeChamps.includes("garant") && (
                  <div>
                    <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Garant</div>
                    <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                      {pdAny?.garant === "OUI" ? "✅ Oui" : pdAny?.garant === "NON" ? "❌ Non" : pdAny?.garant === "A_CONFIRMER" ? "⚠ À confirmer" : "—"}
                    </div>
                  </div>
                )}
                {activeChamps.includes("animaux") && (
                  <div>
                    <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Animaux</div>
                    <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                      {String(pdAny?.animaux ?? "").toLowerCase() === "oui" ? "✅ Oui"
                        : String(pdAny?.animaux ?? "").toLowerCase() === "non" ? "❌ Non"
                        : pdAny?.animaux ? String(pdAny.animaux) : "—"}
                    </div>
                  </div>
                )}
                {activeChamps.includes("nb_personnes") && (
                  <div>
                    <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Personnes dans le foyer</div>
                    <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                      {pdAny?.nb_personnes ? String(pdAny.nb_personnes) : "—"}
                    </div>
                  </div>
                )}
                {activeChamps.includes("date_entree_souhaitee") && (
                  <div className="col-span-2">
                    <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Entrée souhaitée</div>
                    <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                      {pdAny?.date_entree_souhaitee ? String(pdAny.date_entree_souhaitee) : "—"}
                    </div>
                  </div>
                )}
                {propertyRent && (
                  <div>
                    <div className="text-xs mb-0.5" style={{ color: "rgb(148 163 184)" }}>Loyer du bien</div>
                    <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                      {propertyRent.toLocaleString("fr-FR")} €/mois
                    </div>
                  </div>
                )}
              </div>
            </div>
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

            return (<>
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
                </div>
              </div>

            </>);
          })()}

          {/* SOLVABILITÉ — indépendant de situation_pro */}
          {(ratio !== null || revenus || loyer) && (
            <div className="space-y-2">
              {ratio !== null ? (
                <>
                  {/* Détail chiffres */}
                  <div className="flex flex-wrap gap-x-4 text-xs" style={{ color: "rgb(100 116 139)" }}>
                    {revenus && <span>Revenus : <strong style={{ color: "rgb(30 41 59)" }}>{revenus.toLocaleString("fr-FR")} €/mois</strong></span>}
                    {loyer && <span>Loyer : <strong style={{ color: "rgb(30 41 59)" }}>{loyer.toLocaleString("fr-FR")} €/mois</strong></span>}
                  </div>
                  {/* Barre de progression colorée */}
                  <div>
                    <div className="flex justify-between text-xs mb-1" style={{ color: "rgb(100 116 139)" }}>
                      <span>Ratio revenus / loyer</span>
                      <span className="font-semibold" style={{
                        color: ratio >= 3 ? "rgb(22 163 74)" : ratio >= 2 ? "rgb(234 88 12)" : "rgb(220 38 38)"
                      }}>
                        {ratio.toFixed(1)}x
                      </span>
                    </div>
                    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{
                        width: `${Math.min((ratio / 5) * 100, 100)}%`,
                        background: ratio >= 3 ? "rgb(22,163,74)" : ratio >= 2 ? "rgb(234,88,12)" : "rgb(220,38,38)",
                      }} />
                      <div className="absolute top-0 h-full w-0.5" style={{ left: "60%", background: "rgb(79 70 229)", opacity: 0.5 }} />
                    </div>
                    <div className="flex justify-between text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                      <span>0x</span><span style={{ color: "rgb(79 70 229)" }}>Seuil 3x</span><span>5x+</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 font-medium" style={{
                    background: solvable ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)",
                    color: solvable ? "rgb(22 163 74)" : "rgb(220 38 38)",
                    fontSize: 13,
                  }}>
                    {solvable ? "✓ Solvable (≥ 3x)" : "✗ Insuffisant (< 3x)"}
                  </div>
                </>
              ) : (
                <div className="text-xs py-2" style={{ color: "rgb(148 163 184)" }}>Revenus ou loyer non renseigné</div>
              )}
            </div>
          )}

          {/* BLOC DOSSIER LOCATAIRE */}
          {pd?.situation_pro && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
                📋 Dossier locataire
              </h3>
              <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "rgb(226 232 240)" }}>
                {/* Barre de progression */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1" style={{ color: "rgb(100 116 139)" }}>
                    <span>{validatedCount}/{docs.length} documents validés</span>
                    <span>{Math.round((validatedCount / Math.max(docs.length, 1)) * 100)}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{
                      width: `${Math.round((validatedCount / Math.max(docs.length, 1)) * 100)}%`,
                      background: validatedCount >= docs.length ? "rgb(22,163,74)" : validatedCount > 0 ? "rgb(234,88,12)" : "rgb(220,38,38)",
                    }} />
                  </div>
                </div>

                {/* Checklist */}
                <div className="space-y-1.5">
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

                {/* Bouton portail de dépôt */}
                <div className="pt-2">
                  {portalStatus?.lastSentAt ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs" style={{ color: "rgb(22 163 74)" }}>
                        ✓ Lien envoyé le {new Date(portalStatus.lastSentAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </span>
                      {portalStatus.portalUrl && (
                        <button
                          onClick={() => { navigator.clipboard.writeText(portalStatus.portalUrl!); toast("Lien copié !", "success"); }}
                          className="text-xs px-2 py-0.5 rounded-md"
                          style={{ background: "rgba(22,163,74,0.08)", color: "rgb(22 163 74)" }}
                        >
                          📋 Copier
                        </button>
                      )}
                      <button
                        onClick={sendPortalLink}
                        disabled={sendingPortal}
                        className="text-xs px-2 py-0.5 rounded-md disabled:opacity-50"
                        style={{ background: "rgba(100,116,139,0.08)", color: "rgb(100 116 139)" }}
                      >
                        {sendingPortal ? "Envoi…" : "↩ Renvoyer"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={sendPortalLink}
                      disabled={sendingPortal}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                      style={{ background: "rgba(99,102,241,0.1)", color: "rgb(99 102 241)" }}
                    >
                      {sendingPortal ? "📎 Envoi…" : "📎 Envoyer le lien de dépôt"}
                    </button>
                  )}
                </div>

                {/* Boutons IA synthèse + ZIP export */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {validatedCount >= 2 && (
                    <button
                      onClick={generateSummary}
                      disabled={generatingSummary}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                      style={{ background: "rgba(79,70,229,0.1)", color: "rgb(79 70 229)" }}
                    >
                      {generatingSummary ? "🤖 Génération…" : "🤖 Générer note de synthèse"}
                    </button>
                  )}
                  {attachments.length > 0 && (
                    <button
                      onClick={exportZip}
                      disabled={exportingZip}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                      style={{ background: "rgba(100,116,139,0.1)", color: "rgb(100 116 139)" }}
                    >
                      {exportingZip ? "📦 Export…" : "📦 Exporter dossier complet"}
                    </button>
                  )}
                </div>

                {/* Note de synthèse IA */}
                {summaryNote && (
                  <div className="mt-3 rounded-xl border p-4 text-xs whitespace-pre-wrap"
                    style={{ borderColor: "rgba(79,70,229,0.2)", background: "rgba(79,70,229,0.04)", color: "rgb(30 41 59)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold" style={{ color: "rgb(79 70 229)" }}>🤖 Note de synthèse IA</span>
                      <button onClick={() => setSummaryNote(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                    </div>
                    {summaryNote}
                  </div>
                )}
              </div>
            </div>
          )}

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

const DEFAULT_CHAMPS_QUALIFICATION = ["situation_pro", "revenus_mensuels", "garant", "animaux"];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRefused, setShowRefused] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [properties, setProperties] = useState<PropertyInfo[]>([]);
  const [filterEtape, setFilterEtape] = useState<EtapeProcess | "">("");
  const [filterProperty, setFilterProperty] = useState<string>("");
  const [filterSolvable, setFilterSolvable] = useState<"" | "oui" | "non">("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [champsQualification, setChampsQualification] = useState<string[]>(DEFAULT_CHAMPS_QUALIFICATION);
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

  // Sujets parasites — email marketing/notification à exclure même s'ils passent l'IA
  const PARASITE_SUBJECT_KW = [
    "événement", "webinaire", "badge", "mise à jour", "notification",
    "alerte", "nouvelles de", "prix cassés", "offre", "promotion",
    "top 14", "bmc", "pépite", "cohésion", "abonnement",
    "aliexpress", "h&m", "pass culture", "youversion",
    "newsletter", "désabonner", "unsubscribe", "invitation",
    "vous avez été", "confirmez votre", "reçu de paiement",
    "commande", "facture", "récapitulatif", "livraison",
    // Assurances & services financiers
    "garantie", "assurance", "bris de glaces", "mutuelle",
    "prévoyance", "spécialement pour vous", "devis",
  ];

  function hasImmoSubject(lead: Lead): boolean {
    const s = (lead.subject ?? "").toLowerCase();
    return IMMO_KEYWORDS.some((kw) => s.includes(kw));
  }

  function isParasiteSubject(lead: Lead): boolean {
    const s = (lead.subject ?? "").toLowerCase();
    return PARASITE_SUBJECT_KW.some((kw) => s.includes(kw));
  }

  /** Un prospect est valide si au moins une condition de qualification est remplie */
  function isValidProspect(lead: Lead): boolean {
    const pd = lead.prospect_data;
    const etape = (pd as Record<string, unknown> | null)?.etape_process as string | null | undefined;
    const hasRealName = !!(pd?.nom && String(pd.nom) !== "null" && String(pd.nom).trim().length > 0);
    const hasSituationPro = !!(pd?.situation_pro);
    const hasFinancialData = hasSituationPro || !!(pd?.revenus_mensuels);

    // RÈGLE ABSOLUE — nom + situation_pro → toujours valide
    // Court-circuite TOUS les autres filtres (sender, domaine, sujet, étape)
    if (hasRealName && hasSituationPro) return true;

    // En phase dossier sans règle absolue → exiger des données financières
    // (évite que des contacts internes sans dossier apparaissent en "Dossier reçu")
    if (etape === "DOSSIER_RECU" || etape === "DOSSIER_DEMANDE") {
      return hasFinancialData;
    }

    // Nom seul (sans situation_pro) → valide avant filtre parasite
    if (hasRealName) return true;

    // Sans nom IA → filtres de sécurité classiques
    if (isParasiteSubject(lead)) return false;
    if (hasFinancialData) return true;
    if (hasImmoSubject(lead)) return true;
    return false;
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
      const filtered = (data as unknown as Lead[]).filter(isValidProspect);
      const deduped = deduplicateLeads(filtered);
      setLeads(deduped);
    }

    // Charger les biens pour les filtres
    try {
      // pipeline/list pour filtres + déduplication — appliquer le même filtre parasite
      const res = await fetch("/api/pipeline/list");
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      if (res.ok) {
        const json = await res.json();
        const pipelineLeads = (json.leads ?? []) as Lead[];
        const cleanPipeline = pipelineLeads.filter(isValidProspect);
        const dedupedPipeline = deduplicateLeads(cleanPipeline);
        setLeads(dedupedPipeline);
      }

      // Charger les biens pour les filtres
      const propsRes = await fetch("/api/properties");
      if (propsRes.ok) {
        const propsData = await propsRes.json();
        setProperties((propsData.properties ?? []).map((p: any) => ({ id: p.id, title: p.title, rent: p.rent })));
      }

      // Charger les champs de qualification configurés
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      if (settingsRes.ok) {
        const sd = await settingsRes.json();
        const champs = sd?.email_rules?.ft_locatif?.champsQualification;
        if (Array.isArray(champs) && champs.length > 0) setChampsQualification(champs);
      }
    } catch { /* graceful */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const getPropertyName = (propertyId: string | null | undefined): string | null => {
    if (!propertyId) return null;
    return properties.find(p => p.id === propertyId)?.title ?? null;
  };

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
  const alerteCount = leads.filter(l => getTrafficLight(l) === "ALERTE").length;
  const visiteProposeCount = stageLeads("VISITE_PROPOSEE").length + stageLeads("VISITE_CONFIRMEE").length;
  const dossierCount = stageLeads("DOSSIER_DEMANDE").length + stageLeads("DOSSIER_RECU").length;

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
                {activeLeads.length} actifs · 60 jours
                {alerteCount > 0 && <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>🔴 {alerteCount} alerte{alerteCount > 1 ? "s" : ""}</span>}
                {urgentCount > 0 && <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>🔥 {urgentCount} urgent{urgentCount > 1 ? "s" : ""}</span>}
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
                      {["", "Prospect", "Bien", "Revenus / Loyer / Ratio", "Étape", "Activité", "Actions"].map(h => (
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
                      const nom = extractDisplayName(lead);
                      const revenus = pd?.revenus_mensuels ?? null;
                      const loyer = pd?.loyer_max ?? null;
                      const ratio = revenus && loyer ? (revenus / loyer).toFixed(1) : null;
                      const solvable = ratio ? parseFloat(ratio) >= 3 : null;
                      const propertyTitle = getPropertyName(lead.property_id);
                      const hours = hoursAgo(lead.received_at);
                      const spLabels: Record<string, string> = { CDI: "CDI", CDD: "CDD", AUTO_ENTREPRENEUR: "Indépendant", ETUDIANT: "Étudiant", RETRAITE: "Retraité" };
                      const tl = getTrafficLight(lead);
                      const tlDot = TRAFFIC_LIGHT_CONFIG[tl].dot;
                      return (
                        <tr
                          key={lead.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => setSelectedLead(lead)}
                          style={{ borderBottom: i < filteredListLeads.length - 1 ? "1px solid rgb(241 245 249)" : undefined }}
                        >
                          {/* Point tricolore */}
                          <td className="px-3 py-3">
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: tlDot }} />
                          </td>
                          {/* Prospect */}
                          <td className="px-4 py-3">
                            <div className="font-medium" style={{ color: "rgb(30 41 59)" }}>{nom}</div>
                            {pd?.situation_pro && (
                              <div className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>{spLabels[pd.situation_pro] ?? pd.situation_pro}</div>
                            )}
                          </td>
                          {/* Bien */}
                          <td className="px-4 py-3">
                            {propertyTitle
                              ? <div className="text-xs font-medium" style={{ color: "rgb(79 70 229)" }}>🏠 {propertyTitle}</div>
                              : <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>—</div>}
                          </td>
                          {/* Revenus / Loyer / Ratio */}
                          <td className="px-4 py-3">
                            {revenus || loyer ? (
                              <div className="space-y-0.5">
                                {revenus && <div className="text-xs" style={{ color: "rgb(71 85 105)" }}>{revenus.toLocaleString("fr-FR")} €/mois</div>}
                                {loyer && <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Loyer : {loyer.toLocaleString("fr-FR")} €</div>}
                                {ratio && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{
                                    background: solvable ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)",
                                    color: solvable ? "rgb(22 163 74)" : "rgb(220 38 38)",
                                  }}>
                                    {ratio}x {solvable ? "✓" : "✗"}
                                  </span>
                                )}
                              </div>
                            ) : <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>—</span>}
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
                            <div className="text-xs" style={{ color: hours && hours > 48 ? "rgb(220 38 38)" : "rgb(100 116 139)" }}>
                              {daysAgoLabel(lead.received_at) ?? "—"}
                            </div>
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex gap-1.5">
                              <a
                                href={`/emails?id=${lead.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
                                style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}
                              >
                                Voir
                              </a>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleMoveToStage(lead.id, "REFUSE"); }}
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
                            propertyName={getPropertyName(lead.property_id)}
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
                        propertyName={getPropertyName(lead.property_id)}
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
          propertyRent={properties.find(p => p.id === (selectedLead as any).property_id)?.rent ?? null}
          champsQualification={champsQualification}
        />
      )}
    </AppShell>
  );
}
