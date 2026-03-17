import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min max — traitement batch

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * POST /api/emails/reanalyze-prospects
 *
 * Re-extrait les données prospect (prospect_data) pour TOUS les emails
 * de type LOCATION de l'utilisateur connecté, en utilisant le prompt
 * corrigé (BUGs #1, #3, #4 + garant).
 *
 * Retourne : { success: true, processed: N, updated: N, errors: N }
 */
function isInternalCall(req: Request) {
  const key = req.headers.get("x-fixetime-cron-key");
  if (!key) return false;
  const expected = process.env.FIXETIME_INTERNAL_CRON_KEY;
  if (!expected) return true; // dev local : clé non configurée → accepté
  return key === expected;
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}

  const isInternal = isInternalCall(req);

  let userId: string;

  if (isInternal && typeof body.user_id === "string") {
    // Appel serveur (script de migration, cron, etc.)
    userId = body.user_id;
  } else {
    // Auth — utilisateur connecté via cookie
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NO_USER" }, { status: 401 });
    }
    userId = user.id;
  }
  console.log("[REANALYZE-PROSPECTS] Démarrage pour user:", userId);

  // Récupérer tous les emails LOCATION avec un body non-vide
  const { data: emails, error } = await supabaseAdmin
    .from("emails")
    .select("id, subject, body, sender")
    .eq("user_id", userId)
    .eq("category", "LOCATION")
    .not("body", "is", null)
    .order("received_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[REANALYZE-PROSPECTS] Fetch error:", error);
    return NextResponse.json({ error: "FETCH_FAILED" }, { status: 500 });
  }

  if (!emails || emails.length === 0) {
    console.log("[REANALYZE-PROSPECTS] Aucun email LOCATION trouvé.");
    return NextResponse.json({ success: true, processed: 0, updated: 0, errors: 0 });
  }

  console.log(`[REANALYZE-PROSPECTS] ${emails.length} emails LOCATION à re-analyser`);

  let processed = 0;
  let updated = 0;
  let errors = 0;

  for (const email of emails) {
    processed++;

    const content =
      (email.body as string | null)?.trim() ||
      "Email sans contenu.";

    if (content.length < 10) {
      continue;
    }

    try {
      // Prompt corrigé — BUGs #1 (nom depuis corps), #3 (revenus≠loyer), #4 (tous les champs)
      // + AMÉLIORATION : garant remplace date_emmenagement
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

Sujet: ${email.subject ?? ""}
Email à analyser (corps complet) :
${content.slice(0, 2000)}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prospectPrompt }],
        temperature: 0,
      });

      const raw = completion.choices[0]?.message?.content || "";
      const match = raw.match(/\{[\s\S]*\}/);

      if (!match) {
        console.warn(`[REANALYZE-PROSPECTS] Pas de JSON pour email ${email.id}`);
        errors++;
        continue;
      }

      const parsed = JSON.parse(match[0]);

      // Normaliser : nom_prenom → nom (compatibilité anciens prompts)
      if (!parsed.nom && parsed.nom_prenom) parsed.nom = parsed.nom_prenom;
      delete parsed.nom_prenom;
      // Supprimer date_emmenagement si présent (ancien champ)
      delete parsed.date_emmenagement;

      // Écraser COMPLÈTEMENT prospect_data avec les nouvelles données corrigées
      // + réinitialiser ai_reply pour forcer re-génération du brouillon avec les bonnes données
      const { error: updateError } = await supabaseAdmin
        .from("emails")
        .update({ prospect_data: parsed, ai_reply: null })
        .eq("id", email.id);

      if (updateError) {
        console.error(`[REANALYZE-PROSPECTS] Update échoué email ${email.id}:`, updateError);
        errors++;
      } else {
        updated++;
        if (updated % 10 === 0) {
          console.log(`[REANALYZE-PROSPECTS] Progression: ${updated}/${emails.length} mis à jour`);
        }
      }
    } catch (e) {
      console.error(`[REANALYZE-PROSPECTS] Erreur email ${email.id}:`, e);
      errors++;
    }
  }

  console.log(
    `[REANALYZE-PROSPECTS] Terminé — processed:${processed} updated:${updated} errors:${errors}`
  );

  return NextResponse.json({
    success: true,
    processed,
    updated,
    errors,
  });
}
