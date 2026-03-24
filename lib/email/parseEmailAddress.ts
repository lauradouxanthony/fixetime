/**
 * Extrait l'adresse email depuis une chaîne "Nom <email@domain.com>" ou retourne la chaîne nettoyée.
 * Utilisé pour le destinataire (emails.sender) dans send-draft.
 */
export function parseEmailAddress(input: string | null | undefined): string {
  if (input == null || typeof input !== "string") return "";
  const s = input.trim();
  if (!s) return "";
  const match = s.match(/<([^>]+)>/);
  if (match && match[1]) return match[1].trim();
  return s;
}
