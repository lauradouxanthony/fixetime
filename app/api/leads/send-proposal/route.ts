import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailEmail } from "@/lib/google/sendEmail";
import { sendOutlookEmail } from "@/lib/microsoft/sendEmail";
import { logActivity } from "@/lib/activity/logActivity";
import { isProposalAlreadySent } from "@/lib/email/alreadySent";


export const runtime = "nodejs";

function formatSlots(slots: string[], tz = "Europe/Paris") {
  return slots.slice(0, 3).map((iso, idx) => {
    const d = new Date(iso);
    const label = d.toLocaleString("fr-FR", {
      timeZone: tz,
      weekday: "long",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${idx + 1}) ${label}`;
  });
}

export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  try {
    const cronKey = req.headers.get("x-fixetime-cron-key") || req.headers.get("x-cron-key");
    const isCronCall = cronKey === (process.env.FIXETIME_INTERNAL_CRON_KEY || "dev123");

    let userId: string | null = null;
    if (!isCronCall) {
      const supabase = await supabaseServer();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });
      userId = user.id;
    }

    const body = await req.json().catch(() => null);
    const trigger =
  body?.trigger === "autopilot" || req.headers.get("x-fix-trigger") === "autopilot"
    ? "autopilot"
    : "manual";

    const emailId = body?.emailId as string | undefined;

    if (!emailId) {
      return NextResponse.json({ error: "MISSING_EMAIL_ID" }, { status: 400 });
    }

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, provider, sender, subject, ai_reply, lead_json, lead_last_action, lead_profile, gmail_thread_id, outlook_conversation_id, provider_message_id")
      .eq("id", emailId)
      .maybeSingle();

    if (error || !email) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    if (!isCronCall && (email as any).user_id !== userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 403 });
    }

    userId = (email as any).user_id;

    const provider = (email as any).provider as string | null;
    const toRaw = (email as any).sender as string | null;
    if (!toRaw) return NextResponse.json({ error: "MISSING_RECIPIENT" }, { status: 400 });

    // Parse destinataire (si "Nom <mail@...>")
    const m = String(toRaw).match(/<([^>]+)>/);
    const to = (m?.[1] || toRaw || "").trim();

    const leadJson = (email as any).lead_json ?? {};
    const leadLastAction = (email as any).lead_last_action ?? null;
    if (isProposalAlreadySent(leadJson, leadLastAction)) {
      return NextResponse.json({ success: true, skipped: true, reason: "ALREADY_SENT" });
    }
    const isAutopilot = body?.trigger === "autopilot" || req.headers.get("x-fix-trigger") === "autopilot";
    if (isAutopilot) {
      const lockedUntil = leadJson?.autopilot_locked_until;
      if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
        return NextResponse.json({ success: true, skipped: true, reason: "AUTOPILOT_LOCKED" });
      }
    }

    const { data: settingsRow } = await supabaseAdmin
  .from("settings_v1")
  .select("config, automation_level")
  .eq("user_id", userId)
  .maybeSingle();

const cfg = (settingsRow as any)?.config ?? {};
const automationLevel = (settingsRow as any)?.automation_level ?? "draft";
const tz = cfg?.scheduling_rules?.timezone || "Europe/Paris";
const persona = cfg?.agent_persona ?? {};
const signature = persona?.signature || "Cordialement,\nService visites";


const hoursStart = cfg?.scheduling_rules?.hours?.start || "09:00";
const hoursEnd = cfg?.scheduling_rules?.hours?.end || "18:00";
const businessLine = `jours ouvrés ${hoursStart}–${hoursEnd}`;


    const slots: string[] = Array.isArray(leadJson?.slots_proposed) ? leadJson.slots_proposed : [];
    if (!slots.length) {
      return NextResponse.json({ error: "NO_SLOTS_PROPOSED" }, { status: 400 });
    }

    const slotsTxt = formatSlots(slots, tz).join("\n");

    // OK Contenu envoye (simple, clair, vendable)
    const subject = `Visite — choix du créneau`;
    const prospectName =
  (email as any)?.lead_profile?.prospect_name ||
  (leadJson as any)?.analysis?.prospect_name ||
  "Bonjour";

const hello = prospectName === "Bonjour" ? "Bonjour," : `Bonjour ${prospectName},`;

const text = [
  hello,
  ``,
  `Merci pour votre message. Pour organiser la visite, voici 3 créneaux possibles :`,
  ``,
  slotsTxt,
  ``,
  `Répondez simplement avec le numéro (1, 2 ou 3) ou proposez un autre créneau (${businessLine}).`,
  ``,
  signature,
].join("\n");

    // Mode DRAFT : ne pas envoyer, stocker brouillon seulement
    if (automationLevel === "draft") {
      const nowIso = new Date().toISOString();
      const draftLeadJson = {
        ...leadJson,
        draft_proposal: { text, subject: "Visite — choix du créneau", to, created_at: nowIso },
        last_action: { type: "draft_created", at: nowIso, label: "Brouillon prêt" },
      };
      await supabaseAdmin
        .from("emails")
        .update({
          lead_json: draftLeadJson,
          lead_last_action: "Brouillon prêt",
          lead_last_action_at: nowIso,
        })
        .eq("id", emailId)
        .eq("user_id", userId);
      await logActivity({
        userId,
        actor: "ai",
        type: "draft_created",
        title: "Brouillon proposition créneaux créé",
        emailId,
        meta: { trigger: "draft_mode" },
      });
      return NextResponse.json({ success: true, draft: true });
    }

    // OK Envoi provider-agnostic
    // OK Envoi thread-safe
let sent: any = null;

const gmailThreadId = (email as any)?.gmail_thread_id as string | null;
const outlookMsgId = (email as any)?.provider_message_id as string | null;

console.log("SEND_PROPOSAL_THREAD", {
  provider,
  gmailThreadId: (email as any)?.gmail_thread_id ?? null,
  outlookMsgId: (email as any)?.provider_message_id ?? null,
});

if (provider === "microsoft") {
  // Répond dans le thread si on a l'id message Outlook
  sent = await sendOutlookEmail(userId, {
    to,
    subject,
    text,
    replyToMessageId: outlookMsgId,
  });
} else {
  // Gmail: envoi dans le thread si threadId dispo
  sent = await sendGmailEmail(userId, {
    to,
    subject,
    text,
    threadId: gmailThreadId,
  });
}


const nowIso = new Date().toISOString();
const lockUntilIso = trigger === "autopilot" ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : undefined;

const nextLeadJson = {
  ...leadJson,

  // OK FIRST ACTION (si absent)
  first_action_at: leadJson?.first_action_at ?? nowIso,
  first_action_trigger: leadJson?.first_action_trigger ?? trigger,

  // OK LAST ACTION TRIGGER
  last_action_trigger: trigger,

  proposal_slots_sent: true,

  last_outbound: {
    type: "proposal_slots",
    at: nowIso,
    to,
    subject,
    provider: provider === "microsoft" ? "microsoft" : "google",
    ...(sent?.id ?? sent?.messageId ? { provider_message_id: sent?.id ?? sent?.messageId } : {}),
    trigger, // ✅ important pour KPI “autopilot”
    provider_result: sent ?? null,
  },
  last_action: { type: "proposal_sent", at: nowIso, label: "Proposition envoyée" },
  ...(lockUntilIso ? { autopilot_locked_until: lockUntilIso } : {}),
  ...(trigger === "autopilot" ? { autopilot_pending: false } : {}),
};

    await supabaseAdmin
      .from("emails")
      .update({
        lead_json: nextLeadJson,
        lead_last_action_source: trigger === "autopilot" ? "ai" : "human",
        lead_last_action: "proposal_slots_sent",
        lead_last_action_at: nowIso,
      })
      .eq("id", emailId)
      .eq("user_id", userId);
      await logActivity({
        userId: userId,
        actor: trigger === "autopilot" ? "ai" : "human",
        type: "proposal_sent",
        title: "Email envoyé — proposition de créneaux",
        emailId,
        meta: { provider, to, trigger },
      });
      
      
      
    console.log("[api] send-proposal end", { requestId, duration_ms: Date.now() - startMs });
    return NextResponse.json({ success: true, provider, to });
  } catch (e: any) {
    console.error("[api] send-proposal error", { requestId, duration_ms: Date.now() - startMs, error: e?.message ?? e });
    return NextResponse.json({ error: "SEND_PROPOSAL_FAILED" }, { status: 500 });
  }
}
