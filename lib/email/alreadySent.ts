/**
 * Règle unique "already sent" pour empêcher tout double envoi (autopilot ou manuel).
 * Utilisée par send-reply, send-proposal, send-draft avant tout envoi Gmail/Graph.
 *
 * Preuve anti-double envoi : tout appel à send (reply ou proposal) doit appeler
 * isAlreadySent() en premier et skip si true ; après envoi on écrit last_outbound
 * + lead_last_action donc le prochain appel skip.
 */

const SENT_TYPES = [
  "reply_sent",
  "proposal_slots_sent",
  "ai_reply", // rétrocompat
  "proposal_slots", // rétrocompat
  "info_reply", // réponse FAQ / info envoyée
] as const;

export type LastOutbound = {
  type?: string;
  at?: string;
  sent_at?: string;
  to?: string;
  provider_message_id?: string;
};

/**
 * Retourne true si un envoi (réponse ou proposition créneaux) a déjà été effectué
 * pour cet email. Basé sur :
 * - emails.lead_json.last_outbound.type in ["reply_sent","proposal_slots_sent","ai_reply","proposal_slots"]
 * - OU emails.lead_last_action === "reply_sent" | "proposal_slots_sent"
 */
export function isAlreadySent(leadJson: { last_outbound?: LastOutbound } | null, leadLastAction?: string | null): boolean {
  const type = leadJson?.last_outbound?.type;
  if (type && SENT_TYPES.includes(type as any)) return true;
  if (leadLastAction === "reply_sent" || leadLastAction === "proposal_slots_sent") return true;
  return false;
}

/**
 * Retourne true si une réponse (reply) a déjà été envoyée.
 */
export function isReplyAlreadySent(leadJson: { last_outbound?: LastOutbound } | null, leadLastAction?: string | null): boolean {
  const type = leadJson?.last_outbound?.type;
  if (type === "reply_sent" || type === "ai_reply" || type === "info_reply") return true;
  if (leadLastAction === "reply_sent") return true;
  return false;
}

/**
 * Retourne true si une proposition de créneaux a déjà été envoyée.
 */
export function isProposalAlreadySent(leadJson: { last_outbound?: LastOutbound } | null, leadLastAction?: string | null): boolean {
  const type = leadJson?.last_outbound?.type;
  if (type === "proposal_slots_sent" || type === "proposal_slots") return true;
  if (leadLastAction === "proposal_slots_sent") return true;
  return false;
}
