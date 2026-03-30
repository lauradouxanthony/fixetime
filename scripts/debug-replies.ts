/**
 * Debug: voir les réponses complètes de S1 et S2
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { buildSystemPrompt, BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const PROP_T2_FLEURS    = "a036d229-c408-4bed-ba89-2568b0a65a31";
const PROP_STUDIO_RIVOLI= "55f5e032-69cf-4cf8-9e18-422467ca87e0";

async function quickCall(params: {
  subject: string; body: string; sender: string;
  property_id: string; prospect: BuildSystemPromptParams["prospect"]; etape: string;
}) {
  const { data: prop } = await sb.from("properties")
    .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
    .eq("id", params.property_id).maybeSingle();
  const p = prop as Record<string, unknown>;
  const bien = prop ? { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name } : null;

  const { data: row } = await sb.from("settings_v1").select("email_rules").eq("user_id", "69f195a3-4ee2-4f55-950c-530c044e96fc").single();
  const rules = row?.email_rules as Record<string, unknown>;
  const locatif = rules.ft_locatif as Record<string, unknown>;
  const iaSection = rules.ft_ia as Record<string, unknown>;
  const calSection = (rules.ft_calendrier as Record<string, unknown>) ?? {};
  const docsSection = (rules.ft_documents as Record<string, unknown>) ?? {};

  const docsProfiles: Record<string, string[]> = {
    CDI: (docsSection.cdi as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Pièce d'identité"],
    ETUDIANT: (docsSection.etudiant as string[]) ?? ["Carte étudiante", "Justificatif de garant", "Pièce d'identité"],
  };
  const sitPro = params.prospect.situation_pro;
  const docsList = sitPro && docsProfiles[sitPro] ? docsProfiles[sitPro] : docsProfiles.CDI;

  const systemPrompt = buildSystemPrompt({
    nomAgence: (locatif.nomAgence as string) ?? "",
    multiplicateur: (locatif.multiplicateur as number) ?? 3,
    seuilAutopilote: (iaSection.seuil_autopilote as number) ?? 3.5,
    tonDeVoix: (iaSection.ton_de_voix as string) ?? "Professionnel et formel",
    instructions: (iaSection.instructions as string) ?? "",
    prioriteProfils: (iaSection.priorite_profils as string) ?? "",
    heureDebut: (calSection.heureDebut as number) ?? 9,
    heureFin: (calSection.heureFin as number) ?? 18,
    dureeVisite: (calSection.dureeVisite as number) ?? 60,
    etapeProcess: params.etape,
    garantObligatoire: (locatif.garantObligatoire as Record<string, boolean>) ?? { CDD: true, ETUDIANT: true },
    prospect: params.prospect,
    bien,
    docsList,
    faqContext: "",
    multipleProperties: [],
    champsQualification: ["situation_pro", "revenus_mensuels", "garant"],
    customQuestion: "",
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Email reçu :\nExpéditeur : ${params.sender}\nSujet : ${params.subject}\nMessage : ${params.body}` },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0]?.message?.content?.trim() ?? "{}");
}

async function main() {
  console.log("\n=== S1: Paul Martin CDI 3200€, T2 Fleurs (animaux=false, loyer=850€) ===");
  const r1 = await quickCall({
    sender: "Paul Martin <paul.martin@test.com>",
    subject: "Demande visite T2 rue des Fleurs",
    body: "Bonjour, je suis intéressé par votre T2. Je suis en CDI, je gagne 3200€ net. Cordialement, Paul Martin 06 11 22 33 44",
    property_id: PROP_T2_FLEURS,
    prospect: { nom: "Paul Martin", telephone: null, situation_pro: "CDI", revenus_mensuels: 3200, loyer_max: null, garant: null, date_entree_souhaitee: null },
    etape: "NEW",
  });
  console.log("MODE:", r1.mode, "| NEXT:", r1.next_etape);
  console.log("REPLY COMPLET:\n", r1.reply);
  console.log("\nContient '850':", r1.reply?.includes("850"));
  console.log("Contient 'animaux':", r1.reply?.toLowerCase().includes("animaux"));

  console.log("\n\n=== S2: Lucas Petit ETUDIANT garant=OUI, Studio Rivoli (animaux=true) ===");
  const r2 = await quickCall({
    sender: "Lucas Petit <lucas@test.com>",
    subject: "Studio rue de Rivoli pour étudiant",
    body: "Bonjour, je suis étudiant en L3. Mon père est garant, CDI 4000€/mois. Cordialement, Lucas Petit",
    property_id: PROP_STUDIO_RIVOLI,
    prospect: { nom: "Lucas Petit", telephone: null, situation_pro: "ETUDIANT", revenus_mensuels: null, loyer_max: null, garant: "OUI", date_entree_souhaitee: null },
    etape: "NEW",
  });
  console.log("MODE:", r2.mode, "| NEXT:", r2.next_etape);
  console.log("REPLY COMPLET:\n", r2.reply);
  console.log("\nContient 'animaux':", r2.reply?.toLowerCase().includes("animaux"));
  console.log("Contient 'garant':", r2.reply?.toLowerCase().includes("garant"));
}

main().catch(console.error);
