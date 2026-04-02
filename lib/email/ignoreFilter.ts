/**
 * Filtre automatique — emails système non immobiliers.
 * Ces emails sont ignorés SANS appel IA.
 */

const SYSTEM_SENDER_PATTERNS = [
  "noreply", "no-reply", "do-not-reply", "donotreply",
  "notification@", "notifications@",
  "newsletter", "mailer-daemon", "postmaster",
  "caisse-epargne", "caisse.epargne", "caisseepargne",
  "credit-agricole", "creditagricole", "lcl.fr",
  "bnpparibas", "bnp-paribas", "societegenerale", "societe-generale",
  "boursorama", "fortuneo", "hello-bank", "hellobank",
  "assurance", "mutuelle", "ameli.fr", "impots.gouv",
  "laposte.fr", "chronopost", "colissimo",
  "info@edf", "service@sfr", "service@orange",
];

const SYSTEM_SUBJECT_PATTERNS = [
  "accusé de réception",
  "accuse de reception",
  "delivery failed",
  "delivery status notification",
  "mail delivery",
  "undelivered mail",
  "mailer daemon",
  "out of office",
  "absence du bureau",
  "absent du bureau",
  "en déplacement",
  "automatic reply",
  "auto-reply",
  "réponse automatique",
  "reponse automatique",
  "newsletter",
  "désabonnement",
  "unsubscribe",
  "subscription confirmed",
];

export function isSystemEmail(sender: string, subject: string): boolean {
  const s = (sender ?? "").toLowerCase();
  const sub = (subject ?? "").toLowerCase();
  if (SYSTEM_SENDER_PATTERNS.some((p) => s.includes(p))) return true;
  if (SYSTEM_SUBJECT_PATTERNS.some((p) => sub.includes(p))) return true;
  return false;
}
