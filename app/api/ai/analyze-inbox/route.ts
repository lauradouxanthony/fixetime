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

// --- TS safety helpers (local only) ---
type ParseOk = { ok: true; parsed: Record<string, unknown> };
type ParseErr = { ok: false; error: string; detail?: string };
type ParseResult = ParseOk | ParseErr;

type Analysis = {
  prospect_name?: unknown;
  phone?: unknown;
  property_address?: unknown;
  employment_type?: unknown;
  detected_income?: unknown;
  guarantor_present?: unknown;
  [k: string]: unknown;
};

/* ===================== HELPERS ===================== */

/**
 * Timeout propre avec Promise.race pour OpenAI.
 */
async function withAbortTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("ABORT_TIMEOUT")), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}


/* ===================== AUTH ===================== */

function isInternalCron(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  return key === process.env.FIXETIME_INTERNAL_CRON_KEY;
}

function isManualRequest(req: Request) {
  return !!req.headers.get("cookie");
}

/* ===================== OPENAI ===================== */

function getOpenaiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_KEY_MISSING");
  return new OpenAI({ apiKey: key });
}

const PRIMARY_MODEL = "gpt-4o-mini";
const FALLBACK_MODEL = "gpt-3.5-turbo";
const MAX_OPENAI_ATTEMPTS = 3;
const OPENAI_BACKOFF_MS = [400, 1200];

type OpenAiErrorInfo = {
  status: number | null;
  code: string | null;
  message: string;
  type?: string | null;
  model: string;
};

function extractOpenAiError(e: unknown, model: string): OpenAiErrorInfo {
  const err = e && typeof e === "object" ? e as Record<string, unknown> : {};
  return {
    status: typeof err.status === "number" ? err.status : null,
    code: typeof err.code === "string" ? err.code : null,
    message: String(err.message ?? e ?? "Unknown error"),
    type: typeof err.type === "string" ? err.type : null,
    model,
  };
}

function stripJsonRaw(raw: string): string {
  let s = String(raw ?? "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (m) s = m[1].trim();
  return s;
}

function tryParseJson(raw: string): ParseResult {
  const cleaned = stripJsonRaw(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") return { ok: true, parsed };
    return { ok: false, error: "Parsed value is not an object" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/* ===================== FALLBACK ===================== */

function fallbackDecision(email: {
  subject?: string | null;
  sender?: string | null;
}) {
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

  if (
    sender.includes("newsletter") ||
    sender.includes("linkedin") ||
    sender.includes("no-reply")
  ) {
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

export async function POST(req: Request) {
  const isCron = isInternalCron(req);
  const isManual = isManualRequest(req);
  const isAnalyzeNow = req.headers.get("x-fixetime-analyze-now") === "true";

  let body: any = null;
  try {
    body = await req.json();
  } catch {}

  if (!isCron && !isManual && !isAnalyzeNow) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  /* ===================== USER ===================== */

  let targetUserId: string | null = null;

  if ((isCron || isAnalyzeNow) && body?.user_id) {
    targetUserId = body.user_id;
  }

  if (!targetUserId && isManual) {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NO_USER" }, { status: 401 });
    }

    targetUserId = user.id;
  }

  if (!targetUserId) {
    return NextResponse.json({ error: "NO_TARGET_USER" }, { status: 400 });
  }

  /* ===================== ASSISTANT CHECK ===================== */
  const { data: assistantSettings } = await supabaseAdmin
    .from("settings_v1")
    .select("assistant_enabled")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if ((assistantSettings as any)?.assistant_enabled === false) {
    return NextResponse.json({
      success: true,
      status: "assistant_disabled",
      analyzed: 0,
      remaining: null,
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_KEY_MISSING" }, { status: 500 });
  }

  const openai = getOpenaiClient();
  const isDebugOpenAi = process.env.NODE_ENV === "development" || req.headers.get("x-debug-openai") === "true";

  /* ===================== GLOBAL LOCK (via inbox_state) ===================== */
  const now = new Date();
  const lockUntil = new Date(now.getTime() + 60_000).toISOString();

  // Lire état actuel
  const { data: st, error: stErr } = await supabaseAdmin
    .from("inbox_state")
    .select("analyze_locked_until")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (stErr) {
    console.error("[ANALYZE] Failed to read lock state", stErr);
    return NextResponse.json(
      { error: "LOCK_FAILED", details: stErr.message, analyzed: 0 },
      { status: 500 }
    );
  }

  // Si lock actif → return 200
  if (st?.analyze_locked_until && new Date(st.analyze_locked_until).getTime() > Date.now()) {
    const remainingMs = new Date(st.analyze_locked_until).getTime() - Date.now();
    const remainingSec = Math.ceil(remainingMs / 1000);
    console.log(`[ANALYZE] Locked for user ${targetUserId}, remaining: ${remainingSec}s`);
    return NextResponse.json({
      success: true,
      status: "locked",
      remaining: remainingSec,
      analyzed: 0,
    });
  }

  // Prendre lock (upsert)
  const { error: lockErr } = await supabaseAdmin
    .from("inbox_state")
    .upsert(
      {
        user_id: targetUserId,
        analyze_locked_until: lockUntil,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (lockErr) {
    console.error("[ANALYZE] Failed to acquire lock", lockErr);
    return NextResponse.json(
      { error: "LOCK_FAILED", details: lockErr.message, analyzed: 0 },
      { status: 500 }
    );
  }

  // Libérer le lock en finally
  const releaseLock = async () => {
    await supabaseAdmin
      .from("inbox_state")
      .update({
        analyze_locked_until: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", targetUserId);
  };

  /* ===================== SETTINGS ===================== */

  const { data: settings } = await supabaseAdmin
    .from("settings_v1")
    .select("email_rules, config, assistant_enabled, automation_level")
    .eq("user_id", targetUserId)
    .maybeSingle();

  const rules: any = settings?.email_rules ?? {};
  const automationLevelRun = (settings as any)?.automation_level ?? "draft";
  const configAny = (settings as any)?.config ?? {};
  const snippets: Record<string, string> = {
    property_info_default: configAny?.snippets?.property_info_default ?? "Nous vous recontacterons avec les informations détaillées sur ce bien.",
    admin_default: configAny?.snippets?.admin_default ?? "Votre demande a bien été reçue. L'équipe vous répondra sous 48h.",
    application_status_default: configAny?.snippets?.application_status_default ?? "Votre dossier est en cours d'instruction. Nous vous tiendrons informé.",
    out_of_scope_default: configAny?.snippets?.out_of_scope_default ?? "Votre message ne relève pas de notre compétence directe. Merci de contacter le service concerné.",
    missing_docs: configAny?.snippets?.missing_docs ?? "Merci de nous transmettre les documents suivants pour compléter votre dossier : [liste]. À renvoyer à cette adresse.",
    ineligible_guarantor_option: configAny?.snippets?.ineligible_guarantor_option ?? "Malheureusement votre situation ne permet pas de retenir ce bien au regard de nos critères (loyer × 3). Vous pouvez présenter un garant solide ou nous contacter pour un bien à loyer plus adapté.",
    followup_reminder: configAny?.snippets?.followup_reminder ?? "Nous n'avons pas eu de retour de votre part. Souhaitez-vous toujours organiser une visite ? Répondez à ce mail pour confirmer.",
  };
  const intentPolicies: Record<string, { autopilot_allowed?: boolean; required_fields?: string[] }> = configAny?.intent_policies ?? {};
  const addressPolicy = (configAny?.address_policy === "after_qualification" || configAny?.address_policy === "after_booking" || configAny?.address_policy === "always")
    ? configAny.address_policy
    : "after_booking";
  const followupPolicy = configAny?.followup_policy ?? { enabled: true, d1: true, d3: true };

  /* ===================== DATE RANGE ===================== */

  // Support batch mode avec period, limit, cursor, email_id (analyse ciblée)
  const period = body?.period as "7d" | "30d" | undefined;
  const batchLimit = typeof body?.limit === "number" && body.limit > 0 ? Math.min(body.limit, 50) : undefined;
  const cursor = body?.cursor as string | undefined;
  const force = body?.force === true;
  const singleEmailId = (body?.email_id ?? body?.emailId) as string | undefined;

  let daysBack = 30;
  if (period === "7d") daysBack = 7;
  else if (period === "30d") daysBack = 30;

  const THIRTY_DAYS = daysBack * 24 * 60 * 60 * 1000;
  const sinceISO = new Date(Date.now() - THIRTY_DAYS).toISOString();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const EMAIL_LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes max pour traitement d'un email

  /* ===================== CACHED CONTEXT (1x / run) ===================== */

const { data: agency } = await supabaseAdmin
.from("agency_settings")
.select("rent_multiplier, required_documents, ai_name, ai_tone, visit_rules")
.eq("user_id", targetUserId)
.maybeSingle();

const rentMultiplier = Number(
  configAny?.rental_rules?.income_multiplier ?? agency?.rent_multiplier ?? 3.0
);
const requiredDocs = (
  Array.isArray(configAny?.rental_rules?.required_documents) &&
  configAny.rental_rules.required_documents.length > 0
    ? configAny.rental_rules.required_documents
    : (agency?.required_documents ?? [])
) as string[];
const aiName =
  configAny?.agent_persona?.agent_name ??
  agency?.ai_name ??
  "Julie de l'Immobilier";
const aiTone =
  configAny?.agent_persona?.tone ??
  agency?.ai_tone ??
  "professionnel";
const visitRules = agency?.visit_rules ?? "";

// Biens (top 10) -> 1 seule fois (réduit pour latence minimale)
const { data: props } = await supabaseAdmin
  .from("properties")
  .select("id, name, address, rent")
  .eq("user_id", targetUserId)
  .order("created_at", { ascending: false })
  .limit(10);

const propertiesContext = (props ?? []).map((p: any) => ({
  id: p.id,
  name: p.name,
  address: typeof p.address === "string" ? p.address.slice(0, 80) : p.address,
  rent: p.rent,
}));

// Index properties pour matching robuste (1x par run)
type PropIndex = {
  prop: { id: string; name?: string; address?: string; rent?: number };
  nameTokens: string[];
  addressTokens: string[];
  streetNoNum: string;
  city: string;
  postalCode: string | null;
};
const propertyIndex: PropIndex[] = (propertiesContext ?? []).map((p: any) => {
  const name = String(p.name ?? "");
  const address = String(p.address ?? "");
  const streetPart = address.split(",")[0] || "";
  return {
    prop: p,
    nameTokens: normalizeTokens(name),
    addressTokens: normalizeTokens(address),
    streetNoNum: streetWithoutNumber(streetPart),
    city: extractCity(address),
    postalCode: extractPostalCode(address),
  };
});

function scorePropertyMatch(
  leadText: string,
  index: PropIndex[]
): { best: { prop: any; score: number } | null; candidates: { id: string; name: string; address: string; score: number }[] } {
  const leadTokens = normalizeTokens(leadText);
  const leadTextNorm = removeAccents(leadText.toLowerCase());
  const leadPostal = extractPostalCode(leadText);
  const scores: { prop: any; score: number }[] = [];

  for (const idx of index) {
    let score = 0;

    const nameMatch = idx.nameTokens.some((t) => t.length > 2 && leadTokens.includes(t));
    if (nameMatch) score += 5;
    const streetNorm = idx.streetNoNum;
    if (streetNorm.length > 3 && leadTextNorm.includes(streetNorm)) score += 4;
    if (idx.city.length > 2 && leadTextNorm.includes(idx.city)) score += 3;
    if (idx.postalCode && leadPostal === idx.postalCode) score += 2;
    const rentStr = idx.prop.rent ? String(idx.prop.rent) : "";
    if (rentStr && leadText.match(/\d{3,}/) && leadText.includes(rentStr.slice(0, 4))) score += 1;

    if (score > 0) scores.push({ prop: idx.prop, score });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]?.score >= 6 ? scores[0] : null;
  const candidates = scores.slice(0, 3).map((s) => ({
    id: s.prop.id,
    name: String(s.prop.name ?? ""),
    address: String(s.prop.address ?? ""),
    score: s.score,
  }));
  return { best, candidates };
}

async function matchPropertyForLead(
  userId: string,
  emailId: string
): Promise<{ propertyId: string | null; address: string | null; matchedProp: any | null }> {
  const { data: emailRow } = await supabaseAdmin
    .from("emails")
    .select("lead_json, subject, body")
    .eq("id", emailId)
    .eq("user_id", userId)
    .maybeSingle();

  const lj = (emailRow as any)?.lead_json ?? {};
  const leadText = [lj?.analysis?.property_address ?? "", (emailRow as any)?.subject ?? "", String((emailRow as any)?.body ?? "").slice(0, 800)].join(" ");

  const { data: props } = await supabaseAdmin
    .from("properties")
    .select("id, name, address, rent")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(15);

  const propsCtx = (props ?? []).map((p: any) => ({ id: p.id, name: p.name, address: typeof p.address === "string" ? p.address.slice(0, 80) : p.address, rent: p.rent }));
  const idx: PropIndex[] = propsCtx.map((p: any) => {
    const name = String(p.name ?? "");
    const address = String(p.address ?? "");
    const streetPart = address.split(",")[0] || "";
    return {
      prop: p,
      nameTokens: normalizeTokens(name),
      addressTokens: normalizeTokens(address),
      streetNoNum: streetWithoutNumber(streetPart),
      city: extractCity(address),
      postalCode: extractPostalCode(address),
    };
  });

  const { best } = scorePropertyMatch(leadText, idx);
  const propertyId = best && best.score >= 6 ? best.prop.id : null;
  const address = best && best.score >= 6 ? (best.prop.address ?? null) : null;
  const matchedProp = best && best.score >= 6 ? { id: best.prop.id, name: best.prop.name, address: best.prop.address, rent: best.prop.rent, score: best.score } : null;

  console.log(`[MATCH_PROPERTY] ${emailId} -> ${propertyId ?? "null"}`);
  return { propertyId, address, matchedProp };
}

/* Slots cache -> 1 seule fois si nécessaire */
let cachedSlots30: { start: string; end: string }[] | null = null;

  /* ===================== CORE LOOP ===================== */

  const startedAt = Date.now();
  const isDev = process.env.NODE_ENV === "development";
  const TIME_BUDGET_MS = isAnalyzeNow ? 50000 : 8000; // Manuel: 50s, cron: 8s
  const MAX_PER_RUN = isAnalyzeNow ? 20 : (isDev ? 10 : 10);
  const BATCH_SIZE = 10; // Batch size fixe

  let analyzedTotal = 0;
  let skippedTotal = 0;
  let nextCursor: string | undefined = undefined;
  const skipReasons: { emailId: string; reason: string; step: string }[] = [];
  let debugOpenAiLastError: OpenAiErrorInfo | null = null;
  let debugJsonParseLastOutput: string | null = null;
  let debugJsonParseError: string | null = null;

  console.log(`[ANALYZE] START user=${targetUserId}, MAX_PER_RUN=${MAX_PER_RUN}, TIME_BUDGET_MS=${TIME_BUDGET_MS}`);

  try {

  
  while (
    Date.now() - startedAt < TIME_BUDGET_MS &&
    analyzedTotal < MAX_PER_RUN
  ) {
        // Requete: analyse ciblée (email_id) ou batch
        let query = supabaseAdmin
          .from("emails")
          .select("id, provider, provider_message_id, gmail_message_id, gmail_thread_id, sender, subject, body, received_at, lead_status, lead_json, decision, ai_retry_after, ai_timeout_count, ai_error_count, property_id, lead_property_address")
          .eq("user_id", targetUserId);

        if (singleEmailId) {
          query = query.eq("id", singleEmailId).limit(1);
        } else {
          query = query.gte("received_at", sinceISO);
          if (cursor) query = query.lt("received_at", cursor);
          if (!force) {
            query = query.or("lead_json.is.null,lead_status.is.null,decision.is.null");
          }
          query = query.or("decision.is.null,decision.neq.ignorer");
          const nowISO = new Date().toISOString();
          query = query.or(`ai_retry_after.is.null,ai_retry_after.lte.${nowISO}`);
          query = query.order("received_at", { ascending: false, nullsFirst: false }).limit(BATCH_SIZE);
        }

        const { data: emails, error } = await query;

      if (error || !emails || emails.length === 0) {
        console.log(`[ANALYZE] No more emails to process (error=${!!error}, count=${emails?.length ?? 0})`);
        break;
      }

      console.log(`[ANALYZE] Batch fetched: ${emails.length} emails`);

      // Stocker le cursor pour le prochain batch (dernier received_at)
      if (emails.length > 0 && batchLimit) {
        const lastEmail = emails[emails.length - 1];
        nextCursor = lastEmail.received_at || undefined;
      }

      for (const email of emails as DbEmail[]) {
        // Vérifier timeout global avant chaque email
        if (Date.now() - startedAt >= TIME_BUDGET_MS) {
          console.log(`[ANALYZE] Time budget exceeded, stopping at ${analyzedTotal} analyzed`);
          break;
        }

        // 1) LOCK PAR EMAIL simplifié (anti double-run, 2 min max)
        const leadJson = (email.lead_json as any) ?? {};
        const isProcessing = leadJson.processing === true;
        const processingAt = leadJson.processing_at ? new Date(leadJson.processing_at).getTime() : 0;
        const processingAge = processingAt > 0 ? Date.now() - processingAt : Infinity;

        if (isProcessing && processingAge < EMAIL_LOCK_TIMEOUT_MS) {
          skippedTotal++;
          skipReasons.push({ emailId: email.id, reason: "EMAIL_LOCKED", step: "email_lock_check" });
          continue; // skip: locked < 2 min
        }

        // Acquérir le lock (forcer processing=true même si ancien lock expiré)
        const nowISO = new Date().toISOString();
        const updatedLeadJson = {
          ...leadJson,
          processing: true,
          processing_at: nowISO,
        };
        const { error: lockErr } = await supabaseAdmin
          .from("emails")
          .update({ lead_json: updatedLeadJson })
          .eq("id", email.id);

        if (lockErr) {
          skippedTotal++;
          skipReasons.push({ emailId: email.id, reason: "EMAIL_LOCK_FAILED", step: "email_lock_update" });
          continue;
        }

        // Libérer le lock en finally (même si erreur)
        const releaseEmailLock = async () => {
          const { data: currentEmail } = await supabaseAdmin
            .from("emails")
            .select("lead_json")
            .eq("id", email.id)
            .maybeSingle();
          const currentLeadJson = (currentEmail?.lead_json as any) ?? {};
          await supabaseAdmin
            .from("emails")
            .update({
              lead_json: {
                ...currentLeadJson,
                processing: false,
              },
            })
            .eq("id", email.id);
        };

        try {

        let forcedDecision: "traiter" | "ignorer" | "planifier" | null = null;
        let forcedUrgent = false;
        let forcedImportant = false;

        if (
          rules.always_important?.some((d: string) =>
            (email.sender || "").includes(d)
          )
        ) {
          forcedDecision = "traiter";
          forcedImportant = true;
        }

        if (
          rules.always_ignore?.some((d: string) =>
            (email.sender || "").includes(d)
          )
        ) {
          forcedDecision = "ignorer";
        }

        if (
          rules.keywords?.urgent?.some((k: string) =>
            (email.subject || "").toLowerCase().includes(k.toLowerCase())
          )
        ) {
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
              recommended_action:
                forcedDecision === "ignorer" ? "archive" : "reply",
              classification_reason: "Règle utilisateur",
            })
            .eq("id", email.id);

          void logActivity({
            userId: targetUserId,
            actor: "ai",
            type: "email_analyzed",
            title: "Email classé par règle utilisateur",
            emailId: email.id,
            meta: { decision: forcedDecision },
          }).catch(() => null);

          analyzedTotal++;
          continue;
        }

        // FIX DEFINITIF - AUTO-IGNORE EMAILS NON ANALYSABLES
        

        let content = email.body?.trim() || "";
// OK ignore nos emails de confirmation (evite boucle / faux leads)
const subj = (email.subject || "").toLowerCase();
if (subj.includes("votre visite est confirmée")) {
  await supabaseAdmin
    .from("emails")
    .update({
      decision: "ignorer",
      summary: "Email de confirmation auto (ignoré).",
      estimated_time: 0,
      recommended_action: "archive",
      classification_reason: "Auto-confirmation outbound",
    })
    .eq("id", email.id);

  void logActivity({
    userId: targetUserId,
    actor: "ai",
    type: "email_analyzed",
    title: "Email de confirmation auto ignoré",
    emailId: email.id,
    meta: { reason: "auto_confirmation_outbound" },
  }).catch(() => null);

  analyzedTotal++;
  continue;
}

// FETCH BODY GMAIL SI MANQUANT
// FETCH BODY PROVIDER SI MANQUANT
  if (!content || content.length < 20) {
    const isMicrosoft = (email as any).provider === "microsoft";

    let fetchedBody: string | null = null;

    try {
      if (isMicrosoft && (email as any).provider_message_id) {
        fetchedBody = await fetchOutlookBody(targetUserId, (email as any).provider_message_id);
      } else if (!isMicrosoft && (email as any).gmail_message_id) {
        fetchedBody = await fetchGmailBody(targetUserId, (email as any).gmail_message_id);
      }
    } catch (e: any) {
      const errorMsg = e?.message ?? String(e);
      if (errorMsg.includes("TIMEOUT")) {
        await logActivity({
          userId: targetUserId,
          actor: "ai",
          type: "error",
          title: `Timeout fetch body (${isMicrosoft ? "Outlook" : "Gmail"})`,
          emailId: email.id,
          meta: { error: "timeout_fetch_body", provider: (email as any).provider },
        }).catch(() => null);
        skippedTotal++;
        skipReasons.push({ emailId: email.id, reason: "BODY_FETCH_TIMEOUT", step: "fetch_body" });
        continue;
      }
      console.error(`[ANALYZE] Body fetch error for ${email.id}`, e);
    }

    if (fetchedBody && fetchedBody.length > 20) {
      content = fetchedBody;
      await supabaseAdmin
        .from("emails")
        .update({ body: fetchedBody })
        .eq("id", email.id);
    } else if (!content || content.length < 20) {
      // Body vide après fetch : marquer comme ignoré pour ne plus le retraiter
      await supabaseAdmin
        .from("emails")
        .update({
          decision: "ignorer",
          lead_status: "other",
          summary: "Email sans contenu exploitable",
          estimated_time: 0,
          recommended_action: "archive",
          classification_reason: "BODY_EMPTY",
        })
        .eq("id", email.id);

      await logActivity({
        userId: targetUserId,
        actor: "ai",
        type: "error",
        title: "Body fetch vide",
        emailId: email.id,
        meta: { error: "fetch_body_empty", provider: (email as any).provider },
      }).catch(() => null);

      skippedTotal++;
      skipReasons.push({ emailId: email.id, reason: "BODY_EMPTY", step: "fetch_body" });
      continue;
    }
  }

// WARN dernier garde-fou : body vide apres tous les tentatives de fetch
if (!content || content.length < 20) {
  await supabaseAdmin
    .from("emails")
    .update({
      decision: "ignorer",
      lead_status: "other",
      summary: "Email sans contenu exploitable",
      estimated_time: 0,
      recommended_action: "archive",
      classification_reason: "BODY_EMPTY",
    })
    .eq("id", email.id);

  void logActivity({
    userId: targetUserId,
    actor: "ai",
    type: "email_analyzed",
    title: "Email ignoré (contenu vide ou technique)",
    emailId: email.id,
    meta: { reason: "empty_or_technical_content" },
  }).catch(() => null);

  skippedTotal++;
  skipReasons.push({ emailId: email.id, reason: "BODY_EMPTY", step: "body_validation" });
  continue;
}
if (maybeSlotReply(content)) {

// ==============================
// SLOT CONFIRMATION DETECTOR
// (réponse à une proposition de créneaux)
// ==============================
const inboundEmail = extractEmailAddress(email.sender);

// 1) On récupère plusieurs propositions récentes (pas 1 seule)
const { data: candidates, error: candErr } = await supabaseAdmin
  .from("emails")
  .select("id, sender, provider, subject, body, property_id, lead_property_address, lead_json, lead_status, received_at")
  .eq("user_id", targetUserId)
  .not("lead_json", "is", null)
  .eq("lead_status", "slots_proposed")
  .gte("received_at", new Date(Date.now() - 14 * 86400000).toISOString())
  .order("received_at", { ascending: false })
  .limit(5);

if (candErr) {
  console.error("[SLOT] candidates fetch error", candErr);
}

// 2) On choisit le bon “original” : priorité au sender_email (si dispo),
// sinon fallback sur la colonne emails.sender
const SENT_PROPOSAL_TYPES = ["proposal_slots_sent", "proposal_slots"];
const candidatesSent = Array.isArray(candidates)
  ? candidates.filter((e: any) => SENT_PROPOSAL_TYPES.includes(e?.lead_json?.last_outbound?.type ?? ""))
  : [];
const originalMatch =
  candidatesSent.length > 0
    ? candidatesSent.find((e: any) => {
        const outEmail = e?.lead_json?.last_outbound?.sender_email ?? null;
        const a = inboundEmail?.toLowerCase() ?? null;
        const b = typeof outEmail === "string" ? outEmail.toLowerCase() : null;
        if (a && b && a === b) return true;
        const candidateSender = extractEmailAddress(e?.sender ?? null);
        const c = candidateSender?.toLowerCase() ?? null;
        return a && c && a === c;
      }) ?? null
    : null;


  
  
    if (originalMatch?.id) {
      const leadJson = (originalMatch as any).lead_json ?? {};
      const slots = Array.isArray(leadJson?.slots_proposed) ? leadJson.slots_proposed : [];

  if (slots.length > 0) {
    const chosen = detectSlotChoice(content, slots);

    if (chosen) {
      // Aucun lead ne passe en "booked" sans property_id
      let propertyId: string | null = (originalMatch as any).property_id ?? null;
      let propertyAddress: string | null = (originalMatch as any).lead_property_address ?? null;
      let matchedProp: any = null;

      if (!propertyId) {
        const matchResult = await matchPropertyForLead(targetUserId, originalMatch.id);
        propertyId = matchResult.propertyId;
        propertyAddress = matchResult.address;
        matchedProp = matchResult.matchedProp;
      }

      if (!propertyId) {
        await supabaseAdmin
          .from("emails")
          .update({
            lead_status: "qualifying",
            lead_last_action: "Bien non identifié — association requise",
            lead_last_action_at: new Date().toISOString(),
            summary: "Créneau confirmé mais bien non identifié.",
          })
          .eq("id", originalMatch.id);
        void logActivity({
          userId: targetUserId,
          actor: "ai",
          type: "error",
          title: "Bien non identifié — association requise",
          emailId: originalMatch.id,
          meta: { reason: "slot_confirmed_no_property_id" },
        }).catch(() => null);
        analyzedTotal++;
        continue;
      }

      const nextLeadJson = {
        ...leadJson,
        lead_status: "booked",
        confirmed_slot: chosen,
        confirmed_at: new Date().toISOString(),
        last_inbound: { type: "slot_choice", chosen_slot: chosen, at: new Date().toISOString() },
        ...(matchedProp ? { matched_property: matchedProp } : {}),
      };

      await supabaseAdmin
        .from("emails")
        .update({
          lead_status: "booked",
          lead_is_qualified: true,
          property_id: propertyId,
          lead_property_address: propertyAddress,
          lead_json: nextLeadJson,
          summary: "Créneau confirmé par le prospect.",
          classification_reason: "Slot confirmation detector",
          lead_last_action: "Créneau confirmé — prêt à planifier la visite.",
          lead_last_action_at: new Date().toISOString(),
        })
        .eq("id", originalMatch.id);

      void logActivity({
        userId: targetUserId,
        actor: "ai",
        type: "visit_booked",
        title: "Visite confirmée",
        emailId: originalMatch.id,
        meta: { confirmed_slot: chosen, property_id: propertyId },
      }).catch(() => null);

        // OK CREATE CALENDAR EVENT (provider-agnostic)
try {
  const provider =
  (originalMatch as any).provider === "microsoft" ? "microsoft" : "google";

  const start = chosen;
  const end = new Date(new Date(chosen).getTime() + 30 * 60 * 1000).toISOString();

  const created = await createCalendarEvent(targetUserId, provider, {
    title: "Visite",
    start,
    end,
    description: "Visite confirmée automatiquement.",
  });
  
  
} catch (e) {
  console.error("[ANALYZE] createCalendarEvent failed", e);
}
// OK EMAIL CONFIRMATION (texte)
const dt = new Date(chosen);
const formatted = dt.toLocaleString("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

const confirmationSubject = `Votre visite est confirmée pour : ${formatted}`;
const confirmationBody =
`Bonjour,

Votre visite est confirmée pour : ${formatted}.

Cordialement,
L'équipe`;

const toEmail = extractEmailAddress(email.sender);

if (!toEmail) {
  console.error("[ANALYZE] No recipient email parsed from sender:", email.sender);
} else {
  try {
    const isMicrosoft = (email as any).provider === "microsoft";

    if (isMicrosoft) {
      await sendMicrosoftEmail(targetUserId, {
        to: toEmail,
        subject: confirmationSubject,
        text: confirmationBody,
      });
    } else {
      await sendGoogleEmail(targetUserId, {
        to: toEmail,
        subject: confirmationSubject,
        text: confirmationBody,
      });
    }
  } catch (e) {
    console.error("[ANALYZE] confirmation email failed", e);
  }
}


      // 2) on marque l'email courant comme traité (pour qu'il ne repasse pas)
      await supabaseAdmin
        .from("emails")
        .update({
          decision: "traiter",
          recommended_action: "reply",
          estimated_time: 2,
          summary: "Le prospect a confirmé un créneau de visite.",
          classification_reason: "Slot confirmation detector",
        })
        .eq("id", email.id);

      analyzedTotal++;
      continue; // WARN super important : on ne lance PAS l'analyse IA derriere
    }
  }
}


// OK IMPORTANT : on ferme le "if (maybeSlotReply(content))"
}

// OK PERF: on tronque le mail pour eviter un prompt trop lourd (reduit a 1500 pour latence minimale)
const contentForAI = String(content).slice(0, 1500);

// Snippets pour réponses standard (éviter réponses bancales)
const snippetsText = Object.entries(snippets).map(([k, v]) => `- ${k}: "${(v || "").slice(0, 200)}"`).join("\n");

const addressPolicyRule =
  addressPolicy === "always"
    ? "Tu peux indiquer l'adresse exacte du bien dès la première réponse si le candidat la demande."
    : addressPolicy === "after_qualification"
      ? "Ne donne l'adresse exacte (numéro, rue) qu'après qualification du dossier (revenus/docs OK). Avant ça, reste sur le secteur ou le quartier."
      : "Ne JAMAIS divulguer l'adresse exacte (numéro de rue) avant confirmation d'un créneau de visite. Proposer d'abord des créneaux, puis communiquer l'adresse une fois le RDV confirmé.";

const prompt = `
Tu es ${aiName}, l'Expert en Conversion Locative pour une agence immobilière.
Ton objectif : classifier l'intent du message puis filtrer les dossiers et verrouiller des RDV pour les demandes de visite.

### INTENT (obligatoire) — Choisir UN seul :
- booking_request : demande de visite / RDV / voir un bien pour le louer
- property_question : question sur un bien (prix, surface, DPE, dispo) — répondre UNIQUEMENT à partir du CONTEXTE DES BIENS ou snippet property_info_default, ne rien inventer
- documents_status : dossier / documents à fournir ou déjà envoyés — utiliser snippet missing_docs pour demander les pièces manquantes
- application_status : "où en est mon dossier" / suivi candidature — utiliser snippet application_status_default
- reschedule : report ou reprogrammation d'une visite
- cancel : annulation d'une visite ou dossier
- admin_question : bail, état des lieux, paiement, clés — utiliser snippet admin_default si fourni
- out_of_scope : hors sujet location/visite — utiliser snippet out_of_scope_default

Réponses standards (snippets) à utiliser selon l'intent (ne rien inventer) :
${snippetsText}
- Pour candidat inéligible (revenus insuffisants) : utiliser ineligible_guarantor_option pour proposer garant ou autre bien.
- Pour relance sans réponse : utiliser followup_reminder.

RÈGLE ADRESSE (strict) : ${addressPolicyRule}

IMPORTANT :
- Tu es une IA B2B : efficace, froide sur les critères, mais polie.
- Tu ne dois JAMAIS inventer des informations factuelles (revenus, CDI, garant, adresse). Si absent → "null" et tu demandes.
- Si la demande n'est pas une demande de location/visite → intent=out_of_scope ou property_question selon le cas, et is_rental_intent=false.

### 🏠 CONTEXTE DES BIENS DISPONIBLES :
${JSON.stringify(propertiesContext)}

### ⚙️ RÈGLES DE QUALIFICATION (STRICTES, pour intent=booking_request uniquement) :
1) SEUIL FINANCIER : revenus NETS mensuels >= (${rentMultiplier} x loyer)
 - Si revenu annuel détecté : le convertir en mensuel (annuel / 12).
 - Si revenus foyer / conjoint : additionner si clairement mentionné.
 - Si loyer inconnu (bien non matché) : ne calcule pas le ratio, demande le bien exact ou propose d’identifier le bien.

2) DOCUMENTS : le candidat doit fournir (ou être prêt à fournir) :
${requiredDocs.join(", ") || "Non défini"}

3) HEURISTIQUES SCORE :
- CDI + revenus >= seuil + docs OK = score 9-10
- CDD/intérim/indé sans historique clair = score 4-7 (demander précisions)
- Étudiant sans garant = score 1-3
- Revenus insuffisants sans garant = score 1-3

### 🧠 LOGIQUE DE RÉPONSE (TON : ${aiTone}) :
CAS A — Infos manquantes :
- Ne propose JAMAIS de visite.
- Demande précisément ce qui manque (revenus nets mensuels, statut, garant, téléphone, documents).
CAS B — Inéligible :
- Refuse avec diplomatie, explique le critère (x${rentMultiplier}).
- Propose alternative : garant solide / autre bien moins cher.
CAS C — Éligible :
- Confirme que le dossier semble cohérent.
- Demande les documents (si pas déjà mentionnés).
- Propose des créneaux (3) de visite (ne pas donner numéro de rue).
- Si aucun créneau n'est fourni, propose des créneaux réalistes (jours ouvrés, 9h-18h).

Contraintes internes agence (si fourni) :
${visitRules || "(aucune contrainte spécifique)"}

### 📋 STRUCTURE DE SORTIE JSON (OBLIGATOIRE) :
Réponds UNIQUEMENT avec un JSON valide. AUCUN texte autour. Pas de markdown, pas de \`\`\`, pas de prose.
{
"intent": "booking_request|property_question|documents_status|application_status|reschedule|cancel|admin_question|out_of_scope",
"is_rental_intent": boolean,
"property_id": "uuid|null",
"analysis": {
  "prospect_name": "string|null",
  "phone": "string|null",
  "property_address": "string|null",
  "detected_income": number|null,
  "income_ratio": number|null,
  "employment_type": "CDI|CDD|Indé|Interim|Étudiant|Inconnu",
  "guarantor_present": boolean|null,
  "urgency_level": "low|medium|high"
},
"extracted": {},
"lead_score": number,
"lead_status": "new_lead|qualifying|ready_for_visite|rejected|other",
"missing_elements": string[],
"next_action_logic": "string",
"next_action": "string",
"slots_proposed": string[],
"email_reply": "string"
}

### 📨 EMAIL À TRAITER :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${contentForAI}
`;


        const leadJsonBeforeAI = (email.lead_json as any) ?? {};
        const aiTimeoutCount = (email as any).ai_timeout_count ?? 0;
        const aiErrorCount = (email as any).ai_error_count ?? 0;

        let openaiText = "";
        let lastOpenAiError: OpenAiErrorInfo | null = null;

        const runOpenAiAttempt = async (model: string): Promise<string> => {
          const completion = await withAbortTimeout(
            openai.chat.completions.create({
              model,
              messages: [{ role: "user" as const, content: prompt }],
              temperature: 0,
              response_format: { type: "json_object" },
            }),
            8000
          );
          return completion.choices?.[0]?.message?.content || "{}";
        };

        let openaiSuccess = false;
        let attemptsUsed = 0;
        let skipAsRetryLater = false;

        for (let attempt = 0; attempt < MAX_OPENAI_ATTEMPTS && !openaiSuccess && !skipAsRetryLater; attempt++) {
          attemptsUsed = attempt + 1;
          let model = PRIMARY_MODEL;

          try {
            console.time(`[AI] ${email.id} attempt ${attemptsUsed}`);
            openaiText = await runOpenAiAttempt(model);
            console.timeEnd(`[AI] ${email.id} attempt ${attemptsUsed}`);
            if (process.env.NODE_ENV === "development") {
              console.log("[AI] model used:", model);
            }
            openaiSuccess = true;
          } catch (e: unknown) {
            lastOpenAiError = extractOpenAiError(e, model);
            const status = lastOpenAiError.status;
            const code = (lastOpenAiError.code ?? "").toLowerCase();
            const msg = lastOpenAiError.message;
            const is404 = status === 404 || /invalid_model|not_found/i.test(code) || /model.*does not exist/i.test(msg);

            if (attempt === 0 && is404 && model === PRIMARY_MODEL) {
              model = FALLBACK_MODEL;
              try {
                openaiText = await runOpenAiAttempt(model);
                if (process.env.NODE_ENV === "development") console.log("[AI] fallback model used:", model);
                openaiSuccess = true;
              } catch (e2: unknown) {
                lastOpenAiError = extractOpenAiError(e2, model);
              }
            }

            if (!openaiSuccess && lastOpenAiError && (status === 429 || /quota|rate_limit/i.test(msg))) {
              if (attempt >= 1) {
                const retryAt = new Date(Date.now() + 5 * 60 * 1000);
                await supabaseAdmin
                  .from("emails")
                  .update({
                    ai_retry_after: retryAt.toISOString(),
                    ai_last_error_at: new Date().toISOString(),
                    lead_json: {
                      ...leadJsonBeforeAI,
                      openai_last_error_message: msg.slice(0, 200),
                    },
                  })
                  .eq("id", email.id);
                await logActivity({
                  userId: targetUserId,
                  actor: "ai",
                  type: "error",
                  title: "Quota OpenAI — retry 5 min",
                  emailId: email.id,
                  meta: { error: "rate_limit_429", status: 429 },
                }).catch(() => null);
                skippedTotal++;
                skipReasons.push({ emailId: email.id, reason: "RETRY_LATER", step: "openai_completion" });
                skipAsRetryLater = true;
                break;
              }
            }
          }

          if (!openaiSuccess && !skipAsRetryLater && attempt < MAX_OPENAI_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, OPENAI_BACKOFF_MS[attempt] ?? 1200));
          }
        }

        if (skipAsRetryLater) continue;

        if (!openaiSuccess) {
          const now = new Date();
          const retryCount = (leadJsonBeforeAI?.ai_retry_count ?? 0) + attemptsUsed;

          if (retryCount >= MAX_OPENAI_ATTEMPTS || attemptsUsed >= MAX_OPENAI_ATTEMPTS) {
            debugOpenAiLastError = lastOpenAiError;
            const retryAt = new Date(Date.now() + 30 * 60 * 1000);
            await supabaseAdmin
              .from("emails")
              .update({
                decision: "traiter",
                lead_status: "retry_later",
                lead_score: 1,
                lead_is_qualified: false,
                summary: "OpenAI erreur — à relancer",
                classification_reason: "OPENAI_MAX_RETRIES",
                ai_retry_after: retryAt.toISOString(),
                lead_json: {
                  ...leadJsonBeforeAI,
                  ai_error: "OPENAI_MAX_RETRIES",
                  ai_retry_count: retryCount,
                  ai_retry_after: retryAt.toISOString(),
                  openai_last_error_message: lastOpenAiError?.message?.slice(0, 200) ?? null,
                },
              })
              .eq("id", email.id);

            skippedTotal++;
            skipReasons.push({ emailId: email.id, reason: "OPENAI_MAX_RETRIES", step: "openai_completion" });
          } else {
            const isTimeout = lastOpenAiError && /timeout|abort/i.test(lastOpenAiError.message);
            const retry = isTimeout ? new Date(now.getTime() + 10 * 60 * 1000) : new Date(now.getTime() + 30 * 60 * 1000);

            await logActivity({
              userId: targetUserId,
              actor: "ai",
              type: "error",
              title: isTimeout ? `Timeout OpenAI — retry 5 min` : `OpenAI erreur — retry 15 min`,
              emailId: email.id,
              meta: {
                error: isTimeout ? "timeout_openai" : "openai_error",
                attempt: retryCount,
                retry_after: retry.toISOString(),
              },
            }).catch(() => null);

            await supabaseAdmin
              .from("emails")
              .update({
                ai_last_error_at: now.toISOString(),
                ai_retry_after: retry.toISOString(),
                ai_timeout_count: isTimeout ? aiTimeoutCount + 1 : aiTimeoutCount,
                ai_error_count: !isTimeout ? aiErrorCount + 1 : aiErrorCount,
                lead_json: {
                  ...leadJsonBeforeAI,
                  ai_retry_count: retryCount,
                  ai_retry_after: retry.toISOString(),
                  openai_last_error_message: lastOpenAiError?.message?.slice(0, 200) ?? null,
                },
              })
              .eq("id", email.id);

            skippedTotal++;
            skipReasons.push({
              emailId: email.id,
              reason: isTimeout ? "OPENAI_TIMEOUT" : "OPENAI_ERROR",
              step: "openai_completion",
            });
          }
          continue;
        }

        if (aiTimeoutCount > 0 || aiErrorCount > 0 || (email as any).ai_retry_after) {
          await supabaseAdmin
            .from("emails")
            .update({
              ai_timeout_count: 0,
              ai_error_count: 0,
              ai_retry_after: null,
              lead_json: {
                ...leadJsonBeforeAI,
                ai_last_timeout_at: null,
                ai_last_error_at: null,
                openai_last_error_message: null,
              },
            })
            .eq("id", email.id);
        }

        // Parse JSON + validation robuste (max 2 tentatives: parse + 1 repair)
        const MAX_JSON_ATTEMPTS = 2;
        let parseAttempt = 0;
        let rawToParse = openaiText;
        let parsed: Record<string, unknown> | null = null;
        let lastParseError = "";

        const VALID_INTENTS = ["booking_request", "property_question", "documents_status", "application_status", "reschedule", "cancel", "admin_question", "out_of_scope"];
        const validateParsed = (p: Record<string, unknown>): string | null => {
          if (!p || typeof p !== "object") return "Parsed value is not an object";
          if (p.is_rental_intent === undefined && !p.analysis) return "Missing is_rental_intent or analysis";
          if (p.intent != null && typeof p.intent === "string" && !VALID_INTENTS.includes(p.intent)) return "Invalid intent";
          return null;
        };

        while (parseAttempt < MAX_JSON_ATTEMPTS) {
          parseAttempt++;
          const parseResult = tryParseJson(rawToParse);
          if (parseResult.ok) {
            const validationErr = validateParsed(parseResult.parsed);
            if (!validationErr) {
              parsed = parseResult.parsed;
              break;
            }
            lastParseError = validationErr;
          } else {
            // parseResult can be ok:true or ok:false; ensure we only read error on ok:false
            if ((parseResult as any)?.ok === false) {
              lastParseError = String(
                (parseResult as any)?.error ??
                  (parseResult as any)?.detail ??
                  "UNKNOWN_PARSE_ERROR"
              );
            } else {
              lastParseError = null;
            }
          }
          console.error(`[JSON_PARSE] attempt ${parseAttempt} failed:`, lastParseError, "raw:", rawToParse?.slice(0, 200));

          skippedTotal++;
          skipReasons.push({ emailId: email.id, reason: "JSON_PARSE_FAILED", step: "json_parse" });

          if (parseAttempt >= MAX_JSON_ATTEMPTS) {
            debugJsonParseLastOutput = (rawToParse ?? "").slice(0, 2000);
            debugJsonParseError = lastParseError;
            const retryCount = (leadJsonBeforeAI?.ai_retry_count ?? 0) + parseAttempt;
            const retryAt = new Date(Date.now() + 10 * 60 * 1000); // retry dans 10 min
            const leadJsonUpdate: Record<string, unknown> = {
              ...leadJsonBeforeAI,
              processing: false,
              processing_at: null,
              ai_error: "JSON_PARSE_MAX_RETRIES",
              ai_retry_count: retryCount,
              error_reason: "JSON_PARSE",
            };
            if (process.env.NODE_ENV === "development") {
              leadJsonUpdate.openai_raw_response = rawToParse?.slice(0, 500);
            }
            await supabaseAdmin
              .from("emails")
              .update({
                ai_retry_after: retryAt.toISOString(),
                lead_json: leadJsonUpdate,
              })
              .eq("id", email.id);
            skipReasons.push({ emailId: email.id, reason: "JSON_PARSE_MAX_RETRIES", step: "json_parse" });
            continue;
          }

          // Repair mode: 1 retry avec prompt court
          try {
            const repairRes = await withAbortTimeout(
              openai.chat.completions.create({
                model: PRIMARY_MODEL,
                messages: [
                  {
                    role: "user" as const,
                    content: `Réécris ce contenu en JSON strict valide sans changer les valeurs. Réponds UNIQUEMENT avec le JSON, rien d'autre.\n\n${rawToParse.slice(0, 4000)}`,
                  },
                ],
                temperature: 0,
                response_format: { type: "json_object" },
              }),
              6000
            );
            rawToParse = repairRes.choices?.[0]?.message?.content ?? "";
          } catch (e) {
            console.error("[JSON_REPAIR] OpenAI repair failed", e);
            lastParseError = String((e as Error)?.message ?? e);
            debugJsonParseLastOutput = (rawToParse ?? "").slice(0, 2000);
            debugJsonParseError = lastParseError;
            skipReasons.push({ emailId: email.id, reason: "JSON_PARSE_MAX_RETRIES", step: "json_parse" });
            const retryCount = (leadJsonBeforeAI?.ai_retry_count ?? 0) + 2;
            const retryAt = new Date(Date.now() + 10 * 60 * 1000);
            const leadJsonUpdate: Record<string, unknown> = {
              ...leadJsonBeforeAI,
              processing: false,
              processing_at: null,
              ai_error: "JSON_PARSE_MAX_RETRIES",
              ai_retry_count: retryCount,
              error_reason: "JSON_PARSE",
            };
            if (process.env.NODE_ENV === "development") leadJsonUpdate.openai_raw_response = rawToParse?.slice(0, 500);
            await supabaseAdmin
              .from("emails")
              .update({
                ai_retry_after: retryAt.toISOString(),
                lead_json: leadJsonUpdate,
              })
              .eq("id", email.id);
            continue;
          }
        }

        if (!parsed) continue;

        const result = parsed;

        // Intent router: normaliser intent (rétrocompat si absent)
        const validIntents = ["booking_request", "property_question", "documents_status", "application_status", "reschedule", "cancel", "admin_question", "out_of_scope"];
        let intent = typeof result.intent === "string" && validIntents.includes(result.intent) ? result.intent : null;
        if (!intent) {
          intent = result.is_rental_intent ? "booking_request" : "out_of_scope";
        }

const isRental = !!result.is_rental_intent;

// Normalisation status (utilise le JSON si present, sinon sera recalcule plus bas)
const leadStatusRaw = String(result.lead_status || "").toLowerCase();
const lead_status =
  !isRental ? "other" :
  leadStatusRaw === "ready_for_visite" ? "slots_proposed" :
  leadStatusRaw === "qualifying" ? "qualifying" :
  leadStatusRaw === "rejected" ? "unqualified" :
  leadStatusRaw === "new_lead" ? "new_lead" :
  "new_lead";

// lead_score
const lead_score =
  typeof result.lead_score === "number"
    ? Math.max(1, Math.min(10, Math.round(result.lead_score)))
    : 5;

// analysis is dynamic content; cast to a permissive shape for TS
const analysis = (result.analysis ?? {}) as unknown as Analysis;
const rawPropAddr = analysis.property_address;
analysis.prospect_name = cleanNull(analysis.prospect_name);
analysis.phone = cleanNull(analysis.phone);
analysis.property_address = cleanNull(analysis.property_address);
analysis.employment_type = cleanNull(analysis.employment_type);
analysis.detected_income =
  typeof analysis.detected_income === "number" ? analysis.detected_income : null;
result.property_id = cleanNull(result.property_id);
if (typeof rawPropAddr === "string" && rawPropAddr.trim().toLowerCase() === "null") {
  console.log("[CLEAN_NULL] analysis.property_address was string 'null'", { emailId: email.id });
}

const detectedIncome =
  typeof analysis.detected_income === "number" ? analysis.detected_income : null;

const missing =
  Array.isArray(result.missing_elements) ? result.missing_elements : [];

// ================= PROPERTY MATCHING (scoring robuste) =================
const haystack =
  (analysis?.property_address ?? "") + " " + (email.subject ?? "") + " " + contentForAI.slice(0, 800);
const { best: bestMatch, candidates: matchCandidates } = scorePropertyMatch(haystack, propertyIndex);

let matchedProperty: any = bestMatch ? bestMatch.prop : null;
const matchScore = bestMatch?.score ?? 0;
// ================= QUALIFICATION RÉELLE =================

let incomeRatio: number | null = null;
let isQualified = false;

if (matchedProperty && detectedIncome && matchedProperty.rent) {
  incomeRatio = detectedIncome / matchedProperty.rent;
  isQualified = incomeRatio >= rentMultiplier;
}

// S'assurer que lead_status est toujours defini selon revenus et loyer si JSON valide
const finalLeadStatus =
  matchedProperty && detectedIncome != null && matchedProperty.rent
    ? isQualified
      ? (missing.length === 0 ? "slots_proposed" : "qualifying")
      : "unqualified"
    : matchedProperty
    ? "qualifying"
    : isRental
    ? lead_status
    : "other";

  let slotsProposed: string[] = [];

// Slots obligatoires si finalLeadStatus === "slots_proposed" — sinon ne pas marquer slots_proposed
try {
  if (finalLeadStatus === "slots_proposed") {
    if (!cachedSlots30) {
      cachedSlots30 = await getRealVisitSlots(targetUserId, 30);
    }

    slotsProposed = (cachedSlots30 || [])
      .map((s) => s.start)
      .slice(0, 3);
  }
} catch (e: any) {
  const errorMsg = e?.message ?? String(e);
  if (errorMsg.includes("TIMEOUT")) {
    await logActivity({
      userId: targetUserId,
      actor: "ai",
      type: "error",
      title: "Timeout fetch slots",
      emailId: email.id,
      meta: { error: "timeout_fetch_slots" },
    }).catch(() => null);
  } else {
    await logActivity({
      userId: targetUserId,
      actor: "ai",
      type: "error",
      title: "Slots fetch échec",
      emailId: email.id,
      meta: { error: String(e) },
    }).catch(() => null);
  }
}

// Ne jamais marquer slots_proposed sans slots — downgrade vers qualifying
const effectiveLeadStatus =
  finalLeadStatus === "slots_proposed" && slotsProposed.length < 3
    ? "qualifying"
    : finalLeadStatus;

  
// lead_profile (fiche prospect)
const leadProfile = {
  prospect_name: analysis.prospect_name ?? null,
  phone: analysis.phone ?? null,
  property_address: analysis.property_address ?? null,
  monthly_income: detectedIncome,
  employment_status: analysis.employment_type ?? "Inconnu",
  has_guarantor:
    typeof analysis.guarantor_present === "boolean" ? analysis.guarantor_present : null,
};
const forcedEmailReply =
  effectiveLeadStatus === "slots_proposed" && slotsProposed.length >= 3
    ? buildSlotsEmailReply(slotsProposed)
    : null;

// Stocker rent pour valeur_pipeline (fallback ROI)
const leadJsonRent = matchedProperty?.rent != null ? matchedProperty.rent : undefined;

// Intent ELITE (Pipeline / Détails) : LOCATION vs INFORMATION
// Override anti faux-positifs : si intention visite/location explicite dans le contenu => LOCATION
const locationIntentPattern = /\b(visiter|visite|disponibilit[eé]s|rdv|rendez-vous|je souhaite louer|je suis int[eé]ress[eé] par le|quand puis-je visiter|voir le bien|organiser une visite|prendre rendez-vous)\b/i;
const contentForIntent = `${email.subject ?? ""} ${contentForAI}`.trim();
const hasExplicitLocationIntent = locationIntentPattern.test(contentForIntent);
const eliteIntentFromAi =
  intent === "property_question" || intent === "admin_question" || intent === "application_status" || intent === "out_of_scope"
    ? "INFORMATION"
    : "LOCATION";
const eliteIntent = hasExplicitLocationIntent ? "LOCATION" : eliteIntentFromAi;

// Brouillons (assistant activé = on est dans analyze-inbox) : draft_reply + draft_proposal si booking_request + slots
let replyText = forcedEmailReply ?? result.email_reply ?? null;
let draftReplyObj =
  replyText && typeof replyText === "string"
    ? { text: replyText, subject: `Re: ${(email.subject ?? "Votre demande").trim().slice(0, 80)}`, created_at: new Date().toISOString() }
    : undefined;
const draftProposalObj =
  intent === "booking_request" && slotsProposed.length >= 3
    ? { text: buildSlotsEmailReply(slotsProposed), subject: "Visite — choix du créneau", created_at: new Date().toISOString() }
    : undefined;

// INFORMATION : réponse basée FAQ (pas d’hallucination). Si pas de match => demande de précision.
let infoExtra: Record<string, unknown> = {};
if (eliteIntent === "INFORMATION") {
  const faqItemsRaw = (configAny?.faq_items ?? []) as Array<{ id?: string; question?: string; answer?: string }>;
  const faqItems: FaqItem[] = faqItemsRaw.map((item) => ({
    id: item.id ?? String(Math.random()),
    question: item.question ?? "",
    answer: item.answer ?? "",
  }));
  const questionText = `${email.subject ?? ""} ${contentForAI}`.trim();
  const { match } = matchFaq(faqItems, questionText);
  const signature = `\n\n${aiName}`;
  const infoReply = match
    ? (match.item.answer + signature).trim()
    : "Je n'ai pas trouvé la règle correspondante dans nos paramètres. Pouvez-vous préciser votre question ? Vous pouvez aussi nous appeler pour une réponse immédiate.";
  replyText = infoReply;
  draftReplyObj = {
    text: infoReply,
    subject: `Re: ${(email.subject ?? "Votre demande").trim().slice(0, 80)}`,
    created_at: new Date().toISOString(),
  };
  const nowIso = new Date().toISOString();
  infoExtra = {
    info_question: (email.subject ?? "").slice(0, 150),
    info_source: match ? "FAQ" : "MISSING_FAQ",
    ...(match ? { faq_item_id: match.item.id } : {}),
    last_action: setLastAction({}, { type: match ? "draft_info_reply" : "info_missing_faq", label: match ? "Brouillon réponse FAQ" : "Demande de précision (FAQ manquante)" }, nowIso),
  };
}

const mergedLeadJson = {
  ...(result || {}),
  intent: eliteIntent,
  intent_detail: intent,
  lead_status: effectiveLeadStatus,
  next_action: result.next_action ?? result.next_action_logic ?? null,
  slots_proposed: slotsProposed,
  ...(draftReplyObj ? { draft_reply: draftReplyObj } : {}),
  ...(draftProposalObj ? { draft_proposal: draftProposalObj } : {}),
  ...(leadJsonRent != null ? { rent: leadJsonRent } : {}),
  ...(matchedProperty
    ? { matched_property: { id: matchedProperty.id, name: matchedProperty.name, address: matchedProperty.address, rent: matchedProperty.rent, score: matchScore } }
    : {}),
  ...(!matchedProperty && matchCandidates.length > 0 ? { property_match_candidates: matchCandidates } : {}),
  ...infoExtra,
  // last_outbound est écrit UNIQUEMENT après envoi réel (send-reply / send-proposal / send-draft), jamais ici.
};



// Garantir que decision et lead_status sont toujours definis apres analyse
const finalDecision = isRental ? "traiter" : "ignorer";
const finalLeadStatusForDB =
  eliteIntent === "INFORMATION" ? "other" : effectiveLeadStatus || (isRental ? "new_lead" : "other");

await supabaseAdmin.from("emails").update({
  // OK marque "analyse" pour que remaining baisse
  decision: finalDecision,
  recommended_action: isRental ? "reply" : "archive",
  estimated_time: isRental ? 5 : 0,

  // Lead layer
  lead_score,
  lead_profile: leadProfile,
  property_id: matchedProperty?.id ?? null,
  lead_property_address: matchedProperty?.address ?? null,
  income_ratio: incomeRatio,
  lead_is_qualified: isQualified,
  lead_status: finalLeadStatusForDB,
  lead_missing_fields: missing,

  // OK stocke tout dans lead_json (incl. slots)
  lead_json: mergedLeadJson,

  lead_last_action: (infoExtra as { last_action?: { label?: string } })?.last_action?.label ?? result.next_action_logic ?? null,
  lead_last_action_at: new Date().toISOString(),

  // UI/trace
  summary: result.next_action_logic
    ? String(result.next_action_logic).slice(0, 200)
    : "Lead immo analyse.",
  ai_reply: replyText ?? forcedEmailReply ?? result.email_reply ?? null,
  classification_reason: "Analyse IA Immo",
  analyzed_at: new Date().toISOString(),
}).eq("id", email.id);

        void logActivity({
          userId: targetUserId,
          actor: "ai",
          type: matchedProperty ? "lead_qualified" : "email_analyzed",
          title: `Lead ${effectiveLeadStatus} — ${(analysis.prospect_name || "?").toString().slice(0, 30)}`,
          emailId: email.id,
          meta: { lead_status: effectiveLeadStatus, lead_score, ...(matchedProperty ? { matched_property_id: matchedProperty.id } : {}) },
        }).catch(() => null);

// ===== AUTOPILOT (post-analyse) =====
// DÉSACTIVÉ: Ne plus appeler runAutopilotForLead depuis analyze-inbox (évite appels internes /api/leads/* qui peuvent pendre)
// À la place, on met des flags dans lead_json pour qu'un cron séparé /api/cron/autopilot-dispatch les traite
if (!maybeSlotReply(content)) {
  const { data: settings } = await supabaseAdmin
    .from("settings_v1")
    .select("assistant_enabled, automation_level")
    .eq("user_id", targetUserId)
    .maybeSingle();
  
  const assistantEnabled = (settings as any)?.assistant_enabled === true;
  const automationLevel = (settings as any)?.automation_level ?? "draft";
  const autopilotEnabled = assistantEnabled && automationLevel === "autopilot";
  
  if (autopilotEnabled && effectiveLeadStatus === "slots_proposed" && slotsProposed.length >= 3) {
    // Flag pour autopilot: envoyer la proposition de créneaux
    const updatedLeadJson = {
      ...mergedLeadJson,
      autopilot_pending: true,
      autopilot_action: "send_proposal",
    };
    await supabaseAdmin
      .from("emails")
      .update({ lead_json: updatedLeadJson })
      .eq("id", email.id);
  } else if (autopilotEnabled && effectiveLeadStatus === "qualifying" && missing.length === 0) {
    // Flag pour autopilot: envoyer une réponse de qualification
    const updatedLeadJson = {
      ...mergedLeadJson,
      autopilot_pending: true,
      autopilot_action: "send_reply",
    };
    await supabaseAdmin
      .from("emails")
      .update({ lead_json: updatedLeadJson })
      .eq("id", email.id);
  } else if (autopilotEnabled && eliteIntent === "INFORMATION" && replyText) {
    // Flag pour autopilot: envoyer la réponse FAQ / demande de précision
    const updatedLeadJson = {
      ...mergedLeadJson,
      autopilot_pending: true,
      autopilot_action: "send_info_reply",
    };
    await supabaseAdmin
      .from("emails")
      .update({ lead_json: updatedLeadJson })
      .eq("id", email.id);
  }
}

analyzedTotal++;

        } finally {
          // Toujours libérer le lock à la fin du traitement (succès ou skip)
          await releaseEmailLock();
        }

      }
    }
  
    // Compter les emails restants a analyser (decision NULL OU lead_status NULL OU lead_json NULL)
    let remainingQuery = supabaseAdmin
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", targetUserId)
      .gte("received_at", sinceISO)
      .or("decision.is.null,decision.neq.ignorer")
      .or(`ai_retry_after.is.null,ai_retry_after.lte.${new Date().toISOString()}`);

    if (!force) {
      remainingQuery = remainingQuery.or("lead_json.is.null,lead_status.is.null,decision.is.null");
    }

    const { count: remaining } = await remainingQuery;
    
    const duration_ms = Date.now() - startedAt;
    
    // Agréger les raisons de skip
    const aggregateCounts: {
      EMAIL_LOCKED: number;
      EMAIL_LOCK_FAILED: number;
      BODY_FETCH_TIMEOUT: number;
      BODY_EMPTY: number;
      OPENAI_TIMEOUT: number;
      OPENAI_ERROR: number;
      OPENAI_MAX_RETRIES: number;
      JSON_PARSE_FAILED: number;
      RETRY_LATER: number;
    } = {
      EMAIL_LOCKED: 0,
      EMAIL_LOCK_FAILED: 0,
      BODY_FETCH_TIMEOUT: 0,
      BODY_EMPTY: 0,
      OPENAI_TIMEOUT: 0,
      OPENAI_ERROR: 0,
      OPENAI_MAX_RETRIES: 0,
      JSON_PARSE_FAILED: 0,
      RETRY_LATER: 0,
    };
    
    for (const skip of skipReasons) {
      const reason = skip.reason as keyof typeof aggregateCounts;
      if (reason in aggregateCounts) {
        aggregateCounts[reason]++;
      }
    }
    
    console.log(`[ANALYZE] END user=${targetUserId}, analyzed=${analyzedTotal}, skipped=${skippedTotal}, remaining=${remaining ?? 0}, duration_ms=${duration_ms}`);
    console.log(`[ANALYZE] Skip reasons:`, aggregateCounts);
  
    return NextResponse.json({
      success: true,
      analyzed: analyzedTotal,
      skipped: skippedTotal,
      remaining: remaining ?? 0,
      duration_ms,
      skip_reasons: aggregateCounts,
      sample_skipped: skipReasons.slice(0, 5),
      ...(nextCursor ? { nextCursor } : {}),
      ...(isDebugOpenAi && debugOpenAiLastError ? { debug_openai_last_error: debugOpenAiLastError } : {}),
      ...(isDebugOpenAi && debugJsonParseLastOutput != null
        ? {
            debug_json_parse_last_output: debugJsonParseLastOutput,
            debug_json_parse_error: debugJsonParseError ?? null,
          }
        : {}),
    });
  } finally {
    // Libérer le lock
    await releaseLock();
  }
}
