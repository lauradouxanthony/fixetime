import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailEmail } from "@/lib/google/sendEmail";
import { sendOutlookEmail } from "@/lib/microsoft/sendEmail";
import { logActivity } from "@/lib/activity/logActivity";
import { isReplyAlreadySent } from "@/lib/email/alreadySent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  try {
    const cronKey = req.headers.get("x-fixetime-cron-key") || req.headers.get("x-cron-key");
    const isCronCall = cronKey === (process.env.FIXETIME_INTERNAL_CRON_KEY || "dev123");

    let userId: string | null = null;
    if (!isCronCall) {
      const supabase = await supabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });
      userId = user.id;
    }

    const body = await req.json().catch(() => null);
    const trigger = body?.trigger === "autopilot" || (req.headers.get("x-fix-trigger") === "autopilot") ? "autopilot" : "manual";
    const emailId = (body?.emailId ?? body?.lead_id) as string | undefined;
    const action = body?.action as string | undefined;
    if (!emailId) return NextResponse.json({ error: "MISSING_EMAIL_ID" }, { status: 400 });

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id,user_id,provider,sender,subject,ai_reply,lead_json,lead_last_action,gmail_thread_id,provider_message_id")
      .eq("id", emailId)
      .maybeSingle();

    if (error || !email) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    if (!isCronCall && (email as any).user_id !== userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 403 });
    }

    userId = (email as any).user_id;

    // Action "reject" : marquer non qualifié sans envoyer d'email
    if (action === "reject") {
      const nowIso = new Date().toISOString();
      await supabaseAdmin
        .from("emails")
        .update({
          lead_status: "unqualified",
          lead_last_action: "Marqué non qualifié",
          lead_last_action_at: nowIso,
        })
        .eq("id", emailId)
        .eq("user_id", userId);
      return NextResponse.json({ success: true, action: "reject" });
    }

    const provider = (email as any).provider as string | null;
    const toRaw = (email as any).sender as string | null;
    if (!toRaw) return NextResponse.json({ error: "MISSING_RECIPIENT" }, { status: 400 });

    const m = String(toRaw).match(/<([^>]+)>/);
    const to = (m?.[1] || toRaw || "").trim();

    const aiReply = (email as any).ai_reply as string | null;
    if (!aiReply || !aiReply.trim()) {
      return NextResponse.json({ error: "NO_AI_REPLY" }, { status: 400 });
    }

    const leadJson = (email as any).lead_json ?? {};
    const leadLastAction = (email as any).lead_last_action ?? null;
    if (isReplyAlreadySent(leadJson, leadLastAction)) {
      return NextResponse.json({ success: true, skipped: true, reason: "ALREADY_SENT" });
    }
    if (trigger === "autopilot") {
      const lockedUntil = leadJson?.autopilot_locked_until;
      if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
        return NextResponse.json({ success: true, skipped: true, reason: "AUTOPILOT_LOCKED" });
      }
    }

    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("automation_level")
      .eq("user_id", userId)
      .maybeSingle();
    const automationLevel = (settingsRow as any)?.automation_level ?? "draft";

    // Mode DRAFT : ne pas envoyer, stocker brouillon seulement
    if (automationLevel === "draft") {
      const nowIso = new Date().toISOString();
      const subject = (email as any).subject ? `Re: ${(email as any).subject}` : "Re: Votre demande";
      const isInfo = (leadJson?.intent as string) === "INFORMATION";
      const draftLeadJson = {
        ...leadJson,
        draft_reply: { text: aiReply, subject, to, created_at: nowIso },
        last_action: { type: isInfo ? "draft_info_reply" : "draft_created", at: nowIso, label: isInfo ? "Brouillon réponse FAQ" : "Brouillon prêt" },
      };
      await supabaseAdmin
        .from("emails")
        .update({
          lead_json: draftLeadJson,
          lead_last_action: isInfo ? "Brouillon réponse FAQ" : "Brouillon prêt",
          lead_last_action_at: nowIso,
        })
        .eq("id", emailId)
        .eq("user_id", userId);
      await logActivity({
        userId,
        actor: "ai",
        type: "draft_created",
        title: "Brouillon réponse créé",
        emailId,
        meta: { trigger: "draft_mode" },
      });
      return NextResponse.json({ success: true, draft: true });
    }

    const subject = (email as any).subject ? `Re: ${(email as any).subject}` : "Re: Votre demande";

    let sent: any = null;
    const gmailThreadId = (email as any)?.gmail_thread_id as string | null;
    const outlookMsgId = (email as any)?.provider_message_id as string | null;

    if (provider === "microsoft") {
      sent = await sendOutlookEmail(userId, {
        to,
        subject,
        text: aiReply,
        replyToMessageId: outlookMsgId,
      });
    } else {
      sent = await sendGmailEmail(userId, {
        to,
        subject,
        text: aiReply,
        threadId: gmailThreadId,
      });
    }

    const nowIso = new Date().toISOString();
    const lockUntilIso = trigger === "autopilot" ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : undefined;
    const providerMessageId = sent?.id ?? sent?.messageId ?? null;
    const isInfoReply = (leadJson?.intent as string) === "INFORMATION";
    const outboundType = isInfoReply ? "info_reply" : "reply_sent";
    const lastActionLabel = trigger === "autopilot"
      ? (isInfoReply ? "Réponse FAQ auto-envoyée" : "Réponse auto-envoyée")
      : (isInfoReply ? "Réponse FAQ envoyée" : "Réponse envoyée");
    const nextLeadJson = {
      ...leadJson,
      last_outbound: {
        type: outboundType,
        at: nowIso,
        to,
        subject,
        provider: provider === "microsoft" ? "microsoft" : "google",
        ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
        provider_result: sent ?? null,
      },
      last_action: { type: isInfoReply ? "info_answered" : "reply_sent", at: nowIso, label: lastActionLabel },
      ...(lockUntilIso ? { autopilot_locked_until: lockUntilIso } : {}),
      ...(trigger === "autopilot" ? { autopilot_pending: false } : {}),
    };

    await supabaseAdmin
      .from("emails")
      .update({
        lead_json: nextLeadJson,
        lead_last_action: lastActionLabel,
        lead_last_action_at: nowIso,
      })
      .eq("id", emailId)
      .eq("user_id", userId);

    await logActivity({
      userId: userId,
      actor: trigger === "autopilot" ? "ai" : "human",
      type: "ai_reply_sent",
      title: "Réponse IA envoyée",
      meta: { emailId, trigger },
    });

    console.log("[api] send-reply end", { requestId, duration_ms: Date.now() - startMs });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[api] send-reply error", { requestId, duration_ms: Date.now() - startMs, error: e?.message ?? e });
    return NextResponse.json({ error: "SEND_REPLY_FAILED" }, { status: 500 });
  }
}
