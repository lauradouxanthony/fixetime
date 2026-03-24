import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailEmail } from "@/lib/google/sendEmail";
import { sendOutlookEmail } from "@/lib/microsoft/sendEmail";
import { logActivity } from "@/lib/activity/logActivity";
import { createCalendarEvent } from "@/lib/calendar/createEventUnified";

type EmailRow = {
  id: string;
  user_id: string;
  sender: string | null;
  subject: string | null;
  provider: string | null;
  lead_json: any;
  lead_status: string | null;
  lead_profile: any;
  property_id: string | null;
  lead_property_address: string | null;
  gmail_thread_id: string | null;
  outlook_conversation_id: string | null;
  provider_message_id: string | null;
};

function extractEmailAddress(sender: string | null): string | null {
  if (!sender) return null;
  const m = sender.match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim();
  return sender.trim();
}

function formatSlotFR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSlotsEmailReply(slots: string[]): string {
  const s1 = slots[0] ? formatSlotFR(slots[0]) : "—";
  const s2 = slots[1] ? formatSlotFR(slots[1]) : "—";
  const s3 = slots[2] ? formatSlotFR(slots[2]) : "—";

  return `Bonjour,

Merci pour votre intérêt. Voici 3 créneaux disponibles pour une visite :

1) ${s1}
2) ${s2}
3) ${s3}

Pouvez-vous me confirmer celui qui vous convient le mieux ?

Cordialement,
L'équipe`;
}

async function getRealVisitSlots(userId: string, durationMin: number) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const cronKey = process.env.FIXETIME_INTERNAL_CRON_KEY;
  if (cronKey) headers["x-fixetime-cron-key"] = cronKey;

  const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const res = await fetch(`${origin}/api/availability/slots`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      duration_min: durationMin,
      timezone: "Europe/Paris",
      workdays: [1, 2, 3, 4, 5],
      hours: { start: "09:00", end: "18:00" },
      exclude_lunch: true,
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.slots) {
    throw new Error("FREEBUSY_FAILED");
  }

  return Array.isArray(json.slots) ? json.slots : [];
}

function detectSlotChoice(content: string, slots: string[]): string | null {
  const lower = content.toLowerCase();
  for (const slot of slots) {
    const d = new Date(slot);
    const day = d.toLocaleDateString("fr-FR", { day: "numeric" });
    const month = d.toLocaleDateString("fr-FR", { month: "long" });
    const hour = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    if (lower.includes(day) && (lower.includes(month) || lower.includes(hour))) {
      return slot;
    }
    if (lower.includes("1") && slots.indexOf(slot) === 0) return slot;
    if (lower.includes("2") && slots.indexOf(slot) === 1) return slot;
    if (lower.includes("3") && slots.indexOf(slot) === 2) return slot;
  }
  return null;
}

/**
 * Exécute l'autopilot pour un lead après analyse.
 * Décide et exécute automatiquement la prochaine action si autopilot est activé.
 */
export async function runAutopilotForLead(emailRow: EmailRow): Promise<void> {
  try {
    // 1) Charger settings
    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("assistant_enabled, automation_level, config")
      .eq("user_id", emailRow.user_id)
      .maybeSingle();

    const assistantEnabled = settingsRow?.assistant_enabled ?? true;
    const automationLevel = settingsRow?.automation_level ?? "draft";

    // 2) Vérifier si autopilot est activé
    if (!assistantEnabled || automationLevel !== "autopilot") {
      return; // Ne rien faire si autopilot désactivé
    }

    const leadJson = emailRow.lead_json ?? {};
    const leadStatus = emailRow.lead_status;
    const lastOutbound = leadJson?.last_outbound ?? {};
    const lastOutboundType = lastOutbound?.type;

    // 3) Extraire email destinataire
    const to = extractEmailAddress(emailRow.sender);
    if (!to) {
      await logActivity({
        userId: emailRow.user_id,
        actor: "ai",
        type: "autopilot_error",
        title: "Autopilot: email destinataire manquant",
        emailId: emailRow.id,
        meta: { error: "missing_recipient" },
      });
      return;
    }

    const provider = emailRow.provider === "microsoft" ? "microsoft" : "google";
    const config = settingsRow?.config ?? {};
    const persona = config?.agent_persona ?? {};
    const agentName = persona?.agent_name || "L'équipe";

    // A) Si is_rental_intent=false => no-op
    const isRentalIntent = leadJson?.is_rental_intent !== false; // default true si absent
    if (!isRentalIntent) {
      await logActivity({
        userId: emailRow.user_id,
        actor: "ai",
        type: "ignored_not_rental",
        title: "Autopilot: ignoré (pas d'intention locative)",
        emailId: emailRow.id,
        meta: {},
      });
      return;
    }

    // B) Si missing_elements non vide => action = "request_missing_info"
    const missingElements = Array.isArray(leadJson?.missing_elements) ? leadJson.missing_elements : [];
    if (missingElements.length > 0 && lastOutboundType !== "request_missing_info") {
      try {
        const missingList = missingElements
          .map((e: string) => {
            if (e === "guarantor") return "un garant";
            if (e === "income") return "vos revenus";
            if (e === "documents") return "les documents requis";
            return e;
          })
          .join(", ");

        const prospectName = leadJson?.analysis?.prospect_name || emailRow.lead_profile?.prospect_name || "Bonjour";
        const subject = emailRow.subject ? `Re: ${emailRow.subject}` : "Re: Votre demande";
        const text = `Bonjour ${prospectName === "Bonjour" ? "" : prospectName},

Pour finaliser votre dossier, j'aurais besoin de ${missingList}.

Merci de bien vouloir me transmettre ces informations.

Cordialement,
${agentName}`;

        let sent: any = null;
        const gmailThreadId = emailRow.gmail_thread_id;
        const outlookMsgId = emailRow.provider_message_id;

        if (provider === "microsoft") {
          sent = await sendOutlookEmail(emailRow.user_id, {
            to,
            subject,
            text,
            replyToMessageId: outlookMsgId,
          });
        } else {
          sent = await sendGmailEmail(emailRow.user_id, {
            to,
            subject,
            text,
            threadId: gmailThreadId,
          });
        }

        const nowIso = new Date().toISOString();
        const nextLeadJson = {
          ...leadJson,
          last_outbound: {
            type: "request_missing_info",
            to,
            subject,
            provider: provider === "microsoft" ? "microsoft" : "google",
            sent_at: nowIso,
            provider_result: sent ?? null,
          },
        };

        await supabaseAdmin
          .from("emails")
          .update({
            lead_json: nextLeadJson,
            lead_status: leadStatus === "new_lead" ? "qualifying" : leadStatus,
            lead_last_action: "Email envoyé — demande d'informations complémentaires",
            lead_last_action_at: nowIso,
          })
          .eq("id", emailRow.id);

        await logActivity({
          userId: emailRow.user_id,
          actor: "ai",
          type: "autopilot_request_info",
          title: "Demande d'informations envoyée automatiquement",
          emailId: emailRow.id,
          meta: { missing_elements: missingElements },
        });
      } catch (e) {
        await logActivity({
          userId: emailRow.user_id,
          actor: "ai",
          type: "autopilot_error",
          title: "Erreur envoi demande d'informations",
          emailId: emailRow.id,
          meta: { error: String(e) },
        });
      }
      return;
    }

    // C) Si lead_status in ("qualified","qualifying") ET slots_proposed vide => action = "proposal_slots"
    const slotsProposed = Array.isArray(leadJson?.slots_proposed) ? leadJson.slots_proposed : [];
    if (
      (leadStatus === "qualified" || leadStatus === "qualifying" || leadStatus === "slots_proposed") &&
      slotsProposed.length === 0 &&
      lastOutboundType !== "proposal_slots"
    ) {
      try {
        const slots = await getRealVisitSlots(emailRow.user_id, 30);
        const slotsIso = slots.slice(0, 3).map((s: any) => s.start);

        if (slotsIso.length >= 3) {
          const proposalBody = buildSlotsEmailReply(slotsIso);
          const prospectName = leadJson?.analysis?.prospect_name || emailRow.lead_profile?.prospect_name || "Bonjour";
          const subject = "Visite — choix du créneau";
          const text = prospectName === "Bonjour" ? proposalBody : `Bonjour ${prospectName},\n\n${proposalBody}`;

          let sent: any = null;
          const gmailThreadId = emailRow.gmail_thread_id;
          const outlookMsgId = emailRow.provider_message_id;

          if (provider === "microsoft") {
            sent = await sendOutlookEmail(emailRow.user_id, {
              to,
              subject,
              text,
              replyToMessageId: outlookMsgId,
            });
          } else {
            sent = await sendGmailEmail(emailRow.user_id, {
              to,
              subject,
              text,
              threadId: gmailThreadId,
            });
          }

          const nowIso = new Date().toISOString();
          const nextLeadJson = {
            ...leadJson,
            slots_proposed: slotsIso,
            last_outbound: {
              type: "proposal_slots",
              to,
              subject,
              provider: provider === "microsoft" ? "microsoft" : "google",
              sent_at: nowIso,
              sender_email: to,
              provider_result: sent ?? null,
            },
          };

          await supabaseAdmin
            .from("emails")
            .update({
              lead_json: nextLeadJson,
              lead_status: "slots_proposed",
              lead_last_action: "Email envoyé — proposition de créneaux",
              lead_last_action_at: nowIso,
            })
            .eq("id", emailRow.id);

          await logActivity({
            userId: emailRow.user_id,
            actor: "ai",
            type: "autopilot_slots_sent",
            title: "Proposition de créneaux envoyée automatiquement",
            emailId: emailRow.id,
            meta: { slots_count: slotsIso.length },
          });
        }
      } catch (e) {
        await logActivity({
          userId: emailRow.user_id,
          actor: "ai",
          type: "autopilot_error",
          title: "Erreur envoi proposition de créneaux",
          emailId: emailRow.id,
          meta: { error: String(e) },
        });
      }
      return;
    }

    // D) Si last_inbound.type="slot_choice" et confirmed_slot présent ET lead_status !== "booked" => action = "confirm_booking"
    const lastInbound = leadJson?.last_inbound ?? {};
    const confirmedSlot = leadJson?.confirmed_slot ?? leadJson?.booking?.start;
    if (
      lastInbound?.type === "slot_choice" &&
      confirmedSlot &&
      leadStatus !== "booked" &&
      lastOutboundType !== "confirm_booking"
    ) {
      try {
        const slotStart = new Date(confirmedSlot);
        const durationMin = Number(leadJson?.slots_duration_min ?? 30);
        const slotEnd = new Date(slotStart.getTime() + durationMin * 60_000);

        if (isNaN(slotStart.getTime())) {
          throw new Error("INVALID_SLOT_START");
        }

        const prospectName =
          leadJson?.analysis?.prospect_name ||
          emailRow.lead_profile?.prospect_name ||
          (emailRow.sender ? String(emailRow.sender).split("<")[0].trim() : "Candidat");
        const title = `Visite — ${prospectName}`;
        const location = emailRow.lead_property_address || undefined;

        // Créer l'événement calendrier
        const eventResult = await createCalendarEvent(emailRow.user_id, provider, {
          title,
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          description: "Visite confirmée depuis FixTime.",
          attendees: [to],
          location,
        });

        // Envoyer email de confirmation
        const formattedSlot = formatSlotFR(confirmedSlot);
        const subject = "Visite confirmée";
        const text = `Bonjour ${prospectName},

Votre visite est confirmée pour : ${formattedSlot}.

Cordialement,
${agentName}`;

        let sent: any = null;
        const gmailThreadId = emailRow.gmail_thread_id;
        const outlookMsgId = emailRow.provider_message_id;

        if (provider === "microsoft") {
          sent = await sendOutlookEmail(emailRow.user_id, {
            to,
            subject,
            text,
            replyToMessageId: outlookMsgId,
          });
        } else {
          sent = await sendGmailEmail(emailRow.user_id, {
            to,
            subject,
            text,
            threadId: gmailThreadId,
          });
        }

        const nowIso = new Date().toISOString();
        const nextLeadJson = {
          ...leadJson,
          booking: {
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            provider,
            provider_event_id: eventResult?.event?.id ?? null,
            created_at: nowIso,
            trigger: "autopilot",
          },
          last_outbound: {
            type: "confirm_booking",
            to,
            subject,
            provider: provider === "microsoft" ? "microsoft" : "google",
            sent_at: nowIso,
            provider_result: sent ?? null,
          },
        };

        await supabaseAdmin
          .from("emails")
          .update({
            lead_status: "booked",
            lead_json: nextLeadJson,
            lead_last_action: "Visite confirmée — événement créé",
            lead_last_action_at: nowIso,
          })
          .eq("id", emailRow.id);

        await logActivity({
          userId: emailRow.user_id,
          actor: "ai",
          type: "autopilot_confirmed",
          title: "Visite confirmée automatiquement",
          emailId: emailRow.id,
          meta: { slotStart: slotStart.toISOString(), provider },
        });
      } catch (e) {
        await logActivity({
          userId: emailRow.user_id,
          actor: "ai",
          type: "autopilot_error",
          title: "Erreur confirmation de visite",
          emailId: emailRow.id,
          meta: { error: String(e) },
        });
      }
      return;
    }

    // E) Sinon => no-op (rien à faire)
  } catch (e) {
    // Ne jamais casser le flow principal
    console.error("[AUTOPILOT] Fatal error", e);
    await logActivity({
      userId: emailRow.user_id,
      actor: "ai",
      type: "autopilot_error",
      title: "Erreur autopilot",
      emailId: emailRow.id,
      meta: { error: String(e) },
    }).catch(() => null);
  }
}
