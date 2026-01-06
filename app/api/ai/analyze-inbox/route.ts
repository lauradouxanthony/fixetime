import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60; // ← À AJOUTER (CRITIQUE)

function isInternalCron(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  return key === process.env.FIXETIME_INTERNAL_CRON_KEY;
}

function isManualRequest(req: Request) {
  // requête venant du frontend (session utilisateur)
  return !!req.headers.get("cookie");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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

export async function POST(req: Request) {
  const isCron = isInternalCron(req);
  const isManual = isManualRequest(req);
  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  
  if (!isCron && !isManual) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // ✅ Si manuel : on limite aux emails de l'utilisateur connecté
    // ✅ utilisateur ciblé (manuel OU cron)
let targetUserId: string | null = null;

// CAS 1 — CRON / BACKGROUND
if (isCron && body?.user_id) {
  targetUserId = body.user_id;
}

// CAS 2 — MANUEL (frontend avec cookie)
if (isManual && !targetUserId) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "NO_USER" }, { status: 401 });
  }

  targetUserId = user.id;
}

// 🔒 SÉCURITÉ ABSOLUE
if (!targetUserId) {
  return NextResponse.json({ error: "NO_TARGET_USER" }, { status: 400 });
}

    // 1) Emails à analyser (ceux qui manquent de data)
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const sinceISO = new Date(Date.now() - THIRTY_DAYS).toISOString();

let q = supabaseAdmin
.from("emails")
.select("id, user_id, sender, subject, body, received_at")
.gte("received_at", sinceISO)
.or(
  "decision.is.null,summary.is.null,classification_reason.is.null",
  { foreignTable: undefined }
)
.order("received_at", { ascending: false })
.limit(500);

// 🔒 utilisateur ciblé (OBLIGATOIRE)
if (targetUserId) {
  q = q.eq("user_id", targetUserId);
}


const { data: emails, error } = await q;

if (error) {
  console.error("FETCH_EMAILS_ERROR", error);
  return NextResponse.json({ error: "FETCH_EMAILS_FAILED" }, { status: 500 });
}

// 🔒 GARANTIE PRODUIT — nettoyage des anciens emails bloqués en "Analyse…"
// (on exclut ceux qu'on va analyser juste après)
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

    for (const email of emails) {
      // 2) Règles utilisateur
      const { data: settings } = await supabaseAdmin
        .from("settings_v1")
        .select("email_rules")
        .eq("user_id", email.user_id)
        .maybeSingle();

      const rules: any = settings?.email_rules ?? {};

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

      if (
        rules.keywords?.urgent?.some((k: string) =>
          (email.subject || "").toLowerCase().includes(k.toLowerCase())
        )
      ) {
        forcedDecision = "traiter";
        forcedUrgent = true;
      }

      // ✅ Si règle utilisateur : on update toujours complet
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

      const content =
        email.body?.trim() ||
        "Email sans contenu. Analyse basée sur le sujet et l’expéditeur.";

      const prompt = `
Tu es un assistant de tri d'emails pour un dirigeant.
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
${content}
`;

      // 3) Appel IA
      let raw = "";
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
        });
        raw = completion.choices[0]?.message?.content || "";
      } catch (e) {
        raw = "";
      }

      const match = raw.match(/\{[\s\S]*\}/);

      // ✅ Si JSON invalide → FALLBACK + on écrit quand même
      if (!match) {
        const fb = fallbackDecision(email);

        await supabaseAdmin
          .from("emails")
          .update({
            summary: "Analyse automatique incomplète — classé par règles de secours.",
            decision: fb.decision as any,
            estimated_time: fb.decision === "ignorer" ? 0 : 5,
            recommended_action: fb.decision === "ignorer" ? "archive" : "reply",
            is_urgent: fb.is_urgent,
            is_important: fb.is_important,
            classification_reason: "Fallback : réponse IA non exploitable (JSON).",
          })
          .eq("id", email.id);

        analyzed++;
        continue;
      }

      let result: any = null;
      try {
        result = JSON.parse(match[0]);
      } catch {
        result = null;
      }

      if (!result) {
        const fb = fallbackDecision(email);

        await supabaseAdmin
          .from("emails")
          .update({
            summary: "Analyse automatique incomplète — classé par règles de secours.",
            decision: fb.decision as any,
            estimated_time: fb.decision === "ignorer" ? 0 : 5,
            recommended_action: fb.decision === "ignorer" ? "archive" : "reply",
            is_urgent: fb.is_urgent,
            is_important: fb.is_important,
            classification_reason: "Fallback : JSON IA non parsable.",
          })
          .eq("id", email.id);

        analyzed++;
        continue;
      }

      const decisionMap: any = {
        TRAITER: "traiter",
        IGNORER: "ignorer",
        DELEGUER: "planifier",
      };

      // ✅ Alignement action avec ton UI (task -> schedule)
      const actionMap: any = {
        reply: "reply",
        archive: "archive",
        task: "schedule",
        schedule: "schedule",
      };

      await supabaseAdmin
        .from("emails")
        .update({
          summary: typeof result.summary === "string" ? result.summary : null,
          decision: decisionMap[result.decision] ?? "traiter",
          estimated_time: result.estimated_time ?? 5,
          recommended_action: actionMap[result.recommended_action] ?? "reply",
          is_urgent: result.priority === "URGENT",
          is_important: result.priority === "IMPORTANT",
          classification_reason: "Analyse automatique par l’IA",
        })
        .eq("id", email.id);

      analyzed++;
    }

    return NextResponse.json({ success: true, analyzed });
  } catch (err) {
    console.error("ANALYZE_EMAILS_ERROR", err);
    return NextResponse.json({ error: "ANALYZE_EMAILS_FAILED" }, { status: 500 });
  }
}
