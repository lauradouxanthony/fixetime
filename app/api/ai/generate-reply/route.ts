import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";
import { buildSystemPrompt } from "@/lib/ai/buildSystemPrompt";
import { logActivity } from "@/lib/activity/logActivity";

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
    revenus_garant: number | null;
    garant: string | null;
  };
}

/* ── Route handler ── */

export async function POST(req: Request) {
  try {
    // 1. Auth
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // 2. Email
    const body = await req.json();
    const { emailId } = body as { emailId: string };
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
        extracted_data: { nom: null, telephone: null, situation_pro: null, revenus_mensuels: null, revenus_garant: null, garant: null },
      } satisfies ParsedReply);
    }

    // 4. Charger les settings
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
    const customQuestion = typeof locatif.customQuestion === "string" ? locatif.customQuestion.trim() : "";
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

    // Coerce revenus depuis JSONB (l'IA extraction peut stocker des strings "3800")
    const parseNum = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };

    const prospect = {
      nom:                   (pd.nom             as string | null) ?? nomFallback,
      telephone:             (pd.telephone        as string | null) ?? null,
      situation_pro:         (pd.situation_pro    as string | null) ?? situationFallback,
      revenus_mensuels:      parseNum(pd.revenus_mensuels) ?? bodyRevenus,
      revenus_garant:        parseNum(pd.revenus_garant),
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
      const { data: prop, error: propErr } = await supabaseAdmin
        .from("properties")
        .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
        .eq("id", propertyId)
        .maybeSingle();
      if (propErr) {
        console.error("[GENERATE] Erreur fetch bien:", propErr.message);
      }
      // Normaliser rent → loyer, name → title pour compatibilité avec le prompt
      if (prop) {
        const p = prop as Record<string, unknown>;
        bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name };
      }
    }

    // 8. Détection multi-bien si property_id null
    let multipleProperties: Array<{ id: string; title: string }> = [];
    if (!propertyId) {
      const { data: allProps } = await supabaseAdmin
        .from("properties")
        .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
        .eq("user_id", user.id);

      if (allProps && allProps.length > 0) {
        const emailText = `${(email as unknown as { subject: string | null }).subject ?? ""} ${bodyText}`.toLowerCase();

        // Chercher les biens mentionnés dans le sujet/corps (utiliser name, pas title)
        const matched = (allProps as Array<Record<string, unknown>>).filter(
          (p) => typeof p.name === "string" && (p.name as string).length >= 4 &&
            emailText.includes((p.name as string).toLowerCase().substring(0, Math.min(8, (p.name as string).length)))
        );

        if (matched.length === 1) {
          const p = matched[0];
          bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name };
        } else if (matched.length > 1) {
          multipleProperties = matched.map((p) => ({ id: p.id as string, title: p.name as string }));
        } else if (allProps.length === 1) {
          const p = allProps[0] as Record<string, unknown>;
          bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name };
        } else if (allProps.length > 1) {
          multipleProperties = (allProps as Array<Record<string, unknown>>).map((p) => ({ id: p.id as string, title: p.name as string }));
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
      prospect, bien, docsList, faqContext, multipleProperties, champsQualification, customQuestion,
    });

    const sender = (email as unknown as { sender: string | null }).sender ?? "Inconnu";
    const subject = (email as unknown as { subject: string | null }).subject ?? "Sans sujet";

    const userMessage = `Email reçu :
Expéditeur : ${sender}
Sujet : ${subject}
Message : ${bodyText.substring(0, 2000)}`;

    // 11. Log diagnostic bien injecté
    console.log("[GENERATE] bien injecté:", JSON.stringify({
      id: bien?.id,
      name: bien?.name,
      animaux_acceptes: bien?.animaux_acceptes,
      rent: bien?.rent,
      property_id_email: propertyId,
    }));

    // 12. Appel OpenAI (JSON mode)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
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
    if (ext.revenus_garant  != null && !pd.revenus_garant)    updatedPd.revenus_garant = ext.revenus_garant;
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

    // Sauvegarder uniquement le texte de réponse (pas le JSON complet)
    await supabaseAdmin.from("emails").update({
      ai_reply: parsed.reply ?? null,
      prospect_data: updatedPd,
    }).eq("id", email.id);

    console.log(`[generate-reply] emailId=${emailId} mode=${parsed.mode} etape=${pd.etape_process ?? "null"}→${parsed.next_etape}`);

    // ── Activity logs ────────────────────────────────────────────
    // NOUVEAU_PROSPECT_QUALIFIE : prospect vient d'être qualifié (revenus + situation_pro connus)
    const wasQualified = (pd.etape_process ?? "NEW") !== "QUALIFICATION" && parsed.next_etape === "VISITE_PROPOSEE";
    if (wasQualified && updatedPd.revenus_mensuels && updatedPd.situation_pro) {
      void logActivity({
        userId: user.id,
        actor: "ai",
        type: "NOUVEAU_PROSPECT_QUALIFIE",
        title: `Prospect qualifié — ${updatedPd.nom ?? (email as unknown as { sender: string }).sender ?? "Inconnu"}`,
        emailId: email.id,
        meta: {
          situation_pro: updatedPd.situation_pro,
          revenus_mensuels: updatedPd.revenus_mensuels,
          next_etape: parsed.next_etape,
        },
      });
    }

    // VISITE_CONFIRMEE : prospect vient de confirmer un créneau
    if (parsed.next_etape === "VISITE_CONFIRMEE" && (pd.etape_process ?? "") !== "VISITE_CONFIRMEE") {
      void logActivity({
        userId: user.id,
        actor: "ai",
        type: "VISITE_CONFIRMEE",
        title: `Visite confirmée — ${updatedPd.nom ?? (email as unknown as { sender: string }).sender ?? "Inconnu"}`,
        emailId: email.id,
        meta: {
          situation_pro: updatedPd.situation_pro,
          mode: parsed.mode,
        },
      });
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("GENERATE_REPLY_API_ERROR", err);
    return NextResponse.json({ error: "GENERATE_REPLY_FAILED" }, { status: 500 });
  }
}
