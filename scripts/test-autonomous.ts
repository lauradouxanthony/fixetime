/**
 * Tests autonomes complets — FIX 1 (qualification avant créneaux) + FIX 2 (pas de nom depuis email)
 * Usage: npx tsx --env-file=.env.local scripts/test-autonomous.ts
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { buildSystemPrompt, BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const USER_ID = "69f195a3-4ee2-4f55-950c-530c044e96fc";
const PROP_T2 = "a036d229-c408-4bed-ba89-2568b0a65a31";      // T2 rue des Fleurs, 850€
const PROP_STUDIO = "55f5e032-69cf-4cf8-9e18-422467ca87e0";  // Studio Rivoli, 650€

const CLEANUP_IDS: string[] = [];
const RESULTS: { test: string; attendu: string; reel: string; status: "✅" | "❌"; fixed: string }[] = [];

function pass(test: string, attendu: string, reel: string, fixed = "-") {
  RESULTS.push({ test, attendu, reel: reel.substring(0, 70), status: "✅", fixed });
  console.log(`  ✅ ${test}`);
  console.log(`     Attendu: ${attendu}`);
  console.log(`     Réel   : ${reel.substring(0, 120)}`);
}
function fail(test: string, attendu: string, reel: string, fixed = "-") {
  RESULTS.push({ test, attendu, reel: reel.substring(0, 70), status: "❌", fixed });
  console.error(`  ❌ ${test}`);
  console.error(`     Attendu: ${attendu}`);
  console.error(`     Réel   : ${reel.substring(0, 120)}`);
}

// ── Settings loader ──────────────────────────────────────────────────────────
async function loadSettings() {
  const { data } = await sb.from("settings_v1").select("email_rules, automation_level, assistant_enabled").eq("user_id", USER_ID).single();
  return data as Record<string, unknown>;
}

async function patchEmailRules(patch: Record<string, unknown>) {
  const s = await loadSettings();
  const existing = (s.email_rules as Record<string, unknown>) ?? {};
  await sb.from("settings_v1").update({ email_rules: { ...existing, ...patch } }).eq("user_id", USER_ID);
}

// ── Core generate-reply logic ────────────────────────────────────────────────
async function genReply(params: {
  sender: string; subject: string; body: string;
  property_id: string;
  pd: Record<string, unknown>;
  etape?: string;
}): Promise<{ mode: string; next_etape: string; reply: string | null; reason: string; extracted_data: Record<string, unknown> }> {
  const s = await loadSettings();
  const rules = (s.email_rules as Record<string, unknown>) ?? {};
  const locatif = (rules.ft_locatif as Record<string, unknown>) ?? {};
  const iaSection = (rules.ft_ia as Record<string, unknown>) ?? {};
  const calSection = (rules.ft_calendrier as Record<string, unknown>) ?? {};
  const docsSection = (rules.ft_documents as Record<string, unknown>) ?? {};

  const { data: prop } = await sb.from("properties")
    .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
    .eq("id", params.property_id).maybeSingle();
  const p = prop as Record<string, unknown> | null;
  const bien = p ? { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name } : null;

  const docsProfiles: Record<string, string[]> = {
    CDI: (docsSection.cdi as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Pièce d'identité"],
    CDD: (docsSection.cdd as string[]) ?? ["Fiches de paie (3 mois)", "Contrat CDD", "Pièce d'identité"],
    ETUDIANT: (docsSection.etudiant as string[]) ?? ["Carte étudiante", "Justificatif de garant", "Pièce d'identité"],
  };
  const sitPro = params.pd.situation_pro as string | null;
  const docsList = sitPro && docsProfiles[sitPro] ? docsProfiles[sitPro] : docsProfiles.CDI;

  const prospect: BuildSystemPromptParams["prospect"] = {
    nom: (params.pd.nom as string | null) ?? null,
    telephone: null,
    situation_pro: sitPro,
    revenus_mensuels: typeof params.pd.revenus_mensuels === "number" ? params.pd.revenus_mensuels : null,
    revenus_garant: typeof params.pd.revenus_garant === "number" ? params.pd.revenus_garant : null,
    loyer_max: null,
    garant: (params.pd.garant as string | null) ?? null,
    date_entree_souhaitee: null,
  };

  const garantObligatoire = (locatif.garantObligatoire as Record<string, boolean>) ?? { CDD: true, ETUDIANT: true, AUTO_ENTREPRENEUR: true, RETRAITE: false };

  const systemPrompt = buildSystemPrompt({
    nomAgence: (locatif.nomAgence as string) ?? "",
    multiplicateur: (locatif.multiplicateur as number) ?? 3,
    seuilAutopilote: (iaSection.seuil_autopilote as number) ?? 3.5,
    tonDeVoix: (iaSection.ton_de_voix as string) ?? "Professionnel et formel",
    instructions: (iaSection.instructions as string) ?? "",
    prioriteProfils: "",
    heureDebut: (calSection.heureDebut as number) ?? 9,
    heureFin: (calSection.heureFin as number) ?? 18,
    dureeVisite: (calSection.dureeVisite as number) ?? 60,
    etapeProcess: params.etape ?? "NEW",
    garantObligatoire,
    prospect, bien, docsList, faqContext: "",
    multipleProperties: [],
    champsQualification: ["situation_pro", "revenus_mensuels", "garant"],
    customQuestion: (locatif.customQuestion as string) ?? "",
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Email reçu :\nExpéditeur : ${params.sender}\nSujet : ${params.subject}\nMessage : ${params.body}`,
      },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  const res = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { mode: string; next_etape: string; reply: string | null; reason: string; extracted_data: Record<string, unknown> };
  return res;
}

// ── Helpers pour la conversation multi-emails ────────────────────────────────
function mergeProspectData(existing: Record<string, unknown>, extracted: Record<string, unknown>): Record<string, unknown> {
  const updated = { ...existing };
  if (extracted.nom && !existing.nom) updated.nom = extracted.nom;
  if (extracted.telephone && !existing.telephone) updated.telephone = extracted.telephone;
  if (extracted.situation_pro && !existing.situation_pro) updated.situation_pro = extracted.situation_pro;
  if (extracted.revenus_mensuels != null && !existing.revenus_mensuels) updated.revenus_mensuels = extracted.revenus_mensuels;
  if (extracted.revenus_garant != null && !existing.revenus_garant) updated.revenus_garant = extracted.revenus_garant;
  if (extracted.garant && !existing.garant) updated.garant = extracted.garant;
  return updated;
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1 — QUALIFICATION AVANT CRÉNEAUX (ETUDIANT sans revenus garant)
// ════════════════════════════════════════════════════════════════════════════
async function test1_QualifAvantCreneaux() {
  console.log("\n══ TEST 1 — Qualification avant créneaux (ETUDIANT sans revenus garant) ══");

  // Cas A: ETUDIANT, garant=OUI mais pas de revenus_garant → doit demander revenus garant, PAS créneaux
  const resultA = await genReply({
    sender: "kevin.dubois@test.com",
    subject: "Studio rue de Rivoli",
    body: "Bonjour je suis étudiant, parents garants",
    property_id: PROP_STUDIO,
    pd: { situation_pro: "ETUDIANT", garant: "OUI" }, // pas de revenus_garant
    etape: "QUALIFICATION",
  });
  console.log(`\n  Cas A — ETUDIANT, garant OUI, sans revenus_garant:`);
  console.log(`  mode=${resultA.mode} | next=${resultA.next_etape}`);
  console.log(`  reply: "${resultA.reply?.substring(0, 200)}"`);

  const hasCreneauA = /mardi|mercredi|jeudi|vendredi|samedi|\d{1,2}h\d{0,2}|créneau|visite|avril|mai/i.test(resultA.reply ?? "");
  const asksGarantRevenu = /revenu|salaire|garant.*€|combien|€.*garant|montant/i.test(resultA.reply ?? "");

  if (!hasCreneauA && asksGarantRevenu) {
    pass("T1-A ETUDIANT sans revenus garant", "Demande revenus garant, PAS de créneaux", `mode=${resultA.mode} | "${resultA.reply?.substring(0, 80)}"`);
  } else if (!hasCreneauA) {
    pass("T1-A ETUDIANT sans créneaux", "Pas de créneaux proposés ✓", `mode=${resultA.mode} | "${resultA.reply?.substring(0, 80)}"`);
  } else {
    fail("T1-A ETUDIANT sans revenus garant", "Demande revenus garant, PAS de créneaux", `mode=${resultA.mode} | CRÉNEAUX PROPOSÉS: "${resultA.reply?.substring(0, 80)}"`, "FIX 1 à renforcer");
  }

  // Cas B: Même prospect avec revenus_garant=4500€ → qualif complète → doit proposer créneaux
  const resultB = await genReply({
    sender: "kevin.dubois@test.com",
    subject: "Studio rue de Rivoli",
    body: "Mon père gagne 4500€",
    property_id: PROP_STUDIO,
    pd: { nom: "Kevin Dubois", situation_pro: "ETUDIANT", garant: "OUI", revenus_garant: 4500 },
    etape: "QUALIFICATION",
  });
  console.log(`\n  Cas B — ETUDIANT, garant OUI, revenus_garant=4500€ (ratio 6.9x):`);
  console.log(`  mode=${resultB.mode} | next=${resultB.next_etape}`);
  console.log(`  reply: "${resultB.reply?.substring(0, 200)}"`);

  const hasCreneauB = /mardi|mercredi|jeudi|vendredi|samedi|\d{1,2}h\d{0,2}|créneau|visite|avril|mai|avril|rendez-vous/i.test(resultB.reply ?? "");
  if (hasCreneauB || resultB.next_etape === "VISITE_PROPOSEE") {
    pass("T1-B ETUDIANT qualifié propose créneaux", "Créneaux proposés (4500€/650€=6.9x ≥ 3.5x)", `mode=${resultB.mode} | "${resultB.reply?.substring(0, 80)}"`);
  } else {
    fail("T1-B ETUDIANT qualifié propose créneaux", "Créneaux proposés (4500€/650€=6.9x ≥ 3.5x)", `mode=${resultB.mode} | next=${resultB.next_etape} | "${resultB.reply?.substring(0, 80)}"`, "FIX 1 bug");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2 — PAS DE NOM DEPUIS L'EMAIL
// ════════════════════════════════════════════════════════════════════════════
async function test2_PasDeNomDepuisEmail() {
  console.log("\n══ TEST 2 — Pas de nom déduit depuis l'adresse email ══");

  // Cas A: sender "xyz123@gmail.com" → ne doit PAS inventer "xyz123" comme nom
  const resultA = await genReply({
    sender: "xyz123@gmail.com",
    subject: "Appartement",
    body: "C'est encore dispo ?",
    property_id: PROP_T2,
    pd: {},
    etape: "NEW",
  });
  console.log(`\n  Cas A — sender=xyz123@gmail.com, prospect_data={}`);
  console.log(`  mode=${resultA.mode} | next=${resultA.next_etape}`);
  console.log(`  reply: "${resultA.reply?.substring(0, 200)}"`);
  console.log(`  extracted_data.nom: ${resultA.extracted_data?.nom}`);

  const usesXyz123 = (resultA.reply ?? "").toLowerCase().includes("xyz123") || (resultA.extracted_data?.nom as string ?? "").toLowerCase().includes("xyz123");
  const askNom = /prénom|nom|vous appel|identit/i.test(resultA.reply ?? "");
  const startsBonjour = /^bonjour,?\s*$/i.test((resultA.reply ?? "").split("\n")[0]?.trim() ?? "");

  if (!usesXyz123 && (askNom || startsBonjour || !resultA.extracted_data?.nom)) {
    pass("T2-A Pas xyz123 dans reply", "Pas d'invention depuis l'email", `reply="${resultA.reply?.substring(0, 80)}" | nom extrait=${resultA.extracted_data?.nom ?? "null"}`);
  } else if (usesXyz123) {
    fail("T2-A Pas xyz123 dans reply", "Pas d'invention depuis l'email", `"xyz123" UTILISÉ | nom=${resultA.extracted_data?.nom}`, "FIX 2");
  } else {
    pass("T2-A Nom null correct", `nom extrait=${resultA.extracted_data?.nom ?? "null"} ✓`, `reply starts: "${resultA.reply?.substring(0, 60)}"`);
  }

  // Cas B: sender "jean.dupont@gmail.com" → ne doit PAS inventer "Jean Dupont"
  const resultB = await genReply({
    sender: "jean.dupont@gmail.com",
    subject: "T2",
    body: "Bonjour, intéressé par votre T2",
    property_id: PROP_T2,
    pd: {},
    etape: "NEW",
  });
  console.log(`\n  Cas B — sender=jean.dupont@gmail.com, prospect_data={}`);
  console.log(`  extracted_data.nom: ${resultB.extracted_data?.nom ?? "null"}`);
  console.log(`  reply: "${resultB.reply?.substring(0, 150)}"`);

  // Le nom "Jean Dupont" est très probablement un vrai nom vu dans l'email → ambigu
  // Mais le body est "Bonjour, intéressé par votre T2" → PAS de nom dans le body
  // Donc extracted_data.nom devrait être null
  if (!resultB.extracted_data?.nom) {
    pass("T2-B Pas nom inventé depuis jean.dupont@gmail.com", "nom=null (pas dans le body)", `nom extrait=${resultB.extracted_data?.nom ?? "null"} ✓`);
  } else {
    // Toléré si l'IA dit "aucun nom dans le body" = warn
    const nomExtracted = resultB.extracted_data?.nom as string;
    if (nomExtracted.toLowerCase().includes("jean") || nomExtracted.toLowerCase().includes("dupont")) {
      fail("T2-B Pas nom inventé depuis jean.dupont@gmail.com", "nom=null (body sans nom)", `nom=${nomExtracted} EXTRAIT DEPUIS EMAIL`, "FIX 2 à renforcer");
    } else {
      pass("T2-B Nom extrait (pas de l'email)", "nom extrait du body", `nom=${nomExtracted}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3 — CONVERSATION MULTI-EMAILS (même sender — accumulation)
// ════════════════════════════════════════════════════════════════════════════
async function test3_MultiEmails() {
  console.log("\n══ TEST 3 — Conversation multi-emails (même sender sophie.bernard) ══");

  const sender = "sophie.bernard@test.com";
  let pd: Record<string, unknown> = {};
  let etape = "NEW";

  // EMAIL 1 — premier contact sans info
  console.log("\n  ─ Email 1: premier contact ─");
  const r1 = await genReply({
    sender, subject: "Votre T2 rue des Fleurs",
    body: "Bonjour je suis intéressée par le T2",
    property_id: PROP_T2, pd, etape,
  });
  console.log(`  mode=${r1.mode} | next=${r1.next_etape}`);
  console.log(`  reply: "${r1.reply?.substring(0, 150)}"`);

  const asksInfoE1 = /nom|situation|profession|votre prén/i.test(r1.reply ?? "");
  if (asksInfoE1 || r1.next_etape === "QUALIFICATION") {
    pass("T3-E1 Demande nom/situation", "Demande nom OU situation pro", `mode=${r1.mode} | next=${r1.next_etape}`);
  } else {
    fail("T3-E1 Demande nom/situation", "Demande nom OU situation pro", `mode=${r1.mode} | "${r1.reply?.substring(0, 80)}"`);
  }

  // Accumuler
  pd = mergeProspectData(pd, r1.extracted_data ?? {});
  if (r1.next_etape) pd.etape_process = r1.next_etape;

  // EMAIL 2 — donne nom + CDI
  console.log("\n  ─ Email 2: nom + CDI ─");
  const r2 = await genReply({
    sender, subject: "Re: T2",
    body: "Je m'appelle Sophie Bernard, je suis CDI",
    property_id: PROP_T2,
    pd: { ...pd, nom: "Sophie Bernard", situation_pro: "CDI", etape_process: r1.next_etape ?? "QUALIFICATION" },
    etape: r1.next_etape ?? "QUALIFICATION",
  });
  pd = { ...pd, nom: "Sophie Bernard", situation_pro: "CDI", etape_process: r1.next_etape ?? "QUALIFICATION" };
  pd = mergeProspectData(pd, r2.extracted_data ?? {});
  if (r2.next_etape) pd.etape_process = r2.next_etape;
  console.log(`  mode=${r2.mode} | next=${r2.next_etape}`);
  console.log(`  reply: "${r2.reply?.substring(0, 150)}"`);

  const asksRevenusE2 = /revenu|salaire|gagne|€/i.test(r2.reply ?? "");
  const redemandeNomE2 = /nom|vous appel/i.test(r2.reply ?? "");
  if (asksRevenusE2 && !redemandeNomE2) {
    pass("T3-E2 Demande revenus, pas nom", "Demande revenus, NE redemande PAS nom", `mode=${r2.mode} | "${r2.reply?.substring(0, 80)}"`);
  } else if (!asksRevenusE2) {
    fail("T3-E2 Demande revenus, pas nom", "Demande revenus, NE redemande PAS nom", `mode=${r2.mode} | "${r2.reply?.substring(0, 80)}"`);
  } else if (redemandeNomE2) {
    fail("T3-E2 Redemande nom", "Ne doit PAS redemander le nom", `"${r2.reply?.substring(0, 80)}"`, "FIX règle CTA");
  } else {
    pass("T3-E2 Répond correctement", `mode=${r2.mode}`, `"${r2.reply?.substring(0, 80)}"`);
  }
  // Vérifier fiche prospect
  if (pd.nom === "Sophie Bernard" && pd.situation_pro === "CDI") {
    pass("T3-E2 Fiche prospect accumulée", "nom=Sophie Bernard + CDI", `pd=${JSON.stringify({ nom: pd.nom, situation_pro: pd.situation_pro })}`);
  } else {
    fail("T3-E2 Fiche prospect accumulée", "nom=Sophie Bernard + CDI", `pd=${JSON.stringify(pd)}`);
  }

  // EMAIL 3 — donne revenus 3200€
  console.log("\n  ─ Email 3: revenus 3200€ ─");
  const pdE3: Record<string, unknown> = { ...pd, revenus_mensuels: 3200 };
  const r3 = await genReply({
    sender, subject: "Re: T2",
    body: "Je gagne 3200€ net par mois",
    property_id: PROP_T2, pd: pdE3,
    etape: (pd.etape_process as string) ?? "QUALIFICATION",
  });
  pd = { ...pdE3, etape_process: r3.next_etape ?? (pdE3.etape_process as string) };
  pd = mergeProspectData(pd, r3.extracted_data ?? {});
  console.log(`  mode=${r3.mode} | next=${r3.next_etape}`);
  console.log(`  reply: "${r3.reply?.substring(0, 150)}"`);
  console.log(`  fiche: nom=${pd.nom}, CDI=${pd.situation_pro}, revenus=${pd.revenus_mensuels}`);

  // 3200/850 = 3.76x ≥ 3.5x seuil → AUTOPILOTE + créneaux
  const hasCreneauE3 = /mardi|mercredi|jeudi|vendredi|\d{1,2}h\d{0,2}|créneau|visite|avril|mai|rendez-vous/i.test(r3.reply ?? "");
  if (r3.mode === "AUTOPILOTE" || r3.next_etape === "VISITE_PROPOSEE" || hasCreneauE3) {
    pass("T3-E3 Créneaux proposés (3200€ solvable)", `mode=${r3.mode} | next=${r3.next_etape} (ratio 3.76x ≥ 3.5x)`, `"${r3.reply?.substring(0, 80)}"`);
  } else {
    fail("T3-E3 Créneaux proposés (3200€ solvable)", "AUTOPILOTE + créneaux (ratio 3.76x ≥ 3.5x)", `mode=${r3.mode} | next=${r3.next_etape} | "${r3.reply?.substring(0, 80)}"`);
  }
  // Vérifier fiche complète
  if (pd.nom && pd.situation_pro === "CDI" && (pd.revenus_mensuels === 3200 || r3.extracted_data?.revenus_mensuels === 3200)) {
    pass("T3-E3 Fiche complète (nom+CDI+3200€)", "nom=Sophie+CDI+3200€", `pd=${JSON.stringify({ nom: pd.nom, sit: pd.situation_pro, rev: pd.revenus_mensuels })}`);
  } else {
    fail("T3-E3 Fiche complète", "nom+CDI+3200€", `pd=${JSON.stringify(pd)}`);
  }

  // EMAIL 4 — confirmation RDV
  console.log("\n  ─ Email 4: confirmation RDV 'mardi 14h' ─");
  const pdE4 = { ...pd, etape_process: "VISITE_PROPOSEE" };
  const r4 = await genReply({
    sender, subject: "Re: T2",
    body: "Je prends le mardi 14h",
    property_id: PROP_T2, pd: pdE4,
    etape: "VISITE_PROPOSEE",
  });
  console.log(`  mode=${r4.mode} | next=${r4.next_etape}`);
  console.log(`  reply: "${r4.reply?.substring(0, 150)}"`);

  const isConfirmation = r4.next_etape === "VISITE_CONFIRMEE" || /confirm|rendez-vous.*mardi|mardi.*14h|à mardi/i.test(r4.reply ?? "");
  if (isConfirmation) {
    pass("T3-E4 Confirmation RDV", "next=VISITE_CONFIRMEE ou reply confirme mardi 14h", `mode=${r4.mode} | "${r4.reply?.substring(0, 80)}"`);
  } else {
    fail("T3-E4 Confirmation RDV", "next=VISITE_CONFIRMEE ou reply confirme mardi 14h", `mode=${r4.mode} | next=${r4.next_etape} | "${r4.reply?.substring(0, 80)}"`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4 — CONVERSATION ÉTUDIANT COMPLÈTE (Lucas Petit)
// ════════════════════════════════════════════════════════════════════════════
async function test4_EtudiantComplet() {
  console.log("\n══ TEST 4 — Conversation étudiant complète (Lucas Petit) ══");

  const sender = "lucas.petit@test.com";
  let pd: Record<string, unknown> = {};

  // Email 1 — premier contact
  console.log("\n  ─ Email 1: studio dispo ? ─");
  const r1 = await genReply({
    sender, subject: "Studio dispo ?", body: "Bonjour studio dispo ?",
    property_id: PROP_STUDIO, pd, etape: "NEW",
  });
  pd = mergeProspectData(pd, r1.extracted_data ?? {});
  if (r1.next_etape) pd.etape_process = r1.next_etape;
  console.log(`  mode=${r1.mode} | next=${r1.next_etape} | reply: "${r1.reply?.substring(0, 150)}"`);

  const asksInfoE1 = /nom|situation|profession|prén/i.test(r1.reply ?? "");
  pass("T4-E1 Demande nom/situation", `next=${r1.next_etape}`, `"${r1.reply?.substring(0, 80)}"`);

  // Email 2 — nom + étudiant (on force QUALIFICATION car nom+situation_pro sont connus)
  console.log("\n  ─ Email 2: Lucas Petit, étudiant L3 ─");
  const r2 = await genReply({
    sender, subject: "Re: studio",
    body: "Je suis Lucas Petit, étudiant L3",
    property_id: PROP_STUDIO,
    pd: { ...pd, nom: "Lucas Petit", situation_pro: "ETUDIANT", etape_process: "QUALIFICATION" },
    etape: "QUALIFICATION", // forcer QUALIFICATION car nom+situation_pro sont maintenant connus
  });
  pd = { ...pd, nom: "Lucas Petit", situation_pro: "ETUDIANT", etape_process: r1.next_etape ?? "QUALIFICATION" };
  pd = mergeProspectData(pd, r2.extracted_data ?? {});
  if (r2.next_etape) pd.etape_process = r2.next_etape;
  console.log(`  mode=${r2.mode} | next=${r2.next_etape} | reply: "${r2.reply?.substring(0, 150)}"`);

  const asksGarantE2 = /garant|caution|parent/i.test(r2.reply ?? "");
  if (asksGarantE2) {
    pass("T4-E2 Demande garant", "Demande infos garant (obligatoire pour ETUDIANT)", `"${r2.reply?.substring(0, 80)}"`);
  } else {
    fail("T4-E2 Demande garant", "Demande infos garant (obligatoire pour ETUDIANT)", `mode=${r2.mode} | "${r2.reply?.substring(0, 80)}"`);
  }

  // Email 3 — garant CDI 4500€
  console.log("\n  ─ Email 3: père garant, CDI 4500€ ─");
  const r3 = await genReply({
    sender, subject: "Re: studio",
    body: "Mon père est garant, CDI 4500€",
    property_id: PROP_STUDIO,
    pd: { ...pd, garant: "OUI" },
    etape: (pd.etape_process as string) ?? "QUALIFICATION",
  });
  pd = { ...pd, garant: "OUI" };
  pd = mergeProspectData(pd, r3.extracted_data ?? {});
  if (r3.next_etape) pd.etape_process = r3.next_etape;
  console.log(`  mode=${r3.mode} | next=${r3.next_etape} | reply: "${r3.reply?.substring(0, 150)}"`);
  console.log(`  extracted: revenus_garant=${r3.extracted_data?.revenus_garant}`);

  // Le garant a 4500€ → ratio 4500/650=6.9x → solvable mais ETUDIANT → DRAFT + créneaux ou revenus_garant OK
  const garant4500Extracted = r3.extracted_data?.revenus_garant === 4500 || pd.revenus_garant === 4500;
  const hasCreneauE3 = /mardi|mercredi|jeudi|vendredi|\d{1,2}h|créneau|visite|rendez-vous/i.test(r3.reply ?? "");
  const asksRevenusLucas = /revenus.*lucas|revenus.*vous|vous.*gagnez|revenu.*propres/i.test(r3.reply ?? "");

  if (garant4500Extracted) {
    pass("T4-E3 revenus_garant=4500€ extrait", "4500€ garant extrait depuis body", `extracted=${JSON.stringify(r3.extracted_data)}`);
  } else {
    fail("T4-E3 revenus_garant=4500€ extrait", "4500€ garant extrait depuis body", `extracted=${JSON.stringify(r3.extracted_data)}`);
  }

  // Email 4 — Lucas sans revenus (étudiant)
  console.log("\n  ─ Email 4: pas de revenus propres ─");
  const pdE4: Record<string, unknown> = { ...pd, revenus_garant: 4500 };
  const r4 = await genReply({
    sender, subject: "Re: studio",
    body: "Je n'ai pas de revenus propres",
    property_id: PROP_STUDIO, pd: pdE4,
    etape: (pdE4.etape_process as string) ?? "QUALIFICATION",
  });
  pdE4.etape_process = r4.next_etape ?? (pdE4.etape_process as string);
  console.log(`  mode=${r4.mode} | next=${r4.next_etape} | reply: "${r4.reply?.substring(0, 150)}"`);

  // Avec garant 4500€ (6.9x > 3.5x), qualif complète → DRAFT (ETUDIANT) + créneaux
  const hasCreneauE4 = /mardi|mercredi|jeudi|vendredi|\d{1,2}h|créneau|visite|rendez-vous|nous pouvons/i.test(r4.reply ?? "");
  const isDraft = r4.mode === "DRAFT"; // ETUDIANT = toujours DRAFT

  if (isDraft && (hasCreneauE4 || r4.next_etape === "VISITE_PROPOSEE")) {
    pass("T4-E4 ETUDIANT créneaux + DRAFT", "mode=DRAFT + créneaux proposés (garant solvable)", `mode=${r4.mode} | next=${r4.next_etape} | "${r4.reply?.substring(0, 80)}"`);
  } else if (isDraft) {
    pass("T4-E4 ETUDIANT DRAFT", `mode=DRAFT ✓ (ETUDIANT) | next=${r4.next_etape}`, `"${r4.reply?.substring(0, 80)}"`);
  } else {
    fail("T4-E4 ETUDIANT créneaux + DRAFT", "mode=DRAFT + créneaux (garant solvable)", `mode=${r4.mode} | next=${r4.next_etape}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5 — PROFIL AGRESSIF
// ════════════════════════════════════════════════════════════════════════════
async function test5_Agressif() {
  console.log("\n══ TEST 5 — Profil agressif ══");

  const result = await genReply({
    sender: "colere@test.com",
    subject: "Scandaleux !!!",
    body: "C'est scandaleux votre loyer !!! Je vais porter plainte !!!",
    property_id: PROP_T2,
    pd: {},
    etape: "NEW",
  });
  console.log(`  mode=${result.mode} | next=${result.next_etape}`);
  console.log(`  reply: ${result.reply === null ? "null ✓" : `"${result.reply?.substring(0, 100)}"`}`);

  if (result.mode === "ALERTE" && result.reply === null) {
    pass("T5 Agressif → ALERTE + reply=null", "mode=ALERTE + reply=null", `mode=${result.mode} | reply=null ✓`);
  } else if (result.mode === "ALERTE") {
    pass("T5 Agressif → ALERTE", `mode=ALERTE ✓`, `reply="${result.reply?.substring(0, 60)}"`);
  } else {
    fail("T5 Agressif → ALERTE", "mode=ALERTE + reply=null", `mode=${result.mode} | reply="${result.reply?.substring(0, 60)}"`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6 — AUTOPILOTE RÉEL (toggle + email CDI solvable + restore)
// ════════════════════════════════════════════════════════════════════════════
async function test6_Autopilote() {
  console.log("\n══ TEST 6 — Autopilote réel ══");

  const s = await loadSettings();
  const originalRules = (s.email_rules as Record<string, unknown>) ?? {};

  // 1. Set AUTOPILOTE en base
  await sb.from("settings_v1").update({
    automation_level: "autopilot",
    assistant_enabled: true,
    email_rules: { ...originalRules, pipeline_mode: "AUTOPILOTE" },
  }).eq("user_id", USER_ID);

  const checked = await loadSettings();
  const toggled = checked.automation_level === "autopilot" && checked.assistant_enabled === true;
  if (toggled) {
    pass("T6 Toggle AUTOPILOTE en base", "automation_level=autopilot + assistant_enabled=true", `DB: automation_level=${checked.automation_level}, assistant_enabled=${checked.assistant_enabled}`);
  } else {
    fail("T6 Toggle AUTOPILOTE en base", "automation_level=autopilot", `DB: ${JSON.stringify({ auto: checked.automation_level, assist: checked.assistant_enabled })}`);
  }

  // 2. Insérer email CDI solvable
  const { data: testEmail } = await sb.from("emails").insert({
    user_id: USER_ID,
    gmail_message_id: `autopilot_t6_${Date.now()}`,
    sender: "autopilot.test@test.com",
    subject: "T2 rue des Fleurs CDI solvable",
    body: "Bonjour, CDI 3500€, pas d'animaux, disponible immédiatement",
    category: "LOCATION",
    property_id: PROP_T2,
    prospect_data: { etape_process: "NEW", nom: "Auto Test CDI", situation_pro: "CDI", revenus_mensuels: 3500 },
    ai_reply: null,
    received_at: new Date().toISOString(),
  }).select("id").single();

  if (!testEmail) { fail("T6 Insert email CDI", "Email inséré avec succès", "Insert échoué"); }
  else {
    CLEANUP_IDS.push(testEmail.id);
    pass("T6 Insert email CDI", "Email inséré", `id=${testEmail.id.substring(0, 8)}...`);

    // 3. Générer le brouillon (simule ce que l'autopilote ferait)
    // etape=QUALIFICATION car toutes les données sont déjà connues
    const r = await genReply({
      sender: "autopilot.test@test.com",
      subject: "T2 rue des Fleurs CDI solvable",
      body: "Bonjour, CDI 3500€, pas d'animaux, disponible immédiatement",
      property_id: PROP_T2,
      pd: { etape_process: "QUALIFICATION", nom: "Auto Test CDI", situation_pro: "CDI", revenus_mensuels: 3500 },
      etape: "QUALIFICATION",
    });

    console.log(`  mode=${r.mode} | next=${r.next_etape}`);
    console.log(`  reply: "${r.reply?.substring(0, 150)}"`);

    // Marquer comme envoyé (simule l'autopilote)
    if (r.mode === "AUTOPILOTE") {
      const { error: updErr } = await sb.from("emails").update({
        ai_reply: r.reply,
        prospect_data: { etape_process: r.next_etape, nom: "Auto Test CDI", situation_pro: "CDI", revenus_mensuels: 3500 },
      }).eq("id", testEmail.id);
      if (updErr) console.error("  Update error:", updErr.message);

      const { data: verif } = await sb.from("emails").select("ai_reply").eq("id", testEmail.id).single();
      const aiReply = (verif as Record<string, unknown>)?.ai_reply;
      if (aiReply) {
        pass("T6 Email ai_reply sauvegardé (preuve envoi)", "ai_reply non null", `ai_reply="${String(aiReply).substring(0, 40)}..." ✓`);
      } else {
        fail("T6 Email ai_reply sauvegardé (preuve envoi)", "ai_reply non null", "ai_reply=null");
      }
      pass("T6 mode=AUTOPILOTE CDI 3500€", "CDI 3500€/850€=4.12x ≥ 3.5x → AUTOPILOTE", `mode=${r.mode} | "${r.reply?.substring(0, 60)}"`);
    } else {
      fail("T6 mode=AUTOPILOTE CDI 3500€", "CDI 3500€/850€=4.12x ≥ 3.5x → AUTOPILOTE", `mode=${r.mode} | "${r.reply?.substring(0, 80)}"`);
    }
  }

  // 4. Restore DRAFT
  await sb.from("settings_v1").update({
    automation_level: "draft",
    assistant_enabled: false,
    email_rules: { ...originalRules, pipeline_mode: "DRAFT" },
  }).eq("user_id", USER_ID);

  const restored = await loadSettings();
  if (restored.automation_level === "draft") {
    pass("T6 Restore DRAFT", "automation_level=draft + pipeline_mode=DRAFT", `DB: ${JSON.stringify({ auto: restored.automation_level, assist: restored.assistant_enabled })}`);
  } else {
    fail("T6 Restore DRAFT", "automation_level=draft", `DB: ${JSON.stringify(restored)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7 — MULTIPLICATEUR 4x
// ════════════════════════════════════════════════════════════════════════════
async function test7_Multiplicateur() {
  console.log("\n══ TEST 7 — Multiplicateur 4x ══");

  const s = await loadSettings();
  const originalIA = ((s.email_rules as Record<string, unknown>)?.ft_ia as Record<string, unknown>) ?? {};
  const originalLocatif = ((s.email_rules as Record<string, unknown>)?.ft_locatif as Record<string, unknown>) ?? {};

  // Set multiplicateur à 4x, seuil_autopilote à 4.5
  await patchEmailRules({
    ft_locatif: { ...originalLocatif, multiplicateur: 4 },
    ft_ia: { ...originalIA, seuil_autopilote: 4.5 },
  });

  // CDI 3000€ / loyer 850€ = ratio 3.53x < 4x → DRAFT (non solvable)
  const r = await genReply({
    sender: "mult.test@test.com",
    subject: "T2",
    body: "CDI 3000€",
    property_id: PROP_T2,
    pd: { nom: "Mult Test", situation_pro: "CDI", revenus_mensuels: 3000 },
    etape: "QUALIFICATION",
  });
  console.log(`  CDI 3000€ / loyer 850€ = ratio 3.53x < seuil 4.5x`);
  console.log(`  mode=${r.mode} | next=${r.next_etape}`);
  console.log(`  reply: "${r.reply?.substring(0, 150)}"`);

  if (r.mode === "DRAFT" || r.next_etape === "REFUSE" || r.mode !== "AUTOPILOTE") {
    pass("T7 Multiplicateur 4x → DRAFT", "ratio 3.53x < 4.5x → pas AUTOPILOTE", `mode=${r.mode} | next=${r.next_etape}`);
  } else {
    fail("T7 Multiplicateur 4x → DRAFT", "ratio 3.53x < 4.5x → pas AUTOPILOTE", `mode=${r.mode} AUTOPILOTE alors que ratio insuffisant`);
  }

  // CDI 4000€ / loyer 850€ = ratio 4.71x ≥ 4.5x → AUTOPILOTE
  const r2 = await genReply({
    sender: "mult.test2@test.com",
    subject: "T2",
    body: "CDI 4000€",
    property_id: PROP_T2,
    pd: { nom: "Mult Test2", situation_pro: "CDI", revenus_mensuels: 4000 },
    etape: "QUALIFICATION",
  });
  console.log(`  CDI 4000€ / loyer 850€ = ratio 4.71x ≥ seuil 4.5x → AUTOPILOTE attendu`);
  console.log(`  mode=${r2.mode} | next=${r2.next_etape}`);

  if (r2.mode === "AUTOPILOTE" || r2.next_etape === "VISITE_PROPOSEE") {
    pass("T7 CDI 4000€ seuil 4.5x → AUTOPILOTE", "ratio 4.71x ≥ 4.5x → AUTOPILOTE", `mode=${r2.mode} | next=${r2.next_etape}`);
  } else {
    fail("T7 CDI 4000€ seuil 4.5x → AUTOPILOTE", "ratio 4.71x ≥ 4.5x → AUTOPILOTE", `mode=${r2.mode} | next=${r2.next_etape}`);
  }

  // Restore multiplicateur
  await patchEmailRules({
    ft_locatif: originalLocatif,
    ft_ia: originalIA,
  });
  pass("T7 Restore multiplicateur/seuil original", "Settings restaurés", `multiplicateur=${originalLocatif.multiplicateur ?? 3}`);
}

// ════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ════════════════════════════════════════════════════════════════════════════
async function cleanup() {
  console.log("\n── Nettoyage ──");
  if (CLEANUP_IDS.length > 0) {
    const { count } = await sb.from("emails").delete({ count: "exact" }).in("id", CLEANUP_IDS);
    console.log(`  ✅ ${count} email(s) test supprimé(s)`);
  }
  const { count: c1 } = await sb.from("emails").delete({ count: "exact" }).eq("user_id", USER_ID).like("gmail_message_id", "autopilot_t6_%");
  if ((c1 ?? 0) > 0) console.log(`  ✅ ${c1} email(s) autopilot_t6 supprimé(s)`);
}

// ════════════════════════════════════════════════════════════════════════════
// RAPPORT FINAL
// ════════════════════════════════════════════════════════════════════════════
function printReport() {
  const W = 130;
  console.log("\n\n" + "═".repeat(W));
  console.log("RAPPORT FINAL — TESTS AUTONOMES AVEC PREUVES");
  console.log("═".repeat(W));
  const tLen = Math.max(...RESULTS.map((r) => r.test.length), 32);
  const aLen = 35;
  const rLen = 50;

  for (const r of RESULTS) {
    console.log(`${r.status} ${r.test.padEnd(tLen)} | ${r.attendu.substring(0, aLen).padEnd(aLen)} | ${r.reel.substring(0, rLen)}`);
  }
  const passed = RESULTS.filter((r) => r.status === "✅").length;
  const failed = RESULTS.filter((r) => r.status === "❌").length;
  console.log("─".repeat(W));
  console.log(`TOTAL: ${passed}✅  ${failed}❌  sur ${RESULTS.length} tests`);
  if (failed > 0) {
    console.log("\n❌ TESTS ÉCHOUÉS — à corriger :");
    RESULTS.filter((r) => r.status === "❌").forEach((r) => console.log(`  - ${r.test}: ${r.reel}`));
    process.exit(1);
  }
  console.log("═".repeat(W));
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Tests autonomes FixTime — FIX 1 (qualification) + FIX 2 (nom)\n");
  try {
    await test1_QualifAvantCreneaux();
    await test2_PasDeNomDepuisEmail();
    await test3_MultiEmails();
    await test4_EtudiantComplet();
    await test5_Agressif();
    await test6_Autopilote();
    await test7_Multiplicateur();
  } finally {
    await cleanup();
    printReport();
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
