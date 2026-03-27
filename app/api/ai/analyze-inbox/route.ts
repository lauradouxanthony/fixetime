import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";
import { createCalendarEvent } from "@/lib/calendar/createEventUnified";
import { sendGmailEmail as sendGoogleEmail } from "@/lib/google/sendEmail";
import { sendOutlookEmail as sendMicrosoftEmail } from "@/lib/microsoft/sendEmail";
import { logActivity } from "@/lib/activity/logActivity";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { matchFaq, type FaqItem } from "@/lib/faq/matchFaq";
import { setLastAction } from "@/lib/lead/lastAction";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Étapes du process immobilier (ordre de progression) ─────────────────────
export const STEP_ORDER = [
  "NEW",
  "QUALIFICATION",
  "VISITE_PROPOSEE",
  "VISITE_CONFIRMEE",
  "DOSSIER_DEMANDE",
  "DOSSIER_RECU",
  "VALIDE",
  "REFUSE",
] as const;
export type EtapeProcess = (typeof STEP_ORDER)[number];

function isInternalCron(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  if (!key) return false;
  const expected = process.env.FIXETIME_INTERNAL_CRON_KEY;
  if (!expected) return true;
  return key === expected;
}

// ── Correction date RDV : prochain jour de la semaine mentionné ──────────────
const JOURS_SEMAINE: Record<string, number> = {
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4,
  vendredi: 5, samedi: 6, dimanche: 0,
};

function extractJourFromBody(body: string): { jour: string | null; heure: string | null } {
  // Chercher le nom du jour (case insensitive)
  const jourMatch = body.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i);
  // Chercher l'heure au format 14h, 14h30, 14:00
  const heureMatch = body.match(/\b(\d{1,2}h\d{0,2}|\d{1,2}:\d{2})\b/i);
  return {
    jour: jourMatch ? jourMatch[1].toLowerCase() : null,
    heure: heureMatch ? heureMatch[1] : null,
  };
}

/**
 * Calcule la prochaine occurrence d'un jour de la semaine.
 * Ex: si aujourd'hui=lundi et on demande "mercredi" → +2 jours
 * Si aujourd'hui=mercredi et on demande "mercredi" → +7 jours (prochain, pas aujourd'hui)
 */
function prochainJour(jourNom: string, heureText: string | null, fromDate = new Date()): Date | null {
  const targetDay = JOURS_SEMAINE[jourNom.toLowerCase()];
  if (targetDay === undefined) return null;

  const base = new Date(fromDate);
  base.setHours(0, 0, 0, 0);
  const todayDay = base.getDay();

  let daysUntil = targetDay - todayDay;
  if (daysUntil <= 0) daysUntil += 7; // toujours dans le futur

  const eventDate = new Date(base);
  eventDate.setDate(base.getDate() + daysUntil);

  // Parse l'heure : "14h", "14h30", "14:30"
  if (heureText) {
    const m = heureText.match(/^(\d{1,2})[h:](\d{0,2})$/i);
    if (m) {
      eventDate.setHours(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, 0, 0);
    }
  } else {
    eventDate.setHours(10, 0, 0, 0); // default 10h si pas d'heure précisée
  }

  return eventDate;
}

/**
 * Corrige/valide le confirmed_datetime fourni par l'IA.
 * Si le jour de la semaine dans l'email ne correspond pas à la date IA,
 * recalcule le prochain jour correct.
 */
function fixConfirmedDatetime(aiDatetime: string | null, emailBody: string): Date | null {
  const { jour, heure } = extractJourFromBody(emailBody);

  // Si un nom de jour est mentionné dans l'email, on fait confiance au nom plutôt qu'à l'IA
  if (jour) {
    const corrected = prochainJour(jour, heure);
    if (corrected) return corrected;
  }

  // Sinon, utiliser la date IA si valide
  if (aiDatetime) {
    try {
      const d = new Date(aiDatetime);
      if (!isNaN(d.getTime())) {
        // Vérifier que la date est dans le futur (au moins demain)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        if (d >= tomorrow) return d;
        // Date passée → décaler au prochain jour correspondant
        if (jour) return prochainJour(jour, heure) ?? d;
      }
    } catch { /* ignore */ }
  }

  return null;
}

function isManualRequest(req: Request) {
  return !!req.headers.get("cookie");
}

/* ===================== OPENAI ===================== */

function guessCategory(email: { subject?: string | null; sender?: string | null }): string {
  const s = (email.subject || "").toLowerCase();
  const sender = (email.sender || "").toLowerCase();

  // Senders clairement automatisés (noreply / newsletter / donotreply)
  const automatedSender =
    sender.includes("noreply") || sender.includes("no-reply") ||
    sender.includes("donotreply") || sender.includes("newsletter") ||
    sender.includes("notification") || sender.includes("marketing") ||
    sender.includes("promo");

  // LOCATION EN PRIORITÉ ABSOLUE — si sujet contient un mot immobilier explicite
  // ET sender n'est PAS clairement automatisé (noreply/newsletter/donotreply)
  // NOTE : "agency" dans l'adresse email ne rend PAS automatisé (ex: dolphinagency@gmail.com)
  const locationKw = [
    "louer", "location", "appartement", "logement", "visite", "loyer",
    "locataire", "t1", "t2", "t3", "chambre", "studio",
    "surface", "m²", "caution", "propriétaire",
    "candidature location", "dépôt de garantie", "quittance",
  ];
  if (!automatedSender && locationKw.some((k) => s.includes(k))) return "LOCATION";
  // "bail" uniquement si accompagné d'un autre mot immobilier
  if (!automatedSender && s.includes("bail") && ["louer", "location", "loyer", "appartement", "logement", "locataire"].some((k) => s.includes(k))) {
    return "LOCATION";
  }

  // HORS_SUJET — domaines commerciaux connus
  const commercialDomains = [
    "@hellofresh", "@netflix", "@revolut", "@facebookmail", "@meta.com",
    "@google.com", "@linkedin", "@twitter.com", "@amazon", "@paypal",
    "@stripe.com", "@notion.so", "@slack.com", "@crypto", "noreply@",
    "no-reply@", "donotreply@", "newsletter@", "@newsletter",
  ];
  if (commercialDomains.some((d) => sender.includes(d))) return "HORS_SUJET";
  if (automatedSender) return "HORS_SUJET";

  // HORS_SUJET — mots-clés sujet commerciaux
  const horsSujetSubjectKw = [
    "offre exclusive", "offre spéciale", "promotion", "découvrez", "gagnez", "gratuit",
    "abonnement", "commande", "facture", "reçu de paiement",
    "security alert", "alerte sécurité", "compte facebook", "compte google",
    "crypto", "bitcoin", "investissement", "trading",
    "désabonner", "unsubscribe", "vous avez été invité",
    "se désinscrire", "mise à jour de votre compte", "confirmez votre",
  ];
  if (horsSujetSubjectKw.some((k) => s.includes(k))) return "HORS_SUJET";

  // INFO — questions générales
  if (
    s.includes("info") || s.includes("question") || s.includes("renseignement") ||
    s.includes("disponible") || s.includes("prix") || s.includes("tarif") ||
    s.includes("contact")
  ) return "INFO";

  return "INFO"; // doute → INFO plutôt que LOCATION
}

function fallbackDecision(email: { subject?: string | null; sender?: string | null }) {
  const subject = (email.subject || "").toLowerCase();
  const sender = (email.sender || "").toLowerCase();

  if (
    subject.includes("urgent") ||
    subject.includes("asap") ||
    subject.includes("demain")
  ) {
    return { decision: "traiter", is_urgent: true, is_important: false };
  }
  if (subject.includes("réunion") || subject.includes("rdv")) {
    return { decision: "traiter", is_urgent: false, is_important: true };
  }
  if (sender.includes("newsletter") || sender.includes("linkedin") || sender.includes("no-reply")) {
    return { decision: "ignorer", is_urgent: false, is_important: false };
  }
  return { decision: "traiter", is_urgent: false, is_important: false };
}
function extractReplyOnly(raw: string) {
  if (!raw) return "";

  let t = String(raw);

  // 1) coupe à partir des séparateurs de reply les plus fiables
  const separators = [
    /\n---+\s*message d['’]origine\s*---+\n/i,
    /\n---+\s*original message\s*---+\n/i,
    /\n\s*from:\s.+\n/i,
    /\n\s*de\s*:\s.+\n/i,
    /\n\s*sent:\s.+\n/i,
    /\n\s*envoyé\s*:\s.+\n/i,
    /\n\s*on\s.+\swrote:\s*\n/i,
    /\n\s*le\s.+\sa écrit\s*:\s*\n/i, // OK le ... a écrit :
  ];

  for (const re of separators) {
    const m = t.match(re);
    if (m?.index != null && m.index > 0) {
      t = t.slice(0, m.index);
      break;
    }
  }

  // 2) supprime les lignes citées ">"
  t = t
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");

  // 3) trim + limite
  return t.trim().slice(0, 800);
}
function maybeSlotReply(rawText: string) {
  const clean = extractReplyOnly(rawText);
  if (!clean) return false;

  // On ne regarde QUE la vraie réponse (1ère ligne non vide)
  const firstLine =
    clean
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";

  const line = firstLine.toLowerCase();

  // OK Cas "1" / "2" / "3" SEUL (evite T3, 3 pieces, etc.)
  if (/^(?:choix|option)?\s*(1|2|3)\s*$/.test(line)) return true;

  // OK Cas "je prends 2" / "je choisis 3"
  if (/^je\s+(?:prends|choisis)\s+(?:le\s+)?(1|2|3)\s*$/.test(line)) return true;

  // OK Cas "11h" / "11:00" sur la 1ere ligne (reponse courte)
  if (/^(\d{1,2})(?:[:h])(\d{2})?\s*$/.test(line)) return true;

  return false;
}



function detectSlotChoice(rawText: string, slots: string[]) {
  const clean = extractReplyOnly(rawText);
  if (!clean) return null;

  // On ne prend pas que la 1ère ligne : on prend les 8 premières lignes non vides
  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 8);

  const joined = lines.join(" ").toLowerCase();

  // 1) choix explicite "1" / "2" / "3" (ligne seule OU dans phrase)
  // IMPORTANT : on prend le DERNIER match, car certains écrivent "j'hésite entre 1 et 2 => je prends 2"
  const matches = Array.from(joined.matchAll(/\b(1|2|3)\b/g));
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const idx = Number(last[1]) - 1;
    return slots[idx] ?? null;
  }

  // 2) fallback heure (si quelqu'un répond "11h")
  const hourMatches = joined.match(/\b(\d{1,2})(?:[:h])(\d{2})?\b/g);
  if (hourMatches) {
    for (const slot of slots) {
      const d = new Date(slot);
      const sh = d.getHours();
      const sm = d.getMinutes();

      for (const hm of hourMatches) {
        const normalized = hm.replace("h", ":");
        const parts = normalized.split(":");
        const h = Number(parts[0]);
        const m2 = parts[1] ? Number(parts[1]) : 0;

        if (h === sh && m2 === sm) return slot;
      }
    }
  }

  return null;
}



function removeAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeTokens(text: string): string[] {
  const t = removeAccents(String(text || "").toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
  return [...new Set(t)];
}
function streetWithoutNumber(addr: string): string {
  return removeAccents(String(addr || "").toLowerCase())
    .replace(/^\d+\s*/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
}
function extractPostalCode(addr: string): string | null {
  const m = String(addr || "").match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}
function extractCity(addr: string): string {
  const parts = String(addr || "").split(",").map((p) => p.trim());
  const last = parts[parts.length - 1] || "";
  return removeAccents(last.replace(/\d{5}\s*/, "").toLowerCase().trim());
}

function cleanNull(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "" || t === "null" || t === "undefined" || t === "n/a") return null;
  }
  return v;
}

function extractEmailAddress(sender: string | null) {
  if (!sender) return null;

  const m = sender.match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim();

  // fallback si c'est déjà une adresse
  if (sender.includes("@") && !sender.includes(" ")) return sender.trim();

  return null;
}
function formatSlotFR(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSlotsEmailReply(slots: string[]) {
  const s1 = slots[0] ? formatSlotFR(slots[0]) : "—";
  const s2 = slots[1] ? formatSlotFR(slots[1]) : "—";
  const s3 = slots[2] ? formatSlotFR(slots[2]) : "—";

  return `Bonjour,

Merci pour votre message. Pour organiser la visite, voici 3 créneaux disponibles :

1) ${s1}
2) ${s2}
3) ${s3}

Répondez simplement par 1, 2 ou 3 pour confirmer le créneau qui vous convient.

Cordialement,
L'équipe`;
}


/* ===================== TYPES ===================== */

type DbEmail = {
  id: string;
  provider?: string | null;
  provider_message_id?: string | null;
  gmail_message_id?: string | null;

  sender: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;

  lead_status?: string | null;
  lead_json?: any | null;
};

async function fetchGmailBody(
  userId: string,
  gmailMessageId: string
): Promise<string | null> {
  try {
    const accessToken = await getValidGoogleAccessToken(userId);

    const res = await fetchWithTimeout(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}?format=full`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeoutMs: 6000,
      }
    );

    if (!res.ok) return null;

    const data = await res.json();

    // Gmail body parsing (text/plain prioritaire)
    const parts = data.payload?.parts ?? [];
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }

    // fallback body direct
    if (data.payload?.body?.data) {
      return Buffer.from(data.payload.body.data, "base64").toString("utf-8");
    }

    return null;
  } catch (e: any) {
    const errorMsg = e?.message ?? String(e);
    if (errorMsg.includes("TIMEOUT")) {
      console.error(`[ANALYZE] Gmail body fetch timeout: ${gmailMessageId}`);
    } else {
      console.error("[ANALYZE] Gmail body fetch failed", e);
    }
    return null;
  }
}
import { getValidMicrosoftAccessToken } from "@/lib/microsoft/getValidAccessToken";

async function fetchOutlookBody(userId: string, providerMessageId: string): Promise<string | null> {
  try {
    const accessToken = await getValidMicrosoftAccessToken(userId);

    const res = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/me/messages/${providerMessageId}?$select=body`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        timeoutMs: 6000,
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const content = data?.body?.content ?? null;
    return typeof content === "string" ? content : null;
  } catch (e: any) {
    const errorMsg = e?.message ?? String(e);
    if (errorMsg.includes("TIMEOUT")) {
      console.error(`[ANALYZE] Outlook body fetch timeout: ${providerMessageId}`);
    } else {
      console.error("[ANALYZE] Outlook body fetch failed", e);
    }
    return null;
  }
}
async function getRealVisitSlots(userId: string, durationMin: number) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const cronKey = process.env.FIXETIME_INTERNAL_CRON_KEY;
  if (cronKey) headers["x-fixetime-cron-key"] = cronKey;

  const res = await fetchWithTimeout(`${process.env.NEXT_PUBLIC_SITE_URL}/api/availability/slots`, {
    method: "POST",
    headers,
    body: JSON.stringify({ duration_min: durationMin, user_id: userId }),
    cache: "no-store",
    timeoutMs: 6000,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`SLOTS_FETCH_FAILED:${txt}`);
  }

  const j = await res.json();
  const slots = Array.isArray(j?.slots) ? j.slots : [];
  return slots as { start: string; end: string }[];
}

/* ===================== HANDLER ===================== */

/**
 * Fusion cumulative de deux objets prospect_data.
 * Règle générale : un champ non-null dans `base` n'est JAMAIS écrasé.
 * Exception : etape_process — le incoming GAGNE TOUJOURS (progression du process).
 */
function mergeProspect(
  base: Record<string, unknown>,
  incoming: Record<string, unknown> | null
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  if (!incoming) return result;
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "etape_process") {
      // etape_process : le incoming gagne SAUF si c'est un retour en arrière
      // Les étapes manuelles (DOSSIER_DEMANDE, VALIDE, REFUSE) ne peuvent pas être
      // écrasées par l'IA (seule exception : REFUSE peut être mis par l'IA pour insolvable)
      const existingEtape = result["etape_process"] as string | null | undefined;
      const newEtape = v as string | null | undefined;
      if (!existingEtape || !newEtape) {
        result[k] = v;
      } else {
        const existIdx = STEP_ORDER.indexOf(existingEtape as EtapeProcess);
        const newIdx = STEP_ORDER.indexOf(newEtape as EtapeProcess);
        // Autoriser seulement l'avancement (jamais la régression)
        // DOSSIER_DEMANDE ne peut être effacé que par DOSSIER_RECU (géré ailleurs)
        if (newIdx >= existIdx) {
          result[k] = v;
        }
        // sinon on garde l'existing (refus de régresser)
      }
      continue;
    }
    const existing = result[k];
    const isEmpty = existing === null || existing === undefined || existing === "";
    const hasValue = v !== null && v !== undefined && v !== "";
    if (isEmpty && hasValue) {
      result[k] = v;
    }
  }
  return result;
}

/** Détecte si un email contient une confirmation de visite */
function detectConfirmation(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return [
    "je confirme", "c'est parfait", "d'accord pour", "je serai là",
    "convient", "oui pour le", "ça me convient", "parfait pour",
    "ok pour", "ce créneau", "à lundi", "à mardi", "à mercredi",
    "à jeudi", "à vendredi", "rdv confirmé", "rendez-vous confirmé",
    "je prends le", "je prends ce",
  ].some((k) => lower.includes(k));
}

/** Détermine la nouvelle étape du process */
function detectEtapeProcess(params: {
  hasAttachments: boolean;
  rdvConfirmed: boolean;
  isFollowUp: boolean;
  bodyText: string;
  situation: string | null;
  revenus: number | null;
  loyer: number | null;
  multiplicateur: number;
  currentEtape: string | null;
}): EtapeProcess {
  const { hasAttachments, rdvConfirmed, isFollowUp, bodyText, situation, revenus, loyer, multiplicateur, currentEtape } = params;

  // ÉTAPE DOSSIER_RECU : pièces jointes reçues (quelle que soit l'étape actuelle)
  // RÈGLE ABSOLUE : email avec PJ → toujours traiter comme envoi de documents
  if (hasAttachments && currentEtape !== "VALIDE" && currentEtape !== "REFUSE") {
    return "DOSSIER_RECU";
  }

  // ÉTAPE VISITE_CONFIRMEE : prospect confirme un créneau de visite
  // BLOC 7 : si l'IA a explicitement détecté une confirmation RDV (is_rdv_confirmation = true),
  // forcer VISITE_CONFIRMEE sans vérifier currentEtape (score IA = 10 → auto)
  if (rdvConfirmed) return "VISITE_CONFIRMEE";
  // Confirmation de suivi classique (l'email précédent proposait une visite)
  if (isFollowUp && detectConfirmation(bodyText)) {
    return "VISITE_CONFIRMEE";
  }

  // ÉTAPES INITIALES (analyse profil)
  // Étudiant : VISITE_PROPOSEE (avec garant obligatoire mentionné dans la réponse)
  if (situation === "etudiant") return "VISITE_PROPOSEE";

  // Solvable : VISITE_PROPOSEE
  if (revenus !== null && loyer !== null && loyer > 0 && revenus / loyer >= multiplicateur && situation) {
    return "VISITE_PROPOSEE";
  }

  // Insolvable : REFUSE
  if (revenus !== null && loyer !== null && loyer > 0 && revenus / loyer < multiplicateur) {
    return "REFUSE";
  }

  // Infos manquantes : QUALIFICATION
  if (!revenus || !loyer || !situation) return "QUALIFICATION";

  // Par défaut : QUALIFICATION
  return "QUALIFICATION";
}

export async function POST(req: Request) {
  const isCron = isInternalCron(req);
  const isManual = isManualRequest(req);
  const isAnalyzeNow = req.headers.get("x-fixetime-analyze-now") === "true";

  let body: any = null;
  try { body = await req.json(); } catch {}

  if (!isCron && !isManual) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    let targetUserId: string | null = null;

    if (isCron && body?.user_id) {
      targetUserId = body.user_id;
    }

    if (isManual && !targetUserId) {
      const supabase = await supabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });
      targetUserId = user.id;
    }

    if (!targetUserId) {
      return NextResponse.json({ error: "NO_TARGET_USER" }, { status: 400 });
    }

    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const sinceISO = new Date(Date.now() - THIRTY_DAYS).toISOString();

    // ── Sélectionner aussi attachments pour détecter les dossiers envoyés ──
    let q = supabaseAdmin
      .from("emails")
      .select("id, user_id, sender, subject, body, received_at, gmail_message_id, thread_id, attachments")
      .gte("received_at", sinceISO)
      .or("category.is.null,decision.is.null,summary.is.null")
      .order("received_at", { ascending: false })
      .limit(200);

    console.log("[ANALYZE-INBOX] Démarrage analyse pour user:", targetUserId);

    if (targetUserId) {
      q = q.eq("user_id", targetUserId);
    }

    const { data: emails, error } = await q;

    if (error) {
      console.error("FETCH_EMAILS_ERROR", error);
      return NextResponse.json({ error: "FETCH_EMAILS_FAILED" }, { status: 500 });
    }

    // Fallback : emails bloqués hors période
    await supabaseAdmin
      .from("emails")
      .update({
        decision: "ignorer",
        summary: "Email classé automatiquement.",
        estimated_time: 0,
        recommended_action: "archive",
        classification_reason: "Fallback global FixTime",
      })
      .eq("user_id", targetUserId)
      .lt("received_at", sinceISO)
      .is("decision", null);

    if (!emails || emails.length === 0) {
      console.log("[ANALYZE-INBOX] Aucun email à analyser");
      return NextResponse.json({ success: true, analyzed: 0 });
    }

    console.log(`[ANALYZE-INBOX] ${emails.length} emails à classifier`);

    let analyzed = 0;

    // ── Cache biens par user (évite N+1) ────────────────────────────────────
    const propertiesByUser: Record<string, Array<{ id: string; title: string; name?: string; address: string | null; rent: number }>> = {};

    async function getUserProperties(userId: string) {
      if (!propertiesByUser[userId]) {
        const { data } = await supabaseAdmin
          .from("properties")
          .select("id, title, name, address, rent, available")
          .eq("user_id", userId);
        // Normaliser title/name
        propertiesByUser[userId] = (data ?? []).map((p: any) => ({
          id: p.id,
          title: p.title ?? p.name ?? "",
          address: p.address ?? null,
          rent: p.rent ?? 0,
          available: p.available !== false,
        }));
      }
      return propertiesByUser[userId];
    }

    /**
     * BLOC 3 : Matcher un email avec le bon bien immobilier.
     * Retourne { propertyId, rent } si un bien est trouvé.
     */
    function matchPropertyFromEmail(
      emailContent: string,
      emailSubject: string | null,
      properties: Array<{ id: string; title: string; address: string | null; rent: number }>
    ): { propertyId: string; rent: number } | null {
      if (properties.length === 0) return null;
      if (properties.length === 1) return { propertyId: properties[0].id, rent: properties[0].rent };

      const text = `${emailSubject ?? ""} ${emailContent}`.toLowerCase();

      for (const prop of properties) {
        const keywords = [prop.title, prop.address]
          .filter(Boolean)
          .flatMap((s) => (s as string).toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3));

        const matchCount = keywords.filter((k) => text.includes(k)).length;
        if (matchCount >= 2) return { propertyId: prop.id, rent: prop.rent };
      }

      // Si un seul bien et rien de précis → l'utiliser par défaut
      return null; // Plusieurs biens, aucun match → demander
    }

    for (const email of emails) {
      const { data: settings } = await supabaseAdmin
        .from("settings_v1")
        .select("email_rules")
        .eq("user_id", email.user_id)
        .maybeSingle();

      const rules = (settings?.email_rules as any) ?? {};

  /* ===================== ASSISTANT CHECK ===================== */
  const { data: assistantSettings } = await supabaseAdmin
    .from("settings_v1")
    .select("assistant_enabled")
    .eq("user_id", targetUserId)
    .maybeSingle();

      // ── Règles utilisateur ────────────────────────────────────────────────
      let forcedDecision: "traiter" | "ignorer" | "planifier" | null = null;
      let forcedUrgent = false;
      let forcedImportant = false;

      if (rules.always_important?.some((d: string) => (email.sender || "").includes(d))) {
        forcedDecision = "traiter";
        forcedImportant = true;
      }
      if (rules.always_ignore?.some((d: string) => (email.sender || "").includes(d))) {
        forcedDecision = "ignorer";
      }
      if (rules.keywords?.urgent?.some((k: string) =>
        (email.subject || "").toLowerCase().includes(k.toLowerCase())
      )) {
        forcedDecision = "traiter";
        forcedUrgent = true;
      }

      if (forcedDecision) {
        await supabaseAdmin
          .from("emails")
          .update({
            decision: forcedDecision,
            is_urgent: forcedUrgent,
            is_important: forcedImportant,
            summary: "Classé selon vos préférences.",
            estimated_time: forcedDecision === "ignorer" ? 0 : 5,
            recommended_action: forcedDecision === "ignorer" ? "archive" : "reply",
            classification_reason: "Règle utilisateur",
            category: forcedDecision === "ignorer" ? "HORS_SUJET" : guessCategory(email),
          })
          .eq("id", email.id);
        analyzed++;
        continue;
      }

      // ── BLOC 1 DIAGNOSTIC — vérifier que le body arrive bien ─────────────
      console.log(`[BLOC1 DIAGNOSTIC] emailId=${email.id} BODY_LENGTH=${email.body?.length ?? 0}`);
      if (email.body) {
        console.log(`[BLOC1 DIAGNOSTIC] BODY_SAMPLE=${email.body.substring(0, 500)}`);
      } else {
        console.warn(`[BLOC1 DIAGNOSTIC] ⚠️ BODY VIDE pour emailId=${email.id} — sync à corriger`);
      }

      const content =
        email.body?.trim() ||
        "Email sans contenu. Analyse basée sur le sujet et l'expéditeur.";

      // ── Contexte agence ───────────────────────────────────────────────────
      const ftLocatif = rules.ft_locatif ?? {};
      const ftIa = rules.ft_ia ?? {};
      const ftAgence = rules.ft_agence ?? {};
      const ftFaq: { question: string; reponse: string }[] = rules.ft_faq ?? [];

      // ── Blacklist expéditeurs ─────────────────────────────────────────────
      const blacklistSenders: string[] = Array.isArray(ftIa.blacklist_senders) ? ftIa.blacklist_senders as string[] : [];
      const senderLower = (email.sender ?? "").toLowerCase();
      const isBlacklisted = blacklistSenders.some((entry: string) => {
        const e = entry.trim().toLowerCase();
        return e.length > 0 && senderLower.includes(e);
      });
      if (isBlacklisted) {
        await supabaseAdmin.from("emails").update({
          category: "HORS_SUJET",
          classification_reason: "Expéditeur blacklisté",
          decision: "ignorer",
          estimated_time: 0,
          recommended_action: "archive",
          summary: "Expéditeur ignoré selon les règles de l'agent.",
        }).eq("id", email.id);
        analyzed++;
        console.log(`[BLACKLIST] ${email.sender} → HORS_SUJET`);
        continue;
      }

      const multiplicateur = ftLocatif.multiplicateur ?? 3;
      const agenceName = ftAgence.name ?? "l'agence";
      const zones = ftIa.zones ?? "";
      const loyerMoyen = ftIa.loyer_moyen ?? "";
      const instructions = ftIa.instructions ?? "";

      const docsRequired = Object.entries(ftLocatif.docs ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => ({ fiches_paie: "fiches de paie", contrat: "contrat de travail", avis_imposition: "avis d'imposition", piece_identite: "pièce d'identité", rib: "RIB" }[k] ?? k));

      const agencyContext = [
        `Agence : ${agenceName}`,
        zones ? `Zones gérées : ${zones}` : "",
        loyerMoyen ? `Loyer moyen du parc : ${loyerMoyen}€` : "",
        `Critère solvabilité : revenus ≥ ${multiplicateur}x le loyer`,
        docsRequired.length > 0 ? `Documents requis : ${docsRequired.join(", ")}` : "",
        instructions ? `Instructions spéciales : ${instructions}` : "",
        ftFaq.length > 0 ? `FAQ agence (${ftFaq.length} entrées disponibles)` : "",
      ].filter(Boolean).join("\n");

      const classificationPrompt = `Tu es l'IA d'une agence immobilière française. Analyse cet email entrant et retourne UNIQUEMENT un JSON valide (sans markdown, sans texte autour) :

CONTEXTE DE L'AGENCE :
${agencyContext}


{
  "summary": "1 phrase max en français, très concrète sur ce que veut l'expéditeur",
  "intention": "LOCATION" | "INFO" | "HORS_SUJET",
  "decision": "TRAITER" | "DELEGUER" | "IGNORER",
  "priority": "URGENT" | "IMPORTANT" | "NORMAL",
  "estimated_time": 2 | 5 | 15,
  "recommended_action": "reply" | "archive" | "task",
  "is_rdv_confirmation": true | false,
  "confirmed_datetime": "YYYY-MM-DDTHH:MM:SS" | null
}

RÈGLES STRICTES pour "intention" — LIRE ATTENTIVEMENT :

⚡ RÈGLE PRIORITAIRE (override) : si le SUJET contient l'un de ces mots : T1, T2, T3, T4, appartement, visite, location, loyer, logement, chambre, studio, locataire, quittance → classifier "LOCATION" IMMÉDIATEMENT, SAUF si l'expéditeur est clairement automatisé (noreply, no-reply, donotreply, newsletter dans l'adresse).
ATTENTION : "agency" ou "agence" dans l'adresse email n'est PAS un expéditeur automatisé — c'est souvent un particulier ou une petite agence qui écrit manuellement.

"LOCATION" si :
- Le sujet OU le corps mentionne EXPLICITEMENT un mot immobilier : louer, location, appartement, logement, visite, loyer, locataire, bail, T1, T2, T3, chambre, studio, surface, m², charges, caution, candidature, dossier locataire, propriétaire, quittance
- ET l'expéditeur n'est PAS clairement automatisé (noreply / no-reply / donotreply / newsletter dans l'adresse)

"HORS_SUJET" si UNE de ces conditions est vraie :
- L'expéditeur contient : no-reply, noreply, donotreply, newsletter, marketing, promo, notification (dans l'ADRESSE email, pas le nom affiché)
- L'expéditeur vient de : HelloFresh, Netflix, Revolut, Meta, Facebook, LinkedIn, Twitter, Amazon, PayPal, Stripe, crypto, fintech
- Le sujet ou corps contient : offre spéciale, promotion, découvrez, gagnez, gratuit, abonnement, commande, facture, reçu de paiement, bitcoin, crypto, investissement, trading
- Le corps ou sujet contient : désabonner, unsubscribe, se désinscrire, vous avez été invité, mise à jour de votre compte, confirmez votre email
- C'est un email transactionnel automatique (confirmation de commande, récapitulatif, etc.)

"INFO" : question générale sur l'agence, les conditions, les prix.

EN CAS DE DOUTE entre LOCATION et HORS_SUJET → si sujet contient mot immobilier → LOCATION, sinon HORS_SUJET.
EN CAS DE DOUTE entre LOCATION et INFO → choisir INFO.
JAMAIS classifier HORS_SUJET un email dont le sujet contient T1, T2, T3, appartement, visite, location, loyer.

RÈGLES pour "decision" :
- "TRAITER" si LOCATION ou INFO nécessitant une réponse
- "IGNORER" si HORS_SUJET
- "DELEGUER" si à transférer

RÈGLES confirmation RDV (is_rdv_confirmation = true) :
- Sujet commence par "Re:" ET le prospect confirme un créneau
- Mots clés : "je confirme", "c'est parfait", "d'accord pour", "je serai là", "convient", "oui pour le"

Expéditeur: ${email.sender}
Sujet: ${email.subject}
Contenu: ${content}

IMPORTANT : réponds UNIQUEMENT avec le JSON, rien d'autre.`;

      // ── 1er appel IA : classification ─────────────────────────────────────
      let raw = "";
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: classificationPrompt }],
          temperature: 0,
        });
        raw = completion.choices[0]?.message?.content || "";
      } catch (e) {
        raw = "";
      }

      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        const fb = fallbackDecision(email);
        await supabaseAdmin.from("emails").update({
          summary: "Analyse automatique incomplète — classé par règles de secours.",
          decision: fb.decision as any,
          estimated_time: fb.decision === "ignorer" ? 0 : 5,
          recommended_action: fb.decision === "ignorer" ? "archive" : "reply",
          is_urgent: fb.is_urgent,
          is_important: fb.is_important,
          category: guessCategory(email),
          classification_reason: "Fallback : réponse IA non exploitable (JSON).",
        }).eq("id", email.id);
        analyzed++;
        continue;
      }

      let result: any = null;
      try { result = JSON.parse(match[0]); } catch { result = null; }

      if (!result) {
        const fb = fallbackDecision(email);
        await supabaseAdmin.from("emails").update({
          summary: "Analyse automatique incomplète — classé par règles de secours.",
          decision: fb.decision as any,
          estimated_time: fb.decision === "ignorer" ? 0 : 5,
          recommended_action: fb.decision === "ignorer" ? "archive" : "reply",
          is_urgent: fb.is_urgent,
          is_important: fb.is_important,
          category: guessCategory(email),
          classification_reason: "Fallback : JSON IA non parsable.",
        }).eq("id", email.id);
        analyzed++;
        continue;
      }

      const decisionMap: any = { TRAITER: "traiter", IGNORER: "ignorer", DELEGUER: "planifier" };
      const actionMap: any = { reply: "reply", archive: "archive", task: "schedule", schedule: "schedule" };
      const intentionMap: Record<string, string> = { LOCATION: "LOCATION", INFO: "INFO", HORS_SUJET: "HORS_SUJET" };

      // ── Détection confirmation RDV + création Calendar ────────────────────
      let classificationReason = "Analyse automatique par l'IA";
      let rdvConfirmed = false;

      if (result.is_rdv_confirmation === true && (result.confirmed_datetime || detectConfirmation((email as any).body || ""))) {
        rdvConfirmed = true;
        classificationReason = "RDV_CONFIRMÉ";
        try {
          const accessToken = await getValidGoogleAccessToken(email.user_id);
          // BLOC 2 FIX : corriger le jour via nom de jour français dans l'email
          const emailBodyText = (email as any).body || (email as any).subject || "";
          const startDate = fixConfirmedDatetime(result.confirmed_datetime ?? null, emailBodyText);
          const start = startDate ?? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // fallback: +2 jours
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          console.log(`[CALENDAR] RDV créé pour ${email.sender}: ${start.toISOString()} (depuis body: "${emailBodyText.substring(0,100)}"`);
          await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              summary: `Visite confirmée — ${email.sender?.split("@")[0] || "Prospect"}`,
              description: `Confirmation automatique FixTime.\nEmail: ${email.subject}\nExpéditeur: ${email.sender}`,
              start: { dateTime: start.toISOString(), timeZone: "Europe/Paris" },
              end: { dateTime: end.toISOString(), timeZone: "Europe/Paris" },
            }),
          });
        } catch (calErr) {
          console.error("RDV_CALENDAR_CREATE_ERROR", calErr);
        }
      }

      // ── Thread multi-tours ────────────────────────────────────────────────
      let threadProspectData: Record<string, unknown> | null = null;
      let isFollowUp = false;

      if ((email as any).thread_id) {
        try {
          const { data: threadEmails } = await supabaseAdmin
            .from("emails")
            .select("id, prospect_data, received_at")
            .eq("user_id", email.user_id)
            .eq("thread_id", (email as any).thread_id)
            .neq("id", email.id)
            .not("prospect_data", "is", null)
            .order("received_at", { ascending: true });

          if (threadEmails && threadEmails.length > 0) {
            isFollowUp = true;
            let accumulated: Record<string, unknown> = {};
            for (const t of threadEmails) {
              accumulated = mergeProspect(accumulated, t.prospect_data as Record<string, unknown>);
            }
            threadProspectData = accumulated;
            console.log(`[ANALYZE-INBOX] ↩️ Thread ${(email as any).thread_id} — ${threadEmails.length} email(s) précédent(s) fusionnés, etape_courante=${accumulated.etape_process ?? "NEW"}`);
          }
        } catch (e) {
          console.warn("[ANALYZE-INBOX] Thread check échoué:", e);
        }
      }

      // ── BLOC 1 OVERRIDE : forcer LOCATION si PJ ou mots-clés document ──────
      // RÈGLE ABSOLUE : avant toute classification finale, si email porte des
      // pièces jointes physiques OU des mots-clés d'envoi de documents, on force
      // category=LOCATION + etape=DOSSIER_RECU, quelle que soit l'intention IA.
      {
        const docForcedKeywords = [
          "ci-joint", "ci joint", "en pièce jointe", "en pj",
          "voici ma", "voici mon", "voici mes", "voici le dossier",
          "pièce d'identité", "carte d'identité", "carte nationale d'identité", "CNI",
          "fiche de paie", "fiches de paie", "bulletin de salaire", "bulletin de paie",
          "contrat de travail", "contrat cdi", "contrat cdd",
          "avis d'imposition", "avis fiscal", "déclaration fiscale",
          "mes documents", "mon dossier", "le dossier",
          "vous trouverez", "je vous envoie", "je vous joins", "je joins",
          "j'envoie", "j'ai joint", "en annexe", "je vous transmets",
          "je vous adresse", "je vous fais parvenir", "je vous fais suivre",
          "pièces jointes", "documents joints", "scan", "justificatif",
        ];
        const bodyLower = content.toLowerCase();
        const emailHasPhysicalAtts = ((email as any).attachments as any[] ?? []).length > 0;
        const emailHasDocKeywords = docForcedKeywords.some(k => bodyLower.includes(k.toLowerCase()));

        if ((emailHasPhysicalAtts || emailHasDocKeywords) && result.intention !== "LOCATION") {
          console.log(`[ANALYZE-INBOX][BLOC1-OVERRIDE] Forçage LOCATION: physicalAtts=${emailHasPhysicalAtts} docKeywords=${emailHasDocKeywords} | intention originale=${result.intention}`);
          result.intention = "LOCATION";
          result.decision = "TRAITER";
          result.priority = "IMPORTANT";
          if (!classificationReason.includes("RDV")) {
            classificationReason = emailHasPhysicalAtts
              ? "Reclassifié LOCATION — pièces jointes physiques détectées"
              : "Reclassifié LOCATION — mots-clés envoi de documents détectés";
          }
        }

        // Thread link : si l'email appartient à un thread avec un email LOCATION,
        // et que threadProspectData est null, chercher le prospect_data du thread LOCATION
        if (!threadProspectData && (email as any).thread_id) {
          try {
            const { data: locationThreadEmails } = await supabaseAdmin
              .from("emails")
              .select("id, prospect_data, received_at")
              .eq("user_id", email.user_id)
              .eq("thread_id", (email as any).thread_id)
              .eq("category", "LOCATION")
              .neq("id", email.id)
              .not("prospect_data", "is", null)
              .order("received_at", { ascending: true });

            if (locationThreadEmails && locationThreadEmails.length > 0) {
              let accumulated: Record<string, unknown> = {};
              for (const t of locationThreadEmails) {
                accumulated = mergeProspect(accumulated, t.prospect_data as Record<string, unknown>);
              }
              threadProspectData = accumulated;
              isFollowUp = true;
              console.log(`[ANALYZE-INBOX][BLOC1-OVERRIDE] Thread LOCATION trouvé: ${locationThreadEmails.length} email(s), etape=${accumulated.etape_process ?? "NEW"}`);
            }
          } catch (e) {
            console.warn("[ANALYZE-INBOX][BLOC1-OVERRIDE] Thread LOCATION check échoué:", e);
          }
        }
      }

      // ── Extraction IA données prospect (LOCATION uniquement) ─────────────
      let prospectData: Record<string, unknown> | null = null;
      let matchedPropertyId: string | null = null; // BLOC 3
      const isLocationEmail = (intentionMap[result.intention] ?? "INFO") === "LOCATION";
      // BLOC 4 : déclaré ici pour être accessible dans le bloc timeline (hors if isLocationEmail)
      let physicalAttachments = false;

      if (isLocationEmail && content && content.length > 10) {
        try {
          // BLOC 1 FIX : response_format json_object + system/user split
          const extractionCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `Tu es un assistant immobilier français. Extrais les infos du candidat.
Réponds UNIQUEMENT en JSON valide. Si absent → null. Jamais d'explication.`,
              },
              {
                role: "user",
                content: `Email:
"${content.slice(0, 3000)}"

RÈGLES STRICTES :
- nom_prenom : prénom + nom complet du candidat (signature, "je m'appelle X", "je suis X", "Cordialement, X", "Bien à vous, X"). JAMAIS une adresse email.
- telephone : numéro FR format 06, 07, +336, +337, 0033 — extraire tel quel sans transformation. null si absent.
- situation_pro : "CDI"|"CDD"|"AUTO_ENTREPRENEUR"|"ETUDIANT"|"RETRAITE"|null — chercher : "en CDI", "contrat CDI", "salarié", "auto-entrepreneur", "freelance", "étudiant", "université", "retraité".
- revenus_mensuels : salaire NET mensuel en € que GAGNE le candidat. Chercher : "je gagne X€", "salaire de X€", "revenus de X€", "X€ net/mois", "X€/mois", "X€ par mois", "X net mensuel". JAMAIS confondre avec le loyer demandé. null si absent.
- animaux : true si oui, false si non, null si non mentionné
- nb_personnes : nombre total de personnes dans le foyer (incluant le candidat), number|null
- garant : "OUI"|"NON"|"A_CONFIRMER"|null — chercher : "garant", "caution solidaire", "se porter garant"
- date_entree_souhaitee : date d'entrée souhaitée. Format ISO YYYY-MM-DD si date précise, sinon texte brut ("début juin", "au plus tôt", etc.), null si non mentionné

JSON attendu (TOUS les champs, null si absent) :
{
  "nom_prenom": string|null,
  "telephone": string|null,
  "situation_pro": "CDI"|"CDD"|"AUTO_ENTREPRENEUR"|"ETUDIANT"|"RETRAITE"|null,
  "revenus_mensuels": number|null,
  "animaux": boolean|null,
  "nb_personnes": number|null,
  "garant": "OUI"|"NON"|"A_CONFIRMER"|null,
  "date_entree_souhaitee": string|null
}`,
              },
            ],
          });

          const extractionRaw = extractionCompletion.choices[0]?.message?.content || "";
          console.log(`[BLOC1 EXTRACTION] emailId=${email.id} raw=${extractionRaw.slice(0, 200)}`);

          const extractionMatch = extractionRaw.match(/\{[\s\S]*\}/);
          if (extractionMatch) {
            const parsed = JSON.parse(extractionMatch[0]);
            // Normaliser nom_prenom → nom
            if (!parsed.nom && parsed.nom_prenom) parsed.nom = parsed.nom_prenom;
            delete parsed.nom_prenom;
            // Normaliser animaux boolean → "OUI"/"NON"
            if (typeof parsed.animaux === "boolean") {
              parsed.animaux = parsed.animaux ? "OUI" : "NON";
            }
            delete parsed.date_emmenagement;
            prospectData = parsed;
            console.log(`[BLOC1 EXTRACTION] Résultat OK: nom=${parsed.nom} tel=${parsed.telephone} situation=${parsed.situation_pro} revenus=${parsed.revenus_mensuels} loyer=${parsed.loyer_max} date_entree=${parsed.date_entree_souhaitee}`);
          }
        } catch (e) {
          console.warn("[ANALYZE-INBOX] Extraction prospect échouée:", e);
        }

        // Merge thread cumulatif
        if (isFollowUp && threadProspectData) {
          prospectData = mergeProspect(threadProspectData, prospectData);
          console.log(`[ANALYZE-INBOX] ↩️ Merge thread OK: ${JSON.stringify(prospectData)}`);
        }

        // Consolidation même expéditeur (cross-thread) : récupérer prospect_data d'emails précédents du même sender
        {
          const senderEmail = extractEmailAddress(email.sender);
          if (senderEmail) {
            try {
              const { data: senderEmails } = await supabaseAdmin
                .from("emails")
                .select("prospect_data, received_at")
                .eq("user_id", email.user_id)
                .ilike("sender", `%${senderEmail}%`)
                .eq("category", "LOCATION")
                .neq("id", email.id)
                .not("prospect_data", "is", null)
                .order("received_at", { ascending: true })
                .limit(10);

              if (senderEmails && senderEmails.length > 0) {
                let senderAccumulated: Record<string, unknown> = {};
                for (const se of senderEmails) {
                  senderAccumulated = mergeProspect(senderAccumulated, se.prospect_data as Record<string, unknown>);
                }
                // Merge : données expéditeur en base = base, extraction actuelle = incoming
                prospectData = mergeProspect(senderAccumulated, prospectData);
                console.log(`[ANALYZE-INBOX] ↩️ Merge same-sender (${senderEmail}): ${senderEmails.length} email(s) précédent(s) consolidés`);
              }
            } catch (e) {
              console.warn("[ANALYZE-INBOX] Same-sender merge échoué:", e);
            }
          }
        }

        // ── DÉTECTION ÉTAPE PROCESS ────────────────────────────────────────
        const situation = (() => {
          if (prospectData?.situation_pro) {
            const spMap: Record<string, string> = { CDI: "cdi", CDD: "cdd", AUTO_ENTREPRENEUR: "auto", ETUDIANT: "etudiant", RETRAITE: "retraite" };
            return spMap[String(prospectData.situation_pro)] ?? null;
          }
          const bl = content.toLowerCase();
          if (bl.includes("étudiant") || bl.includes("université")) return "etudiant";
          if (bl.includes("cdi")) return "cdi";
          if (bl.includes("cdd")) return "cdd";
          if (bl.includes("auto-entrepreneur") || bl.includes("freelance")) return "auto";
          if (bl.includes("retraité")) return "retraite";
          return null;
        })();

        // ── BLOC 3 : Matching propriété ──────────────────────────────────────
        const userProperties = await getUserProperties(email.user_id);
        // Filtrer uniquement les biens actifs (available !== false)
        const activeProperties = userProperties.filter((p: any) => p.available !== false);
        const propertyMatch = matchPropertyFromEmail(content, email.subject ?? null, activeProperties);
        let matchedPropertyId: string | null = null;
        let matchedRent: number | null = null;

        if (propertyMatch) {
          matchedPropertyId = propertyMatch.propertyId;
          matchedRent = propertyMatch.rent;
          console.log(`[BLOC3] Bien matché: ${matchedPropertyId} (loyer: ${matchedRent}€)`);
        } else if (activeProperties.length === 0) {
          console.log(`[BLOC3] Aucun bien actif configuré pour user ${email.user_id}`);
        } else if (activeProperties.length > 1) {
          // Plusieurs biens, aucun match → note pour l'autopilote
          console.log(`[BLOC3] ${activeProperties.length} biens actifs, aucun match précis`);
          if (!prospectData) prospectData = {};
          prospectData.plusieurs_biens_disponibles = true;
          prospectData.biens_disponibles = activeProperties.map((p) => `${p.title}${p.address ? ` (${p.address})` : ""} — ${p.rent}€/mois`);
        }

        const revenus = (prospectData?.revenus_mensuels as number | null) ?? null;
        // Priorité : loyer du bien matché > loyer extrait par l'IA de l'email
        const loyer = matchedRent ?? (prospectData?.loyer_max as number | null) ?? null;
        const currentEtape = (prospectData?.etape_process as string | null) ?? (threadProspectData?.etape_process as string | null) ?? null;
        // BLOC 4 : PJ physiques OU mention textuelle d'envoi de documents
        physicalAttachments = ((email as any).attachments as any[] ?? []).length > 0;
        const docSentKeywords = [
          "ci-joint", "ci joint", "en pièce jointe", "pièce jointe", "pièces jointes", "en pj",
          "voici ma", "voici mon", "voici mes", "voici le dossier",
          "pièce d'identité", "carte d'identité", "carte nationale", "CNI",
          "fiche de paie", "fiches de paie", "bulletin de salaire", "bulletin de paie",
          "contrat de travail", "contrat cdi", "contrat cdd",
          "avis d'imposition", "avis fiscal",
          "vous trouverez", "je vous envoie", "je vous joins", "je joins",
          "j'envoie", "j'ai joint", "en annexe", "vous faire parvenir",
          "je vous transmets", "je vous fais parvenir", "je vous adresse",
          "mes documents", "mon dossier", "le dossier", "documents joints",
          "scan", "justificatif", "je vous fais suivre",
        ];
        const textMentionsDocsSent = docSentKeywords.some(k => content.toLowerCase().includes(k));
        const hasAttachments = physicalAttachments || textMentionsDocsSent;
        if (physicalAttachments) console.log(`[ANALYZE-INBOX][PJ] ${physicalAttachments ? "PJ physiques" : ""} | Texte envoi docs: ${textMentionsDocsSent} → hasAttachments=${hasAttachments}`);

        const newEtape = detectEtapeProcess({
          hasAttachments,
          rdvConfirmed,
          isFollowUp,
          bodyText: content,
          situation,
          revenus,
          loyer,
          multiplicateur,
          currentEtape,
        });

        console.log(`[ANALYZE-INBOX] etape_process: ${currentEtape ?? "null"} → ${newEtape} | situation=${situation} revenus=${revenus} loyer=${loyer}`);

        if (!prospectData) prospectData = {};
        prospectData.etape_process = newEtape;

        // Log ETAPE_CHANGE si l'étape a réellement changé
        if (newEtape && newEtape !== currentEtape) {
          void supabaseAdmin.from("prospect_timeline").insert({
            user_id: email.user_id,
            email_id: email.id,
            action_type: "ETAPE_CHANGE",
            description: `Transition : ${currentEtape ?? "NEW"} → ${newEtape}`,
            metadata: { from: currentEtape ?? "NEW", to: newEtape },
          });
        }
      }

      // ── BLOC 2F : Résumé IA enrichi pour les emails LOCATION ─────────────
      function buildEnrichedSummary(): string | null {
        if (!isLocationEmail) return typeof result.summary === "string" ? result.summary : null;
        if (rdvConfirmed) return `✅ RDV de visite confirmé par ${email.sender?.split("@")[0] || "le prospect"}`;

        const parts: string[] = [];
        const pd = prospectData ?? {};

        // Nom prospect
        const nom = (pd.nom_prenom as string) || (pd.nom as string) || null;
        if (nom) parts.push(nom);

        // Situation professionnelle
        const sit = (pd.situation_pro as string) || null;
        if (sit) parts.push(sit);

        // Revenus + loyer + ratio
        const rev = parseFloat(String(pd.revenus ?? "")) || null;
        const loy = parseFloat(String(pd.loyer ?? "")) || null;
        if (rev && loy && loy > 0) {
          const ratio = (rev / loy).toFixed(1);
          parts.push(`${rev.toLocaleString("fr-FR")}€/mois — loyer ${loy.toLocaleString("fr-FR")}€ — Ratio ${ratio}x`);
        } else if (rev) {
          parts.push(`${rev.toLocaleString("fr-FR")}€/mois`);
        }

        // Étape
        const etapeLabelMap: Record<string, string> = {
          NEW: "Nouveau",
          QUALIFICATION: "En qualification",
          VISITE_PROPOSEE: "Visite proposée",
          VISITE_CONFIRMEE: "Visite confirmée",
          DOSSIER_DEMANDE: "Dossier demandé",
          DOSSIER_RECU: "Dossier reçu",
          VALIDE: "Validé",
          REFUSE: "Refusé",
        };
        const etapeLabel = etapeLabelMap[(pd.etape_process as string) ?? ""] ?? null;
        if (etapeLabel && etapeLabel !== "Nouveau") parts.push(etapeLabel);

        // Fallback: résumé IA si pas assez d'infos
        if (parts.length === 0) {
          return isFollowUp
            ? `↩️ Réponse — ${typeof result.summary === "string" ? result.summary : "nouvelles informations"}`
            : typeof result.summary === "string" ? result.summary : null;
        }

        const prefix = isFollowUp ? "↩️ " : "";
        return prefix + parts.join(" — ");
      }

      // ── Mise à jour DB principale ─────────────────────────────────────────
      const mainUpdate: Record<string, unknown> = {
        summary: buildEnrichedSummary(),
        decision: decisionMap[result.decision] ?? "traiter",
        estimated_time: result.estimated_time ?? 5,
        recommended_action: actionMap[result.recommended_action] ?? "reply",
        // BLOC 1 : emails reclassifiés LOCATION par doc override → score ≥ 8 (is_important)
        is_urgent: result.priority === "URGENT",
        is_important: rdvConfirmed ? true : result.priority === "IMPORTANT" ||
          (isLocationEmail && classificationReason.includes("Reclassifié LOCATION")),
        category: intentionMap[result.intention] ?? "INFO",
        classification_reason: classificationReason,
      };

      // Merge DB non-destructif pour les champs normaux + avancement pour etape_process
      // Fetch existing email once for prospect_data merge + property_id check
      const { data: existingEmail } = await supabaseAdmin
        .from("emails")
        .select("prospect_data, property_id")
        .eq("id", email.id)
        .maybeSingle();

      if (prospectData) {
        const existing = ((existingEmail as any)?.prospect_data as Record<string, unknown> | null) ?? {};
        const mergedFinal = mergeProspect(existing, prospectData);
        (mainUpdate as any).prospect_data = mergedFinal;
      }

      // BLOC 3 : Mettre à jour property_id si non déjà renseigné (indépendant de prospectData)
      if (matchedPropertyId && !(existingEmail as any)?.property_id) {
        (mainUpdate as any).property_id = matchedPropertyId;
        console.log(`[BLOC3] property_id assigné: ${matchedPropertyId}`);
      }

      try {
        await supabaseAdmin.from("emails").update(mainUpdate).eq("id", email.id);
      } catch {
        delete (mainUpdate as any).prospect_data;
        await supabaseAdmin.from("emails").update(mainUpdate).eq("id", email.id);
      }

      // ── BLOC 3 : Logs timeline automatiques ──────────────────────────────
      // On wrappe en try/catch pour ne pas bloquer l'analyse si la table n'existe pas encore
      try {
        const category = intentionMap[result.intention] ?? "INFO";

        // EMAIL_RECU — pour les emails LOCATION seulement
        if (category === "LOCATION") {
          // Vérifier si l'entrée EMAIL_RECU existe déjà
          const { count } = await supabaseAdmin
            .from("prospect_timeline")
            .select("id", { count: "exact", head: true })
            .eq("email_id", email.id)
            .eq("action_type", "EMAIL_RECU");

          if (!count || count === 0) {
            await supabaseAdmin.from("prospect_timeline").insert({
              user_id: email.user_id,
              email_id: email.id,
              action_type: "EMAIL_RECU",
              description: `Email reçu de ${email.sender?.replace(/<.*>/, "").trim() ?? "inconnu"}`,
              created_at: email.received_at ?? new Date().toISOString(),
            });
          }

          // DOCUMENT_RECU — si PJ physiques détectées
          if (physicalAttachments) {
            const attList = ((email as any).attachments as any[] ?? []).map((a: any) => a.filename).join(", ");
            await supabaseAdmin.from("prospect_timeline").insert({
              user_id: email.user_id,
              email_id: email.id,
              action_type: "DOCUMENT_RECU",
              description: `Document(s) reçu(s) : ${attList || "fichier joint"}`,
            });
          }

          // VISITE_CONFIRMEE — si visite détectée
          if (rdvConfirmed) {
            await supabaseAdmin.from("prospect_timeline").insert({
              user_id: email.user_id,
              email_id: email.id,
              action_type: "VISITE_CONFIRMEE",
              description: "Visite confirmée par le prospect",
            });
          }
        }
      } catch (timelineErr: any) {
        // Table prospect_timeline peut ne pas exister encore → ignorer silencieusement
        if (!timelineErr?.message?.includes("does not exist")) {
          console.warn("[ANALYZE-INBOX][TIMELINE] Erreur log:", timelineErr?.message);
        }
      }

      // ── AUTOPILOTE ────────────────────────────────────────────────────────
      const pipelineMode = (settings?.email_rules as any)?.pipeline_mode ?? "DRAFT";
      const emailRules = (settings as any)?.email_rules ?? {};
      const intention = intentionMap[result.intention] ?? "INFO";

      if (pipelineMode === "AUTOPILOTE" && !rdvConfirmed && email.gmail_message_id) {
        try {
          const accessToken = await getValidGoogleAccessToken(email.user_id);
          let autoReply: string | null = null;

          if (intention === "HORS_SUJET") {
            await supabaseAdmin.from("emails").update({ is_archived: true }).eq("id", email.id);
          } else if (intention === "INFO") {
            const faq: { question: string; reponse: string }[] = emailRules.ft_faq ?? [];
            const faqText = faq.length > 0
              ? faq.map((f) => `Q: ${f.question}\nR: ${f.reponse}`).join("\n\n")
              : "Contactez-nous directement pour plus d'informations.";
            const faqCompletion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: `Tu es l'assistant d'une agence immobilière. Réponds à cet email en te basant sur la FAQ ci-dessous.\n\nFAQ:\n${faqText}\n\nEmail de: ${email.sender}\nSujet: ${email.subject}\nContenu: ${email.body ?? ""}` }],
              temperature: 0.3,
            });
            autoReply = faqCompletion.choices[0]?.message?.content ?? null;
          } else if (intention === "LOCATION" && prospectData) {
            // ── Logique par étape (BLOC 2) ────────────────────────────────
            const locatif = emailRules.ft_locatif ?? {};
            const docsSection = emailRules.ft_documents ?? {};
            const calSection = emailRules.ft_calendrier ?? {};
            const nomAgence = locatif.nomAgence ?? "l'agence";
            const mult = locatif.multiplicateur ?? 3;
            const garantObligatoire = locatif.garantObligatoire ?? { cdd: true, auto: true, etudiant: true, retraite: false };
            const heureDebut = calSection.heureDebut ?? 9;
            const heureFin = calSection.heureFin ?? 18;
            const dureeVisite = calSection.dureeVisite ?? 60;
            const docsProfiles: Record<string, string[]> = {
              cdi:     (docsSection.cdi     as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
              cdd:     (docsSection.cdd     as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail (durée + date de fin)", "Avis d'imposition", "Pièce d'identité"],
              etudiant:(docsSection.etudiant as string[]) ?? ["Carte étudiante", "Certificat de scolarité", "Justificatif de garant", "Pièce d'identité"],
              auto:    (docsSection.auto    as string[]) ?? ["Extrait Kbis", "Bilans comptables (2 dernières années)", "Avis d'imposition", "Pièce d'identité"],
              retraite:(docsSection.retraite as string[]) ?? ["Relevés de pension (3 derniers mois)", "Avis d'imposition", "Pièce d'identité"],
            };

            const etapeActuelle = (prospectData.etape_process as string) ?? "NEW";
            const nom = (prospectData.nom as string | null) ?? "Madame, Monsieur";
            const situationPro = prospectData.situation_pro as string | null;
            const revenus = (prospectData.revenus_mensuels as number | null) ?? null;
            const loyer = (prospectData.loyer_max as number | null) ?? null;

            const spMap: Record<string, string> = { CDI: "cdi", CDD: "cdd", AUTO_ENTREPRENEUR: "auto", ETUDIANT: "etudiant", RETRAITE: "retraite" };
            const situation = situationPro ? (spMap[situationPro] ?? null) : null;
            const ratio = revenus && loyer ? (revenus / loyer).toFixed(1) : null;
            const sig = `Cordialement, L'équipe ${nomAgence}`;

            let autopilotePrompt = "";

            // BLOC 3 : Si plusieurs biens et aucun match → demander lequel intéresse
            const pluralBiens = (prospectData.plusieurs_biens_disponibles as boolean | undefined) === true;
            const biensList = (prospectData.biens_disponibles as string[] | undefined) ?? [];

            if (pluralBiens && biensList.length > 1 && etapeActuelle !== "VISITE_CONFIRMEE" && etapeActuelle !== "DOSSIER_DEMANDE" && etapeActuelle !== "DOSSIER_RECU") {
              autopilotePrompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige un email court pour ${nom}.
- Remercier pour l'intérêt
- Indiquer que vous avez plusieurs biens disponibles
- Demander lequel les intéresse, en listant les biens :
${biensList.map((b, i) => `  ${i + 1}. ${b}`).join("\n")}
- Ton : chaleureux, professionnel
- Signature : ${sig}
Email reçu : Expéditeur: ${email.sender}, Sujet: ${email.subject}`;
            } else if (etapeActuelle === "DOSSIER_RECU") {
              // Étape 3 : accusé réception documents
              autopilotePrompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige un email bref pour accuser réception du dossier de ${nom}.
- Remercier chaleureusement pour l'envoi des pièces jointes
- Confirmer la bonne réception du dossier complet
- Indiquer qu'un retour sera communiqué rapidement
- Signature : ${sig}
Email reçu : Expéditeur: ${email.sender}, Sujet: ${email.subject}`;

            } else if (etapeActuelle === "VISITE_CONFIRMEE") {
              // Étape 2 : confirmation reçue, on confirme + préparer pour visite
              autopilotePrompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige un email de confirmation de visite pour ${nom}.
- Confirmer chaleureusement la visite (date/heure depuis l'email reçu)
- Mentionner qu'un retour sera communiqué après la visite
- Signature : ${sig}
Email reçu : Expéditeur: ${email.sender}, Sujet: ${email.subject}, Contenu: ${email.body ?? ""}`;

            } else if (etapeActuelle === "VISITE_PROPOSEE" && situation === "etudiant") {
              // Étudiant : proposer visite + garant obligatoire, PAS de docs
              const needsGarant = garantObligatoire["etudiant"] !== false;
              autopilotePrompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige un email pour ${nom} (étudiant).
- Remercier pour l'intérêt
- Expliquer qu'un garant est ${needsGarant ? "obligatoire" : "recommandé"} (revenus ≥ ${mult}x le loyer)
- Si l'email mentionne un garant : proposer 3 créneaux de visite (jours ouvrés ${heureDebut}h-${heureFin}h, durée ${dureeVisite}min)
- Si pas de garant mentionné : demander si un garant est disponible
- NE PAS demander de documents à ce stade
- Signature : ${sig}
Email reçu : Expéditeur: ${email.sender}, Sujet: ${email.subject}, Contenu: ${email.body ?? ""}`;

            } else if (etapeActuelle === "VISITE_PROPOSEE") {
              // Solvable : proposer visite, PAS de docs
              autopilotePrompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige un email enthousiaste pour ${nom} (profil solvable, ratio ${ratio ?? "bon"}x).
- Confirmer que le profil correspond aux critères
- Proposer 3 créneaux de visite concrets (jours ouvrés à court terme, entre ${heureDebut}h et ${heureFin}h, durée ${dureeVisite}min)
- Demander de confirmer un créneau
- NE PAS demander de documents — ils seront demandés après la visite
- Signature : ${sig}
Email reçu : Expéditeur: ${email.sender}, Sujet: ${email.subject}, Contenu: ${email.body ?? ""}`;

            } else if (etapeActuelle === "REFUSE") {
              // Insolvable
              autopilotePrompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige un email poli pour décliner la candidature de ${nom}.
- Remercier pour sa candidature
- Expliquer poliment que les revenus sont insuffisants (critère: ${mult}x le loyer, ratio actuel: ${ratio ?? "insuffisant"}x)
- Suggérer la possibilité d'un garant solide (revenus ≥ ${mult}x le loyer)
- Signature : ${sig}
Email reçu : Expéditeur: ${email.sender}, Sujet: ${email.subject}, Contenu: ${email.body ?? ""}`;

            } else {
              // QUALIFICATION (infos manquantes) : demander SEULEMENT situation + revenus
              const missing: string[] = [];
              if (!situationPro) missing.push("votre situation professionnelle (CDI, CDD, étudiant, indépendant…)");
              if (!revenus) missing.push("vos revenus nets mensuels (€)");
              autopilotePrompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige un email pour demander les informations manquantes à ${nom}.
- Remercier pour l'intérêt
- Demander uniquement :
${missing.map((m, i) => `${i + 1}. ${m}`).join("\n")}
- NE PAS demander de documents à ce stade
- Rester encourageant
- Signature : ${sig}
Email reçu : Expéditeur: ${email.sender}, Sujet: ${email.subject}, Contenu: ${email.body ?? ""}`;
            }

            const locationCompletion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: autopilotePrompt }],
              temperature: 0.3,
            });
            autoReply = locationCompletion.choices[0]?.message?.content ?? null;
          }

          if (autoReply && email.gmail_message_id) {
            const subjectEncoded = `=?UTF-8?B?${Buffer.from(`Re: ${email.subject ?? ""}`, "utf-8").toString("base64")}?=`;
            const mime = [
              `MIME-Version: 1.0`,
              `To: ${email.sender ?? ""}`,
              `Subject: ${subjectEncoded}`,
              `Content-Type: text/plain; charset=UTF-8`,
              `Content-Transfer-Encoding: base64`,
              ``,
              Buffer.from(autoReply, "utf-8").toString("base64"),
            ].join("\r\n");
            const rawMsg = Buffer.from(mime, "utf-8")
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/, "");

            let threadId: string | undefined;
            try {
              const msgRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.gmail_message_id}?format=minimal`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (msgRes.ok) threadId = (await msgRes.json()).threadId;
            } catch { /* optional */ }

            const payload: any = { raw: rawMsg };
            if (threadId) payload.threadId = threadId;

            await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            await supabaseAdmin.from("emails").update({
              ai_reply: autoReply,
              is_archived: true,
            }).eq("id", email.id);

            // Log timeline IA_REPONDU
            try {
              const etapeForLog = (prospectData?.etape_process as string) ?? "?";
              await supabaseAdmin.from("prospect_timeline").insert({
                user_id: email.user_id,
                email_id: email.id,
                action_type: "IA_REPONDU",
                description: `IA a répondu automatiquement — étape: ${etapeForLog}`,
              });
            } catch { /* silencieux si table manquante */ }
          }
        } catch (autoErr) {
          console.error("AUTOPILOTE_SEND_ERROR", autoErr);
        }
      }

      analyzed++;
      continue; // WARN super important : on ne lance PAS l'analyse IA derriere
    }

    console.log(`[ANALYZE-INBOX] Terminé : ${analyzed} emails classifiés`);
    return NextResponse.json({ success: true, analyzed });
  } catch (err) {
    console.error("ANALYZE_EMAILS_ERROR", err);
    return NextResponse.json({ error: "ANALYZE_EMAILS_FAILED" }, { status: 500 });
  }
}
