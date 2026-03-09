export type EmailDecision = "traiter" | "planifier" | "ignorer" | null;

export type EmailAction = "reply" | "schedule" | "archive" | null;

// Intention immobilière — stockée dans la colonne `category`
export type EmailIntention = "LOCATION" | "INFO" | "HORS_SUJET" | null;

export type Email = {
  id: string;
  gmail_message_id?: string | null;

  sender: string | null;
  subject: string | null;
  body?: string | null;
  received_at: string | null;

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
