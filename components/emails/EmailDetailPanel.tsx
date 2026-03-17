"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Send, Check, Ban } from "lucide-react";
import type { Email } from "@/types/email";
import { decodeUtf8Mojibake } from "@/lib/decode";
import { stripHtmlToText } from "@/components/emails/utils";
import { useSettings } from "@/hooks/useSettings";
import { isReplyAlreadySent, isProposalAlreadySent, type LastOutbound } from "@/lib/email/alreadySent";
import { normalizeFaqQuestion } from "@/lib/faq/matchFaq";

type FaqItem = { id: string; question: string; answer: string; updated_at?: string };

const ACTION_TIMEOUT_MS = 12000;
// Debug temporaire : laisser le backend prouver qu'il répond bien avant le timeout client
const GENERATE_SLOTS_TIMEOUT_MS = 60000;

/** Fetch avec timeout. Chaque appel crée son propre AbortController (jamais de ref partagée). */
function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = ACTION_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...rest, signal: controller.signal }).finally(() => clearTimeout(t));
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/* ===================== HELPERS ===================== */

function scoreColor(score: number | null | undefined) {
  const s = typeof score === "number" ? score : 0;
  if (s >= 8) return "bg-green-600 text-white";
  if (s >= 4) return "bg-orange-500 text-black";
  return "bg-red-600 text-white";
}

function statusLabel(status: Email["lead_status"]) {
  if (status === "new_lead") return "Nouveau lead";
  if (status === "qualifying") return "En qualification";
  if (status === "slots_proposed") return "Créneaux proposés";
  if (status === "booked") return "Visite confirmée";
  if (status === "unqualified") return "Rejeté";
  if (status === "other") return "Autre";
  if (status === "raw") return "À analyser";
  return "—";
}

function statusPill(status: Email["lead_status"]) {
  if (status === "booked") return "bg-green-900/40 text-green-300 border border-green-800/60";
  if (status === "slots_proposed") return "bg-blue-900/40 text-blue-300 border border-blue-800/60";
  if (status === "qualifying") return "bg-orange-900/40 text-orange-300 border border-orange-800/60";
  if (status === "unqualified") return "bg-red-900/40 text-red-300 border border-red-800/60";
  if (status === "new_lead") return "bg-gray-800 text-gray-200 border border-gray-700";
  if (status === "other") return "bg-gray-800 text-gray-400 border border-gray-700";
  if (status === "raw") return "bg-gray-800 text-gray-400 border border-gray-700";
  return "bg-gray-800 text-gray-400 border border-gray-700";
}

function candidateName(email: Email) {
  const n = email.lead_profile?.prospect_name?.trim();
  if (n) return n;
  const s = (email.sender || "").split("<")[0].trim();
  return s || "Candidat inconnu";
}

function propertyLabel(email: Email) {
  const addr = email.lead_profile?.property_address || email.lead_property_address;
  if (addr && addr.trim().length > 0) return addr;
  const subj = decodeUtf8Mojibake(email.subject).trim();
  return subj ? subj : "Bien non identifié";
}

/** Détecte si le contenu ressemble à du HTML */
function looksLikeHtml(s: string): boolean {
  return /<[a-z][^>]*>/i.test(s);
}

function prettyMoney(v?: number | null) {
  if (typeof v !== "number") return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
  } catch {
    return `${v} €`;
  }
}

function missingList(email: Email) {
  const missing = email.lead_missing_fields ?? [];
  if (!missing.length) return [];

  const map: Record<string, string> = {
    monthly_income: "Revenus nets mensuels",
    employment_status: "Statut professionnel",
    has_guarantor: "Garant",
    phone: "Téléphone",
    property_address: "Bien / adresse mentionnée",
    documents: "Documents",
  };

  return missing.map((m) => map[m] || m);
}

/** Extrait les ISO start des créneaux depuis un email (row API ou Email). Gère array de strings ou array de { start }. */
function extractSlotsFromEmail(email: any): string[] {
  if (!email) return [];
  const lj = email.lead_json ?? {};
  const raw = lj.slots_proposed ?? (email as any).lead_slots_proposed ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any) => (typeof s === "string" ? s : s?.start)).filter((x: any) => typeof x === "string");
}

/* ===================== COMPONENT ===================== */

type EmailDetailPanelProps = {
  email: Email | null;
  onSetView?: (view: "list" | "kanban") => void;
  onRefresh?: () => void;
};

export function EmailDetailPanel({ email, onSetView, onRefresh }: EmailDetailPanelProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyFetchedEmpty, setBodyFetchedEmpty] = useState(false);
  const [bodyFetchFailed, setBodyFetchFailed] = useState(false);
  const [retryBodyFetchTrigger, setRetryBodyFetchTrigger] = useState(0);
  const [autopilotOverrideByLead, setAutopilotOverrideByLead] = useState<Record<string, boolean>>({});

  // IA reply accordion
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);

  // Autopilot (UI-only pour l’instant)
  const [showRawHtml, setShowRawHtml] = useState(false);
  const [showRendered, setShowRendered] = useState(false);
  const [autopilot, setAutopilot] = useState(false);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsDurationMin, setSlotsDurationMin] = useState<number>(30);
  const [sendProposalLoading, setSendProposalLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [confirmLoadingStart, setConfirmLoadingStart] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<null | "generate_slots" | "confirm" | "reject" | "send_draft" | "send_proposal">(null);
  const [analyzeSingleLoading, setAnalyzeSingleLoading] = useState(false);

  /** Debug: dernier appel API (path, status, json) pour diagnostiquer les silent fail */
  const [lastApiDebug, setLastApiDebug] = useState<{
    requestId: string;
    path: string;
    payload: unknown;
    status: number;
    ok: boolean;
    json: unknown;
    text: string;
    ms: number;
  } | null>(null);

  const { settings, updateSettings } = useSettings();
  const [showAddFaqForm, setShowAddFaqForm] = useState(false);
  const [addFaqQuestion, setAddFaqQuestion] = useState("");
  const [addFaqAnswer, setAddFaqAnswer] = useState("");
  const [addFaqSaving, setAddFaqSaving] = useState(false);

  const showDebug = process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";

  const isMountedRef = useRef(true);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guard: ne tenter fetch-body qu'une seule fois par emailId (évite boucle + double appel). */
  const bodyFetchAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const notify = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => {
      toastTimeoutRef.current = null;
      if (isMountedRef.current) setToast(null);
    }, 2500);
  };

  /** Appel POST JSON avec debug. Chaque appel crée son propre AbortController (pas de ref partagée => pas d'abort croisé). */
  const postJson = async (
    path: string,
    payload: Record<string, unknown>,
    opts?: { timeoutMs?: number }
  ) => {
    const timeoutMs = opts?.timeoutMs ?? ACTION_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const requestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
    const startedAt = Date.now();
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify(payload),
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const dbg = {
        requestId,
        path,
        payload,
        status: res.status,
        ok: res.ok,
        json,
        text: text.slice(0, 500),
        ms: Date.now() - startedAt,
      };
      setLastApiDebug(dbg);
      if (!res.ok || (json && json.ok === false)) {
        const msg = json?.error ?? json?.message ?? json?.details ?? `HTTP ${res.status}`;
        const err: any = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        err.status = res.status;
        err.json = json;
        err.path = path;
        throw err;
      }
      return json ?? {};
    } finally {
      clearTimeout(timeoutId);
    }
  };

  /** Applique l'email renvoyé par le backend à l'UI (évite le "200 mais rien") */
  const applyEmailFromResponse = (row: any) => {
    if (!row || !isMountedRef.current) return;
    if (row.ai_reply != null) setAiReply(row.ai_reply);
    if (row.body != null) setBody(row.body);
    const slotsArr = extractSlotsFromEmail(row);
    setSlots(slotsArr);
    const lj = row.lead_json ?? {};
    if (lj.slots_duration_min != null) setSlotsDurationMin(Number(lj.slots_duration_min));
  };

  /** Re-fetch l'email depuis Supabase après succès d'une action (fallback si pas d'email dans la réponse) */
  const refreshSelectedEmail = async () => {
    if (!email?.id) return;
    const requestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `get-${Date.now()}`;
    try {
      const res = await fetch(`/api/emails/get?id=${encodeURIComponent(email.id)}`, {
        credentials: "include",
        cache: "no-store",
        headers: { "x-request-id": requestId },
      });
      const data = await res.json().catch(() => null);
      if (!isMountedRef.current) return;
      if (data?.ok === true && data?.email) {
        const row = data.email as Email;
        setAiReply(row.ai_reply ?? null);
        setBody(row.body ?? null);
        setSlots(extractSlotsFromEmail(row));
        const lj = (row.lead_json as { slots_duration_min?: number }) ?? {};
        setSlotsDurationMin(Number(lj.slots_duration_min ?? 30));
      }
    } catch (e) {
      if (isMountedRef.current) notify("Erreur rechargement email");
    }
    onRefresh?.();
    window.dispatchEvent(new Event("fix:emails-refresh"));
  };

  const slotDurationFromSettings = settings?.config?.scheduling_rules?.slot_duration_min;

  useEffect(() => {
    setToast(null);
    setShowRawHtml(false);
    setShowRendered(false);
    setBody(email?.body ?? null);
    setBodyFetchedEmpty(false);
    setBodyFetchFailed(false);
    setAiReply(email?.ai_reply ?? null);
    setReplyOpen(false);

    const lj: any = (email as any)?.lead_json ?? {};
    setSlots(extractSlotsFromEmail(email as any));
    const fromLj = lj?.slots_duration_min != null ? Number(lj.slots_duration_min) : null;
    setSlotsDurationMin(fromLj ?? slotDurationFromSettings ?? 30);
  }, [email?.id]);

  useEffect(() => {
    if (!email?.id) return;
    const lj: any = (email as any)?.lead_json ?? {};
    const fromLj = lj?.slots_duration_min != null ? Number(lj.slots_duration_min) : null;
    if (fromLj != null) return;
    setSlotsDurationMin(slotDurationFromSettings ?? 30);
  }, [email?.id, slotDurationFromSettings]);


  // Récupérer le body automatiquement s'il est vide ou trop court (évite "Aucun contenu")
  // Ac est strictement local à cet effet : cleanup abort uniquement ce fetch-body, pas les actions (generateSlots etc.)
  // Guard: une seule tentative par emailId (pas de boucle, pas de retry auto en cas d'erreur).
  useEffect(() => {
    if (!email) return;
    const hasBody = (email.body ?? "").trim().length >= 50;
    if (hasBody) {
      setBody(email.body ?? null);
      setBodyLoading(false);
      return;
    }
    setBody(email.body ?? null);

    const isMicrosoft = email.provider === "microsoft";
    if (isMicrosoft && !email.provider_message_id) return;
    if (!isMicrosoft && !email.gmail_message_id) return;

    const emailId = email.id;
    if (bodyFetchAttemptedRef.current.has(emailId)) return;
    bodyFetchAttemptedRef.current.add(emailId);

    const ac = new AbortController();
    setBodyLoading(true);
    const fetchBody = async () => {
      try {
        const url = isMicrosoft ? "/api/outlook/fetch-body" : "/api/gmail/fetch-body";
        const payload = isMicrosoft
          ? { emailId: email.id, providerMessageId: email.provider_message_id }
          : { emailId: email.id, gmailMessageId: email.gmail_message_id };

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });

        const json = await res.json().catch(() => null);
        if (!isMountedRef.current) return;
        if (!res.ok) {
          setBodyLoading(false);
          setBodyFetchFailed(true);
          notify("Impossible de charger le contenu");
          return;
        }
        if (json?.ok === false || (json?.error && !json?.body)) {
          setBodyLoading(false);
          setBodyFetchFailed(true);
          notify("Impossible de charger le contenu");
          return;
        }
        if (json?.body != null) {
          const bodyStr = typeof json.body === "string" ? json.body : "";
          if (bodyStr.trim().length === 0) setBodyFetchedEmpty(true);
          setBody(bodyStr || null);
        }
        setBodyLoading(false);
        setBodyFetchFailed(false);
      } catch (e) {
        if (isMountedRef.current) {
          setBodyLoading(false);
          setBodyFetchFailed(true);
          if (e instanceof Error && e.name !== "AbortError") {
            notify("Impossible de charger le contenu");
            console.error("FETCH_BODY_ERROR", e);
          }
        }
      }
    };

    fetchBody();
    return () => ac.abort();
  }, [email?.id, email?.body, email?.provider, email?.provider_message_id, email?.gmail_message_id, retryBodyFetchTrigger]);

  const openExternal = () => {
    if (!email) return;

    // Outlook priority
    if (email.open_url) {
      window.open(email.open_url, "_blank");
      return;
    }

    // Gmail fallback
    if (email.gmail_message_id) {
      window.open(`https://mail.google.com/mail/u/0/#inbox/${email.gmail_message_id}`, "_blank");
      return;
    }

    notify("Impossible d’ouvrir : lien externe manquant.");
  };

  const generateReply = async () => {
    if (!email || replyLoading) return;
    if (!email.id) {
      notify("Erreur: emailId manquant (sélectionnez un email).");
      return;
    }
    setReplyLoading(true);
    const startMs = Date.now();
    console.log("[action] start", "generateReply", { action: "generateReply", emailId: email.id });
    try {
      const mode = settings?.assistant_enabled !== false
        ? (settings?.automation_level ?? "draft")
        : "draft";
      const payload = { emailId: email.id, mode };
      const json = await postJson("/api/ai/generate-reply", payload);
      if (!isMountedRef.current) return;
      if (json?.email) {
        applyEmailFromResponse(json.email);
        setAiReply(json.reply ?? json.email?.ai_reply ?? null);
      } else {
        setAiReply(json.reply ?? null);
        await refreshSelectedEmail();
      }
      setReplyOpen(true);
      if (isMountedRef.current) notify(mode === "autopilot" ? "Réponse IA prête (Autopilot)." : "Brouillon IA prêt.");
      const durationMs = Date.now() - startMs;
      console.log("[action] end", "generateReply", { action: "generateReply", ok: true, status: "ok", durationMs });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur génération IA";
      const durationMs = Date.now() - startMs;
      console.log("[action] end", "generateReply", { action: "generateReply", ok: false, status: "error", error: msg, durationMs });
      if (isMountedRef.current) {
        if (isAbortError(e)) {
          notify("Requête annulée (abort). Cause probable: refresh/refetch. Corrigé si A+B ok.");
        } else if (typeof msg === "string" && (msg.includes("timeout") || msg.includes("TIMEOUT") || msg.includes("Timeout"))) {
          notify("Timeout, réessayer");
        } else if (msg.includes("500") || msg.includes("Erreur serveur")) {
          notify("Erreur serveur" + (msg ? ` — ${msg}` : ""));
        } else {
          notify(msg);
        }
        setLastApiDebug((prev) => (prev ? { ...prev, json: { ...(prev as any).json, clientError: msg } } : null));
      }
      console.log("[action] error", "generateReply", msg);
    } finally {
      if (isMountedRef.current) setReplyLoading(false);
    }
  };

  const archive = async () => {
    if (!email) return;

    const isMicrosoft = email.provider === "microsoft";
    if (isMicrosoft && !email.provider_message_id) {
      notify("Impossible d’archiver : provider_message_id manquant.");
      return;
    }
    if (!isMicrosoft && !email.gmail_message_id) {
      notify("Impossible d’archiver : gmail_message_id manquant.");
      return;
    }

    try {
      const url = isMicrosoft ? "/api/outlook/archive" : "/api/gmail/archive";
      const payload = isMicrosoft
        ? { providerMessageId: email.provider_message_id, emailId: email.id }
        : { gmailMessageId: email.gmail_message_id, emailId: email.id };

      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      if (!res.ok) {
        notify(`Erreur archivage (${res.status}).`);
        return;
      }

      window.dispatchEvent(new Event("fix:emails-refresh"));
      notify("Archivé ✅");
    } catch (e) {
      if (isAbortError(e)) notify("Timeout — Réessayer");
      else notify("Erreur archivage.");
    }
  };

  const generateSlots = async () => {
    if (!email || slotsLoading) return;
    if (!email.id) {
      notify("Erreur: emailId manquant (sélectionnez un email).");
      return;
    }
    setSlotsLoading(true);
    const startMs = Date.now();
    console.log("[action] start", "generateSlots", { action: "generateSlots", emailId: email.id });
    try {
      const payload: { emailId: string; duration_min?: number } = { emailId: email.id };
      const cfgDuration = slotDurationFromSettings ?? settings?.config?.scheduling_rules?.slot_duration_min;
      if (cfgDuration != null && cfgDuration >= 15 && cfgDuration <= 120) payload.duration_min = cfgDuration;
      const json = await postJson("/api/leads/generate-slots", payload, {
        timeoutMs: GENERATE_SLOTS_TIMEOUT_MS,
      });
      if (!isMountedRef.current) return;
      if (json?.email) {
        applyEmailFromResponse(json.email);
        const listRaw = Array.isArray(json?.slots) ? json.slots : [];
        const list = listRaw.map((s: any) => (typeof s === "string" ? s : s?.start)).filter((x: any) => typeof x === "string");
        setSlots(list.length ? list : (json.email?.lead_json?.slots_proposed ?? []));
        setSlotsDurationMin(Number(json?.duration_min ?? json.email?.lead_json?.slots_duration_min ?? slotDurationFromSettings ?? 30));
        if (json?.reply_text) setAiReply(json.reply_text); else if (json.email?.ai_reply) setAiReply(json.email.ai_reply);
      } else {
        const listRaw = Array.isArray(json?.slots) ? json.slots : [];
        const list = listRaw.map((s: any) => (typeof s === "string" ? s : s?.start)).filter((x: any) => typeof x === "string");
        setSlots(list);
        setSlotsDurationMin(Number(json?.duration_min ?? slotDurationFromSettings ?? 30));
        if (json?.reply_text) setAiReply(json.reply_text);
        await refreshSelectedEmail();
      }
      if (isMountedRef.current) notify((json?.slots?.length ?? json?.email?.lead_json?.slots_proposed?.length ?? 0) ? "Créneaux générés ✅" : "Aucun créneau trouvé.");
      const durationMs = Date.now() - startMs;
      console.log("[action] end", "generateSlots", { action: "generateSlots", ok: true, status: "ok", durationMs, slotsCount: json?.slots?.length ?? json?.email?.lead_json?.slots_proposed?.length ?? 0 });
    } catch (e) {
      const anyErr: any = e;
      const msg = e instanceof Error ? e.message : "Erreur génération créneaux";
      const status = anyErr?.status as number | undefined;
      const body = anyErr?.json as any;
      const durationMs = Date.now() - startMs;
      console.error("[action] error", "generateSlots", {
        status,
        body,
        message: msg,
        durationMs,
      });
      console.log("[action] end", "generateSlots", { status: "error", ok: false, error: msg, durationMs });
      if (isMountedRef.current) {
        if (isAbortError(e)) {
          notify("Requête annulée (abort). Cause probable: refresh/refetch. Corrigé si A+B ok.");
        } else if (body?.error === "NO_CALENDAR_CONNECTED" || msg.includes("NO_CALENDAR_CONNECTED")) {
          notify("Connecte ton agenda (Google ou Outlook Calendar).");
        } else if (body?.error === "FREEBUSY_TIMEOUT" || msg.includes("FREEBUSY_TIMEOUT")) {
          notify("Agenda trop lent, réessaie.");
        } else if (body?.error === "FREEBUSY_FAILED" || msg.includes("FREEBUSY_FAILED")) {
          notify("Erreur agenda, vérifie la connexion de ton calendrier.");
        } else if (body?.error === "NO_SLOTS_AVAILABLE" || msg.includes("NO_SLOTS_AVAILABLE")) {
          notify("Aucun créneau libre dans les 5 prochains jours selon tes règles.");
        } else if (typeof msg === "string" && (msg.includes("timeout") || msg.includes("TIMEOUT") || msg.includes("Timeout"))) {
          notify("Timeout, réessayer");
        } else if (msg.includes("500") || msg.includes("Erreur serveur")) {
          notify("Erreur serveur" + (msg ? ` — ${msg}` : ""));
        } else {
          notify(msg);
        }
        setLastApiDebug((prev) =>
          prev
            ? {
                ...prev,
                clientError: msg,
              }
            : prev
        );
      }
    } finally {
      if (isMountedRef.current) setSlotsLoading(false);
    }
  };

  const actionSendProposal = async () => {
    if (!email || quickAction) return;
    if (!email.id) {
      notify("Erreur: emailId manquant.");
      return;
    }
    setQuickAction("generate_slots");
    const startMs = Date.now();
    console.log("[action] start", "actionSendProposal", { action: "actionSendProposal", emailId: email.id });
    try {
      const payload: { emailId: string; duration_min?: number } = { emailId: email.id };
      const cfgDuration = slotDurationFromSettings ?? settings?.config?.scheduling_rules?.slot_duration_min;
      if (cfgDuration != null && cfgDuration >= 15 && cfgDuration <= 120) payload.duration_min = cfgDuration;
      const json = await postJson("/api/leads/generate-slots", payload, {
        timeoutMs: GENERATE_SLOTS_TIMEOUT_MS,
      });
      if (!isMountedRef.current) return;
      if (json?.email) {
        applyEmailFromResponse(json.email);
        const listRaw = Array.isArray(json?.slots) ? json.slots : [];
        const list = listRaw.map((s: any) => (typeof s === "string" ? s : s?.start)).filter((x: any) => typeof x === "string");
        setSlots(list.length ? list : (json.email?.lead_json?.slots_proposed ?? []));
        setSlotsDurationMin(Number(json?.duration_min ?? json.email?.lead_json?.slots_duration_min ?? slotDurationFromSettings ?? 30));
        if (json?.reply_text) setAiReply(json.reply_text); else if (json.email?.ai_reply) setAiReply(json.email.ai_reply);
      } else {
        const listRaw = Array.isArray(json?.slots) ? json.slots : [];
        const list = listRaw.map((s: any) => (typeof s === "string" ? s : s?.start)).filter((x: any) => typeof x === "string");
        setSlots(list);
        setSlotsDurationMin(Number(json?.duration_min ?? slotDurationFromSettings ?? 30));
        if (json?.reply_text) setAiReply(json.reply_text);
        await refreshSelectedEmail();
      }
      if (isMountedRef.current) notify((json?.slots?.length ?? json?.email?.lead_json?.slots_proposed?.length ?? 0) ? "Créneaux générés ✅" : "Aucun créneau.");
      const durationMs = Date.now() - startMs;
      console.log("[action] end", "actionSendProposal", { action: "actionSendProposal", ok: true, status: "ok", durationMs });
    } catch (e) {
      const anyErr: any = e;
      const msg = e instanceof Error ? e.message : "Erreur génération créneaux";
      const status = anyErr?.status as number | undefined;
      const body = anyErr?.json as any;
      const durationMs = Date.now() - startMs;
      console.error("[action] error", "actionSendProposal", {
        status,
        body,
        message: msg,
        durationMs,
      });
      console.log("[action] end", "actionSendProposal", { action: "actionSendProposal", ok: false, status: "error", error: msg, durationMs });
      if (isMountedRef.current) {
        if (isAbortError(e)) {
          notify("Requête annulée (abort). Cause probable: refresh/refetch. Corrigé si A+B ok.");
        } else if (body?.error === "NO_CALENDAR_CONNECTED" || msg.includes("NO_CALENDAR_CONNECTED")) {
          notify("Connecte ton agenda (Google ou Outlook Calendar).");
        } else if (body?.error === "FREEBUSY_TIMEOUT" || msg.includes("FREEBUSY_TIMEOUT")) {
          notify("Agenda trop lent, réessaie.");
        } else if (body?.error === "FREEBUSY_FAILED" || msg.includes("FREEBUSY_FAILED")) {
          notify("Erreur agenda, vérifie la connexion de ton calendrier.");
        } else if (body?.error === "NO_SLOTS_AVAILABLE" || msg.includes("NO_SLOTS_AVAILABLE")) {
          notify("Aucun créneau libre dans les 5 prochains jours selon tes règles.");
        } else if (typeof msg === "string" && (msg.includes("timeout") || msg.includes("TIMEOUT") || msg.includes("Timeout"))) {
          notify("Timeout, réessayer");
        } else if (msg.includes("500") || msg.includes("Erreur serveur")) {
          notify("Erreur serveur" + (msg ? ` — ${msg}` : ""));
        } else {
          notify(msg);
        }
        setLastApiDebug((prev) =>
          prev
            ? {
                ...prev,
                clientError: msg,
              }
            : prev
        );
      }
    } finally {
      setQuickAction(null);
    }
  };

  const sendProposalOnly = async () => {
    if (!email?.id || sendProposalLoading) return;
    setSendProposalLoading(true);
    console.log("[action] start", "sendProposalOnly", { emailId: email.id });
    try {
      const j = await postJson("/api/leads/send-proposal", { emailId: email.id });
      window.dispatchEvent(new Event("fix:emails-refresh"));
      if (j?.success === true && j?.draft === true) {
        await refreshSelectedEmail();
        if (isMountedRef.current) notify("Brouillon créé. Utilisez « Envoyer brouillon » pour envoyer.");
      } else if (j?.success === true && !j?.skipped) {
        await refreshSelectedEmail();
        if (isMountedRef.current) notify("Proposition envoyée ✅");
      } else if (j?.success === true && j?.reason === "ALREADY_SENT") {
        if (isMountedRef.current) notify("Proposition déjà envoyée.");
        await refreshSelectedEmail();
      } else if (j?.error) {
        if (j?.error === "NO_SLOTS_PROPOSED" && isMountedRef.current) notify("Génère d'abord des créneaux.");
        else if (isMountedRef.current) notify(j?.error ?? "Erreur envoi proposition");
        await refreshSelectedEmail();
      } else {
        await refreshSelectedEmail();
        if (isMountedRef.current) notify("Proposition envoyée ✅");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur envoi proposition";
      if (isMountedRef.current) notify(msg);
    } finally {
      setSendProposalLoading(false);
    }
  };

  const actionConfirmManual = async () => {
    if (!email || quickAction) return;
    setQuickAction("confirm");
    console.log("[action] start", "actionConfirmManual");
    try {
      const res = await fetchWithTimeout("/api/leads/confirm-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id }),
        cache: "no-store",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        notify(json?.error === "MISSING_SLOT" ? "Aucun créneau proposé pour ce lead." : "Erreur confirmation.");
        return;
      }
      window.dispatchEvent(new Event("fix:emails-refresh"));
      notify("Visite confirmée ✅");
      console.log("[action] end", "actionConfirmManual");
    } catch (e) {
      console.log("[action] error", "actionConfirmManual", e);
      if (isAbortError(e)) notify("Timeout — Réessayer");
      else notify("Erreur confirmation.");
    } finally {
      setQuickAction(null);
    }
  };

  const hasDraft = (() => {
    const lj = email?.lead_json as { draft_reply?: unknown; draft_proposal?: unknown } | null;
    const hasAiReply = (email?.ai_reply ?? "").trim().length > 0;
    return !!(lj?.draft_reply || lj?.draft_proposal || hasAiReply);
  })();

  const leadJsonForSent = (email?.lead_json ?? null) as { last_outbound?: LastOutbound } | null;
  const alreadySentReply = isReplyAlreadySent(leadJsonForSent, email?.lead_last_action ?? null);
  const alreadySentProposal = isProposalAlreadySent(leadJsonForSent, email?.lead_last_action ?? null);
  const cannotSendDraft = hasDraft && (alreadySentReply || alreadySentProposal);

  const statusStr = email?.lead_status != null ? String(email.lead_status) : "";
  const needsAnalysis =
    !statusStr ||
    statusStr === "raw" ||
    statusStr === "unclassified" ||
    statusStr === "retry_later";

  const actionAnalyzeSingle = async () => {
    if (!email || analyzeSingleLoading) return;
    setAnalyzeSingleLoading(true);
    console.log("[action] start", "actionAnalyzeSingle");
    try {
      const res = await fetchWithTimeout("/api/ai/analyze-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: email.id }),
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      if (res.ok) {
        notify("Analyse terminée ✅");
        onRefresh?.();
        window.dispatchEvent(new Event("fix:emails-refresh"));
        console.log("[action] end", "actionAnalyzeSingle");
      } else {
        notify(j?.error ?? "Erreur");
        console.log("[action] error", "actionAnalyzeSingle", j?.error);
      }
    } catch (e) {
      console.log("[action] error", "actionAnalyzeSingle", e);
      if (isAbortError(e)) notify("Timeout — Réessayer");
      else notify("Timeout ou erreur");
    } finally {
      setAnalyzeSingleLoading(false);
    }
  };

  const actionSendDraft = async () => {
    if (!email || quickAction || !hasDraft) return;
    if (!email.id) {
      notify("Erreur: emailId manquant.");
      return;
    }
    setQuickAction("send_draft");
    const startMs = Date.now();
    console.log("[action] start", "actionSendDraft", { action: "actionSendDraft", emailId: email.id });
    try {
      const payload = { emailId: email.id, text: (aiReply ?? "").trim() || undefined };
      const j = await postJson("/api/emails/send-draft", payload);
      window.dispatchEvent(new Event("fix:emails-refresh"));
      if (j?.ok === true && j?.sent === true) {
        if (j?.email) applyEmailFromResponse(j.email);
        else await refreshSelectedEmail();
        if (isMountedRef.current) notify("Email envoyé ✅ (Envoyés + destinataire)");
        const durationMs = Date.now() - startMs;
        console.log("[action] end", "actionSendDraft", { action: "actionSendDraft", ok: true, status: "sent", durationMs });
        return;
      }
      if (j?.ok === true && (j?.sent === false || j?.reason === "already_sent")) {
        if (isMountedRef.current) notify("Déjà envoyé.");
        const durationMs = Date.now() - startMs;
        console.log("[action] end", "actionSendDraft", { action: "actionSendDraft", ok: true, status: "already_sent", durationMs });
        return;
      }
      if (isMountedRef.current) notify(j?.details ?? j?.error ?? "Erreur envoi");
      const durationMs = Date.now() - startMs;
      console.log("[action] end", "actionSendDraft", { action: "actionSendDraft", ok: false, status: "error", error: j?.error ?? j?.details, durationMs });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur envoi";
      const durationMs = Date.now() - startMs;
      console.log("[action] end", "actionSendDraft", { action: "actionSendDraft", ok: false, status: "error", error: msg, durationMs });
      if (isMountedRef.current) {
        if (isAbortError(e)) notify("Requête annulée (abort). Cause probable: refresh/refetch. Corrigé si A+B ok.");
        else if (typeof msg === "string" && (msg.includes("timeout") || msg.includes("TIMEOUT") || msg.includes("Timeout"))) notify("Timeout, réessayer");
        else if (msg.includes("500") || msg.includes("Erreur serveur")) notify("Erreur serveur" + (msg ? ` — ${msg}` : ""));
        else notify(msg);
      }
      console.log("[action] error", "actionSendDraft", msg);
    } finally {
      setQuickAction(null);
    }
  };

  const actionMarkUnqualified = async () => {
    if (!email || quickAction) return;
    setQuickAction("reject");
    console.log("[action] start", "actionMarkUnqualified");
    try {
      const res = await fetchWithTimeout("/api/leads/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id, action: "reject" }),
        cache: "no-store",
      });
      if (!res.ok) {
        notify("Erreur.");
        return;
      }
      window.dispatchEvent(new Event("fix:emails-refresh"));
      notify("Marqué non qualifié.");
      console.log("[action] end", "actionMarkUnqualified");
    } catch (e) {
      console.log("[action] error", "actionMarkUnqualified", e);
      if (isAbortError(e)) notify("Timeout — Réessayer");
      else notify("Erreur.");
    } finally {
      setQuickAction(null);
    }
  };

  // ✅ useMemo DOIT être avant tout return conditionnel (sinon bug React hooks)
  const bodyHtml = (email as { body_html?: string | null })?.body_html;
  const bodyText = (email as { body_text?: string | null })?.body_text;
  const rawContent = body ?? bodyHtml ?? email?.body ?? "";
  const isHtml = looksLikeHtml(rawContent);
  const previewText = useMemo(() => {
    if (rawContent && isHtml) return stripHtmlToText(rawContent, 1200);
    if (bodyText) return bodyText.length > 1200 ? bodyText.slice(0, 1200).trim() + "…" : bodyText;
    if (rawContent && !isHtml) return rawContent.length > 1200 ? rawContent.slice(0, 1200).trim() + "…" : rawContent.trim();
    return null;
  }, [rawContent, isHtml, bodyText]);

  const isDraftMode = settings?.assistant_enabled !== false && (settings?.automation_level ?? "draft") === "draft";
  const ljForCta = (email?.lead_json ?? {}) as {
    slots_proposed?: string[];
    draft_reply?: unknown;
    draft_proposal?: unknown;
    proposal_slots_sent?: boolean;
    confirmed_slot?: string;
    calendar_event_id?: string;
  };
  const slotsStoredCta = Array.isArray(ljForCta?.slots_proposed) ? ljForCta.slots_proposed : [];
  const proposalSentCta = !!(
    ljForCta?.proposal_slots_sent ||
    alreadySentProposal
  );
  const isBooked = (email?.lead_status ?? "") === "booked";

  // Prochaine action : source de vérité = état du lead (Draft et Autopilot)
  const nextActionCta = useMemo(() => {
    if (!email) return null;
    const missing = missingList(email);
    const status = email.lead_status ?? "raw";
    const hasMissing = missing.length > 0;
    const qualified = !!(email as { lead_is_qualified?: boolean }).lead_is_qualified;
    const hasSlots = slotsStoredCta.length > 0;
    const hasDraftReply = !!(email.ai_reply ?? "").trim() || !!ljForCta.draft_reply;
    const hasDraftProposal = !!ljForCta.draft_proposal;
    const sentReply = alreadySentReply;

    if (isBooked)
      return { label: "Visite confirmée", action: "booked" as const, eventId: ljForCta.calendar_event_id };
    if (!hasSlots && qualified)
      return { label: "Générer des créneaux", action: "generate_slots" as const };
    if (hasSlots && !proposalSentCta)
      return { label: "Envoyer proposition", action: "send_proposal" as const };
    if (proposalSentCta && !isBooked)
      return { label: "Attendre réponse du prospect", action: "wait_reply" as const };
    if (["new_lead", "qualifying"].includes(status) && hasMissing)
      return { label: "Générer brouillon (infos manquantes)", action: "generate_draft" as const };
    if (hasDraftReply && !sentReply)
      return { label: "Envoyer brouillon", action: "send_draft" as const };
    return null;
  }, [email, alreadySentReply, alreadySentProposal, slotsStoredCta, proposalSentCta, isBooked]);

  if (!email) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/60 p-8 text-center">
          <div className="text-lg font-semibold text-white">Sélectionnez un prospect</div>
          <p className="mt-2 text-sm text-slate-400">
            Cliquez à gauche pour ouvrir le dossier. Astuce: utilisez Kanban pour traiter par étape.
          </p>
          <button
            type="button"
            onClick={() => {
              if (onSetView) onSetView("kanban");
              else window.dispatchEvent(new CustomEvent("fix:emails-set-view", { detail: { view: "kanban" } }));
            }}
            className="mt-4 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
          >
            Aller au Kanban
          </button>
        </div>
      </div>
    );
  }

  const name = candidateName(email);
  const prop = propertyLabel(email);
  const status = email.lead_status ?? "raw";
  const score = email.lead_score ?? null;
  const intent = (email.lead_json as { intent?: "LOCATION" | "INFORMATION" } | null)?.intent ?? "LOCATION";

  const profile = email.lead_profile ?? null;
  const missing = missingList(email);
  const lj = (email.lead_json ?? {}) as {
    slots_proposed?: string[];
    draft_reply?: { text?: string } | null;
    draft_proposal?: unknown;
    info_question?: string;
    info_source?: "faq" | "ia" | string;
    faq_missing?: boolean;
    autopilot_pending?: boolean;
    autopilot_block_reason?: string;
    last_outbound?: { type?: string };
  };
  const slotsStored = Array.isArray(lj.slots_proposed) ? lj.slots_proposed : [];
  const autopilotBlockReason = lj.autopilot_block_reason?.trim() || null;

  const globalAutopilot = settings?.assistant_enabled !== false && settings?.automation_level === "autopilot";
  const override = autopilotOverrideByLead[email.id];
  const effectiveAutopilot = override !== undefined ? override : globalAutopilot;

  const infoStatusLabel =
    intent === "INFORMATION"
      ? lj.last_outbound?.type === "info_reply"
        ? "Réponse envoyée"
        : lj.autopilot_pending
          ? "Envoi en cours (Autopilot)"
          : !effectiveAutopilot && lj.draft_reply?.text
            ? "Brouillon prêt"
            : "INFO"
      : null;

  const runNextAction = () => {
    if (!nextActionCta) return;
    if (nextActionCta.action === "generate_draft") generateReply();
    else if (nextActionCta.action === "generate_slots") generateSlots();
    else if (nextActionCta.action === "send_proposal") sendProposalOnly();
    else if (nextActionCta.action === "send_draft") actionSendDraft();
    else if (nextActionCta.action === "wait_reply") sendProposalOnly();
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="p-3 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-200">
          {toast}
        </div>
      )}

      {/* 1. Header: nom, score, intent, statut, mode Draft/Autopilot, dernière action */}
      <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{name}</h2>
            <p className="text-sm text-gray-400 truncate mt-0.5">{prop}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${scoreColor(score)}`}>
              {typeof score === "number" ? `${score}/10` : "—"}
            </span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${intent === "LOCATION" ? "bg-blue-900/50 text-blue-200" : "bg-slate-700 text-slate-400"}`}>
              {intent === "LOCATION" ? "LOCATION" : infoStatusLabel ? `INFO — ${infoStatusLabel}` : "INFO"}
            </span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusPill(status)}`}>
              {statusLabel(status)}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {effectiveAutopilot ? "Autopilot" : "Draft"}
            </span>
          </div>
        </div>
        {email.lead_last_action != null && String(email.lead_last_action).trim() !== "" && (
          <p className="text-xs text-gray-500">Dernière action: {String(email.lead_last_action).trim()}</p>
        )}
        {autopilotBlockReason && (
          <div className="mt-2 p-2 rounded-lg bg-amber-900/40 border border-amber-700/60">
            <p className="text-xs font-medium text-amber-200">Autopilot bloqué: {autopilotBlockReason}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(autopilotBlockReason === "calendar" || autopilotBlockReason === "quiet hours") && (
                <a href="/settings" className="text-xs text-sky-400 hover:underline">Paramètres / Connexion calendrier</a>
              )}
              {autopilotBlockReason === "property missing" && (
                <a href="/settings" className="text-xs text-sky-400 hover:underline">Paramètres / Biens</a>
              )}
              {autopilotBlockReason === "faq missing" && (
                <a href="/settings" className="text-xs text-sky-400 hover:underline">Paramètres / FAQ</a>
              )}
              {autopilotBlockReason === "rate limit" && (
                <span className="text-xs text-slate-400">Attendre 1h ou augmenter la limite dans Paramètres</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Prochaine action — 1 CTA principal */}
      <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 space-y-3">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Prochaine action</div>
        {nextActionCta ? (
          nextActionCta.action === "booked" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-green-400 font-medium">Visite confirmée</p>
              {"eventId" in nextActionCta && nextActionCta.eventId && (
                <p className="text-xs text-gray-500">Événement calendrier enregistré.</p>
              )}
            </div>
          ) : nextActionCta.action === "wait_reply" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-gray-300">Attendre réponse du prospect (1, 2 ou 3).</p>
              <button
                type="button"
                onClick={sendProposalOnly}
                disabled={sendProposalLoading}
                className="w-full rounded-xl border border-sky-600 bg-sky-900/40 px-4 py-2.5 text-sm font-medium text-sky-300 hover:bg-sky-800/50 disabled:opacity-50"
              >
                {sendProposalLoading ? "Envoi…" : "Relancer"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={runNextAction}
              disabled={
                (nextActionCta.action === "generate_draft" && replyLoading) ||
                (nextActionCta.action === "generate_slots" && slotsLoading) ||
                (nextActionCta.action === "send_proposal" && (sendProposalLoading || !!quickAction)) ||
                (nextActionCta.action === "send_draft" && (!!quickAction || cannotSendDraft))
              }
              className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {nextActionCta.action === "generate_draft" && replyLoading
                ? "Génération…"
                : nextActionCta.action === "generate_slots" && slotsLoading
                  ? "Génération créneaux…"
                  : nextActionCta.action === "send_proposal" && sendProposalLoading
                    ? "Envoi…"
                    : nextActionCta.action === "send_draft" && quickAction === "send_draft"
                      ? "Envoi…"
                      : nextActionCta.label}
            </button>
          )
        ) : (
          <p className="text-sm text-gray-500">Aucune action requise pour l’instant.</p>
        )}
      </div>

      {/* Debug: dernier appel API — status + json.ok / json.error / json.email (ai_reply + slots length) */}
      {showDebug && lastApiDebug && (
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono space-y-1">
          <div className="text-slate-400 font-semibold">Dernier appel API</div>
          <div><span className="text-slate-500">path:</span> {lastApiDebug.path}</div>
          <div><span className="text-slate-500">status:</span> {lastApiDebug.status} {lastApiDebug.ok ? "✓" : "✗"}</div>
          <div><span className="text-slate-500">json.ok:</span> {(lastApiDebug.json as any)?.ok === true ? "true" : (lastApiDebug.json as any)?.ok === false ? "false" : "—"}</div>
          {(lastApiDebug.json as any)?.error != null && (
            <div className="text-amber-400">json.error: {(lastApiDebug.json as any).error}</div>
          )}
          {(lastApiDebug.json as any)?.reason != null && (
            <div className="text-slate-400">json.reason: {(lastApiDebug.json as any).reason}</div>
          )}
          {(lastApiDebug.json as any)?.email != null && (
            <div className="text-slate-300 space-y-0.5">
              <div>json.email: ai_reply length = {((lastApiDebug.json as any).email?.ai_reply ?? "").length}, slots_proposed length = {extractSlotsFromEmail((lastApiDebug.json as any).email).length}</div>
              {(lastApiDebug.json as any).provider != null && <div>provider: {(lastApiDebug.json as any).provider}</div>}
              {(lastApiDebug.json as any).to != null && <div className="truncate">to: {(lastApiDebug.json as any).to}</div>}
            </div>
          )}
          {lastApiDebug.json && (lastApiDebug.json as any).sent != null && (
            <div className="text-slate-300">sent: {(lastApiDebug.json as any).sent === true ? "true" : "false"}{(lastApiDebug.json as any).reason ? `, reason: ${(lastApiDebug.json as any).reason}` : ""}</div>
          )}
          {lastApiDebug.json && (lastApiDebug.json as any).to != null && (
            <div className="text-slate-400 truncate">to: {(lastApiDebug.json as any).to}</div>
          )}
          {!(lastApiDebug.json as any)?.email && lastApiDebug.text && (
            <div className="text-slate-500 truncate max-w-full break-all">text: {lastApiDebug.text.slice(0, 300)}{lastApiDebug.text.length > 300 ? "…" : ""}</div>
          )}
          <div className="text-slate-500">ms: {lastApiDebug.ms}</div>
          <button
            type="button"
            onClick={() => {
              const str = JSON.stringify(lastApiDebug, null, 2);
              if (typeof navigator?.clipboard?.writeText === "function") {
                navigator.clipboard.writeText(str).then(() => notify("Debug copié")).catch(() => notify("Erreur copie"));
              }
            }}
            className="mt-1 px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
          >
            Copier debug
          </button>
        </div>
      )}

      {/* Intent = INFORMATION: question / réponse / source / CTA Ajouter FAQ */}
      {intent === "INFORMATION" && (
        <div className="p-5 rounded-xl bg-gray-900 border border-gray-800 space-y-4">
          <div className="text-sm font-semibold text-white">Assistant information</div>
          <div className="space-y-2">
            <div>
              <span className="text-xs text-slate-400">Question détectée</span>
              <p className="text-sm text-slate-200 mt-0.5">{lj.info_question || email.subject || "—"}</p>
            </div>
            <div>
              <span className="text-xs text-slate-400">Réponse {email.ai_reply?.trim() ? "envoyée / préparée" : "—"}</span>
              {email.ai_reply?.trim() && (
                <div className="mt-1 p-3 rounded-lg bg-slate-800/50 text-sm text-slate-200 whitespace-pre-wrap">{email.ai_reply}</div>
              )}
            </div>
            <div>
              <span className="text-xs text-slate-400">Source</span>
              <p className="text-sm text-slate-300">
                {String(lj.info_source || "").toUpperCase() === "FAQ" ? "FAQ" : String(lj.info_source || "").toUpperCase() === "MISSING_FAQ" ? "FAQ manquante" : lj.faq_missing ? "IA (FAQ manquante)" : "IA"}
              </p>
            </div>
          </div>
          {!showAddFaqForm ? (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={() => {
                  setAddFaqQuestion(lj.info_question || email.subject || "");
                  setAddFaqAnswer((email.ai_reply ?? "").trim());
                  setShowAddFaqForm(true);
                }}
                className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600"
              >
                Ajouter à la FAQ
              </button>
            </div>
          ) : (
            <div className="space-y-2 p-3 rounded-lg border border-slate-700">
              <input
                value={addFaqQuestion}
                onChange={(e) => setAddFaqQuestion(e.target.value)}
                placeholder="Question"
                className="w-full rounded-lg bg-slate-800 border border-slate-600 px-2 py-1.5 text-sm text-white"
              />
              <textarea
                value={addFaqAnswer}
                onChange={(e) => setAddFaqAnswer(e.target.value)}
                placeholder="Réponse agence"
                rows={3}
                className="w-full rounded-lg bg-slate-800 border border-slate-600 px-2 py-1.5 text-sm text-white"
              />
              {(() => {
                const list: FaqItem[] = Array.isArray(settings?.config?.faq_items)
                  ? (settings!.config!.faq_items as any[]).map((it) => ({
                      id: String(it?.id ?? crypto.randomUUID()),
                      question: String(it?.question ?? ""),
                      answer: String(it?.answer ?? ""),
                      updated_at: it?.updated_at ? String(it.updated_at) : undefined,
                    }))
                  : [];
                const normNew = normalizeFaqQuestion(addFaqQuestion.trim());
                const existingId = normNew ? list.find((it) => normalizeFaqQuestion((it?.question ?? "").trim()) === normNew)?.id : null;
                const isUpdate = !!existingId;
                return (
                  <div className="flex flex-wrap gap-2 items-center">
                    {isUpdate && (
                      <span className="text-xs text-amber-400">Une entrée avec cette question existe déjà.</span>
                    )}
                    <button
                      type="button"
                      disabled={addFaqSaving}
                      onClick={async () => {
                        if (!addFaqQuestion.trim()) return;
                        setAddFaqSaving(true);
                        try {
                          const listCopy = [...list];
                          if (isUpdate && existingId) {
                            const idx = listCopy.findIndex((it) => it?.id === existingId);
                            if (idx >= 0) {
                              listCopy[idx] = { ...listCopy[idx], question: addFaqQuestion.trim(), answer: addFaqAnswer.trim(), updated_at: new Date().toISOString() };
                            }
                            await updateSettings({ config: { faq_items: listCopy } as any });
                            notify("Entrée FAQ mise à jour ✅");
                          } else {
                            const newItem = {
                              id: `faq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                              question: addFaqQuestion.trim(),
                              answer: addFaqAnswer.trim(),
                              updated_at: new Date().toISOString(),
                            };
                            await updateSettings({ config: { faq_items: [...list, newItem] } as any });
                            notify("Ajouté à la FAQ ✅");
                          }
                          setShowAddFaqForm(false);
                          setAddFaqQuestion("");
                          setAddFaqAnswer("");
                        } catch {
                          notify("Erreur enregistrement FAQ");
                        } finally {
                          setAddFaqSaving(false);
                        }
                      }}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {addFaqSaving ? "Enregistrement…" : isUpdate ? "Mettre à jour l'entrée existante" : "Enregistrer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddFaqForm(false)}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Annuler
                    </button>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Intent = LOCATION: Solvabilité + Fiche + Bien + Réponse + Créneaux */}
      {intent === "LOCATION" && (
        <>
      {/* Solvabilité (Revenus / Loyer × multiplicateur) */}
      {(() => {
        const income = (profile as { monthly_income?: number })?.monthly_income ?? (email as any).monthly_income ?? null;
        const rent = (email.lead_json as { rent?: number; property_rent?: number } | null)?.rent ?? (email.lead_json as any)?.property_rent ?? null;
        const multiplier = (settings?.config as any)?.rental_rules?.income_multiplier ?? 3;
        const ok = typeof income === "number" && typeof rent === "number" && rent > 0 && income >= rent * multiplier;
        return (
          <div className="p-5 rounded-xl bg-gray-900 border border-gray-800 space-y-2">
            <div className="text-sm font-semibold text-white">Solvabilité</div>
            <p className="text-xs text-slate-500">Règle agence : revenus nets ≥ loyer × {multiplier}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-slate-400">Revenus: {income != null ? `${income} €` : "—"}</span>
              <span className="text-slate-400">Loyer: {rent != null ? `${rent} €` : "Loyer manquant"}</span>
              {typeof income === "number" && typeof rent === "number" && rent > 0 && (
                <span className={ok ? "text-green-400 font-medium" : "text-amber-400 font-medium"}>
                  Verdict: {ok ? "OK" : "Sous le seuil"}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* 3. Fiche prospect */}
      <div className="p-5 rounded-xl bg-gray-900 border border-gray-800 space-y-4">
        <div className="text-sm font-semibold text-white">Fiche prospect</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div className="space-y-0.5"><span className="text-sm text-gray-500/60 uppercase tracking-wide">Tél</span><div className="text-base text-gray-200">{profile?.phone ?? "—"}</div></div>
          <div className="space-y-0.5"><span className="text-sm text-gray-500/60 uppercase tracking-wide">Revenus</span><div className="text-base text-gray-200">{prettyMoney(profile?.monthly_income ?? null)}</div></div>
          <div className="space-y-0.5"><span className="text-sm text-gray-500/60 uppercase tracking-wide">Statut pro</span><div className="text-base text-gray-200">{profile?.employment_status ?? "—"}</div></div>
          <div className="space-y-0.5"><span className="text-sm text-gray-500/60 uppercase tracking-wide">Garant</span><div className="text-base text-gray-200">{typeof profile?.has_guarantor === "boolean" ? (profile.has_guarantor ? "Oui" : "Non") : "—"}</div></div>
        </div>
        {missing.length > 0 && (
          <div className="p-3 rounded-lg bg-orange-900/20 border border-orange-800/40">
            <div className="text-xs text-orange-300 font-medium">Manque :</div>
            <p className="text-sm text-orange-200 mt-1">{missing.join(", ")}</p>
          </div>
        )}
      </div>

      {/* 4. Bien */}
      <div className="p-5 rounded-xl bg-gray-900 border border-gray-800 space-y-2">
        <div className="text-sm font-semibold text-white">Bien</div>
        <p className="text-sm text-gray-300 truncate" title={prop}>{prop}</p>
        {(email as { property_id?: string | null }).property_id != null && String((email as { property_id?: string | null }).property_id).trim() !== "" && (
          <p className="text-xs text-gray-500">ID bien: {(email as { property_id?: string | null }).property_id}</p>
        )}
      </div>

      {/* 5. Réponse IA — textarea éditable + Copier / Envoyer (Draft) / Marquer non qualifié */}
      <div className="p-5 rounded-xl bg-gray-900 border border-gray-800 space-y-3">
        <div className="text-sm font-semibold text-white">Réponse IA</div>
        {!aiReply && !hasDraft && (
          <p className="text-sm text-gray-500">Aucun brouillon. Utilisez « Générer brouillon » dans Prochaine action.</p>
        )}
        {(aiReply != null || hasDraft) && (
          <>
            <textarea
              value={aiReply ?? ""}
              onChange={(e) => setAiReply(e.target.value)}
              className="w-full min-h-[120px] rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-sky-500 focus:outline-none"
              placeholder="Brouillon de réponse…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const text = String(aiReply ?? "").trim();
                  if (typeof navigator?.clipboard?.writeText === "function") {
                    navigator.clipboard.writeText(text).then(() => notify("Copié ✅")).catch(() => notify("Erreur copie"));
                  } else notify("Copie non disponible");
                }}
                className="rounded-lg border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600"
              >
                Copier
              </button>
              <button
                type="button"
                onClick={actionSendDraft}
                disabled={!!quickAction || cannotSendDraft}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {quickAction === "send_draft" ? "Envoi…" : "Envoyer (Draft)"}
              </button>
              {cannotSendDraft && <span className="text-xs text-slate-400">Déjà envoyé</span>}
              <button
                type="button"
                onClick={actionMarkUnqualified}
                disabled={!!quickAction}
                className="rounded-lg border border-red-800/60 bg-red-900/40 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-900/60 disabled:opacity-50"
              >
                {quickAction === "reject" ? "…" : "Marquer non qualifié"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 6. Créneaux proposés */}
      <div id="creneaux-slots" className="p-5 rounded-xl bg-gray-900 border border-gray-800 space-y-3">
        <div className="text-sm font-semibold text-white">Créneaux de visite</div>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={generateSlots}
            disabled={slotsLoading}
            className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {slotsLoading ? "Génération…" : "Générer des créneaux"}
          </button>
          <button
            type="button"
            onClick={sendProposalOnly}
            disabled={slots.length === 0 || sendProposalLoading}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {sendProposalLoading ? "Envoi…" : "Envoyer proposition"}
          </button>
        </div>
        {slots.length === 0 ? (
          <div className="text-sm text-gray-400">
            Aucun créneau enregistré. Clique sur “Générer des créneaux”.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-gray-400">
              Durée estimée : {slotsDurationMin} min — clique pour confirmer.
            </div>

            <div className="flex flex-col gap-2">
              {slots.map((iso) => {
                const d = new Date(iso);
                const end = new Date(d.getTime() + slotsDurationMin * 60_000);

                const label =
                  `${d.toLocaleDateString("fr-FR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                  })} — ${d.toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })} → ${end.toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`;

                return (
                  <button
                    key={iso}
                    onClick={async () => {
                      if (!email) return;
                      setConfirmLoadingStart(iso);
                      try {
                        const res = await fetchWithTimeout("/api/leads/confirm-slot", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ emailId: email.id, slotStart: iso, trigger: "manual" }),
                          cache: "no-store",
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok) {
                          notify(json?.error ?? "Erreur confirmation du créneau.");
                          return;
                        }
                        window.dispatchEvent(new Event("fix:emails-refresh"));
                        notify("Visite confirmée ✅ (événement créé)");
                      } catch (e) {
                        if (isAbortError(e)) notify("Timeout — Réessayer");
                        else notify("Erreur confirmation.");
                      } finally {
                        setConfirmLoadingStart(null);
                      }
                    }}
                    disabled={confirmLoadingStart === iso}
                    className="text-left px-3 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-sm disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>🕒 {label}</div>
                      <div className="text-xs text-gray-400">
                        {confirmLoadingStart === iso ? "Confirmation…" : "Confirmer"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="text-[11px] text-gray-500">
              Après confirmation : statut = “Visite confirmée” + relance automatique planifiée (tâche à J-0, H-2).
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {/* 7. Email source */}
      <div className="p-5 rounded-xl bg-gray-900 border border-gray-800 space-y-3">
        <div className="text-sm font-semibold text-white">Email source</div>

        <div className="text-sm text-gray-200 font-medium">
          {decodeUtf8Mojibake(email.subject ?? "") || "(Sans objet)"}
        </div>

        {previewText ? (
          <div>
            <div className="text-xs text-slate-500 mb-1">Aperçu du message</div>
            <div className="text-sm text-gray-300 bg-gray-950/40 border border-gray-800 rounded-lg p-3 max-h-72 overflow-y-auto">
              <div className="whitespace-pre-line">{previewText}</div>
            </div>
          </div>
        ) : bodyLoading ? (
          <div className="text-sm text-slate-400">Chargement du contenu…</div>
        ) : bodyFetchFailed ? (
          <div className="flex flex-col gap-2">
            <div className="text-sm text-amber-500/90">Impossible de charger le contenu</div>
            <button
              type="button"
              onClick={() => {
                if (email?.id) {
                  bodyFetchAttemptedRef.current.delete(email.id);
                  setBodyFetchFailed(false);
                  setRetryBodyFetchTrigger((t) => t + 1);
                }
              }}
              className="self-start rounded-lg border border-amber-600 bg-amber-900/30 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-800/50"
            >
              Réessayer
            </button>
          </div>
        ) : bodyFetchedEmpty ? (
          <div className="text-sm text-amber-500/90 italic">Body vide côté provider</div>
        ) : (
          <div className="text-sm text-slate-500 italic">Aucun contenu</div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRawHtml((v) => !v)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-700"
          >
            {showRawHtml ? "Masquer brut" : "Voir brut"}
          </button>
          {rawContent && isHtml && (
            <button
              type="button"
              onClick={() => setShowRendered((v) => !v)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-700"
            >
              {showRendered ? "Masquer rendu" : "Voir rendu"}
            </button>
          )}
        </div>

        {showRawHtml && rawContent && (
          <pre className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono">
            {rawContent}
          </pre>
        )}

        {showRendered && rawContent && isHtml && (
          <iframe
            sandbox="allow-same-origin"
            srcDoc={rawContent}
            title="Aperçu rendu"
            className="w-full min-h-[200px] max-h-72 rounded-lg border border-slate-800 bg-white text-gray-900 overflow-auto"
          />
        )}

        <div className="flex flex-wrap gap-2">
          {(email.open_url || email.gmail_message_id) && (
            <button
              onClick={openExternal}
              className="px-3 py-2 rounded-md bg-blue-600 text-sm hover:bg-blue-500 text-black font-medium"
            >
              📩 Ouvrir dans la boîte mail
            </button>
          )}

          <button
            onClick={archive}
            className="px-3 py-2 rounded-md bg-gray-800 text-sm hover:bg-gray-700"
          >
            Archiver
          </button>
        </div>
      </div>

    </div>
  );
}
