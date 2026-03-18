/**
 * Dérive une ligne Pipeline normalisée depuis un row email (DB).
 * Utilisé côté serveur (API list) et côté client si besoin.
 * Pas de valeurs hardcodées : intent depuis lead_json.intent, fallback logique.
 *
 * Ordre de priorité statut :
 *   1. prospect_data.etape_process (EtapeProcess officiel)
 *   2. lead_status legacy (converti via LEGACY_STATUS_TO_ETAPE)
 */
import { LEAD_STATUS_TO_LABEL, ETAPE_PROCESS_META, LEGACY_STATUS_TO_ETAPE, type EtapeProcess } from "./constants";

export type PipelineRow = {
  id: string;
  candidate_name: string;
  lead_score: number;
  lead_status: string;
  status_label: string;
  intent: "LOCATION" | "INFORMATION";
  last_action_label: string;
  last_action_at: string | null;
  /** Loyer connu (bien) pour badge "Loyer: xxx€" */
  property_rent: number | null;
};

type EmailLike = {
  id: string;
  sender?: string | null;
  subject?: string | null;
  lead_status?: string | null;
  lead_score?: number | null;
  lead_last_action?: string | null;
  lead_last_action_at?: string | null;
  prospect_data?: {
    etape_process?: string | null;
    nom_prenom?: string | null;
    nom?: string | null;
  } | null;
  lead_json?: {
    intent?: string | null;
    last_action?: { type?: string; at?: string; label?: string };
    last_outbound?: { type?: string; at?: string };
    last_inbound?: { at?: string };
    slots_proposed?: unknown[];
    proposal_slots_sent?: boolean;
    rent?: number;
    matched_property?: { rent?: number };
  } | null;
  lead_profile?: { prospect_name?: string } | null;
  candidate_name?: string | null;
};

function candidateName(email: EmailLike): string {
  const name =
    (email.lead_profile as { prospect_name?: string } | null)?.prospect_name?.trim() ||
    (email as any).candidate_name ||
    "";
  if (name) return name;
  const sender = (email.sender || "").trim();
  const match = sender.match(/^([^<]+)</);
  if (match) return match[1].trim();
  if (sender.includes("@")) return sender.split("@")[0] || "Candidat";
  return sender || "Candidat";
}

function deriveIntent(email: EmailLike): "LOCATION" | "INFORMATION" {
  const intent = (email.lead_json as { intent?: string } | null)?.intent;
  if (intent === "INFORMATION" || intent === "LOCATION") return intent;
  const status = email.lead_status ?? "raw";
  const hasSlots =
    Array.isArray((email.lead_json as { slots_proposed?: unknown[] } | null)?.slots_proposed) &&
    (email.lead_json as { slots_proposed: unknown[] }).slots_proposed.length > 0;
  if (status === "slots_proposed" || status === "booked" || hasSlots) return "LOCATION";
  return "LOCATION";
}

/**
 * Résout le statut effectif d'un email :
 * 1. prospect_data.etape_process (EtapeProcess officiel) → priorité absolue
 * 2. lead_status legacy → converti via LEGACY_STATUS_TO_ETAPE
 */
function resolveEtapeProcess(email: EmailLike): EtapeProcess {
  const etape = email.prospect_data?.etape_process;
  if (etape && etape in ETAPE_PROCESS_META) {
    return etape as EtapeProcess;
  }
  const legacy = email.lead_status ?? "raw";
  return LEGACY_STATUS_TO_ETAPE[legacy] ?? "NEW";
}

function statusLabel(email: EmailLike): string {
  const etape = resolveEtapeProcess(email);
  return ETAPE_PROCESS_META[etape]?.label ?? LEAD_STATUS_TO_LABEL[email.lead_status ?? "raw"] ?? "New";
}

const LAST_ACTION_LABELS: Record<string, string> = {
  draft_created: "Brouillon créé",
  reply_sent: "Réponse envoyée",
  proposal_sent: "Proposition envoyée",
  slots_generated: "Créneaux générés",
  booked: "Visite confirmée",
  asked_missing_info: "Demande d'infos manquantes",
  asked_docs: "Demande de documents",
  info_answered: "Réponse FAQ envoyée",
  draft_info_reply: "Brouillon réponse FAQ",
  info_reply: "Réponse FAQ envoyée",
  info_missing_faq: "Demande de précision (FAQ manquante)",
  autopilot_blocked: "Autopilot bloqué",
};

function lastActionLabel(email: EmailLike): string {
  const lj = email.lead_json as { last_action?: { type?: string; label?: string }; last_outbound?: { type?: string } } | null;
  if (lj?.last_action?.label && String(lj.last_action.label).trim()) return String(lj.last_action.label).trim();
  if (lj?.last_action?.type && LAST_ACTION_LABELS[lj.last_action.type]) return LAST_ACTION_LABELS[lj.last_action.type];
  const last = email.lead_last_action?.trim();
  if (last) return last;
  const out = lj?.last_outbound;
  if (out?.type === "proposal_slots" || out?.type === "proposal_slots_sent") return "Proposition envoyée";
  if (out?.type === "reply_sent" || out?.type === "ai_reply") return "Réponse envoyée";
  if (out?.type === "info_reply" || out?.type === "draft_info_reply") return out.type === "info_reply" ? "Réponse FAQ envoyée" : "Brouillon réponse FAQ";
  if (out?.type) return LAST_ACTION_LABELS[out.type] ?? `Action: ${out.type}`;
  return "—";
}

function lastActionAt(email: EmailLike): string | null {
  const lj = email.lead_json as { last_action?: { at?: string }; last_outbound?: { at?: string } } | null;
  if (lj?.last_action?.at) return lj.last_action.at;
  return email.lead_last_action_at ?? lj?.last_outbound?.at ?? null;
}

function propertyRent(email: EmailLike): number | null {
  const lj = email.lead_json as { rent?: number; matched_property?: { rent?: number } } | null;
  if (typeof lj?.rent === "number" && lj.rent > 0) return lj.rent;
  if (typeof lj?.matched_property?.rent === "number" && lj.matched_property.rent > 0) return lj.matched_property.rent;
  return null;
}

export function derivePipelineRow(email: EmailLike): PipelineRow {
  const intent = deriveIntent(email);
  const etape = resolveEtapeProcess(email);
  const uiStatus = ETAPE_PROCESS_META[etape]?.uiStatus ?? (email.lead_status ?? "raw");
  return {
    id: email.id,
    candidate_name: candidateName(email),
    lead_score: typeof email.lead_score === "number" ? Math.min(10, Math.max(0, email.lead_score)) : 0,
    lead_status: uiStatus, // expose ui_status key for backward compat filters
    status_label: statusLabel(email),
    intent,
    last_action_label: lastActionLabel(email),
    last_action_at: lastActionAt(email),
    property_rent: propertyRent(email),
  };
}
