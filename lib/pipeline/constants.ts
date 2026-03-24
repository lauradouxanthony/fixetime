/**
 * Mapping statuts pipeline (DB) → libellés affichage ELITE.
 * Source de vérité pour la liste Pipeline et le panneau Détails.
 */

// @deprecated — use ETAPE_PROCESS_META instead.
// Conservé uniquement pour la conversion des anciens emails non migrés (lead_status legacy).
export const LEAD_STATUS_TO_LABEL: Record<string, string> = {
  raw: "New",
  new_lead: "New",
  qualifying: "WaitingDocs", // peut être affiné en ReadyForVisit si dossier complet
  slots_proposed: "SlotsProposed",
  booked: "Booked",
  unqualified: "Unqualified",
  other: "Other",
};

// @deprecated — use ETAPE_PROCESS_META
export const STATUS_QUALIFYING = "qualifying";
// @deprecated — use ETAPE_PROCESS_META
export const STATUS_SLOTS_PROPOSED = "slots_proposed";
// @deprecated — use ETAPE_PROCESS_META
export const STATUS_BOOKED = "booked";

/** Tous les états EtapeProcess (8 états officiels + DOSSIER_COMPLET) */
export type EtapeProcess =
  | "NEW"
  | "QUALIFICATION"
  | "VISITE_PROPOSEE"
  | "VISITE_CONFIRMEE"
  | "DOSSIER_DEMANDE"
  | "DOSSIER_RECU"
  | "DOSSIER_COMPLET"
  | "VALIDE"
  | "REFUSE";

export type EtapeProcessMeta = {
  label: string;
  /** Tailwind color classes for badge */
  className: string;
  /** Normalized ui_status key (used in pipeline filters) */
  uiStatus: string;
};

/** Source de vérité : EtapeProcess → affichage + couleur */
export const ETAPE_PROCESS_META: Record<EtapeProcess, EtapeProcessMeta> = {
  NEW: {
    label: "Nouveau",
    className: "bg-blue-500/20 text-blue-200 border border-blue-500/40",
    uiStatus: "new",
  },
  QUALIFICATION: {
    label: "En qualification",
    className: "bg-amber-500/20 text-amber-200 border border-amber-500/40",
    uiStatus: "qualifying",
  },
  VISITE_PROPOSEE: {
    label: "Visite proposée",
    className: "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40",
    uiStatus: "visite_proposee",
  },
  VISITE_CONFIRMEE: {
    label: "✓ Visite confirmée",
    className: "bg-zinc-900 text-emerald-300 border border-emerald-500/40",
    uiStatus: "confirmed",
  },
  DOSSIER_DEMANDE: {
    label: "Dossier demandé",
    className: "bg-purple-500/20 text-purple-200 border border-purple-500/40",
    uiStatus: "dossier_demande",
  },
  DOSSIER_RECU: {
    label: "Dossier reçu",
    className: "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40",
    uiStatus: "dossier_recu",
  },
  DOSSIER_COMPLET: {
    label: "Dossier complet",
    className: "bg-teal-500/20 text-teal-200 border border-teal-500/40",
    uiStatus: "dossier_complet",
  },
  VALIDE: {
    label: "✓ Validé",
    className: "bg-green-600/20 text-green-200 border border-green-500/40",
    uiStatus: "valide",
  },
  REFUSE: {
    label: "Refusé",
    className: "bg-red-500/20 text-red-200 border border-red-500/40",
    uiStatus: "rejected",
  },
};

/** Convertit un lead_status legacy → EtapeProcess approximatif (pour migration applicative) */
export const LEGACY_STATUS_TO_ETAPE: Record<string, EtapeProcess> = {
  raw: "NEW",
  new_lead: "NEW",
  qualifying: "QUALIFICATION",
  slots_proposed: "VISITE_PROPOSEE",
  booked: "VISITE_CONFIRMEE",
  unqualified: "REFUSE",
  other: "NEW",
};

export type IntentType = "LOCATION" | "INFORMATION";
