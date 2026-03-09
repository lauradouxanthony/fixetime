import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function isInternalCron(req: Request) {
  return req.headers.get("x-fixetime-cron-key") === process.env.FIXETIME_INTERNAL_CRON_KEY;
}

function isManualRequest(req: Request) {
  return !!req.headers.get("cookie");
}

// ─── Fallback classification ──────────────────────────────────────────────────

function fallbackDecision(email: { subject?: string | null; sender?: string | null }) {
  const subject = (email.subject || "").toLowerCase();
  const sender = (email.sender || "").toLowerCase();

  if (subject.includes("urgent") || subject.includes("asap") || subject.includes("demain")) {
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

// ─── Generate ai_reply ────────────────────────────────────────────────────────

async function generateReply(email: {
  sender?: string | null;
  subject?: string | null;
  body?: string | null;
}): Promise<string | null> {
  try {
    const prompt = `Tu es l'assistant personnel d'un dirigeant très occupé.
Rédige une réponse email professionnelle, claire, naturelle et prête à être envoyée.

Règles :
- Français professionnel
- Ton humain, poli, efficace
- Pas trop long
- Adapté au CONTENU réel
- Pas de promesse irréaliste
- Signature neutre (sans prénom)

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${email.body || "Email sans contenu visible"}

Réponse :`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ─── Send via Gmail API ───────────────────────────────────────────────────────

function buildRawReply(to: string, subject: string, body: string): string {
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(`Re: ${subject}`, "utf-8").toString("base64")}?=`;
  const mime = [
    `MIME-Version: 1.0`,
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(body, "utf-8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendGmailReply(
  userId: string,
  email: { gmail_message_id?: string | null; sender?: string | null; subject?: string | null },
  replyBody: string
): Promise<boolean> {
  try {
    const accessToken = await getValidGoogleAccessToken(userId);

    // Récupérer le threadId pour répondre dans le bon fil
    let threadId: string | undefined;
    if (email.gmail_message_id) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.gmail_message_id}?format=minimal`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (msgRes.ok) {
        const msgJson = await msgRes.json();
        threadId = msgJson.threadId;
      }
    }

    const raw = buildRawReply(email.sender ?? "", email.subject ?? "", replyBody);
    const payload: any = { raw };
    if (threadId) payload.threadId = threadId;

    const sendRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    return sendRes.ok;
  } catch {
    return false;
  }
}

// ─── Create Calendar event ─────────────────────────────────────────────────────

async function createCalendarEvent(
  userId: string,
  subject: string | null,
  estimatedMinutes: number
): Promise<void> {
  try {
    const accessToken = await getValidGoogleAccessToken(userId);

    // Demain à 9h00
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + estimatedMinutes * 60_000);

    await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `Répondre : ${subject || "Email"}`,
        start: { dateTime: start.toISOString(), timeZone: "Europe/Paris" },
        end: { dateTime: end.toISOString(), timeZone: "Europe/Paris" },
      }),
    });
  } catch (e) {
    console.warn("[ANALYZE] calendar event creation failed:", e);
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const isCron = isInternalCron(req);
  const isManual = isManualRequest(req);
  let body: any = null;
  try { body = await req.json(); } catch {}

  if (!isCron && !isManual) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // ── Résoudre l'utilisateur cible ──
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

    // ── Lire les settings une seule fois ──
    const { data: settings } = await supabaseAdmin
      .from("settings_v1")
      .select("automation_level, email_rules")
      .eq("user_id", targetUserId)
      .maybeSingle();

    const automationLevel: string = settings?.automation_level ?? "suggestions";
    const emailRules: any = settings?.email_rules ?? {};

    const isDraft = automationLevel === "semi";
    const isAutopilot = automationLevel === "advanced";
    const autoReply = isDraft || isAutopilot; // générer ai_reply automatiquement

    // ── Emails à analyser ──
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const sinceISO = new Date(Date.now() - THIRTY_DAYS).toISOString();

    const { data: emails, error } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, gmail_message_id, sender, subject, body, received_at")
      .eq("user_id", targetUserId)
      .gte("received_at", sinceISO)
      .or("decision.is.null,summary.is.null,classification_reason.is.null")
      .order("received_at", { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json({ error: "FETCH_EMAILS_FAILED" }, { status: 500 });
    }

    // Nettoyer les anciens emails bloqués sans décision
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
      return NextResponse.json({ success: true, analyzed: 0 });
    }

    let analyzed = 0;
    // Garde-fou : max 5 envois auto par run (évite le spam)
    let autoSentCount = 0;
    const MAX_AUTO_SEND = 5;

    for (const email of emails) {
      // ── Règles utilisateur ──
      let forcedDecision: "traiter" | "ignorer" | "planifier" | null = null;
      let forcedUrgent = false;
      let forcedImportant = false;

      if (emailRules.always_important?.some((d: string) => (email.sender || "").includes(d))) {
        forcedDecision = "traiter";
        forcedImportant = true;
      }
      if (emailRules.always_ignore?.some((d: string) => (email.sender || "").includes(d))) {
        forcedDecision = "ignorer";
      }
      if (
        emailRules.keywords?.urgent?.some((k: string) =>
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
            recommended_action: forcedDecision === "ignorer" ? "archive" : "reply",
            classification_reason: "Règle utilisateur",
          })
          .eq("id", email.id);
        analyzed++;
        continue;
      }

      // ── Appel IA analyse ──
      const content =
        email.body?.trim() || "Email sans contenu. Analyse basée sur le sujet et l'expéditeur.";

      const prompt = `Tu es un assistant de tri d'emails pour un dirigeant.
Retourne UNIQUEMENT un JSON valide, en FRANÇAIS, sans texte autour :

{
  "summary": "1 phrase max, très concret",
  "decision": "TRAITER" | "DELEGUER" | "IGNORER",
  "priority": "URGENT" | "IMPORTANT" | "NORMAL",
  "estimated_time": 2 | 5 | 15,
  "recommended_action": "reply" | "archive" | "task"
}

Expéditeur: ${email.sender}
Sujet: ${email.subject}
Contenu:
${content}`;

      let raw = "";
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
        });
        raw = completion.choices[0]?.message?.content || "";
      } catch {
        raw = "";
      }

      const match = raw.match(/\{[\s\S]*\}/);

      const decisionMap: any = { TRAITER: "traiter", IGNORER: "ignorer", DELEGUER: "planifier" };
      const actionMap: any = { reply: "reply", archive: "archive", task: "schedule", schedule: "schedule" };

      let finalDecision: string = "traiter";
      let finalSummary: string | null = null;
      let finalTime = 5;
      let finalAction = "reply";
      let finalUrgent = false;
      let finalImportant = false;

      if (!match) {
        const fb = fallbackDecision(email);
        finalDecision = fb.decision;
        finalUrgent = fb.is_urgent;
        finalImportant = fb.is_important;
        finalSummary = "Analyse automatique incomplète — classé par règles de secours.";
        finalTime = finalDecision === "ignorer" ? 0 : 5;
        finalAction = finalDecision === "ignorer" ? "archive" : "reply";
      } else {
        let result: any = null;
        try { result = JSON.parse(match[0]); } catch {}

        if (!result) {
          const fb = fallbackDecision(email);
          finalDecision = fb.decision;
          finalUrgent = fb.is_urgent;
          finalImportant = fb.is_important;
          finalSummary = "Analyse automatique incomplète — classé par règles de secours.";
          finalTime = finalDecision === "ignorer" ? 0 : 5;
          finalAction = finalDecision === "ignorer" ? "archive" : "reply";
        } else {
          finalDecision = decisionMap[result.decision] ?? "traiter";
          finalSummary = typeof result.summary === "string" ? result.summary : null;
          finalTime = result.estimated_time ?? 5;
          finalAction = actionMap[result.recommended_action] ?? "reply";
          finalUrgent = result.priority === "URGENT";
          finalImportant = result.priority === "IMPORTANT";
        }
      }

      // ── Sauvegarder l'analyse ──
      await supabaseAdmin
        .from("emails")
        .update({
          summary: finalSummary,
          decision: finalDecision,
          estimated_time: finalTime,
          recommended_action: finalAction,
          is_urgent: finalUrgent,
          is_important: finalImportant,
          classification_reason: "Analyse automatique par l'IA",
        })
        .eq("id", email.id);

      analyzed++;

      // ── Mode DRAFT ou AUTOPILOTE : générer le brouillon ──
      if (autoReply && finalDecision === "traiter") {
        const reply = await generateReply(email);
        if (reply) {
          await supabaseAdmin
            .from("emails")
            .update({ ai_reply: reply })
            .eq("id", email.id);

          // ── Mode AUTOPILOTE : envoyer automatiquement (max 5/run) ──
          if (isAutopilot && autoSentCount < MAX_AUTO_SEND) {
            const sent = await sendGmailReply(targetUserId, email, reply);
            if (sent) {
              await supabaseAdmin
                .from("emails")
                .update({ is_archived: true })
                .eq("id", email.id);
              autoSentCount++;
            }
          }
        }
      }

      // ── Mode AUTOPILOTE : créer l'événement calendrier si "planifier" ──
      if (isAutopilot && finalDecision === "planifier") {
        await createCalendarEvent(targetUserId, email.subject, finalTime ?? 30);
      }
    }

    return NextResponse.json({
      success: true,
      analyzed,
      autoSent: autoSentCount,
      mode: automationLevel,
    });
  } catch (err) {
    console.error("ANALYZE_EMAILS_ERROR", err);
    return NextResponse.json({ error: "ANALYZE_EMAILS_FAILED" }, { status: 500 });
  }
}
