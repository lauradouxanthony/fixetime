import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60; // ← À AJOUTER (CRITIQUE)

function isInternalCron(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  if (!key) return false;
  const expected = process.env.FIXETIME_INTERNAL_CRON_KEY;
  // Si la clé env n'est pas configurée, tout appel avec le header est accepté (dev local)
  if (!expected) return true;
  return key === expected;
}

function isManualRequest(req: Request) {
  // requête venant du frontend (session utilisateur) OU appel server-to-server avec cookie
  return !!req.headers.get("cookie");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/** Heuristique simple pour deviner la catégorie quand l'IA n'a pas répondu */
function guessCategory(email: { subject?: string | null; sender?: string | null }): string {
  const s = (email.subject || "").toLowerCase();
  const sender = (email.sender || "").toLowerCase();
  if (
    s.includes("location") || s.includes("louer") || s.includes("appartement") ||
    s.includes("visite") || s.includes("logement") || s.includes("studio") ||
    s.includes("loyer") || s.includes("locataire") || s.includes("candidature") ||
    s.includes("dossier") || s.includes("bien") || s.includes("chambre")
  ) return "LOCATION";
  if (
    s.includes("info") || s.includes("question") || s.includes("renseignement") ||
    s.includes("disponible") || s.includes("prix") || s.includes("tarif") ||
    s.includes("contact")
  ) return "INFO";
  if (
    sender.includes("newsletter") || sender.includes("no-reply") ||
    sender.includes("noreply") || sender.includes("linkedin") ||
    sender.includes("donotreply") || sender.includes("notification")
  ) return "HORS_SUJET";
  return "INFO"; // défaut neutre
}

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
.select("id, user_id, sender, subject, body, received_at, gmail_message_id")
.gte("received_at", sinceISO)
.or("category.is.null,decision.is.null,summary.is.null")
.order("received_at", { ascending: false })
.limit(200);

console.log("[ANALYZE-INBOX] Démarrage analyse pour user:", targetUserId);

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
      console.log("[ANALYZE-INBOX] Aucun email à analyser (déjà tous classifiés)");
      return NextResponse.json({ success: true, analyzed: 0 });
    }

    console.log(`[ANALYZE-INBOX] ${emails.length} emails à classifier`);

    let analyzed = 0;

    for (const email of emails) {
      // 2) Règles utilisateur + pipeline_mode
      const { data: settings } = await supabaseAdmin
        .from("settings_v1")
        .select("email_rules, pipeline_mode")
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
            category: forcedDecision === "ignorer" ? "HORS_SUJET" : guessCategory(email),
          })
          .eq("id", email.id);

        analyzed++;
        continue;
      }

      const content =
        email.body?.trim() ||
        "Email sans contenu. Analyse basée sur le sujet et l’expéditeur.";

      const prompt = `Tu es l'IA d'une agence immobilière française. Analyse cet email entrant et retourne UNIQUEMENT un JSON valide (sans markdown, sans texte autour) :

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

RÈGLES STRICTES pour "intention" :
- "LOCATION" : le message vient d'un PARTICULIER cherchant à LOUER un logement. Cas : demande de visite, candidature locative, question sur un appartement/bien spécifique avec intention claire de louer, envoi de dossier locataire.
- "INFO" : question générale sur l'agence, les conditions de location, les quartiers, la disponibilité, les prix — SANS intention immédiate de louer ou de visiter.
- "HORS_SUJET" : newsletter, publicité, email automatique (facture, alerte, notification service), LinkedIn, réseaux sociaux, emails transactionnels (Vercel, Orange, Free, Amazon, AliExpress, banque, etc.), tout ce qui n'est PAS une communication humaine liée à la location immobilière.

RÈGLES pour "decision" :
- "TRAITER" si LOCATION ou INFO nécessitant une réponse humaine
- "IGNORER" si HORS_SUJET ou email automatique sans besoin de réponse
- "DELEGUER" si à transférer

RÈGLES confirmation RDV (is_rdv_confirmation = true) :
- Sujet commence par "Re:" ET le prospect confirme un créneau de visite
- Mots clés : "je confirme", "c'est parfait", "d'accord pour", "je serai là", "convient", "oui pour le"
- Dans ce cas seulement : extraire la date dans confirmed_datetime (ISO)

Expéditeur: ${email.sender}
Sujet: ${email.subject}
Contenu: ${content}

IMPORTANT : réponds UNIQUEMENT avec le JSON, rien d'autre.`;

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
            category: guessCategory(email),
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
            category: guessCategory(email),
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

      const intentionMap: Record<string, string> = {
        LOCATION: "LOCATION",
        INFO: "INFO",
        HORS_SUJET: "HORS_SUJET",
      };

      // ── Détection confirmation RDV ──────────────────────────────
      let classificationReason = "Analyse automatique par l’IA";
      let rdvConfirmed = false;

      if (result.is_rdv_confirmation === true && result.confirmed_datetime) {
        rdvConfirmed = true;
        classificationReason = "RDV_CONFIRMÉ";

        // Créer l’event Google Calendar directement
        try {
          const accessToken = await getValidGoogleAccessToken(email.user_id);
          const start = new Date(result.confirmed_datetime);
          const end = new Date(start.getTime() + 60 * 60 * 1000); // +1h

          await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                summary: `Visite confirmée — ${email.sender?.split("@")[0] || "Prospect"}`,
                description: `Confirmation automatique FixTime.\nEmail: ${email.subject}\nExpéditeur: ${email.sender}`,
                start: { dateTime: start.toISOString(), timeZone: "Europe/Paris" },
                end: { dateTime: end.toISOString(), timeZone: "Europe/Paris" },
              }),
            }
          );
        } catch (calErr) {
          console.error("RDV_CALENDAR_CREATE_ERROR", calErr);
          // On continue même si le Calendar échoue
        }
      }

      await supabaseAdmin
        .from("emails")
        .update({
          summary: rdvConfirmed
            ? `✅ RDV de visite confirmé par ${email.sender?.split("@")[0] || "le prospect"}`
            : typeof result.summary === "string" ? result.summary : null,
          decision: decisionMap[result.decision] ?? "traiter",
          estimated_time: result.estimated_time ?? 5,
          recommended_action: actionMap[result.recommended_action] ?? "reply",
          is_urgent: result.priority === "URGENT",
          is_important: rdvConfirmed ? true : result.priority === "IMPORTANT",
          category: intentionMap[result.intention] ?? "INFO",
          classification_reason: classificationReason,
        })
        .eq("id", email.id);

      // ── AUTOPILOTE : envoi automatique ──────────────────────────
      const pipelineMode = (settings as any)?.pipeline_mode ?? "DRAFT";
      const emailRules = (settings as any)?.email_rules ?? {};
      const intention = intentionMap[result.intention] ?? "INFO";

      if (pipelineMode === "AUTOPILOTE" && !rdvConfirmed && email.gmail_message_id) {
        try {
          const accessToken = await getValidGoogleAccessToken(email.user_id);

          let autoReply: string | null = null;

          if (intention === "HORS_SUJET") {
            // Archive silencieusement
            await supabaseAdmin.from("emails").update({ is_archived: true }).eq("id", email.id);
          } else if (intention === "INFO") {
            // Répondre via FAQ
            const faq: { question: string; reponse: string }[] = emailRules.ft_faq ?? [];
            const faqText = faq.length > 0
              ? faq.map((f) => `Q: ${f.question}\nR: ${f.reponse}`).join("\n\n")
              : "Contactez-nous directement pour plus d'informations.";

            const faqCompletion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{
                role: "user",
                content: `Tu es l'assistant d'une agence immobilière. Réponds à cet email en te basant sur la FAQ ci-dessous. Sois courtois et professionnel. Réponds en français.\n\nFAQ:\n${faqText}\n\nEmail de: ${email.sender}\nSujet: ${email.subject}\nContenu: ${email.body ?? ""}`,
              }],
              temperature: 0.3,
            });
            autoReply = faqCompletion.choices[0]?.message?.content ?? null;
          } else if (intention === "LOCATION") {
            // Demander les documents + proposer créneaux
            const docsConfig = emailRules.ft_locatif?.docs ?? {};
            const docsRequired = Object.entries(docsConfig)
              .filter(([, v]) => v === true)
              .map(([k]) => {
                const labels: Record<string, string> = {
                  fiches_paie: "3 dernières fiches de paie",
                  contrat: "Contrat de travail",
                  avis_imposition: "Dernier avis d'imposition",
                  piece_identite: "Pièce d'identité",
                  rib: "RIB",
                };
                return labels[k] ?? k;
              });

            const docsText = docsRequired.length > 0
              ? `Pour étudier votre dossier, merci de nous transmettre :\n${docsRequired.map((d) => `• ${d}`).join("\n")}`
              : "Merci de nous transmettre votre dossier de location complet.";

            const locationCompletion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{
                role: "user",
                content: `Tu es l'assistant d'une agence immobilière. Réponds à cette demande de location. Accuse réception, ${docsText}. Indique que tu reviendras rapidement avec des créneaux de visite. Sois chaleureux et professionnel. En français.\n\nEmail de: ${email.sender}\nSujet: ${email.subject}\nContenu: ${email.body ?? ""}`,
              }],
              temperature: 0.3,
            });
            autoReply = locationCompletion.choices[0]?.message?.content ?? null;
          }

          if (autoReply && email.gmail_message_id) {
            // Construire le message RFC 2822
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
            const raw = Buffer.from(mime, "utf-8")
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/, "");

            // Récupérer threadId
            let threadId: string | undefined;
            try {
              const msgRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.gmail_message_id}?format=minimal`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (msgRes.ok) threadId = (await msgRes.json()).threadId;
            } catch { /* optional */ }

            const payload: any = { raw };
            if (threadId) payload.threadId = threadId;

            await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            // Marquer comme traité
            await supabaseAdmin.from("emails").update({
              ai_reply: autoReply,
              is_archived: true,
            }).eq("id", email.id);
          }
        } catch (autoErr) {
          console.error("AUTOPILOTE_SEND_ERROR", autoErr);
          // On ne bloque pas l'analyse si l'envoi auto échoue
        }
      }

      analyzed++;
    }

    console.log(`[ANALYZE-INBOX] Terminé : ${analyzed} emails classifiés`);
    return NextResponse.json({ success: true, analyzed });
  } catch (err) {
    console.error("ANALYZE_EMAILS_ERROR", err);
    return NextResponse.json({ error: "ANALYZE_EMAILS_FAILED" }, { status: 500 });
  }
}
