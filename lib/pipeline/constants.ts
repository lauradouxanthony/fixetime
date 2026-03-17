/**
 * Mapping statuts pipeline (DB) → libellés affichage ELITE.
 * Source de vérité pour la liste Pipeline et le panneau Détails.
 */
export const LEAD_STATUS_TO_LABEL: Record<string, string> = {
  raw: "New",
  new_lead: "New",
  qualifying: "WaitingDocs", // peut être affiné en ReadyForVisit si dossier complet
  slots_proposed: "SlotsProposed",
  booked: "Booked",
  unqualified: "Unqualified",
  other: "Other",
};

/** Statuts considérés "qualifying" pour affiner en WaitingDocs vs ReadyForVisit */
export const STATUS_QUALIFYING = "qualifying";
export const STATUS_SLOTS_PROPOSED = "slots_proposed";
export const STATUS_BOOKED = "booked";

export type IntentType = "LOCATION" | "INFORMATION";
