import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ── Extraction heuristique depuis le corps de l'email ── */
function detectSituation(body: string): string | null {
  const l = body.toLowerCase();
  if (l.includes("étudiant") || l.includes("etudiante") || l.includes("école") || l.includes("université") || l.includes("lycée")) return "etudiant";
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
  // Fallback : 2 premiers montants > 200
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
  // Signature
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2 && l.length < 45);
  const last = lines[lines.length - 1] ?? "";
  if (last.split(/\s+/).length >= 2 && !/[@.]/.test(last)) return last;
  return "";
}

/* ── Déterminer le cas selon la logique 4 cas ── */
type ReplyCase = "etudiant" | "insolvable" | "incomplet" | "complet";

function determineCase(params: {
  situation: string | null;
  revenus: number | null;
  loyer: number | null;
  multiplicateur: number;
  garantObligatoire: Record<string, boolean>;
}): ReplyCase {
  const { situation, revenus, loyer, multiplicateur, garantObligatoire } = params;

  // Cas 1 : étudiant
  if (situation === "etudiant") return "etudiant";

  // Cas 2 : insolvable
  if (revenus !== null && loyer !== null) {
    const ratio = revenus / loyer;
    if (ratio < multiplicateur) return "insolvable";
  }

  // Cas 3 : infos manquantes (revenus ou loyer inconnus)
  if (!revenus || !loyer || !situation) return "incomplet";

  // Cas 4 : complet + solvable
  return "complet";
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
    docsProfiles: { cdi: string[]; etudiant: string[]; auto: string[] };
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

  if (cas === "etudiant") {
    const docsList = docsProfiles.etudiant.map((d) => `• ${d}`).join("\n");
    const needsGarant = garantObligatoire["etudiant"] !== false;
    return `Tu es l'assistant de l'${agenceLine}.
Rédige un email professionnel et chaleureux pour un candidat étudiant.
${instructLine}

Contenu de l'email à envoyer :
- Remercier ${nomProspect} pour sa candidature
- Expliquer que pour les étudiants, un garant est ${needsGarant ? "obligatoire" : "recommandé"}
- Demander les documents suivants :
${docsList}
- Préciser que la candidature sera examinée dès réception du dossier complet
- Signature : Cordialement, L'équipe ${nomAgence || "de l'agence"}

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu : ${email.body}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "insolvable") {
    const ratio = prospect.revenus && prospect.loyer
      ? (prospect.revenus / prospect.loyer).toFixed(1)
      : "insuffisant";
    return `Tu es l'assistant de l'${agenceLine}.
Rédige un email professionnel, poli et respectueux pour décliner cette candidature.
${instructLine}

Contenu de l'email à envoyer :
- Remercier ${nomProspect} pour sa candidature et son intérêt
- Expliquer poliment que le critère de solvabilité n'est pas atteint (revenus insuffisants pour couvrir ${multiplicateur}x le loyer, ratio actuel : ${ratio}x)
- Suggérer la possibilité d'un garant solide (revenus ≥ ${multiplicateur}x le loyer) qui pourrait permettre de reconsidérer
- Encourager à revenir vers l'agence si la situation évolue
- Rester positif et professionnel
- Signature : Cordialement, L'équipe ${nomAgence || "de l'agence"}

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu : ${email.body}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  if (cas === "incomplet") {
    const missingList: string[] = [];
    if (!prospect.situation) missingList.push("votre situation professionnelle (CDI, CDD, étudiant, indépendant…)");
    if (!prospect.revenus) missingList.push("vos revenus nets mensuels (€)");
    if (!prospect.loyer) missingList.push("le loyer du bien qui vous intéresse");
    const missingStr = missingList.map((m, i) => `${i + 1}. ${m}`).join("\n");
    return `Tu es l'assistant de l'${agenceLine}.
Rédige un email professionnel pour demander les informations manquantes au candidat.
${instructLine}

Contenu de l'email à envoyer :
- Remercier ${nomProspect} pour sa candidature
- Expliquer qu'avant de continuer, nous avons besoin des informations suivantes :
${missingStr}
- Rester chaleureux et encourageant
- Indiquer que la réponse sera rapide dès réception
- Signature : Cordialement, L'équipe ${nomAgence || "de l'agence"}

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu : ${email.body}

Réponse (française, professionnelle, directement envoyable) :`;
  }

  // cas === "complet" — solvable, envoyer les docs et proposer des créneaux
  const sitKey = prospect.situation === "auto" ? "auto" : "cdi";
  const docsList = docsProfiles[sitKey as keyof typeof docsProfiles] ?? docsProfiles.cdi;
  const docsStr = docsList.map((d) => `• ${d}`).join("\n");
  const needsGarant = prospect.situation && garantObligatoire[prospect.situation];
  const garantLine = needsGarant ? "\n• Pour votre profil, un garant sera également requis (mêmes documents)." : "";
  const ratio = prospect.revenus && prospect.loyer
    ? (prospect.revenus / prospect.loyer).toFixed(1)
    : null;
  const solvLine = ratio ? ` Votre dossier présente un ratio de ${ratio}x, ce qui est ${parseFloat(ratio) >= multiplicateur ? "conforme" : "proche"} à nos critères.` : "";

  return `Tu es l'assistant de l'${agenceLine}.
Rédige un email professionnel pour accueillir favorablement ce candidat et lancer la constitution du dossier.
${instructLine}

Contenu de l'email à envoyer :
- Accueillir chaleureusement ${nomProspect}${solvLine}
- Lui demander de transmettre les documents suivants pour monter son dossier :
${docsStr}${garantLine}
- Lui proposer de planifier une visite (créneaux en semaine entre ${heureDebut}h et ${heureFin}h, durée ${dureeVisite} min) — lui demander ses disponibilités
- Rester enthousiaste et professionnel
- Signature : Cordialement, L'équipe ${nomAgence || "de l'agence"}

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu : ${email.body}

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

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, body, ai_reply, category, prospect_data")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (error || !email) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

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
        cdi: (docsSection.cdi as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
        etudiant: (docsSection.etudiant as string[]) ?? ["Carte étudiante", "Certificat de scolarité", "Justificatif de garant", "Pièce d'identité"],
        auto: (docsSection.auto as string[]) ?? ["Extrait Kbis", "Bilans (2 ans)", "Avis d'imposition", "Pièce d'identité"],
      },
      faq: Array.isArray(faqSection) ? faqSection : [],
      instructions: (iaSection.instructions as string) ?? "",
      heureDebut: (calSection.heureDebut as number) ?? 9,
      heureFin: (calSection.heureFin as number) ?? 18,
      dureeVisite: (calSection.dureeVisite as number) ?? 60,
    };

    // 5. Extraction prospect (uniquement pour emails LOCATION)
    const body = email.body ?? "";
    const isLocation = (email.category || "").toUpperCase() === "LOCATION";

    let prompt: string;

    if (isLocation) {
      // BLOC 1 FIX : utiliser prospect_data (données IA) en priorité au lieu de
      // re-parser le body avec l'heuristique qui inversait revenus/loyer
      const pd = (email as any).prospect_data as Record<string, unknown> | null;

      // Mapper les valeurs situation_pro (enum DB) vers les clés internes
      const situationProMap: Record<string, string> = {
        ETUDIANT: "etudiant",
        CDI: "cdi",
        CDD: "cdd",
        AUTO_ENTREPRENEUR: "auto",
        RETRAITE: "retraite",
      };

      // Situation : prospect_data en priorité, fallback heuristique
      const situation = pd?.situation_pro
        ? (situationProMap[String(pd.situation_pro)] ?? detectSituation(body))
        : detectSituation(body);

      // Revenus & loyer : prospect_data en priorité, fallback extractMoney
      const pdRevenus = typeof pd?.revenus_mensuels === "number" ? pd.revenus_mensuels as number : null;
      const pdLoyer = typeof pd?.loyer_max === "number" ? pd.loyer_max as number : null;
      const { revenus: bodyRevenus, loyer: bodyLoyer } = extractMoney(body);
      const revenus = pdRevenus ?? bodyRevenus;
      const loyer = pdLoyer ?? bodyLoyer;

      // Nom : prospect_data.nom en priorité (extrait du corps, pas de l'expéditeur Gmail)
      const nom = (typeof pd?.nom === "string" && pd.nom.trim().length > 0)
        ? pd.nom.trim()
        : extractNom(body);

      const cas = determineCase({
        situation,
        revenus,
        loyer,
        multiplicateur: settings.multiplicateur,
        garantObligatoire: settings.garantObligatoire,
      });

      console.log(`[generate-reply] emailId=${emailId} cas=${cas} situation=${situation} revenus=${revenus} loyer=${loyer} nom="${nom}" source=${pd ? "prospect_data" : "heuristique"}`);

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

      // Intégrer les FAQ si disponibles
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
- Pas de promesse irréaliste
- Signature neutre : Cordialement, L'équipe ${settings.nomAgence || "de l'agence"}

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${email.body || "Email sans contenu visible"}

Réponse :`;
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
