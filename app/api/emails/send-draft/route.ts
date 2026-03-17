import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailEmail } from "@/lib/google/sendEmail";
import { sendOutlookEmail } from "@/lib/microsoft/sendEmail";
import { logActivity } from "@/lib/activity/logActivity";
import { isReplyAlreadySent, isProposalAlreadySent } from "@/lib/email/alreadySent";
import { parseEmailAddress } from "@/lib/email/parseEmailAddress";

export const runtime = "nodejs";

const MIN_BODY_LENGTH = 20;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SEND_DRAFT_EMAIL_SELECT =
  "id, provider, sender, subject, ai_reply, lead_json, lead_last_action, lead_last_action_at";

function isValidEmail(s: string): boolean {
  return typeof s === "string" && s.trim().length > 0 && EMAIL_REGEX.test(s.trim());
}

/**
 * POST /api/emails/send-draft
 *
 * Envoie un brouillon stocké (draft_reply ou draft_proposal) en mode draft.
 * Réponse JSON structurée: { ok, sent?, reason?, provider?, messageId?, to?, subject?, error?, details? }
 */
export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();

  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "NO_USER" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const emailId = body?.emailId ?? body?.lead_id;

    if (!emailId || typeof emailId !== "string") {
      return NextResponse.json({ ok: false, error: "MISSING_EMAIL_ID" }, { status: 400 });
    }

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, provider, sender, subject, ai_reply, lead_json, lead_last_action, lead_profile, gmail_thread_id, provider_message_id")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !email) {
      return NextResponse.json({ ok: false, error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    const leadJson = (email.lead_json as any) ?? {};
    const leadProfile = (email as any).lead_profile ?? {};
    let draftReply = leadJson?.draft_reply;
    const draftProposal = leadJson?.draft_proposal;

    const aiReplyText = (email as any).ai_reply ? String((email as any).ai_reply).trim() : "";
    if (!draftReply?.text && aiReplyText.length > 0) {
      draftReply = { text: aiReplyText, subject: `Re: ${((email as any).subject || "Votre demande").trim().slice(0, 80)}` };
    }

    // Destinataire: priorité lead_profile.email > lead_json.sender_email > parse(sender) > lead_json.from.address
    const toRaw =
      (leadProfile as any)?.email?.trim?.() ||
      (leadJson?.sender_email && String(leadJson.sender_email).trim()) ||
      parseEmailAddress((email as any).sender) ||
      (leadJson?.from?.address && String(leadJson.from.address).trim()) ||
      "";
    const to = toRaw.trim();

    const providerRaw = ((email as any).provider as string) || "";
    if (!providerRaw || (providerRaw !== "google" && providerRaw !== "microsoft")) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PROVIDER", details: "provider doit être google ou microsoft" },
        { status: 400 }
      );
    }
    const provider = providerRaw as "google" | "microsoft";
    const subject = draftReply?.subject || draftProposal?.subject || `Re: ${(email as any).subject || ""}`;
    const bodyText = (body?.text != null ? String(body.text).trim() : null) || draftReply?.text || draftProposal?.text || "";
    const subjectLen = subject?.length ?? 0;
    const bodyLen = bodyText.length;

    console.log("SEND_DRAFT_START", {
      requestId,
      userId: user.id,
      emailId,
      provider: providerRaw,
      to: to ? `${to.slice(0, 20)}…` : "(empty)",
      subjectLen,
      bodyLen,
    });

    if (!to) {
      return NextResponse.json(
        { ok: false, error: "MISSING_RECIPIENT", sender: (email as any).sender ?? null },
        { status: 400 }
      );
    }
    if (!isValidEmail(to)) {
      return NextResponse.json({ ok: false, error: "INVALID_RECIPIENT", details: "email destinataire invalide" }, { status: 400 });
    }
    if (bodyLen < MIN_BODY_LENGTH) {
      return NextResponse.json({
        ok: false,
        error: "EMPTY_DRAFT",
        details: `Corps du brouillon trop court (min ${MIN_BODY_LENGTH} caractères)`,
      }, { status: 400 });
    }

    const leadLastAction = (email as any).lead_last_action ?? null;

    // Cas 1: envoi draft reply
    if (draftReply?.text) {
      if (isReplyAlreadySent(leadJson, leadLastAction)) {
        console.log("SEND_DRAFT_SKIP", { requestId, reason: "already_sent", type: "reply" });
        return NextResponse.json({
          ok: true,
          sent: false,
          reason: "already_sent",
          provider,
          to,
          subject,
          email: email,
        });
      }

      let sent: any = null;
      try {
        if (provider === "microsoft") {
          sent = await sendOutlookEmail(user.id, {
            to,
            subject: draftReply.subject || `Re: ${(email as any).subject}`,
            text: draftReply.text,
            replyToMessageId: (email as any).provider_message_id,
          });
        } else {
          sent = await sendGmailEmail(user.id, {
            to,
            subject: draftReply.subject || `Re: ${(email as any).subject}`,
            text: draftReply.text,
            threadId: (email as any).gmail_thread_id,
          });
        }
      } catch (sendErr: any) {
        console.error("SEND_DRAFT_ERROR", {
          requestId,
          type: "reply",
          provider,
          error: sendErr?.message ?? sendErr,
          stack: sendErr?.stack,
        });
        return NextResponse.json(
          {
            ok: false,
            error: "SEND_FAILED",
            details: sendErr?.message ?? "Erreur envoi provider",
          },
          { status: 500 }
        );
      }

      const messageId = sent?.id ?? sent?.messageId ?? null;
      const nowIso = new Date().toISOString();
      const isInfoReply = (leadJson?.intent as string) === "INFORMATION";
      const outboundType = isInfoReply ? "info_reply" : "reply_sent";
      const lastActionLabel = isInfoReply ? "Réponse FAQ envoyée" : "Réponse envoyée";
      const nextLeadJson = {
        ...leadJson,
        draft_reply: null,
        last_outbound: {
          type: outboundType,
          at: nowIso,
          to,
          subject: draftReply.subject,
          provider: provider === "microsoft" ? "microsoft" : "google",
          ...(messageId ? { provider_message_id: messageId } : {}),
          provider_result: sent,
        },
        last_action: { type: isInfoReply ? "info_answered" : "reply_sent", at: nowIso, label: lastActionLabel },
      };

      await supabaseAdmin
        .from("emails")
        .update({
          lead_json: nextLeadJson,
          lead_last_action: lastActionLabel,
          lead_last_action_at: nowIso,
          ai_reply: draftReply.text,
        })
        .eq("id", emailId)
        .eq("user_id", user.id);

      await logActivity({
        userId: user.id,
        actor: "human",
        type: "email_sent",
        title: "Brouillon envoyé",
        emailId,
        meta: { trigger: "send_draft" },
      });

      const { data: updatedRow } = await supabaseAdmin
        .from("emails")
        .select(SEND_DRAFT_EMAIL_SELECT)
        .eq("id", emailId)
        .eq("user_id", user.id)
        .single();

      console.log("SEND_DRAFT_END", {
        requestId,
        duration_ms: Date.now() - startMs,
        type: "reply",
        sent: true,
        messageId: messageId ?? undefined,
      });

      return NextResponse.json({
        ok: true,
        sent: true,
        provider: provider === "microsoft" ? "microsoft" : "google",
        messageId: messageId ?? undefined,
        to,
        subject: draftReply.subject || subject,
        email: updatedRow ?? email,
      });
    }

    // Cas 2: envoi draft proposal (slots)
    if (draftProposal?.text) {
      if (isProposalAlreadySent(leadJson, leadLastAction)) {
        console.log("SEND_DRAFT_SKIP", { requestId, reason: "already_sent", type: "proposal" });
        return NextResponse.json({
          ok: true,
          sent: false,
          reason: "already_sent",
          provider,
          to,
          subject: draftProposal.subject,
          email: email,
        });
      }

      let sent: any = null;
      try {
        if (provider === "microsoft") {
          sent = await sendOutlookEmail(user.id, {
            to,
            subject: draftProposal.subject || "Visite — choix du créneau",
            text: draftProposal.text,
            replyToMessageId: (email as any).provider_message_id,
          });
        } else {
          sent = await sendGmailEmail(user.id, {
            to,
            subject: draftProposal.subject || "Visite — choix du créneau",
            text: draftProposal.text,
            threadId: (email as any).gmail_thread_id,
          });
        }
      } catch (sendErr: any) {
        console.error("SEND_DRAFT_ERROR", {
          requestId,
          type: "proposal",
          provider,
          error: sendErr?.message ?? sendErr,
          stack: sendErr?.stack,
        });
        return NextResponse.json(
          {
            ok: false,
            error: "SEND_FAILED",
            details: sendErr?.message ?? "Erreur envoi provider",
          },
          { status: 500 }
        );
      }

      const messageId = sent?.id ?? sent?.messageId ?? null;
      const nowIso = new Date().toISOString();
      const nextLeadJson = {
        ...leadJson,
        draft_proposal: null,
        last_outbound: {
          type: "proposal_slots_sent",
          at: nowIso,
          to,
          subject: draftProposal.subject,
          provider: provider === "microsoft" ? "microsoft" : "google",
          ...(messageId ? { provider_message_id: messageId } : {}),
          provider_result: sent,
        },
      };

      await supabaseAdmin
        .from("emails")
        .update({
          lead_json: nextLeadJson,
          lead_last_action: "proposal_slots_sent",
          lead_last_action_at: nowIso,
        })
        .eq("id", emailId)
        .eq("user_id", user.id);

      await logActivity({
        userId: user.id,
        actor: "human",
        type: "email_sent",
        title: "Proposition créneaux envoyée",
        emailId,
        meta: { trigger: "send_draft" },
      });

      const { data: updatedRow } = await supabaseAdmin
        .from("emails")
        .select(SEND_DRAFT_EMAIL_SELECT)
        .eq("id", emailId)
        .eq("user_id", user.id)
        .single();

      console.log("SEND_DRAFT_END", {
        requestId,
        duration_ms: Date.now() - startMs,
        type: "proposal",
        sent: true,
        messageId: messageId ?? undefined,
      });

      return NextResponse.json({
        ok: true,
        sent: true,
        provider: provider === "microsoft" ? "microsoft" : "google",
        messageId: messageId ?? undefined,
        to,
        subject: draftProposal.subject || "Visite — choix du créneau",
        email: updatedRow ?? email,
      });
    }

    return NextResponse.json({ ok: false, error: "NO_DRAFT", details: "Aucun brouillon (draft_reply/draft_proposal/ai_reply) à envoyer" }, { status: 400 });
  } catch (e: any) {
    console.error("SEND_DRAFT_ERROR", {
      requestId,
      duration_ms: Date.now() - startMs,
      error: e?.message ?? e,
      stack: e?.stack,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "SEND_DRAFT_FAILED",
        details: e?.message ?? "Erreur serveur",
      },
      { status: 500 }
    );
  }
}
