import type { Email } from "@/types/email";

/** Nom affiché: lead_profile.prospect_name || candidate_name || partie avant @ du sender || "Prospect" */
export function extractNameFromSender(sender: string | null): string {
  if (!sender || typeof sender !== "string") return "";
  const beforeAt = sender.split("<")[0].trim();
  if (beforeAt) return beforeAt;
  const match = sender.match(/<([^@]+)@/);
  return match ? match[1].trim() : "";
}

export function prospectDisplayName(email: Email): string {
  const fromProfile = (email.lead_profile as { prospect_name?: string } | null)?.prospect_name?.trim();
  if (fromProfile) return fromProfile;
  const candidate = email.candidate_name?.trim();
  if (candidate) return candidate;
  const fromSender = extractNameFromSender(email.sender ?? null);
  if (fromSender) return fromSender;
  return "Prospect";
}

/** Date reçue format FR court (jj/mm/aa ou jj/mm à HH:mm) */
export function formatDateShortFR(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function getRentFromEmail(email: Email): number | null {
  const lj = email.lead_json as { rent?: number } | null;
  if (typeof lj?.rent === "number") return lj.rent;
  return null;
}

export function statusBadgeLabel(st: string | null | undefined): string {
  const s = String(st ?? "").toLowerCase();
  if (s === "new_lead") return "Analysé";
  if (s === "qualifying") return "Analysé";
  if (s === "slots_proposed") return "Slots proposés";
  if (s === "booked") return "Confirmé";
  if (s === "unqualified") return "Refusé";
  if (s === "other") return "Hors scope";
  if (s === "raw" || !s) return "Non analysé";
  if (s === "unclassified") return "Erreur parsing";
  if (s === "retry_later") return "À relancer";
  return "—";
}

export function statusBadgeCls(st: string | null | undefined): string {
  const s = String(st ?? "").toLowerCase();
  if (s === "booked") return "bg-green-900/40 text-green-300 border border-green-800/60";
  if (s === "slots_proposed") return "bg-blue-900/40 text-blue-300 border border-blue-800/60";
  if (s === "qualifying") return "bg-orange-900/40 text-orange-300 border border-orange-800/60";
  if (s === "new_lead") return "bg-gray-800 text-gray-200 border border-gray-700";
  if (s === "unqualified") return "bg-red-900/40 text-red-300 border border-red-800/60";
  if (s === "other") return "bg-gray-800/60 text-gray-400 border border-gray-700";
  if (s === "raw") return "bg-gray-800/60 text-gray-400 border border-gray-700";
  if (s === "unclassified") return "bg-amber-900/40 text-amber-300 border border-amber-800/60";
  if (s === "retry_later") return "bg-amber-900/40 text-amber-300 border border-amber-800/60";
  return "bg-gray-800 text-gray-300 border border-gray-700";
}

/** Score label pour badge: "8/10" ou "—" */
export function scoreBadgeLabel(score: number | null | undefined): string {
  if (typeof score === "number") return `${score}/10`;
  return "—";
}

export function scoreBadgeCls(score: number | null | undefined): string {
  const s = typeof score === "number" ? score : 0;
  if (s >= 8) return "bg-green-600 text-white";
  if (s >= 4) return "bg-orange-500 text-black";
  return "bg-red-600 text-white";
}

/** Raison hors scope: classification_reason ou decision === "ignorer" */
export function reasonPillText(email: Email): string | null {
  if (email.decision === "ignorer") return "Hors scope";
  const reason = (email as { classification_reason?: string }).classification_reason?.trim();
  if (reason) return reason;
  return null;
}

export function isAutopilotPending(email: Email): boolean {
  const lj = email.lead_json as { autopilot_pending?: boolean } | null;
  return lj?.autopilot_pending === true;
}

export function propertyDisplay(email: Email): string {
  const addr =
    email.lead_property_address?.trim() ||
    (email.lead_profile as { property_address?: string } | null)?.property_address?.trim();
  if (addr) return addr;
  return "Bien non identifié";
}

export function prettyMoney(v?: number | null): string {
  if (typeof v !== "number") return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} €`;
  }
}
