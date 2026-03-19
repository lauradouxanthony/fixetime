import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";
import { setLastAction } from "@/lib/lead/lastAction";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ── Helpers heuristiques ── */

function detectSituation(body: string): string | null {
  const l = body.toLowerCase();
  if (l.includes("étudiant") || l.includes("etudiante") || l.includes("école") || l.includes("université")) return "etudiant";
  if (l.includes("cdi")) return "cdi";
  if (l.includes("cdd")) return "cdd";
  if (l.includes("auto-entrepreneur") || l.includes("autoentrepreneur") || l.includes("freelance") || l.includes("indépendant")) return "auto";
  if (l.includes("retraité") || l.includes("retraitée")) return "retraite";
  return null;
}

function extractMoney(body: string): { revenus: number | null; loyer: number | null } {
  const lines = body.split(/\r?\n/);
  let revenus: number | null = null;
  let loyer: number | null = null;
  for (const line of lines) {
    const l = line.toLowerCase();
    const m = line.match(/(\d[\d\s]*)\s*(?:€|euros?)/i);
    if (!m) continue;
    const val = parseFloat(m[1].replace(/\s/g, ""));
    if (!val || val < 100) continue;
    if (l.includes("salaire") || l.includes("revenu") || l.includes("gagne") || l.includes("touche")) {
      if (!revenus) revenus = val;
    } else if (l.includes("loyer") || l.includes("budget") || l.includes("mensuel") || l.includes("loue")) {
      if (!loyer) loyer = val;
    }
  }
  if (!revenus || !loyer) {
    const all = [...body.matchAll(/(\d[\d\s]*)\s*(?:€|euros?)/gi)]
      .map((m) => parseFloat(m[1].replace(/\s/g, "")))
      .filter((v) => v >= 200);
    if (!loyer && all[0]) loyer = all[0];
    if (!revenus && all[1]) revenus = all[1];
  }
  return { revenus, loyer };
}

function extractNom(body: string): string {
  const m = body.match(/(?:je m['']appelle|je suis|prénom\s*:?\s*)([A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+(?:\s+[A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+)*)/);
  if (m?.[1]) return m[1].trim();
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2 && l.length < 45);
  const last = lines[lines.length - 1] ?? "";
  if (last.split(/\s+/).length >= 2 && !/[@.]/.test(last)) return last;
  return "";
}

/* ── Détection intentions edge cases ── */

function detectChangementCreneau(body: string): boolean {
  const l = body.toLowerCase();
  return (
    (l.includes("changer") && (l.includes("créneau") || l.includes("rendez-vous") || l.includes("rdv") || l.includes("date") || l.includes("visite"))) ||
    l.includes("annuler le rdv") || l.includes("annuler le rendez-vous") ||
    (l.includes("pas disponible") && (l.includes("créneau") || l.includes("date") || l.includes("visite"))) ||
    l.includes("autre créneau") || l.includes("autre date") || l.includes("changer la date")
  );
}

function detectRefusVisite(body: string): boolean {
  const l = body.toLowerCase();
  return (
    (l.includes("ne peux pas") || l.includes("impossible") || l.includes("finalement non") || l.includes("je refuse") || l.includes("non merci")) &&
    (l.includes("visite") || l.includes("rdv") || l.includes("rendez-vous"))
  );
}

/* ── Cas de réponse selon l'étape du process ── */
type ReplyCase =
  | "qualification"
  | "visite_proposee"
  | "etudiant"
  | "refuse"
  | "visite_confirmee"
  | "dossier_demande"
  | "dossier_recu"
  | "docs_hors_etape"      // CAS B — docs reçus sans demande préalable
  | "refus_visite_provisoire"; // CAS C — prospect refuse un créneau

function determineCase(params: {
  situation: string | null;
  revenus: number | null;
  loyer: number | null;
  multiplicateur: number;
  etapeProcess: string | null;
  body: string;
  hasAttachments: boolean;
}): { cas: ReplyCase; intention: string } {
  const { situation, revenus, loyer, multiplicateur, etapeProcess, body, hasAttachments } = params;

  // CAS B — documents reçus hors étape DOSSIER
  if (hasAttachments && etapeProcess !== "DOSSIER_DEMANDE" && etapeProcess !== "DOSSIER_RECU") {
    return { cas: "docs_hors_etape", intention: "docs_hors_etape" };
  }

  // CAS C — refus d'une visite proposée/confirmée
  if (
    (etapeProcess === "VISITE_PROPOSEE" || etapeProcess === "VISITE_CONFIRMEE") &&
    detectRefusVisite(body)
  ) {
    return { cas: "refus_visite_provisoire", intention: "refus_visite_provisoire" };
  }

  // CAS A — changement de créneau (re-propose des créneaux)
  if (
    (etapeProcess === "VISITE_CONFIRMEE" || etapeProcess === "VISITE_PROPOSEE") &&
    detectChangementCreneau(body)
  ) {
    return { cas: situation === "etudiant" ? "etudiant" : "visite_proposee", intention: "changement_creneau" };
  }

  // Étapes avancées et manuelles
  if (etapeProcess === "DOSSIER_RECU")     return { cas: "dossier_recu",     intention: "dossier_recu" };
  if (etapeProcess === "DOSSIER_DEMANDE")  return { cas: "dossier_demande",  intention: "dossier_demande" };
  if (etapeProcess === "VISITE_CONFIRMEE") return { cas: "visite_confirmee", intention: "visite_confirmee" };
  if (etapeProcess === "REFUSE")           return { cas: "refuse",           intention: "refuse" };
  if (etapeProcess === "VISITE_PROPOSEE") {
    return { cas: situation === "etudiant" ? "etudiant" : "visite_proposee", intention: "visite_proposee" };
  }

  // Pas d'étape renseignée → déterminer depuis le profil
  if (situation === "etudiant") return { cas: "etudiant", intention: "qualification" };
  if (revenus !== null && loyer !== null && loyer > 0 && revenus / loyer < multiplicateur)
    return { cas: "refuse", intention: "refuse_solvabilite" };
  if (!revenus || !loyer || !situation) return { cas: "qualification", intention: "qualification" };
  return { cas: "visite_proposee", intention: "visite_proposee" };
}

/* ── Contexte système structuré (toujours injecté) ── */
function buildSystemContext(params: {
  nomAgence: string;
  instructions: string;
  prospect: {
    nom: string;
    etapeProcess: string | null;
    situationPro: string | null;
    revenus: number | null;
    loyer: number | null;
    garant: boolean | null;
    multiplicateur: number;
  };
  property: { title: string; address: string | null; rent: number; required_docs: string[] } | null;
  attachments: { filename: string; docType?: string; status?: string }[];
  threadEmails: { received_at: string | null; sender: string | null; body: string | null; ai_reply: string | null }[];
}): string {
  const { nomAgence, instructions, prospect, property, attachments, threadEmails } = params;
  const { revenus, loyer, multiplicateur } = prospect;
  const ratio = revenus && loyer ? revenus / loyer : null;
  const solvabilite = ratio
    ? `ratio ${ratio.toFixed(1)}x — ${ratio >= multiplicateur ? "solvable" : "insolvable"}`
    : "non calculée";

  const docsRecus = attachments
    .filter((a) => a.filename && a.filename.trim().length > 0)
    .map((a) => a.docType && a.docType !== "autre" ? a.docType : a.filename);

  const docsRequis = property?.required_docs ?? [];
  const docsMissing = docsRequis.filter(
    (d) => !docsRecus.some((r) => r.toLowerCase().includes(d.toLowerCase().slice(0, 5)))
  );

  const historyLines = threadEmails.map((e) => {
    const ts = e.received_at ? new Date(e.received_at).toLocaleDateString("fr-FR") : "?";
    const senderShort = (e.sender ?? "Prospect").replace(/<[^>]+>/, "").trim();
    const bodyShort = (e.body ?? "").slice(0, 300).replace(/\n+/g, " ");
    const lines = [`[${ts}] ${senderShort} : ${bodyShort}`];
    if (e.ai_reply) {
      lines.push(`[${ts}] IA : ${e.ai_reply.slice(0, 300).replace(/\n+/g, " ")}`);
    }
    return lines.join("\n");
  }).join("\n");

  return `Tu es l'assistant IA de ${nomAgence || "l'agence immobilière"}.
Réponds toujours en français, ton professionnel et humain.
Tu ne décides jamais si un dossier est valide — c'est le rôle de l'agent.${instructions ? `\nINSTRUCTIONS SPÉCIALES : ${instructions}` : ""}

CONTEXTE PROSPECT :
- Nom : ${prospect.nom || "non renseigné"}
- Étape actuelle : ${prospect.etapeProcess ?? "NEW"}
- Situation pro : ${prospect.situationPro ?? "non renseignée"}
- Revenus nets/mois : ${revenus ? `${revenus}€` : "non renseignés"}
- Solvabilité : ${solvabilite}
- Garant : ${prospect.garant === true ? "oui" : prospect.garant === false ? "non" : "non précisé"}
- Documents reçus : ${docsRecus.length > 0 ? docsRecus.join(", ") : "aucun"}
- Documents manquants : ${docsMissing.length > 0 ? docsMissing.join(", ") : "aucun"}

${property ? `BIEN CONCERNÉ :
- ${property.title}${property.address ? ` — ${property.address}` : ""}
- Loyer : ${property.rent}€/mois
` : ""}HISTORIQUE DE LA CONVERSATION :
${historyLines || "(Premier contact — aucun historique disponible)"}`;
}

/* ── Builders de prompt par cas ── */
function buildPrompt(params: {
  cas: ReplyCase;
  email: { sender: string | null; subject: string | null; body: string | null };
  settings: {
    nomAgence: string;
    multiplicateur: number;
    animaux: string;
    garantObligatoire: Record<string, boolean>;
    docsProfiles: { cdi: string[]; cdd: string[]; etudiant: string[]; auto: string[]; retraite: string[] };
    faq: { question: string; reponse: string }[];
    instructions: string;
    heureDebut: number;
    heureFin: number;
    dureeVisite: number;
  };
  prospect: {
    nom: string;
    situation: string | null;
    revenus: number | null;
    loyer: number | null;
  };
}): string {
  const { cas, email, settings, prospect } = params;
  const { nomAgence, multiplicateur, garantObligatoire, docsProfiles, heureDebut, heureFin, dureeVisite } = settings;

  const agenceLine = nomAgence ? `Agence : ${nomAgence}` : "Agence immobilière";
  const nomProspect = prospect.nom || "Madame, Monsieur";
  const emailCtx = `Email reçu :\nExpéditeur : ${email.sender}\nSujet : ${email.subject}\nContenu : ${email.body}`;
  const sig = `Cordialement, L'équipe ${nomAgence || "de l'agence"}`;

  if (cas === "dossier_recu") {
    return `Rédige un email bref et professionnel pour accuser réception des documents de ${nomProspect}.

Contenu :
- Remercier chaleureusement pour l'envoi du dossier
- Confirmer la bonne réception de l'ensemble des pièces
- Indiquer que le dossier va être étudié et qu'un retour sera communiqué rapidement
- Ne pas s'engager sur un délai précis
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "docs_hors_etape") {
    return `Rédige un email professionnel et chaleureux pour accuser réception de documents envoyés par ${nomProspect}.

Contenu :
- Remercier sincèrement pour l'envoi
- Indiquer que les documents ont bien été reçus et conservés dans le dossier
- Expliquer qu'un retour sera fait prochainement selon l'avancement du process
- NE PAS prendre d'engagement ferme sur la suite
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "refus_visite_provisoire") {
    return `Rédige un email compréhensif et professionnel pour répondre à ${nomProspect} qui ne peut pas se rendre à la visite proposée.

Contenu :
- Comprendre et remercier ${nomProspect} de nous avoir informé
- Demander brièvement la raison si elle n'est pas précisée
- Proposer de trouver une autre disponibilité et demander ses créneaux préférés
- Rester positif et disponible
- NE PAS passer en statut refus définitif
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "dossier_demande") {
    const sitKeyMap: Record<string, keyof typeof docsProfiles> = {
      cdi: "cdi", cdd: "cdd", auto: "auto", retraite: "retraite", etudiant: "etudiant",
    };
    const sitKey: keyof typeof docsProfiles = prospect.situation ? (sitKeyMap[prospect.situation] ?? "cdi") : "cdi";
    const docsList = (docsProfiles[sitKey] ?? docsProfiles.cdi).map((d) => `• ${d}`).join("\n");
    const needsGarant = prospect.situation && garantObligatoire[prospect.situation];
    const garantLine = needsGarant ? "\n• Pour votre profil, un garant sera également requis (mêmes documents)." : "";
    return `Rédige un email chaleureux pour demander le dossier locataire à ${nomProspect}, suite à la visite.

Contenu :
- Remercier ${nomProspect} pour la visite et l'intérêt pour le bien
- Demander de transmettre les documents suivants pour constituer le dossier :
${docsList}${garantLine}
- Indiquer que la candidature sera examinée dès réception du dossier complet
- Rester enthousiaste et professionnel
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "visite_confirmee") {
    return `Rédige un email de confirmation de visite pour ${nomProspect}.

Contenu :
- Confirmer chaleureusement la visite (date/heure telles que mentionnées dans l'email reçu)
- Indiquer l'adresse du bien si connue, sinon proposer un rappel
- Préciser qu'un retour sera communiqué rapidement après la visite
- NE PAS demander de documents — les documents seront demandés après la visite
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "refuse") {
    const ratio = prospect.revenus && prospect.loyer
      ? (prospect.revenus / prospect.loyer).toFixed(1)
      : "insuffisant";
    return `Rédige un email professionnel, poli et respectueux pour décliner cette candidature.

Contenu :
- Remercier ${nomProspect} pour sa candidature et son intérêt
- Expliquer poliment que le critère de solvabilité n'est pas atteint (revenus insuffisants pour couvrir ${multiplicateur}x le loyer, ratio actuel : ${ratio}x)
- Suggérer la possibilité d'un garant solide (revenus ≥ ${multiplicateur}x le loyer) qui pourrait permettre de reconsidérer
- Encourager à revenir vers l'agence si la situation évolue
- NE PAS demander de documents
- Rester positif et professionnel
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "etudiant") {
    const needsGarant = garantObligatoire["etudiant"] !== false;
    return `Rédige un email professionnel et bienveillant pour un candidat étudiant.

Contenu :
- Remercier ${nomProspect} pour son intérêt pour le bien
- Expliquer que pour les étudiants, un garant (personne physique avec revenus stables ≥ ${multiplicateur}x le loyer) est ${needsGarant ? "obligatoire" : "fortement recommandé"}
- Si l'email mentionne déjà un garant disponible : proposer 3 créneaux de visite (jours ouvrés entre ${heureDebut}h et ${heureFin}h, durée ${dureeVisite}min) et demander de confirmer le créneau préféré
- Si aucun garant n'est mentionné : demander si ${nomProspect} dispose d'un garant avant d'aller plus loin
- NE PAS demander de documents à ce stade — les documents seront demandés après la visite
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "qualification") {
    const missingList: string[] = [];
    if (!prospect.situation) missingList.push("votre situation professionnelle (CDI, CDD, étudiant, indépendant, retraité…)");
    if (!prospect.revenus) missingList.push("vos revenus nets mensuels (en €)");
    const missingStr = missingList.map((m, i) => `${i + 1}. ${m}`).join("\n");
    return `Rédige un email chaleureux pour demander les informations manquantes.

Contenu :
- Remercier ${nomProspect} pour son intérêt pour le bien
- Expliquer qu'avant d'étudier sa candidature, il manque quelques informations :
${missingStr}
- Préciser que ces informations permettront de traiter rapidement sa candidature
- Rester encourageant et disponible pour toute question
- NE PAS demander de documents à ce stade
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  // visite_proposee (default)
  const ratio = prospect.revenus && prospect.loyer
    ? (prospect.revenus / prospect.loyer).toFixed(1)
    : null;
  const solvLine = ratio ? ` Son profil présente un ratio de ${ratio}x (critère : ${multiplicateur}x).` : "";

  return `Rédige un email professionnel et enthousiaste pour proposer une visite à ce candidat solvable.${solvLine}

Contenu :
- Accueillir chaleureusement ${nomProspect}
- Confirmer que son profil correspond à nos critères (sans rentrer dans les détails chiffrés)
- Proposer 3 créneaux de visite concrets et réalistes à court terme (jours ouvrés, entre ${heureDebut}h et ${heureFin}h, durée ${dureeVisite}min)
- Demander de confirmer le créneau préféré ou de proposer une autre disponibilité
- NE PAS demander de documents — les documents seront demandés après la visite
- Rester enthousiaste et professionnel
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
}

/* ── Route handler ── */
export async function POST(req: Request) {
  try {
    // 1. Auth
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // 2. Email ID
    const { emailId } = await req.json();
    if (!emailId) return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });

    // 3. Charger email + champs nécessaires (thread, property, attachments)
    const { data: email, error: emailErr } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, body, ai_reply, category, prospect_data, prospect_id, thread_id, gmail_thread_id, property_id, attachments")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (emailErr || !email) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    // CAS D — HORS_SUJET : ne pas générer de réponse
    if ((email.category ?? "").toUpperCase() === "HORS_SUJET") {
      try {
        await supabaseAdmin.from("activity_log").insert({
          user_id: user.id,
          actor: "ai",
          type: "skipped_hors_sujet",
          title: "Email HORS_SUJET — réponse IA non générée",
          email_id: emailId,
          meta: { subject: email.subject, sender: email.sender },
        });
      } catch { /* non bloquant */ }
      return NextResponse.json({ error: "HORS_SUJET", message: "Email hors sujet — aucune réponse générée." }, { status: 400 });
    }

    // Anti-coût : réponse déjà générée
    if (email.ai_reply && email.ai_reply.trim().length > 0) {
      return NextResponse.json({ reply: email.ai_reply });
    }

    // 4. Charger l'historique du thread (5 emails précédents + email courant)
    const threadId = (email as any).thread_id ?? (email as any).gmail_thread_id ?? null;
    let threadEmails: { received_at: string | null; sender: string | null; body: string | null; ai_reply: string | null }[] = [];

    if (threadId) {
      const { data: threadRows } = await supabaseAdmin
        .from("emails")
        .select("id, sender, subject, body, received_at, prospect_data, category, ai_reply")
        .eq("user_id", user.id)
        .eq("thread_id", threadId)
        .neq("id", emailId) // exclure l'email courant (il sera ajouté en dernier)
        .order("received_at", { ascending: true })
        .limit(6);

      if (threadRows && threadRows.length > 0) {
        threadEmails = threadRows.map((r: any) => ({
          received_at: r.received_at,
          sender: r.sender,
          body: r.body,
          ai_reply: r.ai_reply,
        }));
        console.log(`[generate-reply] Thread ${threadId} → ${threadEmails.length} email(s) précédent(s) chargé(s)`);
      }
    }

    // 5. Charger le bien associé (property_id)
    const propertyId = (email as any).property_id ?? null;
    let property: { title: string; address: string | null; rent: number; required_docs: string[] } | null = null;

    if (propertyId) {
      const { data: propRow } = await supabaseAdmin
        .from("properties")
        .select("title, address, rent, required_docs, description")
        .eq("id", propertyId)
        .maybeSingle();
      if (propRow) {
        property = {
          title: propRow.title,
          address: propRow.address ?? null,
          rent: propRow.rent ?? 0,
          required_docs: Array.isArray(propRow.required_docs) ? propRow.required_docs : [],
        };
        console.log(`[generate-reply] Property chargée: ${property.title}`);
      }
    }

    // 6. Charger les settings
    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("email_rules")
      .eq("user_id", user.id)
      .maybeSingle();

    const rules = (settingsRow?.email_rules && typeof settingsRow.email_rules === "object")
      ? (settingsRow.email_rules as Record<string, unknown>) : {};

    const locatif = (rules.ft_locatif as Record<string, unknown>) ?? {};
    const docsSection = (rules.ft_documents as Record<string, unknown>) ?? {};
    const iaSection = (rules.ft_ia as Record<string, unknown>) ?? {};
    const calSection = (rules.ft_calendrier as Record<string, unknown>) ?? {};
    const faqSection = (rules.ft_faq as { question: string; reponse: string }[] | null) ?? [];

    const settings = {
      nomAgence: (locatif.nomAgence as string) ?? "",
      multiplicateur: (locatif.multiplicateur as number) ?? 3,
      animaux: (locatif.animaux as string) ?? "selon",
      garantObligatoire: (locatif.garantObligatoire as Record<string, boolean>) ?? { cdd: true, auto: true, etudiant: true, retraite: false },
      docsProfiles: {
        cdi:     (docsSection.cdi     as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
        cdd:     (docsSection.cdd     as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail (durée + date de fin)", "Avis d'imposition", "Pièce d'identité"],
        etudiant:(docsSection.etudiant as string[]) ?? ["Carte étudiante", "Certificat de scolarité", "Justificatif de garant", "Pièce d'identité"],
        auto:    (docsSection.auto    as string[]) ?? ["Extrait Kbis", "Bilans comptables (2 dernières années)", "Avis d'imposition", "Pièce d'identité"],
        retraite:(docsSection.retraite as string[]) ?? ["Relevés de pension (3 derniers mois)", "Avis d'imposition", "Pièce d'identité"],
      },
      faq: Array.isArray(faqSection) ? faqSection : [],
      instructions: (iaSection.instructions as string) ?? "",
      heureDebut: (calSection.heureDebut as number) ?? 9,
      heureFin: (calSection.heureFin as number) ?? 18,
      dureeVisite: (calSection.dureeVisite as number) ?? 60,
    };

    // 7. Construction du prompt
    const body = email.body ?? "";
    const isLocation = (email.category || "").toUpperCase() === "LOCATION";
    const attachments = Array.isArray((email as any).attachments) ? (email as any).attachments as { filename: string; docType?: string; status?: string }[] : [];

    let prompt: string;
    let intention = "non_location";
    let etapeAvant: string = "unknown";
    let etapeApres: string = "unknown";

    if (isLocation) {
      // ── NOUVELLE SOURCE : charger prospect depuis la table prospects ──
      const prospectId = (email as any).prospect_id as string | null;
      let prospectRow: Record<string, unknown> | null = null;

      if (prospectId) {
        const { data: pr } = await supabaseAdmin
          .from("prospects")
          .select("*")
          .eq("id", prospectId)
          .maybeSingle();
        prospectRow = pr ?? null;
        console.log(`[generate-reply] Prospect chargé depuis table: ${prospectId} etape=${pr?.etape_process ?? "null"}`);
      }

      // Fallback JSONB si pas de prospect_id
      const pd = prospectRow ?? ((email as any).prospect_data as Record<string, unknown> | null);

      const situationProMap: Record<string, string> = {
        ETUDIANT: "etudiant", CDI: "cdi", CDD: "cdd", AUTO_ENTREPRENEUR: "auto", RETRAITE: "retraite",
      };

      const situation = pd?.situation_pro
        ? (situationProMap[String(pd.situation_pro)] ?? detectSituation(body))
        : detectSituation(body);

      const pdRevenus = typeof pd?.revenus_mensuels === "number" ? pd.revenus_mensuels as number : null;
      const pdLoyer = typeof pd?.loyer_max === "number" ? pd.loyer_max as number : null;
      const { revenus: bodyRevenus, loyer: bodyLoyer } = extractMoney(body);
      const revenus = pdRevenus ?? bodyRevenus;
      const loyer = pdLoyer ?? bodyLoyer;

      const nomStr = typeof pd?.nom === "string" ? pd.nom.trim() : "";
      const prenomStr = typeof pd?.prenom === "string" ? pd.prenom.trim() : "";
      const fullNom = [prenomStr, nomStr].filter(Boolean).join(" ");
      const nom = fullNom.length > 0 ? fullNom : extractNom(body);

      const etapeProcess = (pd?.etape_process as string | null) ?? null;
      etapeAvant = etapeProcess ?? "NEW";

      // ── RÈGLE 3 : Auto DOSSIER_RECU si pièces jointes + étape = DOSSIER_DEMANDE ──
      if (attachments.length > 0 && etapeProcess === "DOSSIER_DEMANDE" && prospectId) {
        try {
          await supabaseAdmin
            .from("prospects")
            .update({ etape_process: "DOSSIER_RECU", updated_at: new Date().toISOString() })
            .eq("id", prospectId);
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: user.id,
            email_id: emailId,
            action_type: "dossier_recu_auto",
            description: "Dossier reçu automatiquement (pièces jointes détectées)",
            metadata: { prospect_id: prospectId, etape_avant: "DOSSIER_DEMANDE", etape_apres: "DOSSIER_RECU" },
          });
          console.log(`[generate-reply] RÈGLE 3: DOSSIER_RECU auto pour prospect ${prospectId}`);
          etapeAvant = "DOSSIER_RECU"; // traiter comme si on est à DOSSIER_RECU pour le prompt
        } catch { /* non bloquant */ }
      }

      // ── RÈGLE 2 : Auto VISITE_CONFIRMEE si le prospect confirme une visite ──
      const confirmeVisite = (() => {
        const l = body.toLowerCase();
        return (
          (etapeProcess === "VISITE_PROPOSEE" || etapeProcess === "VISITE_CONFIRMEE") &&
          (
            l.includes("je confirme") || l.includes("je serai") || l.includes("je serai présent") ||
            l.includes("ça me convient") || l.includes("c'est parfait") || l.includes("ça m'arrange") ||
            (l.includes("ok") && (l.includes("visite") || l.includes("créneau") || l.includes("rdv"))) ||
            l.includes("j'y serai") || l.includes("rendez-vous confirmé")
          )
        );
      })();

      if (confirmeVisite && etapeProcess !== "VISITE_CONFIRMEE" && prospectId) {
        try {
          await supabaseAdmin
            .from("prospects")
            .update({ etape_process: "VISITE_CONFIRMEE", updated_at: new Date().toISOString() })
            .eq("id", prospectId);
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: user.id,
            email_id: emailId,
            action_type: "visite_confirmee_auto",
            description: "Visite confirmée automatiquement par le prospect",
            metadata: { prospect_id: prospectId, etape_avant: etapeProcess, etape_apres: "VISITE_CONFIRMEE" },
          });
          console.log(`[generate-reply] RÈGLE 2: VISITE_CONFIRMEE auto pour prospect ${prospectId}`);
          etapeAvant = "VISITE_CONFIRMEE";
        } catch { /* non bloquant */ }
      }

      // ── RÈGLE 4 : Comptabiliser les relances (max 2 par étape) ──
      const relanceCount = typeof pd?.relance_count === "number" ? pd.relance_count : 0;
      const lastRelanceAt = pd?.last_relance_at ? new Date(pd.last_relance_at as string) : null;
      const hoursSinceRelance = lastRelanceAt ? (Date.now() - lastRelanceAt.getTime()) / 3_600_000 : Infinity;
      const relanceLimits: Record<string, number> = {
        NEW: 48, QUALIFICATION: 48,
        VISITE_PROPOSEE: 72,
        DOSSIER_DEMANDE: 120, // 5 jours
      };
      const relanceThreshold = relanceLimits[etapeAvant ?? "NEW"] ?? 48;
      const canRelance = relanceCount < 2 && hoursSinceRelance >= relanceThreshold;
      if (canRelance && prospectId) {
        try {
          await supabaseAdmin
            .from("prospects")
            .update({
              relance_count: relanceCount + 1,
              last_relance_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", prospectId);
          console.log(`[generate-reply] RÈGLE 4: Relance ${relanceCount + 1}/2 enregistrée pour prospect ${prospectId}`);
        } catch { /* non bloquant */ }
      }

      // ── RÈGLE 1 : Ne pas reposer une question déjà posée dans le thread ──
      const threadBodies = threadEmails
        .map((te) => [(te.body ?? "").toLowerCase(), (te.ai_reply ?? "").toLowerCase()])
        .flat()
        .join(" ");
      const alreadyAskedSituation = /situation professionnelle|cdi|cdd|auto.entrepreneur|étudiant|retraité|emploi/.test(threadBodies);
      const alreadyAskedRevenus = /revenus|salaire|gagne|touche/.test(threadBodies);
      const alreadyAskedVisite = /créneau|rendez.vous|rdv|disponibili/.test(threadBodies);
      const noRepeatInstructions = [
        alreadyAskedSituation && "Ne repose PAS de question sur la situation professionnelle (déjà abordée).",
        alreadyAskedRevenus && "Ne repose PAS de question sur les revenus (déjà abordés).",
        alreadyAskedVisite && "Ne repose PAS de question sur les disponibilités pour la visite (déjà proposée).",
      ].filter(Boolean).join(" ");

      // ── RÈGLE 5 : Ton adapté au profil ──
      const toneInstruction = (() => {
        if (situation === "etudiant") return "Ton rassurant et bienveillant : l'étudiant peut être anxieux dans ses démarches.";
        if (revenus !== null && loyer !== null && loyer > 0 && revenus / loyer < settings.multiplicateur) {
          return "Ton poli et doux : le profil est insolvable, il faut décliner sans blesser.";
        }
        return "Ton professionnel et humain.";
      })();

      const { cas, intention: detectedIntention } = determineCase({
        situation,
        revenus,
        loyer,
        multiplicateur: settings.multiplicateur,
        etapeProcess,
        body,
        hasAttachments: attachments.length > 0,
      });
      intention = detectedIntention;

      // CAS A — changement créneau : update etape_process en DB
      if (intention === "changement_creneau") {
        etapeApres = "VISITE_PROPOSEE";
        try {
          // Mettre à jour la table prospects (source de vérité)
          if (prospectId) {
            await supabaseAdmin
              .from("prospects")
              .update({ etape_process: "VISITE_PROPOSEE", updated_at: new Date().toISOString() })
              .eq("id", prospectId);
          }
          // Compat JSONB pour l'ancien modèle
          await supabaseAdmin
            .from("emails")
            .update({ prospect_data: { ...(pd ?? {}), etape_process: "VISITE_PROPOSEE" } })
            .eq("id", emailId);
        } catch { /* non bloquant */ }
      } else {
        etapeApres = etapeAvant;
      }

      console.log(`[generate-reply] emailId=${emailId} thread_emails=${threadEmails.length} etape=${etapeProcess ?? "null"} cas=${cas} intention=${intention}`);

      // Contexte système structuré
      // Injecter RÈGLE 1 (no-repeat) + RÈGLE 5 (tone) dans les instructions
      const augmentedInstructions = [
        settings.instructions,
        noRepeatInstructions,
        toneInstruction,
      ].filter(Boolean).join(" ").trim();

      const systemContext = buildSystemContext({
        nomAgence: settings.nomAgence,
        instructions: augmentedInstructions,
        prospect: {
          nom,
          etapeProcess: etapeAvant,
          situationPro: situation,
          revenus,
          loyer,
          garant: (pd?.garant as boolean | null) ?? null,
          multiplicateur: settings.multiplicateur,
        },
        property,
        attachments,
        threadEmails,
      });

      prompt = `${systemContext}\n\n---\n\n` + buildPrompt({
        cas,
        email: { sender: email.sender, subject: email.subject, body: email.body },
        settings,
        prospect: { nom, situation, revenus, loyer },
      });
    } else {
      // Email non-LOCATION : prompt générique professionnel
      const contextLine = settings.nomAgence ? `Tu es l'assistant de l'agence ${settings.nomAgence}.` : "Tu es l'assistant personnel d'un dirigeant très occupé.";
      const instructLine = settings.instructions ? `\nINSTRUCTIONS SPÉCIALES : ${settings.instructions}` : "";
      const faqContext = settings.faq.length > 0
        ? `\nFAQ AGENCE (utilise ces réponses si pertinent) :\n${settings.faq.slice(0, 5).map((f) => `Q: ${f.question}\nR: ${f.reponse}`).join("\n\n")}`
        : "";

      prompt = `${contextLine}
Rédige une réponse email professionnelle, claire, naturelle et prête à être envoyée.
${instructLine}${faqContext}

Règles :
- Français professionnel
- Ton humain, poli, efficace
- Pas trop long
- Adapté au CONTENU réel
- Signature neutre : Cordialement, L'équipe ${settings.nomAgence || "de l'agence"}

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${email.body}

Réponse (française, professionnelle, directement envoyable) :`;
    }

    // 8. Appel OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || null;
    if (!reply) return NextResponse.json({ error: "AI_NO_REPLY" }, { status: 500 });

    // 9. Sauvegarde
    await supabaseAdmin.from("emails").update({ ai_reply: reply }).eq("id", email.id);

    // 10. Timeline : logs spécifiques par cas + log général
    if (isLocation) {
      // CAS A — changement créneau : log spécifique
      if (intention === "changement_creneau") {
        try {
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: user.id,
            email_id: emailId,
            action_type: "changement_creneau",
            description: "Prospect demande un autre créneau",
            metadata: { etape_avant: etapeAvant, etape_apres: "VISITE_PROPOSEE" },
          });
        } catch { /* non bloquant */ }
      }

      // CAS B — docs reçus hors étape : log spécifique
      if (intention === "docs_hors_etape") {
        try {
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: user.id,
            email_id: emailId,
            action_type: "docs_recus_hors_etape",
            description: "Documents reçus avant demande formelle",
            metadata: { etape_process: etapeAvant },
          });
        } catch { /* non bloquant */ }
      }

      // CAS C — refus visite provisoire : log spécifique
      if (intention === "refus_visite_provisoire") {
        try {
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: user.id,
            email_id: emailId,
            action_type: "refus_visite_provisoire",
            description: "Prospect ne peut pas se rendre à la visite — en attente de replanification",
            metadata: { etape_process: etapeAvant },
          });
        } catch { /* non bloquant */ }
      }

      // Log général
      try {
        await supabaseAdmin.from("prospect_timeline").insert({
          user_id: user.id,
          email_id: emailId,
          action_type: "ai_reply_generated",
          description: "Réponse IA générée",
          metadata: {
            intention_detectee: intention,
            etape_avant: etapeAvant,
            etape_apres: etapeApres,
            confiance: intention !== "qualification" ? 0.85 : 0.6,
            thread_emails_loaded: threadEmails.length,
          },
        });
      } catch { /* non bloquant */ }
    }

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("GENERATE_REPLY_API_ERROR", err);
    return NextResponse.json({ error: "GENERATE_REPLY_FAILED" }, { status: 500 });
  }
}
