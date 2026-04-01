export type EmailDecision = "traiter" | "planifier" | "ignorer" | null;
export type EmailAction = "reply" | "schedule" | "archive" | null;

// Intention immobilière — stockée dans la colonne `category`
export type EmailIntention = "LOCATION" | "INFO" | "HORS_SUJET" | null;

/** Étapes du process immobilier (ordre de progression) */
export type EtapeProcess =
  | "NEW"
  | "QUALIFICATION"
  | "VISITE_PROPOSEE"
  | "VISITE_CONFIRMEE"
  | "DOSSIER_DEMANDE"
  | "DOSSIER_RECU"
  | "VALIDE"
  | "REFUSE";

export type ProspectData = {
  nom?: string | null;
  telephone?: string | null;
  situation_pro?: "CDI" | "CDD" | "AUTO_ENTREPRENEUR" | "ETUDIANT" | "RETRAITE" | null;
  revenus_mensuels?: number | null;
  loyer_max?: number | null;
  animaux?: "OUI" | "NON" | null;
  nb_personnes?: number | null;
  /** Garant disponible */
  garant?: "OUI" | "NON" | "A_CONFIRMER" | null;
  /** Étape courante du process immobilier */
  etape_process?: EtapeProcess | null;
  /** property_id lié (optionnel) */
  property_id?: string | null;
};

export type Email = {
  id: string;

  // Provider
  provider?: "google" | "microsoft" | string | null;
  provider_message_id?: string | null;
  open_url?: string | null;
  gmail_message_id?: string | null;

  // Raw email
  sender: string | null;
  subject: string | null;
  body?: string | null;
  received_at: string | null;

  // Bien immobilier lié (colonne top-level emails.property_id)
  property_id?: string | null;

  summary?: string | null;
  classification_reason?: string | null;
  decision?: EmailDecision;
  estimated_time?: number | null;
  recommended_action?: EmailAction;

  // Intention immobilière (stockée dans `category`)
  category?: string | null;

  is_archived?: boolean | null;
  is_urgent?: boolean | null;
  is_important?: boolean | null;
  ai_reply?: string | null;

  // Données prospect extraites par l'IA (JSONB en DB)
  prospect_data?: ProspectData | null;

  // Legacy pipeline fields (optional, kept for backward compat with utils)
  lead_status?: string | null;
  lead_last_action?: string | null;
  lead_last_action_at?: string | null;
  lead_json?: Record<string, unknown> | null;
  lead_profile?: Record<string, unknown> | null;
  lead_property_address?: string | null;
  candidate_name?: string | null;
};

// Helper : extraire l'intention depuis `category`
export function getIntention(email: Email): EmailIntention {
  const c = (email.category || "").toUpperCase();
  if (c === "LOCATION") return "LOCATION";
  if (c === "INFO") return "INFO";
  if (c === "HORS_SUJET") return "HORS_SUJET";
  return null;
}

// Helper : calculer le score IA (1-10) depuis les champs existants
export function getAiScore(email: Email): number {
  if (email.is_urgent) return 9;
  if (email.is_important && email.decision === "traiter") return 7;
  if (email.decision === "traiter") return 6;
  if (email.is_important && email.decision === "planifier") return 5;
  if (email.decision === "planifier") return 4;
  if (email.decision === "ignorer") return 2;
  return 5;
}
