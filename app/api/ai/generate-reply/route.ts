import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ── Helpers heuristiques (fallback si prospect_data absent) ── */

function detectSituation(body: string): string | null {
  const l = body.toLowerCase();
  if (l.includes("étudiant") || l.includes("etudiante") || l.includes("école") || l.includes("université")) return "ETUDIANT";
  if (l.includes("cdi")) return "CDI";
  if (l.includes("cdd")) return "CDD";
  if (l.includes("auto-entrepreneur") || l.includes("autoentrepreneur") || l.includes("freelance") || l.includes("indépendant")) return "AUTO_ENTREPRENEUR";
  if (l.includes("retraité") || l.includes("retraitée")) return "RETRAITE";
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
      .map((m2) => parseFloat(m2[1].replace(/\s/g, "")))
      .filter((v) => v >= 200);
    if (!loyer && all[0]) loyer = all[0];
    if (!revenus && all[1]) revenus = all[1];
  }
  return { revenus, loyer };
}

function extractNom(body: string): string | null {
  const m = body.match(/(?:je m['']appelle|je suis|prénom\s*:?\s*)([A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+(?:\s+[A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+)*)/);
  if (m?.[1]) return m[1].trim();
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2 && l.length < 45);
  const last = lines[lines.length - 1] ?? "";
  if (last.split(/\s+/).length >= 2 && !/[@.]/.test(last)) return last;
  return null;
}

/* ── Détection ALERTE (avant appel IA, gratuit) ── */

const ALERTE_KEYWORDS = [
  "avocat", "tribunal", "plainte", "discrimination", "racisme",
  "scandaleux", "inacceptable", "je vais porter", "huissier", "juridique",
];

function detectAlerte(body: string): boolean {
  const l = body.toLowerCase();
  if (ALERTE_KEYWORDS.some((k) => l.includes(k))) return true;
  if (/[!?]{3,}/.test(body)) return true;
  const capsCount = (body.match(/[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ]/g)?.length ?? 0);
  const capsRatio = capsCount / Math.max(body.replace(/\s/g, "").length, 1);
  if (capsRatio > 0.35 && body.length > 50) return true;
  return false;
}

/* ── Types de sortie ── */

type ReplyMode = "AUTOPILOTE" | "DRAFT" | "ALERTE";
type EtapeProcess =
  | "NEW" | "QUALIFICATION" | "VISITE_PROPOSEE" | "VISITE_CONFIRMEE"
  | "DOSSIER_DEMANDE" | "DOSSIER_RECU" | "VALIDE" | "REFUSE";

interface ParsedReply {
  reply: string | null;
  mode: ReplyMode;
  reason: string;
  next_etape: EtapeProcess;
  extracted_data: {
    nom: string | null;
    telephone: string | null;
    situation_pro: string | null;
    revenus_mensuels: number | null;
    garant: string | null;
  };
}

/* ── Construction du prompt système JSON ── */

function buildSystemPrompt(params: {
  nomAgence: string;
  multiplicateur: number;
  seuilAutopilote: number;
  tonDeVoix: string;
  instructions: string;
  prioriteProfils: string;
  heureDebut: number;
  heureFin: number;
  dureeVisite: number;
  etapeProcess: string;
  garantObligatoire: Record<string, boolean>;
  prospect: {
    nom: string | null;
    telephone: string | null;
    situation_pro: string | null;
    revenus_mensuels: number | null;
    loyer_max: number | null;
    garant: string | null;
    date_entree_souhaitee: string | null;
  };
  bien: Record<string, unknown> | null;
  docsList: string[];
  faqContext: string;
  multipleProperties: Array<{ title: string }>;
  champsQualification: string[];
}): string {
  const {
    nomAgence, multiplicateur, seuilAutopilote, tonDeVoix, instructions,
    prioriteProfils, heureDebut, heureFin, dureeVisite, etapeProcess,
    garantObligatoire, prospect, bien, docsList, faqContext, multipleProperties,
    champsQualification,
  } = params;

  const loyerBien = (bien?.loyer as number | null) ?? prospect.loyer_max;

  const ratioStr = prospect.revenus_mensuels && loyerBien
    ? ((prospect.revenus_mensuels) / (loyerBien)).toFixed(1)
    : "?";

  const workflowByEtape: Record<string, string> = {
    NEW: `ÉTAT NEW :
- Analyser l'intention : question FAQ simple OU demande de visite/intérêt pour le bien
- Si question FAQ (animaux, charges, ascenseur, parking, surface, étage, disponibilité) → répondre directement → mode AUTOPILOTE
- Si intérêt pour le bien → demander nom, téléphone, situation professionnelle → mode DRAFT
- Toujours finir par une question CTA (appel à l'action)
- next_etape = QUALIFICATION si nom + situation_pro identifiés dans l'email, sinon NEW`,

    QUALIFICATION: `ÉTAT QUALIFICATION :
- Demander ce qui manque parmi : ${champsQualification.join(", ")}
- Calculer solvabilité : revenus / loyer, critère agence = ${multiplicateur}x, seuil autopilote = ${seuilAutopilote}x
- Si solvable ET CDI avec revenus ≥ ${seuilAutopilote}x le loyer → proposer visite → mode AUTOPILOTE → next_etape = VISITE_PROPOSEE
- Si profil atypique (AUTO_ENTREPRENEUR, CDD, ETUDIANT) ou solvabilité entre 2.5x et ${seuilAutopilote}x → mode DRAFT
- Si non solvable (revenus < ${multiplicateur}x loyer) → expliquer poliment, ne pas proposer de visite → mode DRAFT → next_etape = REFUSE
- next_etape = VISITE_PROPOSEE si solvabilité validée`,

    VISITE_PROPOSEE: `ÉTAT VISITE_PROPOSEE :
- Proposer 3 créneaux concrets à court terme (jours ouvrés, ${heureDebut}h-${heureFin}h, durée ${dureeVisite}min)
- Si le prospect confirme un créneau dans son message → next_etape = VISITE_CONFIRMEE → mode AUTOPILOTE
- Si pas de confirmation → next_etape = VISITE_PROPOSEE, relancer doucement`,

    VISITE_CONFIRMEE: `ÉTAT VISITE_CONFIRMEE :
- Confirmer le rendez-vous de visite ou demander un retour après visite
- Si le prospect dit qu'il est toujours intéressé → mentionner qu'un lien de dépôt de documents va être envoyé → next_etape = DOSSIER_DEMANDE → mode AUTOPILOTE
- Sinon → next_etape = VISITE_CONFIRMEE`,

    DOSSIER_DEMANDE: `ÉTAT DOSSIER_DEMANDE :
- Documents attendus pour profil ${prospect.situation_pro ?? "CDI"} : ${docsList.join(", ")}
- Si le prospect indique avoir envoyé les documents → confirmer réception, prévenir l'agent → next_etape = DOSSIER_RECU → mode DRAFT
- Si pas de réponse ou retard → relancer poliment avec rappel du lien portail → next_etape = DOSSIER_DEMANDE`,

    DOSSIER_RECU: `ÉTAT DOSSIER_RECU :
- Générer une note de synthèse dans "reply" : "Profil ${prospect.situation_pro ?? "?"}, ratio ${ratioStr}x, dossier complet"
- Mode DRAFT OBLIGATOIRE — décision finale de l'agent requise
- next_etape = VALIDE ou REFUSE selon les éléments du dossier`,
  };

  const etapeWorkflow = workflowByEtape[etapeProcess] ?? `ÉTAT ${etapeProcess} : Analyser l'email et répondre de façon appropriée à l'étape actuelle.`;

  const multiPropWarning = multipleProperties.length > 1
    ? `\nATTENTION — PLUSIEURS BIENS SANS PRÉCISION :
Le prospect n'a pas précisé pour quel bien il écrit.
Biens disponibles : ${multipleProperties.map((p) => p.title).join(", ")}
Dans reply, demande OBLIGATOIREMENT : "Votre demande concerne-t-elle ${multipleProperties.map((p) => p.title).join(" ou ")} ?"
Mode = DRAFT, next_etape = NEW\n`
    : "";

  return `Tu es l'assistant IA de l'agence immobilière "${nomAgence || "FixTime"}".
Ton de voix : ${tonDeVoix}.${instructions ? `\nInstructions spéciales : ${instructions}` : ""}${prioriteProfils ? `\nPriorisation des profils : ${prioriteProfils}` : ""}

Tu dois analyser l'email reçu et retourner UNIQUEMENT un JSON valide, sans aucun texte autour, avec cette structure exacte :
{
  "reply": "texte de la réponse à envoyer au prospect (en français, professionnel, prêt à être envoyé). null si mode ALERTE.",
  "mode": "AUTOPILOTE" ou "DRAFT" ou "ALERTE",
  "reason": "explication courte du mode choisi (1 phrase)",
  "next_etape": "NEW" ou "QUALIFICATION" ou "VISITE_PROPOSEE" ou "VISITE_CONFIRMEE" ou "DOSSIER_DEMANDE" ou "DOSSIER_RECU" ou "VALIDE" ou "REFUSE",
  "extracted_data": {
    "nom": null ou string,
    "telephone": null ou string,
    "situation_pro": null ou "CDI" ou "CDD" ou "AUTO_ENTREPRENEUR" ou "ETUDIANT" ou "RETRAITE",
    "revenus_mensuels": null ou number,
    "garant": null ou "OUI" ou "NON" ou "A_CONFIRMER"
  }
}

RÈGLES DE CLASSIFICATION DU MODE :

AUTOPILOTE (envoyer directement sans validation agent) :
- Question FAQ simple : animaux, charges, ascenseur, parking, surface, étage, disponibilité
- Confirmation de créneau de visite simple
- Prospect CDI avec revenus ≥ ${seuilAutopilote}x le loyer${loyerBien ? ` (loyer = ${loyerBien}€, seuil = ${(seuilAutopilote * loyerBien).toFixed(0)}€/mois)` : ""}
- Relance standard sans réponse

DRAFT (l'agent valide avant envoi) :
- Première réponse à un nouveau prospect (étape NEW)
- Profil atypique : AUTO_ENTREPRENEUR, CDD, garant étranger, revenus variables
- Solvabilité entre 2.5x et ${seuilAutopilote}x le loyer
- Situation complexe ou ambiguë

ALERTE (arrêter immédiatement, ne pas envoyer, notifier l'agent) :
- Mots détectés : avocat, tribunal, plainte, discrimination, racisme, scandaleux, inacceptable, je vais porter, huissier, juridique
- Ton agressif : majuscules excessives, ponctuation multiple (!!!, ???)
- Si ALERTE → reply = null

${multiPropWarning}WORKFLOW ÉTAPE ACTUELLE (${etapeProcess}) :
${etapeWorkflow}

CONTEXTE AGENCE :
- Critère de solvabilité : revenus ≥ ${multiplicateur}x le loyer BRUT (hors charges)
- Seuil autopilote : revenus ≥ ${seuilAutopilote}x le loyer BRUT
- RÈGLE CHARGES : utiliser UNIQUEMENT le loyer brut pour le calcul. Ne JAMAIS inventer de charges (ex: 150€ imaginaire). Si charges inconnues → écrire "charges à confirmer" dans la réponse.
- GARANT OBLIGATOIRE pour ces profils : ${Object.entries(garantObligatoire).filter(([,v]) => v).map(([k]) => k).join(", ") || "aucun profil spécifique"}. Si le prospect a un de ces profils et n'a pas mentionné de garant → demander explicitement un garant en DRAFT.${bien ? `

BIEN CONCERNÉ :
- Titre : ${(bien.title as string) ?? "?"}
- Adresse : ${(bien.address as string) ?? "Non précisée"}
- Loyer : ${(bien.loyer as number) ?? "?"}€ + charges : ${bien.charges != null ? `${bien.charges}€/mois` : "inconnues (à confirmer — ne pas inventer de montant)"}
- Type : ${(bien.type as string) ?? "?"}${bien.meuble ? " — Meublé" : " — Non meublé"}
- Animaux : ${bien.animaux_acceptes ? "Acceptés" : "Non acceptés"}
- Parking : ${bien.parking_inclus ? "Inclus" : "Non inclus"}${bien.disponible_a_partir_de ? `\n- Disponible à partir du : ${bien.disponible_a_partir_de}` : ""}${bien.notes_specifiques ? `\n- Notes : ${bien.notes_specifiques}` : ""}` : ""}
${faqContext ? `\nFAQ AGENCE (questions générales uniquement — processus, signature, documents) :\n${faqContext}` : ""}

RÈGLE ABSOLUE — QUESTIONS SPÉCIFIQUES AU BIEN :
Pour toute question concernant les caractéristiques d'un bien (animaux, charges, ascenseur, superficie, disponibilité, parking, meublé, travaux, étage), réponds UNIQUEMENT avec les données du BIEN CONCERNÉ fournies ci-dessus dans la section "BIEN CONCERNÉ".
N'utilise JAMAIS la FAQ agence pour répondre à ces questions spécifiques.
La FAQ agence est réservée aux questions générales : processus de candidature, signature de bail, documents requis, fonctionnement de l'agence.

FICHE PROSPECT (données déjà collectées — ne pas redemander ce qui est déjà renseigné) :
${JSON.stringify({
  nom: prospect.nom,
  telephone: prospect.telephone,
  situation_pro: prospect.situation_pro,
  revenus_mensuels: prospect.revenus_mensuels,
  garant: prospect.garant,
  date_entree_souhaitee: prospect.date_entree_souhaitee,
}, null, 2)}

Signature email : Cordialement, L'équipe ${nomAgence || "de l'agence"}`;
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

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, body, ai_reply, category, prospect_data, property_id")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (error || !email) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    const bodyText = (email as unknown as { body: string | null }).body ?? "";

    // 3. Détection ALERTE immédiate (avant appel IA, gratuit)
    if (detectAlerte(bodyText)) {
      const existingPdAlerte = ((email as unknown as { prospect_data: Record<string, unknown> | null }).prospect_data) ?? {};
      await supabaseAdmin.from("emails").update({
        prospect_data: { ...existingPdAlerte, alerte: true, alerte_at: new Date().toISOString() },
      }).eq("id", email.id);
      return NextResponse.json({
        reply: null,
        mode: "ALERTE",
        reason: "Message à caractère juridique ou agressif détecté — intervention humaine requise",
        next_etape: (existingPdAlerte.etape_process as EtapeProcess) ?? "NEW",
        extracted_data: { nom: null, telephone: null, situation_pro: null, revenus_mensuels: null, garant: null },
      } satisfies ParsedReply);
    }

    // 4. Anti-coût : réponse JSON déjà générée et valide
    const cachedReply = (email as unknown as { ai_reply: string | null }).ai_reply ?? "";
    if (cachedReply.trim().startsWith("{")) {
      try {
        const cached = JSON.parse(cachedReply) as ParsedReply;
        if (cached.reply && cached.mode) return NextResponse.json(cached);
      } catch { /* régénérer */ }
    }

    // 5. Charger les settings
    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("email_rules")
      .eq("user_id", user.id)
      .maybeSingle();

    const rules = (settingsRow?.email_rules && typeof settingsRow.email_rules === "object")
      ? (settingsRow.email_rules as Record<string, unknown>) : {};

    const locatif  = (rules.ft_locatif   as Record<string, unknown>) ?? {};
    const docsSection = (rules.ft_documents as Record<string, unknown>) ?? {};
    const iaSection   = (rules.ft_ia       as Record<string, unknown>) ?? {};
    const calSection  = (rules.ft_calendrier as Record<string, unknown>) ?? {};
    const faqSection  = (rules.ft_faq      as { question: string; reponse: string }[] | null) ?? [];

    const nomAgence       = (locatif.nomAgence       as string)  ?? "";
    const multiplicateur  = (locatif.multiplicateur  as number)  ?? 3;
    const garantObligatoire = (locatif.garantObligatoire as Record<string, boolean>) ?? { CDD: true, AUTO_ENTREPRENEUR: true, ETUDIANT: true, RETRAITE: false };
    const DEFAULT_CHAMPS_QUALIFICATION = ["situation_pro", "revenus_mensuels", "garant", "animaux"];
    const champsQualification: string[] = Array.isArray(locatif.champsQualification)
      ? (locatif.champsQualification as string[])
      : DEFAULT_CHAMPS_QUALIFICATION;
    const seuilAutopilote = (iaSection.seuil_autopilote as number) ?? 3.5;
    const tonDeVoix       = (iaSection.ton_de_voix   as string)  ?? "Professionnel et formel";
    const prioriteProfils = (iaSection.priorite_profils as string) ?? "";
    const instructions    = (iaSection.instructions  as string)  ?? "";
    const heureDebut      = (calSection.heureDebut   as number)  ?? 9;
    const heureFin        = (calSection.heureFin     as number)  ?? 18;
    const dureeVisite     = (calSection.dureeVisite  as number)  ?? 60;

    const docsProfiles: Record<string, string[]> = {
      CDI:              (docsSection.cdi      as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
      CDD:              (docsSection.cdd      as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail (durée + date de fin)", "Avis d'imposition", "Pièce d'identité"],
      ETUDIANT:         (docsSection.etudiant as string[]) ?? ["Carte étudiante", "Certificat de scolarité", "Justificatif de garant", "Pièce d'identité"],
      AUTO_ENTREPRENEUR:(docsSection.auto     as string[]) ?? ["Extrait Kbis", "Bilans comptables (2 dernières années)", "Avis d'imposition", "Pièce d'identité"],
      RETRAITE:         (docsSection.retraite as string[]) ?? ["Relevés de pension (3 derniers mois)", "Avis d'imposition", "Pièce d'identité"],
    };

    // 6. Données prospect
    const pd = ((email as unknown as { prospect_data: Record<string, unknown> | null }).prospect_data) ?? {};
    const etapeProcess = (pd.etape_process as string) ?? "NEW";

    const { revenus: bodyRevenus, loyer: bodyLoyer } = extractMoney(bodyText);
    const situationFallback = detectSituation(bodyText);
    const nomFallback = extractNom(bodyText);

    const prospect = {
      nom:                   (pd.nom             as string | null) ?? nomFallback,
      telephone:             (pd.telephone        as string | null) ?? null,
      situation_pro:         (pd.situation_pro    as string | null) ?? situationFallback,
      revenus_mensuels:      (typeof pd.revenus_mensuels === "number" ? pd.revenus_mensuels : null) ?? bodyRevenus,
      loyer_max:             (typeof pd.loyer_max === "number" ? pd.loyer_max : null) ?? bodyLoyer,
      garant:                (pd.garant           as string | null) ?? null,
      date_entree_souhaitee: (pd.date_entree_souhaitee as string | null) ?? null,
    };

    const sitPro = prospect.situation_pro;
    const docsList = sitPro && docsProfiles[sitPro] ? docsProfiles[sitPro] : docsProfiles.CDI;

    // 7. Chargement du bien
    let bien: Record<string, unknown> | null = null;
    const propertyId = (email as unknown as { property_id: string | null }).property_id;

    if (propertyId) {
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select("id, title, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques")
        .eq("id", propertyId)
        .maybeSingle();
      // Normaliser rent → loyer pour compatibilité avec le prompt
      if (prop) {
        const p = prop as Record<string, unknown>;
        bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles };
      }
    }

    // 8. Détection multi-bien si property_id null
    let multipleProperties: Array<{ id: string; title: string }> = [];
    if (!propertyId) {
      const { data: allProps } = await supabaseAdmin
        .from("properties")
        .select("id, title, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques")
        .eq("user_id", user.id);

      if (allProps && allProps.length > 0) {
        const emailText = `${(email as unknown as { subject: string | null }).subject ?? ""} ${bodyText}`.toLowerCase();

        // Chercher les biens mentionnés dans le sujet/corps
        const matched = (allProps as Array<Record<string, unknown>>).filter(
          (p) => typeof p.title === "string" && p.title.length >= 4 &&
            emailText.includes((p.title as string).toLowerCase().substring(0, Math.min(8, (p.title as string).length)))
        );

        if (matched.length === 1) {
          // Un seul bien correspond → l'utiliser directement
          const p = matched[0];
          bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles };
        } else if (matched.length > 1) {
          // Plusieurs correspondent → demander au prospect lequel
          multipleProperties = matched.map((p) => ({ id: p.id as string, title: p.title as string }));
        } else if (allProps.length === 1) {
          // Aucun mentionné mais l'agent n'a qu'un seul bien → l'utiliser par défaut
          const p = allProps[0] as Record<string, unknown>;
          bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles };
        }
        // Sinon (plusieurs biens, aucun mentionné) : bien reste null, l'IA pose la question
        else if (allProps.length > 1) {
          multipleProperties = (allProps as Array<Record<string, unknown>>).map((p) => ({ id: p.id as string, title: p.title as string }));
        }
      }
    }

    // 9. FAQ (max 5 entrées)
    const faqContext = Array.isArray(faqSection)
      ? faqSection.slice(0, 5).map((f) => `Q: ${f.question}\nR: ${f.reponse}`).join("\n\n")
      : "";

    // 10. Construction du prompt système
    const systemPrompt = buildSystemPrompt({
      nomAgence, multiplicateur, seuilAutopilote, tonDeVoix, instructions, prioriteProfils,
      heureDebut, heureFin, dureeVisite, etapeProcess, garantObligatoire,
      prospect, bien, docsList, faqContext, multipleProperties, champsQualification,
    });

    const sender = (email as unknown as { sender: string | null }).sender ?? "Inconnu";
    const subject = (email as unknown as { subject: string | null }).subject ?? "Sans sujet";

    const userMessage = `Email reçu :
Expéditeur : ${sender}
Sujet : ${subject}
Message : ${bodyText.substring(0, 2000)}`;

    // 11. Appel OpenAI (JSON mode)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    let parsed: ParsedReply;
    try {
      parsed = JSON.parse(raw) as ParsedReply;
    } catch {
      console.error("[generate-reply] JSON parse error:", raw);
      return NextResponse.json({ error: "AI_JSON_PARSE_ERROR" }, { status: 500 });
    }

    if (!parsed.mode || !parsed.next_etape) {
      return NextResponse.json({ error: "AI_INCOMPLETE_RESPONSE" }, { status: 500 });
    }

    // 12. Merge prospect_data (ne pas écraser les données existantes)
    const updatedPd: Record<string, unknown> = { ...pd };
    const ext = (parsed.extracted_data ?? {}) as Record<string, unknown>;

    if (ext.nom            && !pd.nom)             updatedPd.nom = ext.nom;
    if (ext.telephone      && !pd.telephone)        updatedPd.telephone = ext.telephone;
    if (ext.situation_pro  && !pd.situation_pro)    updatedPd.situation_pro = ext.situation_pro;
    if (ext.revenus_mensuels != null && !pd.revenus_mensuels) updatedPd.revenus_mensuels = ext.revenus_mensuels;
    if (ext.garant         && !pd.garant)           updatedPd.garant = ext.garant;

    // Avancer l'étape si différente
    if (parsed.next_etape && parsed.next_etape !== pd.etape_process) {
      updatedPd.etape_process = parsed.next_etape;
    }

    // ALERTE → marquer dans la fiche
    if (parsed.mode === "ALERTE") {
      updatedPd.alerte = true;
      updatedPd.alerte_at = new Date().toISOString();
    }

    // Vérifier garant obligatoire pour le profil
    if (sitPro && garantObligatoire[sitPro] && !updatedPd.garant) {
      updatedPd.garant = "A_CONFIRMER";
    }

    // Sauvegarder reply JSON + prospect_data mis à jour
    await supabaseAdmin.from("emails").update({
      ai_reply: JSON.stringify(parsed),
      prospect_data: updatedPd,
    }).eq("id", email.id);

    console.log(`[generate-reply] emailId=${emailId} mode=${parsed.mode} etape=${pd.etape_process ?? "null"}→${parsed.next_etape}`);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("GENERATE_REPLY_API_ERROR", err);
    return NextResponse.json({ error: "GENERATE_REPLY_FAILED" }, { status: 500 });
  }
}
