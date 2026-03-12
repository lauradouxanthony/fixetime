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
.select("id, user_id, sender, subject, body, received_at, gmail_message_id, thread_id")
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
        .select("email_rules")          // pipeline_mode est dans email_rules.pipeline_mode (pas de colonne dédiée)
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

      // ── Contexte agence depuis les settings ──────────────────────────
      const ftLocatif = rules.ft_locatif ?? {};
      const ftIa = rules.ft_ia ?? {};
      const ftAgence = rules.ft_agence ?? {};
      const ftFaq: { question: string; reponse: string }[] = rules.ft_faq ?? [];

      const multiplicateur = ftLocatif.multiplicateur ?? 3;
      const agenceName = ftAgence.name ?? "l’agence";
      const zones = ftIa.zones ?? "";
      const loyerMoyen = ftIa.loyer_moyen ?? "";
      const instructions = ftIa.instructions ?? "";

      const docsRequired = Object.entries(ftLocatif.docs ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => ({ fiches_paie: "fiches de paie", contrat: "contrat de travail", avis_imposition: "avis d’imposition", piece_identite: "pièce d’identité", rib: "RIB" }[k] ?? k));

      const agencyContext = [
        `Agence : ${agenceName}`,
        zones ? `Zones gérées : ${zones}` : "",
        loyerMoyen ? `Loyer moyen du parc : ${loyerMoyen}€` : "",
        `Critère solvabilité : revenus ≥ ${multiplicateur}x le loyer`,
        docsRequired.length > 0 ? `Documents requis : ${docsRequired.join(", ")}` : "",
        instructions ? `Instructions spéciales : ${instructions}` : "",
        ftFaq.length > 0 ? `FAQ agence (${ftFaq.length} entrées disponibles)` : "",
      ].filter(Boolean).join("\n");

      const prompt = `Tu es l’IA d’une agence immobilière française. Analyse cet email entrant et retourne UNIQUEMENT un JSON valide (sans markdown, sans texte autour) :

CONTEXTE DE L’AGENCE :
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

RÈGLES STRICTES pour "intention" :
- "LOCATION" : le message vient d'un PARTICULIER cherchant à LOUER un logement. Cas : demande de visite, candidature locative, question sur un appartement/bien spécifique avec intention claire de louer, envoi de dossier locataire.
- "INFO" : question générale sur l'agence, les conditions de location, les quartiers, la disponibilité, les prix — SANS intention immédiate de louer ou de visiter.
- "HORS_SUJET" : newsletter, publicité, email automatique (facture, alerte, notification service), LinkedIn, réseaux sociaux, emails transactionnels (Vercel, Orange, Free, Amazon, AliExpress, banque, etc.), tout ce qui n'est PAS une communication humaine liée à la location immobilière.

RÈGLES pour "decision" :
- "TRAITER" si LOCATION ou INFO nécessitant une réponse humaine
- "IGNORER" si HORS_SUJET ou email automatique sans besoin de réponse
- "DELEGUER" si à transférer

RÈGLES pour "priority" (détermine le score de qualification 1-10) :
- "URGENT" → score 9-10 : email LOCATION où le prospect mentionne SIMULTANÉMENT revenus (ex: 3000€, CDI, salaire...) ET au moins 2 documents (fiches de paie, contrat, pièce d'identité, avis d'imposition) ET une intention claire de visite/candidature. Exemple : "Je suis en CDI, 3500€/mois, je peux vous envoyer mes 3 fiches de paie et ma pièce d'identité, quand puis-je visiter ?"
- "IMPORTANT" → score 7-8 : email LOCATION avec intention claire de louer/visiter ET quelques infos financières OU mention de documents, mais profil incomplet
- "NORMAL" → score 3-6 : question générale sur un bien ou l'agence, demande d'information sans dossier, ou email INFO
- Pour HORS_SUJET : toujours "NORMAL" (score 1-2)

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

      // ── PROBLÈME 1 : Détection fil de conversation (thread multi-tours) ──
      // Si un email du même thread_id existe déjà, c'est une réponse du prospect
      // → merger le prospect_data accumulé pour ne demander que ce qui manque encore
      let threadProspectData: Record<string, unknown> | null = null;
      let isFollowUp = false;

      if ((email as any).thread_id) {
        try {
          const { data: threadPrev } = await supabaseAdmin
            .from("emails")
            .select("id, prospect_data")
            .eq("user_id", email.user_id)
            .eq("thread_id", (email as any).thread_id)
            .neq("id", email.id)
            .not("prospect_data", "is", null)
            .order("received_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (threadPrev?.prospect_data) {
            isFollowUp = true;
            threadProspectData = threadPrev.prospect_data as Record<string, unknown>;
            console.log(`[ANALYZE-INBOX] ↩️ Réponse dans thread ${(email as any).thread_id} — merge prospect_data`);
          }
        } catch (e) {
          console.warn("[ANALYZE-INBOX] Thread check échoué:", e);
        }
      }

      // ── Extraction IA données prospect (LOCATION uniquement) ──────────
      let prospectData: Record<string, unknown> | null = null;
      const isLocationEmail = (intentionMap[result.intention] ?? "INFO") === "LOCATION";

      if (isLocationEmail && content && content.length > 10) {
        try {
          // BUG FIX #1+3+4 : prompt amélioré
          // - nom extrait du CORPS de l'email (pas de l'expéditeur Gmail)
          // - revenus_mensuels = ce que GAGNE le candidat (≠ loyer)
          // - loyer_max = loyer du BIEN visité (≠ revenus)
          // - garant remplace date_emmenagement
          const prospectPrompt = `Tu es un assistant immobilier. Extrais TOUTES les informations suivantes depuis le corps de cet email de candidature locative. Si une info est absente, retourne null.
Retourne UNIQUEMENT ce JSON valide sans aucun texte autour :
{
  "nom": string | null,
  "telephone": string | null,
  "situation_pro": "CDI" | "CDD" | "AUTO_ENTREPRENEUR" | "ETUDIANT" | "RETRAITE" | null,
  "revenus_mensuels": number | null,
  "loyer_max": number | null,
  "animaux": "OUI" | "NON" | null,
  "nb_personnes": number | null,
  "garant": "OUI" | "NON" | null
}

RÈGLES IMPORTANTES :
- nom : extraire le NOM DU CANDIDAT depuis le corps de l'email (signature, "je suis X", "je m'appelle X", "cordialement X"). NE PAS utiliser l'adresse email ni le nom de l'expéditeur Gmail. Si plusieurs noms, prendre le signataire.
- revenus_mensuels : salaire NET MENSUEL que GAGNE le candidat en € (ex: "je gagne 3200€/mois" → 3200, "CDI 2800€" → 2800). C'est ce que gagne la personne.
- loyer_max : montant du LOYER DU BIEN que le candidat souhaite louer, mentionné dans l'email en € (ex: "l'appartement à 850€/mois" → 850, "loyer de 950€" → 950). C'est le prix du logement.
- ATTENTION : ne pas inverser revenus_mensuels et loyer_max. Les revenus sont toujours > loyer dans un dossier solvable.
- animaux : "OUI" si animaux mentionnés, "NON" si dit explicitement ne pas en avoir, null si non mentionné.
- garant : "OUI" si le candidat mentionne avoir un garant, "NON" si dit explicitement ne pas avoir de garant, null si non mentionné.
- situation_pro : déduire depuis le contexte (étudiant/école → ETUDIANT, freelance/indépendant → AUTO_ENTREPRENEUR, retraité → RETRAITE).
- Retourne null pour tout champ non trouvé dans l'email.

Sujet: ${email.subject}
Email à analyser (corps complet) :
${content.slice(0, 2000)}`;

          const prospectCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prospectPrompt }],
            temperature: 0,
          });
          const prospectRaw = prospectCompletion.choices[0]?.message?.content || "";
          const prospectMatch = prospectRaw.match(/\{[\s\S]*\}/);
          if (prospectMatch) {
            const parsed = JSON.parse(prospectMatch[0]);
            // Normaliser le champ "nom" → peut venir de "nom" ou "nom_prenom"
            if (!parsed.nom && parsed.nom_prenom) parsed.nom = parsed.nom_prenom;
            delete parsed.nom_prenom;
            // Supprimer date_emmenagement si présent (ancien prompt)
            delete parsed.date_emmenagement;
            prospectData = parsed;
          }
        } catch (e) {
          console.warn("[ANALYZE-INBOX] Extraction prospect échouée:", e);
        }

        // PROBLÈME 1 : Merger avec le prospect_data du thread si c'est une réponse
        // Stratégie : les champs non-null du nouvel email écrasent les anciens null.
        // Les champs déjà renseignés dans le thread sont conservés.
        if (isFollowUp && threadProspectData) {
          const merged: Record<string, unknown> = { ...threadProspectData };
          if (prospectData) {
            for (const [k, v] of Object.entries(prospectData)) {
              if (v !== null && v !== undefined) merged[k] = v;
            }
          }
          prospectData = merged;
          console.log(`[ANALYZE-INBOX] ↩️ Merge thread OK:`, JSON.stringify(merged));
        }
      }

      // ── Mise à jour DB principale ─────────────────────────────────────
      const mainUpdate: Record<string, unknown> = {
        summary: rdvConfirmed
          ? `✅ RDV de visite confirmé par ${email.sender?.split("@")[0] || "le prospect"}`
          : isFollowUp
          ? `↩️ Réponse — ${typeof result.summary === "string" ? result.summary : "nouvelles informations du prospect"}`
          : typeof result.summary === "string" ? result.summary : null,
        decision: decisionMap[result.decision] ?? "traiter",
        estimated_time: result.estimated_time ?? 5,
        recommended_action: actionMap[result.recommended_action] ?? "reply",
        is_urgent: result.priority === "URGENT",
        is_important: rdvConfirmed ? true : result.priority === "IMPORTANT",
        category: intentionMap[result.intention] ?? "INFO",
        classification_reason: classificationReason,
      };

      // Ajouter prospect_data si extrait (merge non-destructif : ne pas écraser les champs remplis)
      if (prospectData) {
        // Lire l'existant d'abord pour merger
        const { data: existingEmail } = await supabaseAdmin
          .from("emails")
          .select("prospect_data")
          .eq("id", email.id)
          .maybeSingle();
        const existing = (existingEmail as any)?.prospect_data ?? {};
        // Merger : ne remplacer que les champs null/undefined existants
        const merged: Record<string, unknown> = { ...prospectData };
        for (const [k, v] of Object.entries(existing)) {
          if (v !== null && v !== undefined && v !== "") {
            merged[k] = v; // Conserver la valeur existante non-nulle
          }
        }
        (mainUpdate as any).prospect_data = merged;
      }

      // Tenter la mise à jour (prospect_data peut ne pas exister encore en DB)
      try {
        await supabaseAdmin.from("emails").update(mainUpdate).eq("id", email.id);
      } catch {
        // Fallback sans prospect_data si la colonne n'existe pas
        delete (mainUpdate as any).prospect_data;
        await supabaseAdmin.from("emails").update(mainUpdate).eq("id", email.id);
      }

      // ── AUTOPILOTE : envoi automatique ──────────────────────────
      const pipelineMode = (settings?.email_rules as any)?.pipeline_mode ?? "DRAFT";
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
            // ── Logique 4 cas (même que generate-reply) ──────────────────────
            const locatif = emailRules.ft_locatif ?? {};
            const docsSection = emailRules.ft_documents ?? {};
            const calSection = emailRules.ft_calendrier ?? {};
            const nomAgence = locatif.nomAgence ?? "l'agence";
            const multiplicateur = locatif.multiplicateur ?? 3;
            const garantObligatoire = locatif.garantObligatoire ?? { cdd: true, auto: true, etudiant: true, retraite: false };
            const heureDebut = calSection.heureDebut ?? 9;
            const heureFin = calSection.heureFin ?? 18;
            const dureeVisite = calSection.dureeVisite ?? 60;
            const docsProfiles: Record<string, string[]> = {
              cdi: (docsSection.cdi as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
              etudiant: (docsSection.etudiant as string[]) ?? ["Carte étudiante", "Certificat de scolarité", "Justificatif de garant", "Pièce d'identité"],
              auto: (docsSection.auto as string[]) ?? ["Extrait Kbis", "Bilans (2 ans)", "Avis d'imposition", "Pièce d'identité"],
            };

            const body = email.body ?? "";
            const bodyLower = body.toLowerCase();

            // Situation
            let situation: string | null = null;
            if (bodyLower.includes("étudiant") || bodyLower.includes("université") || bodyLower.includes("école")) situation = "etudiant";
            else if (bodyLower.includes("cdi")) situation = "cdi";
            else if (bodyLower.includes("cdd")) situation = "cdd";
            else if (bodyLower.includes("auto-entrepreneur") || bodyLower.includes("freelance")) situation = "auto";
            else if (bodyLower.includes("retraité")) situation = "retraite";
            // Utiliser aussi les données IA extraites si disponibles
            if (prospectData?.situation_pro) {
              const spMap: Record<string, string> = {
                CDI: "cdi", CDD: "cdd", AUTO_ENTREPRENEUR: "auto", ETUDIANT: "etudiant", RETRAITE: "retraite"
              };
              situation = spMap[prospectData.situation_pro as string] ?? situation;
            }

            // Revenus/loyer (priorité aux données IA)
            let revenus: number | null = (prospectData?.revenus_mensuels as number | null) ?? null;
            let loyer: number | null = (prospectData?.loyer_max as number | null) ?? null;
            if (!revenus || !loyer) {
              for (const line of body.split(/\r?\n/)) {
                const l = line.toLowerCase();
                const m = line.match(/(\d[\d\s]*)\s*(?:€|euros?)/i);
                if (!m) continue;
                const val = parseFloat(m[1].replace(/\s/g, ""));
                if (!val || val < 100) continue;
                if (l.includes("salaire") || l.includes("revenu") || l.includes("gagne")) { if (!revenus) revenus = val; }
                else if (l.includes("loyer") || l.includes("budget")) { if (!loyer) loyer = val; }
              }
            }

            // Nom (priorité aux données IA)
            let nom = prospectData?.nom ?? "Madame, Monsieur";
            if (!prospectData?.nom) {
              const nomMatch = body.match(/(?:je m['']appelle|je suis|prénom\s*:?\s*)([A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+(?:\s+[A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+)*)/);
              if (nomMatch?.[1]) nom = nomMatch[1].trim();
            }

            // Cas
            let cas: "etudiant" | "insolvable" | "incomplet" | "complet";
            if (situation === "etudiant") cas = "etudiant";
            else if (revenus !== null && loyer !== null && revenus / loyer < multiplicateur) cas = "insolvable";
            else if (!revenus || !loyer || !situation) cas = "incomplet";
            else cas = "complet";

            console.log(`[AUTOPILOTE] emailId=${email.id} cas=${cas} situation=${situation} revenus=${revenus} loyer=${loyer}`);

            let autopilotePrompt = "";
            const agenceLine = `agence ${nomAgence}`;

            if (cas === "etudiant") {
              const docsList = docsProfiles.etudiant.map(d => `• ${d}`).join("\n");
              const needsGarant = garantObligatoire["etudiant"] !== false;
              autopilotePrompt = `Tu es l'assistant de l'${agenceLine}. Rédige un email professionnel et chaleureux pour un candidat étudiant.\nRemercier ${nom} pour sa candidature.\nExpliquer que pour les étudiants, un garant est ${needsGarant ? "obligatoire" : "recommandé"}.\nDemander les documents suivants:\n${docsList}\nSignature: Cordialement, L'équipe ${nomAgence}\n\nEmail reçu:\nExpéditeur: ${email.sender}\nSujet: ${email.subject}\nContenu: ${body}`;
            } else if (cas === "insolvable") {
              const ratio = revenus && loyer ? (revenus / loyer).toFixed(1) : "insuffisant";
              autopilotePrompt = `Tu es l'assistant de l'${agenceLine}. Rédige un email poli et respectueux pour décliner cette candidature.\nRemercier ${nom}.\nExpliquer poliment que les revenus sont insuffisants (critère: ${multiplicateur}x le loyer, ratio actuel: ${ratio}x).\nSuggérer la possibilité d'un garant solide.\nSignature: Cordialement, L'équipe ${nomAgence}\n\nEmail reçu:\nExpéditeur: ${email.sender}\nSujet: ${email.subject}\nContenu: ${body}`;
            } else if (cas === "incomplet") {
              const missing: string[] = [];
              if (!situation) missing.push("votre situation professionnelle (CDI, CDD, étudiant, indépendant…)");
              if (!revenus) missing.push("vos revenus nets mensuels (€)");
              if (!loyer) missing.push("le loyer du bien qui vous intéresse");
              autopilotePrompt = `Tu es l'assistant de l'${agenceLine}. Rédige un email pour demander les informations manquantes.\nRemercier ${nom} pour sa candidature.\nDemander:\n${missing.map((m, i) => `${i + 1}. ${m}`).join("\n")}\nSignature: Cordialement, L'équipe ${nomAgence}\n\nEmail reçu:\nExpéditeur: ${email.sender}\nSujet: ${email.subject}\nContenu: ${body}`;
            } else {
              const sitKey = situation === "auto" ? "auto" : "cdi";
              const docsList = (docsProfiles[sitKey as keyof typeof docsProfiles] ?? docsProfiles.cdi).map(d => `• ${d}`).join("\n");
              autopilotePrompt = `Tu es l'assistant de l'${agenceLine}. Accueille favorablement ce candidat solvable.\nRemercier ${nom}.\nDemander les documents suivants:\n${docsList}\nProposer des créneaux de visite (entre ${heureDebut}h et ${heureFin}h en semaine, durée ${dureeVisite}min).\nSignature: Cordialement, L'équipe ${nomAgence}\n\nEmail reçu:\nExpéditeur: ${email.sender}\nSujet: ${email.subject}\nContenu: ${body}`;
            }

            const locationCompletion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: autopilotePrompt }],
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
