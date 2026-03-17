import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";
import { getAvailabilitySlots } from "@/lib/calendar/availability";
import { matchFaq, type FaqItem } from "@/lib/faq/matchFaq";
import { setLastAction } from "@/lib/lead/lastAction";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ── Extraction heuristique depuis le corps (fallback si prospect_data absent) ── */
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

/* ── Cas de réponse selon l'étape du process ── */
type ReplyCase =
  | "qualification"      // QUALIFICATION → demander situation + revenus SEULEMENT
  | "visite_proposee"    // VISITE_PROPOSEE → proposer créneaux, PAS de docs
  | "etudiant"           // VISITE_PROPOSEE (étudiant) → garant + créneaux, PAS de docs
  | "refuse"             // REFUSE → refus poli + suggestion garant
  | "visite_confirmee"   // VISITE_CONFIRMEE → confirmer RDV + attendre visite
  | "dossier_demande"    // DOSSIER_DEMANDE → envoyer liste de documents
  | "dossier_recu";      // DOSSIER_RECU → accusé réception

function determineCase(params: {
  situation: string | null;
  revenus: number | null;
  loyer: number | null;
  multiplicateur: number;
  etapeProcess: string | null;
}): ReplyCase {
  const { situation, revenus, loyer, multiplicateur, etapeProcess } = params;

  // Les étapes avancées et manuelles priment toujours
  if (etapeProcess === "DOSSIER_RECU")    return "dossier_recu";
  if (etapeProcess === "DOSSIER_DEMANDE") return "dossier_demande";
  if (etapeProcess === "VISITE_CONFIRMEE") return "visite_confirmee";
  if (etapeProcess === "REFUSE")          return "refuse";

  // Étape VISITE_PROPOSEE
  if (etapeProcess === "VISITE_PROPOSEE") {
    return situation === "etudiant" ? "etudiant" : "visite_proposee";
  }

  // Pas d'étape renseignée → déterminer depuis le profil
  if (situation === "etudiant") return "etudiant";
  if (revenus !== null && loyer !== null && loyer > 0 && revenus / loyer < multiplicateur) return "refuse";
  if (!revenus || !loyer || !situation) return "qualification";
  return "visite_proposee";
}

/* ── Builders de prompt selon le cas ── */
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
  const { nomAgence, multiplicateur, garantObligatoire, docsProfiles, instructions, heureDebut, heureFin, dureeVisite } = settings;

  const agenceLine = nomAgence ? `Agence : ${nomAgence}` : "Agence immobilière";
  const nomProspect = prospect.nom || "Madame, Monsieur";
  const instructLine = instructions ? `\nINSTRUCTIONS SPÉCIALES : ${instructions}` : "";
  const emailCtx = `Email reçu :\nExpéditeur : ${email.sender}\nSujet : ${email.subject}\nContenu : ${email.body}`;
  const sig = `Cordialement, L'équipe ${nomAgence || "de l'agence"}`;

  // ── DOSSIER_RECU — accusé réception ────────────────────────────────────────
  if (cas === "dossier_recu") {
    return `Tu es l'assistant de l'${agenceLine}.${instructLine}

Rédige un email bref et professionnel pour accuser réception des documents de ${nomProspect}.

Contenu :
- Remercier chaleureusement pour l'envoi du dossier
- Confirmer la bonne réception de l'ensemble des pièces
- Indiquer que le dossier va être étudié et qu'un retour sera communiqué rapidement
- Ne pas s'engager sur un délai précis
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  // ── DOSSIER_DEMANDE — envoyer liste de documents ──────────────────────────
  if (cas === "dossier_demande") {
    const sitKeyMap: Record<string, keyof typeof docsProfiles> = {
      cdi: "cdi", cdd: "cdd", auto: "auto", retraite: "retraite", etudiant: "etudiant",
    };
    const sitKey: keyof typeof docsProfiles =
      (prospect.situation ? (sitKeyMap[prospect.situation] ?? "cdi") : "cdi");
    const docsList = (docsProfiles[sitKey] ?? docsProfiles.cdi).map(d => `• ${d}`).join("\n");
    const needsGarant = prospect.situation && garantObligatoire[prospect.situation];
    const garantLine = needsGarant ? "\n• Pour votre profil, un garant sera également requis (mêmes documents)." : "";
    return `Tu es l'assistant de l'${agenceLine}.${instructLine}

Rédige un email chaleureux pour demander le dossier locataire à ${nomProspect}, suite à la visite.

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

  // ── VISITE_CONFIRMEE — confirmer RDV (pas de docs, attendre visite) ────────
  if (cas === "visite_confirmee") {
    return `Tu es l'assistant de l'${agenceLine}.${instructLine}

Rédige un email de confirmation de visite pour ${nomProspect}.

Contenu :
- Confirmer chaleureusement la visite (date/heure telles que mentionnées dans l'email reçu)
- Indiquer l'adresse du bien si connue, sinon proposer un rappel
- Préciser qu'un retour sera communiqué rapidement après la visite
- NE PAS demander de documents — les documents seront demandés après la visite
- Signature : ${sig}

${emailCtx}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  // ── REFUSE — refus poli + suggestion garant ────────────────────────────────
  if (cas === "refuse") {
    const ratio = prospect.revenus && prospect.loyer
      ? (prospect.revenus / prospect.loyer).toFixed(1)
      : "insuffisant";
    return `Tu es l'assistant de l'${agenceLine}.${instructLine}

Rédige un email professionnel, poli et respectueux pour décliner cette candidature.

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

  // ── ETUDIANT — garant + créneaux, PAS de documents ────────────────────────
  if (cas === "etudiant") {
    const needsGarant = garantObligatoire["etudiant"] !== false;
    return `Tu es l'assistant de l'${agenceLine}.${instructLine}

Rédige un email professionnel et bienveillant pour un candidat étudiant.

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

  // ── QUALIFICATION — demander situation + revenus SEULEMENT ────────────────
  if (cas === "qualification") {
    const missingList: string[] = [];
    if (!prospect.situation) missingList.push("votre situation professionnelle (CDI, CDD, étudiant, indépendant, retraité…)");
    if (!prospect.revenus) missingList.push("vos revenus nets mensuels (en €)");
    const missingStr = missingList.map((m, i) => `${i + 1}. ${m}`).join("\n");
    return `Tu es l'assistant de l'${agenceLine}.${instructLine}

Rédige un email chaleureux pour demander les informations manquantes.

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

  // ── VISITE_PROPOSEE — solvable, proposer créneaux, PAS de documents ────────
  const ratio = prospect.revenus && prospect.loyer
    ? (prospect.revenus / prospect.loyer).toFixed(1)
    : null;
  const solvLine = ratio
    ? ` Son profil présente un ratio de ${ratio}x (critère : ${multiplicateur}x).`
    : "";

  return `Tu es l'assistant de l'${agenceLine}.${instructLine}

Rédige un email professionnel et enthousiaste pour proposer une visite à ce candidat solvable.${solvLine}

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

    // 2. Email
    const { emailId } = await req.json();
    if (!emailId) return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });

    // 3) Charger email
    const { data: email, error: emailErr } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, body, ai_reply, category, prospect_data")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (emailErr || !email) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    // 3. Anti-coût : réponse déjà générée
    if (email.ai_reply && email.ai_reply.trim().length > 0) {
      return NextResponse.json({ reply: email.ai_reply });
    }

    // 4. Charger les settings
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

    // 5. Construction du prompt selon l'intention et l'étape
    const body = email.body ?? "";
    const isLocation = (email.category || "").toUpperCase() === "LOCATION";

    let prompt: string;

    if (isLocation) {
      const pd = (email as any).prospect_data as Record<string, unknown> | null;

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

      const nom = (typeof pd?.nom === "string" && pd.nom.trim().length > 0)
        ? pd.nom.trim()
        : extractNom(body);

      // ← BLOC 2 : lire l'étape depuis prospect_data
      const etapeProcess = (pd?.etape_process as string | null) ?? null;

      const cas = determineCase({
        situation,
        revenus,
        loyer,
        multiplicateur: settings.multiplicateur,
        etapeProcess,
      });

      console.log(`[generate-reply] emailId=${emailId} etape=${etapeProcess ?? "null"} cas=${cas} situation=${situation} revenus=${revenus} loyer=${loyer} nom="${nom}"`);

      prompt = buildPrompt({
        cas,
        email: { sender: email.sender, subject: email.subject, body: email.body },
        settings,
        prospect: { nom, situation, revenus, loyer },
      });
    } else {
      // Email non-LOCATION : prompt générique professionnel
      const contextLine = settings.nomAgence ? `Tu es l'assistant de l'${settings.nomAgence}.` : "Tu es l'assistant personnel d'un dirigeant très occupé.";
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
- Signature neutre : Cordialement, L’équipe ${settings.nomAgence || "de l’agence"}

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${email.body}

Réponse (française, professionnelle, directement envoyable) :`;
    }

    // 6. Appel OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || null;
    if (!reply) return NextResponse.json({ error: "AI_NO_REPLY" }, { status: 500 });

    // 7. Sauvegarde (anti-surcoût)
    await supabaseAdmin.from("emails").update({ ai_reply: reply }).eq("id", email.id);

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("GENERATE_REPLY_API_ERROR", err);
    return NextResponse.json({ error: "GENERATE_REPLY_FAILED" }, { status: 500 });
  }
}
