/**
 * isSpamSender — détecte les expéditeurs automatiques/spam
 * qui ne doivent JAMAIS devenir des prospects.
 *
 * Retourne true si l'email doit être exclu du pipeline prospect.
 */

const SENDER_BLACKLIST = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer",
  "notification",
  "newsletter",
  "facebook.com",
  "revolut.com",
  "google.com",
  "apple.com",
  "linkedin.com",
  "twitter.com",
  "instagram.com",
];

const SUBJECT_BLACKLIST = [
  "abonnement",
  "facture",
  "invoice",
  "receipt",
  "confirmation de commande",
  "your order",
  "verify your",
  "reset your password",
];

export function isSpamSender(
  sender: string | null | undefined,
  subject: string | null | undefined
): boolean {
  const senderLow = (sender ?? "").toLowerCase();
  const subjectLow = (subject ?? "").toLowerCase();

  if (SENDER_BLACKLIST.some((pattern) => senderLow.includes(pattern))) {
    return true;
  }
  if (SUBJECT_BLACKLIST.some((pattern) => subjectLow.includes(pattern))) {
    return true;
  }
  return false;
}
