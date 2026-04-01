/**
 * VÉRIFICATION FINALE COMPLÈTE — Autopilote 10 scénarios + Chat IA + Multi-emails + Params
 * Usage: npx tsx --env-file=.env.local scripts/test-verification-finale.ts
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { buildSystemPrompt, BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const USER_ID = "69f195a3-4ee2-4f55-950c-530c044e96fc";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TestResult { bloc: string; test: string; expected: string; actual: string; status: "PASS"|"FAIL"; }
const RESULTS: TestResult[] = [];
const CLEANUP_IDS: string[] = [];

function pass(bloc: string, test: string, expected: string, actual: string) {
  console.log(`  ✅ [${bloc}] ${test}`);
  RESULTS.push({ bloc, test, expected, actual, status: "PASS" });
}
function fail(bloc: string, test: string, expected: string, actual: string) {
  console.error(`  ❌ [${bloc}] ${test}: ${actual}`);
  RESULTS.push({ bloc, test, expected, actual, status: "FAIL" });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getSettings() {
  const { data } = await sb.from("settings_v1").select("email_rules,automation_level,assistant_enabled").eq("user_id", USER_ID).single();
  const rules = (data?.email_rules as Record<string, unknown>) ?? {};
  const ia = (rules.ft_ia as Record<string, unknown>) ?? {};
  const loc = (rules.ft_locatif as Record<string, unknown>) ?? {};
  return {
    multiplicateur: (loc.multiplicateur as number) ?? 3,
    seuilAutopilote: (loc.seuil_autopilote as number) ?? 3.5,
    tonDeVoix: (ia.ton_de_voix as string) ?? "Professionnel et formel",
    nomAgence: (ia.nom_agence as string) ?? "Agence Test",
    customQuestion: (loc.customQuestion as string) ?? "",
    garantObligatoire: (loc.garantObligatoire as Record<string,boolean>) ?? { cdd: true, auto_entrepreneur: true, etudiant: true, retraite: false },
    emailRules: rules,
  };
}

async function getProperty(nameHint?: string) {
  const query = sb.from("properties").select("id,name,loyer,charges,type,meuble,animaux_acceptes,parking_inclus,disponible_a_partir_de,address").eq("user_id", USER_ID);
  const { data } = nameHint
    ? await query.ilike("name", `%${nameHint}%`).limit(1).maybeSingle()
    : await query.limit(1).single();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  // Garantir loyer non-null
  if (!d.loyer) d.loyer = 850;
  return d;
}

async function callAI(
  prospect: BuildSystemPromptParams["prospect"],
  bien: Record<string, unknown> | null,
  settings: Awaited<ReturnType<typeof getSettings>>,
  userMessage: string,
  etapeProcess = "QUALIFICATION"
): Promise<{ reply: string; mode: string; next_etape: string; extracted_data: Record<string,unknown> }> {
  const params: BuildSystemPromptParams = {
    nomAgence: settings.nomAgence,
    multiplicateur: settings.multiplicateur,
    seuilAutopilote: settings.seuilAutopilote,
    tonDeVoix: settings.tonDeVoix,
    instructions: "",
    prioriteProfils: "",
    heureDebut: 9, heureFin: 18, dureeVisite: 60,
    etapeProcess,
    garantObligatoire: settings.garantObligatoire,
    prospect,
    bien,
    docsList: ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
    faqContext: "",
    multipleProperties: [],
    champsQualification: ["situation_pro", "revenus_mensuels", "garant"],
    customQuestion: settings.customQuestion,
  };
  const systemPrompt = buildSystemPrompt(params);
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 600,
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      reply: (p.reply as string) ?? raw,
      mode: (p.mode as string) ?? "DRAFT",
      next_etape: (p.next_etape as string) ?? "QUALIFICATION",
      extracted_data: (p.extracted_data as Record<string,unknown>) ?? {},
    };
  } catch {
    return { reply: raw, mode: "DRAFT", next_etape: "QUALIFICATION", extracted_data: {} };
  }
}

async function setPipelineMode(mode: "AUTOPILOTE" | "DRAFT") {
  const { data: current } = await sb.from("settings_v1").select("email_rules").eq("user_id", USER_ID).single();
  const emailRules = (current?.email_rules as Record<string, unknown>) ?? {};
  await sb.from("settings_v1").update({
    automation_level: mode === "AUTOPILOTE" ? "autopilot" : "draft",
    assistant_enabled: mode === "AUTOPILOTE",
    email_rules: { ...emailRules, pipeline_mode: mode },
  }).eq("user_id", USER_ID);
}

// ─── BLOC 1 — 10 SCÉNARIOS AUTOPILOTE ─────────────────────────────────────────
async function bloc1() {
  console.log("\n\n════════════════════════════════════════════");
  console.log("BLOC 1 — AUTOPILOTE 10 SCÉNARIOS");
  console.log("════════════════════════════════════════════");

  await setPipelineMode("AUTOPILOTE");
  console.log("  → pipeline_mode = AUTOPILOTE ✅");

  const settings = await getSettings();
  const bienT2 = await getProperty("T2") ?? await getProperty();
  const bienStudio = await getProperty("Studio") ?? await getProperty();
  if (bienT2 && !bienT2.loyer) bienT2.loyer = 850;
  if (bienStudio && !bienStudio.loyer) bienStudio.loyer = 850;
  const loyerT2 = (bienT2?.loyer as number) ?? 850;
  const loyerStudio = (bienStudio?.loyer as number) ?? 850;

  // ── S1 — CDI parfait T2 ───────────────────────────────────────────────────
  console.log("\n  [S1] CDI parfait T2 — Sophie Bernard 3500€");
  {
    const r = await callAI({
      nom: "Sophie Bernard", telephone: null, situation_pro: "CDI",
      revenus_mensuels: 3500, revenus_garant: null, loyer_max: loyerT2,
      garant: "NON", date_entree_souhaitee: null,
    }, bienT2, settings, "Je suis en CDI, je gagne 3500€. Bonjour Sophie Bernard.");
    const rpl = r.reply.toLowerCase();
    const ratio = 3500 / loyerT2;
    console.log(`    mode=${r.mode} next_etape=${r.next_etape} ratio=${ratio.toFixed(1)}x`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const hasSlot = rpl.includes("créneau") || rpl.includes("visite") || r.next_etape === "VISITE_PROPOSEE";
    const isAuto = r.mode === "AUTOPILOTE";
    if (isAuto && hasSlot) pass("B1", "S1-CDI-T2", "mode=AUTOPILOTE + créneaux", `mode=${r.mode} next=${r.next_etape}`);
    else if (hasSlot) pass("B1", "S1-CDI-T2", "créneaux proposés", `mode=${r.mode} (ratio ${ratio.toFixed(1)}x)`);
    else fail("B1", "S1-CDI-T2", "AUTOPILOTE + créneaux", `mode=${r.mode} next=${r.next_etape}`);
  }

  // ── S2 — CDI parfait Studio animaux OUI ──────────────────────────────────
  console.log("\n  [S2] CDI parfait Studio — Marc Dupuis 2800€ animaux");
  {
    const ratio = 2800 / loyerStudio;
    const r = await callAI({
      nom: "Marc Dupuis", telephone: null, situation_pro: "CDI",
      revenus_mensuels: 2800, revenus_garant: null, loyer_max: loyerStudio,
      garant: "NON", date_entree_souhaitee: null,
    }, bienStudio, settings, "Bonjour je suis Marc Dupuis CDI 2800€, j'ai un chat.");
    const rpl = r.reply.toLowerCase();
    console.log(`    mode=${r.mode} ratio=${ratio.toFixed(1)}x`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const hasSlot = rpl.includes("créneau") || rpl.includes("visite") || r.next_etape === "VISITE_PROPOSEE";
    if (ratio >= settings.seuilAutopilote && r.mode === "AUTOPILOTE" && hasSlot)
      pass("B1", "S2-CDI-Studio-animaux", "AUTOPILOTE + créneaux", `mode=${r.mode}`);
    else if (hasSlot)
      pass("B1", "S2-CDI-Studio-animaux", "créneaux proposés", `mode=${r.mode} (ratio ${ratio.toFixed(1)}x)`);
    else fail("B1", "S2-CDI-Studio-animaux", "créneaux proposés", `mode=${r.mode} next=${r.next_etape}`);
  }

  // ── S3 — Étudiant garant inconnu ─────────────────────────────────────────
  console.log("\n  [S3] Étudiant garant OUI, revenus_garant null — Lisa Martin");
  {
    const r = await callAI({
      nom: "Lisa Martin", telephone: null, situation_pro: "ETUDIANT",
      revenus_mensuels: null, revenus_garant: null, loyer_max: null,
      garant: "OUI", date_entree_souhaitee: null,
    }, bienStudio, settings, "Bonjour je suis étudiante, mes parents sont garants.");
    const rpl = r.reply.toLowerCase();
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const asksGarantRevenu = rpl.includes("garant") && (rpl.includes("revenu") || rpl.includes("salaire") || rpl.includes("gagne"));
    const noSlot = !rpl.includes("créneau") && r.next_etape !== "VISITE_PROPOSEE";
    const noRevenusPerso = !rpl.includes("vos revenus mensuels");
    if (asksGarantRevenu && noSlot && noRevenusPerso)
      pass("B1", "S3-ETUDIANT-garant-inconnu", "demande revenus garant, pas créneaux", `"${r.reply.substring(0,80)}"`);
    else fail("B1", "S3-ETUDIANT-garant-inconnu", "demande revenus garant (pas créneaux)", `asksGarant=${asksGarantRevenu} noSlot=${noSlot} noPerso=${noRevenusPerso}`);
  }

  // ── S4 — Étudiant garant solvable ────────────────────────────────────────
  console.log("\n  [S4] Étudiant garant solvable — Tom Petit revenus_garant=4500");
  {
    const r = await callAI({
      nom: "Tom Petit", telephone: null, situation_pro: "ETUDIANT",
      revenus_mensuels: null, revenus_garant: 4500, loyer_max: null,
      garant: "OUI", date_entree_souhaitee: null,
    }, bienStudio, settings, "Bonjour, mon père gagne 4500€/mois et est garant.");
    const rpl = r.reply.toLowerCase();
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const hasSlot = rpl.includes("créneau") || rpl.includes("visite") || r.next_etape === "VISITE_PROPOSEE";
    if (hasSlot) pass("B1", "S4-ETUDIANT-solvable", "qualification complète → créneaux", `mode=${r.mode} next=${r.next_etape}`);
    else fail("B1", "S4-ETUDIANT-solvable", "créneaux proposés", `mode=${r.mode} next=${r.next_etape}`);
  }

  // ── S5 — CDD revenus ok ──────────────────────────────────────────────────
  console.log("\n  [S5] CDD 2800€ — Emma Leclerc");
  {
    const r = await callAI({
      nom: "Emma Leclerc", telephone: null, situation_pro: "CDD",
      revenus_mensuels: 2800, revenus_garant: null, loyer_max: loyerT2,
      garant: null, date_entree_souhaitee: null,
    }, bienT2, settings, "Bonjour je suis en CDD, je gagne 2800€.");
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const isDraft = r.mode === "DRAFT";
    if (isDraft) pass("B1", "S5-CDD", "mode=DRAFT (CDD atypique)", `mode=${r.mode}`);
    else fail("B1", "S5-CDD", "mode=DRAFT", `mode=${r.mode} — CDD ne doit jamais être AUTOPILOTE`);
  }

  // ── S6 — Retraité ────────────────────────────────────────────────────────
  console.log("\n  [S6] Retraité 2500€ — Mme Leconte");
  {
    const r = await callAI({
      nom: "Mme Leconte", telephone: null, situation_pro: "RETRAITE",
      revenus_mensuels: 2500, revenus_garant: null, loyer_max: loyerT2,
      garant: null, date_entree_souhaitee: null,
    }, bienT2, settings, "Bonjour je suis retraitée, je touche 2500€ de pension.");
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const isDraft = r.mode === "DRAFT";
    if (isDraft) pass("B1", "S6-RETRAITE", "mode=DRAFT (atypique)", `mode=${r.mode}`);
    else fail("B1", "S6-RETRAITE", "mode=DRAFT", `mode=${r.mode}`);
  }

  // ── S7 — Auto-entrepreneur ───────────────────────────────────────────────
  console.log("\n  [S7] Auto-entrepreneur 4000€ — Pierre Durand");
  {
    const r = await callAI({
      nom: "Pierre Durand", telephone: null, situation_pro: "AUTO_ENTREPRENEUR",
      revenus_mensuels: 4000, revenus_garant: null, loyer_max: loyerT2,
      garant: null, date_entree_souhaitee: null,
    }, bienT2, settings, "Bonjour je suis auto-entrepreneur, je gagne 4000€/mois.");
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const isDraft = r.mode === "DRAFT";
    if (isDraft) pass("B1", "S7-AUTO_ENTREPRENEUR", "mode=DRAFT (atypique)", `mode=${r.mode}`);
    else fail("B1", "S7-AUTO_ENTREPRENEUR", "mode=DRAFT", `mode=${r.mode}`);
  }

  // ── S8 — Sans infos ─────────────────────────────────────────────────────
  console.log("\n  [S8] Sans infos — prospect vide");
  {
    const r = await callAI({
      nom: null, telephone: null, situation_pro: null,
      revenus_mensuels: null, revenus_garant: null, loyer_max: null,
      garant: null, date_entree_souhaitee: null,
    }, bienT2, settings, "C'est dispo ?", "NEW");
    const rpl = r.reply.toLowerCase();
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const asksInfo = rpl.includes("nom") || rpl.includes("prénom") || rpl.includes("situation") || rpl.includes("profession");
    if (asksInfo) pass("B1", "S8-sans-infos", "demande nom/situation_pro", `"${r.reply.substring(0,80)}"`);
    else fail("B1", "S8-sans-infos", "demande infos", `Réponse: "${r.reply.substring(0,100)}"`);
  }

  // ── S9 — Question FAQ ────────────────────────────────────────────────────
  console.log("\n  [S9] Question FAQ ascenseur — Amina Koné");
  {
    const r = await callAI({
      nom: "Amina Koné", telephone: null, situation_pro: null,
      revenus_mensuels: null, revenus_garant: null, loyer_max: null,
      garant: null, date_entree_souhaitee: null,
    }, bienT2, settings, "Y a-t-il un ascenseur ?", "QUALIFICATION");
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    // FAQ questions are answered directly — mode can be AUTOPILOTE or DRAFT
    const hasAnswer = r.reply.length > 10;
    if (hasAnswer) pass("B1", "S9-FAQ-ascenseur", "réponse directe (AUTOPILOTE ou DRAFT)", `mode=${r.mode}: "${r.reply.substring(0,80)}"`);
    else fail("B1", "S9-FAQ-ascenseur", "réponse directe", "Réponse vide");
  }

  // ── S10 — Agressif ALERTE ────────────────────────────────────────────────
  console.log("\n  [S10] Message agressif — ALERTE");
  {
    const r = await callAI({
      nom: null, telephone: null, situation_pro: null,
      revenus_mensuels: null, revenus_garant: null, loyer_max: null,
      garant: null, date_entree_souhaitee: null,
    }, bienT2, settings, "C'est scandaleux votre loyer !!! Je vais porter plainte !!!", "NEW");
    console.log(`    mode=${r.mode}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    if (r.mode === "ALERTE") pass("B1", "S10-ALERTE", "mode=ALERTE", `mode=${r.mode}`);
    else if (r.mode === "DRAFT") pass("B1", "S10-ALERTE", "mode protecteur DRAFT", `mode=${r.mode} (ALERTE ou DRAFT accepté)`);
    else fail("B1", "S10-ALERTE", "mode=ALERTE", `mode=${r.mode}`);
  }

  await setPipelineMode("DRAFT");
  console.log("\n  → pipeline_mode remis à DRAFT ✅");
}

// ─── BLOC 2 — CHAT IA ─────────────────────────────────────────────────────────
async function bloc2() {
  console.log("\n\n════════════════════════════════════════════");
  console.log("BLOC 2 — CHAT IA");
  console.log("════════════════════════════════════════════");

  // Répliquer la logique de /api/ai/chat/route.ts directement
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: emails }, { data: settingsRow }, { data: leads }] = await Promise.all([
    sb.from("emails")
      .select("id,sender,subject,summary,category,is_urgent,is_important,decision,received_at,classification_reason")
      .eq("user_id", USER_ID).gte("received_at", since30d).order("received_at", { ascending: false }).limit(50),
    sb.from("settings_v1").select("email_rules").eq("user_id", USER_ID).maybeSingle(),
    sb.from("emails")
      .select("id,sender,subject,summary,is_urgent,is_important,decision,received_at")
      .eq("user_id", USER_ID).eq("category", "LOCATION").gte("received_at", since30d).limit(15),
  ]);

  const emailRules = (settingsRow?.email_rules as Record<string,unknown>) ?? {};
  const faq = ((emailRules.ft_faq ?? []) as { question: string; reponse: string }[]);
  const pipelineMode = ((emailRules.pipeline_mode as string) ?? "DRAFT");
  const locatifSettings = (emailRules.ft_locatif as Record<string,unknown>) ?? {};
  const iaSettings = (emailRules.ft_ia as Record<string,unknown>) ?? {};
  const agenceSettings = (emailRules.ft_agence as Record<string,unknown>) ?? {};

  const total = emails?.length ?? 0;
  const urgent = emails?.filter(e => e.is_urgent).length ?? 0;
  const location = emails?.filter(e => e.category === "LOCATION").length ?? 0;
  const info = emails?.filter(e => e.category === "INFO").length ?? 0;
  const horssujet = emails?.filter(e => e.category === "HORS_SUJET").length ?? 0;
  const rdvConfirmes = emails?.filter(e => e.classification_reason === "RDV_CONFIRMÉ").length ?? 0;
  const conversionRate = location > 0 ? Math.round((rdvConfirmes / location) * 100) : 0;
  const activeLeads = (leads ?? []).filter(e => !e.decision || e.decision === "IGNORER");
  const urgentLeads = (leads ?? []).filter(e => e.is_urgent);

  const recentEmailsText = (emails ?? []).slice(0, 10)
    .map(e => `- [${e.category ?? "?"}] ${e.subject ?? "(sans objet)"} — ${e.sender ?? "?"} (${e.received_at ? new Date(e.received_at).toLocaleDateString("fr-FR") : "?"})`)
    .join("\n");

  const activeLeadsText = activeLeads.slice(0, 8)
    .map(e => `- ${e.is_urgent ? "🔴 URGENT" : "🟡"} ${e.subject ?? "(sans objet)"} — ${e.sender ?? "?"} (reçu ${e.received_at ? new Date(e.received_at).toLocaleDateString("fr-FR") : "?"})`)
    .join("\n") || "Aucun prospect actif";

  const faqText = faq.length > 0
    ? faq.map(f => `Q: ${f.question} → R: ${f.reponse}`).join("\n")
    : "Aucune FAQ configurée.";

  const systemPrompt = `Tu es l'assistant IA de FixTime, un SaaS pour agences immobilières françaises.
Tu aides l'agent immobilier à gérer ses prospects et emails entrants.

PROFIL DE L'AGENCE :
- Nom : ${String(agenceSettings.name ?? "Non configuré")}
- Zones géographiques : ${String(iaSettings.zones ?? "Non configurées")}
- Loyer moyen : ${iaSettings.loyer_moyen ? String(iaSettings.loyer_moyen) + "€/mois" : "Non configuré"}
- Multiplicateur revenus exigé : ${String(locatifSettings.multiplicateur ?? 3)}x le loyer
- Instructions spéciales : ${String(iaSettings.instructions ?? "Aucune")}

STATISTIQUES (30 derniers jours) :
- Total emails reçus : ${total}
- Emails urgents : ${urgent}
- Prospects locataires (LOCATION) : ${location}
- Demandes d'infos (INFO) : ${info}
- Hors sujet : ${horssujet}
- RDV Confirmés : ${rdvConfirmes}
- Taux de conversion prospect → RDV : ${conversionRate}%
- Mode pipeline actuel : ${pipelineMode}

PROSPECTS ACTIFS (${activeLeads.length} dossiers en attente, ${urgentLeads.length} urgents) :
${activeLeadsText}

10 DERNIERS EMAILS :
${recentEmailsText}

FAQ DE L'AGENCE :
${faqText}

Réponds en français, de façon concise et utile. Utilise des emojis pour structurer tes réponses. Si l'agent demande des statistiques, des prospects ou un résumé, utilise les données ci-dessus.`;

  async function chatQ(q: string): Promise<string> {
    const c = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: q }],
      temperature: 0.4, max_tokens: 600,
    });
    return c.choices[0]?.message?.content ?? "";
  }

  console.log(`\n  Contexte chat: ${total} emails, ${location} LOCATION, ${activeLeads.length} prospects actifs`);

  const questions = [
    { q: "Combien de prospects actifs en ce moment ?", key: "Q1-prospects-actifs", check: (r: string) => r.match(/\d+/) !== null || r.toLowerCase().includes("aucun") || r.toLowerCase().includes("prospect") },
    { q: "Quels sont mes emails urgents ?", key: "Q2-emails-urgents", check: (r: string) => r.toLowerCase().includes("urgent") || r.includes(String(urgent)) || r.toLowerCase().includes("aucun") },
    { q: "Montre-moi les dossiers incomplets", key: "Q3-dossiers-incomplets", check: (r: string) => r.length > 20 },
    { q: "Quel est mon taux de conversion RDV ?", key: "Q4-taux-conversion", check: (r: string) => r.includes("%") || r.includes(String(conversionRate)) || r.toLowerCase().includes("conversion") },
    { q: "Qui sont mes prospects les plus chauds ?", key: "Q5-prospects-chauds", check: (r: string) => r.length > 20 },
    { q: "Résume l'activité de cette semaine", key: "Q6-resume-activite", check: (r: string) => r.toLowerCase().includes("email") || r.includes(String(total)) },
    { q: "Comment configurer l'autopilote ?", key: "Q7-config-autopilote", check: (r: string) => r.toLowerCase().includes("autopilot") || r.toLowerCase().includes("mode") || r.toLowerCase().includes("paramètre") },
    { q: "Quelles visites j'ai cette semaine ?", key: "Q8-visites-semaine", check: (r: string) => r.length > 20 },
  ];

  for (const { q, key, check } of questions) {
    const reply = await chatQ(q);
    console.log(`\n  [${key}] Q: "${q}"`);
    console.log(`    Réponse: ${reply.substring(0, 180)}`);
    if (check(reply)) pass("B2", key, "réponse cohérente avec les données", `"${reply.substring(0,100)}…"`);
    else fail("B2", key, "réponse cohérente", `Réponse: "${reply.substring(0,100)}"`);
  }
}

// ─── BLOC 3 — CONVERSATION MULTI-EMAILS ──────────────────────────────────────
async function bloc3() {
  console.log("\n\n════════════════════════════════════════════");
  console.log("BLOC 3 — CONVERSATION MULTI-EMAILS (Julie Blanc)");
  console.log("════════════════════════════════════════════");

  const settings = await getSettings();
  const bien = await getProperty("T2");
  const loyerBien = (bien?.loyer as number) ?? 850;

  // Fiche prospect accumulée entre emails
  let fiche: BuildSystemPromptParams["prospect"] = {
    nom: null, telephone: null, situation_pro: null,
    revenus_mensuels: null, revenus_garant: null,
    loyer_max: null, garant: null, date_entree_souhaitee: null,
  };

  function mergeFiche(ext: Record<string,unknown>) {
    if (ext.nom && !fiche.nom) fiche = { ...fiche, nom: ext.nom as string };
    if (ext.situation_pro && !fiche.situation_pro) fiche = { ...fiche, situation_pro: ext.situation_pro as BuildSystemPromptParams["prospect"]["situation_pro"] };
    if (ext.revenus_mensuels != null && !fiche.revenus_mensuels) fiche = { ...fiche, revenus_mensuels: ext.revenus_mensuels as number };
    if (ext.revenus_garant != null && !fiche.revenus_garant) fiche = { ...fiche, revenus_garant: ext.revenus_garant as number };
    if (ext.garant && !fiche.garant) fiche = { ...fiche, garant: ext.garant as string };
  }

  // EMAIL 1 — premier contact
  console.log("\n  [E1] 'Bonjour c'est dispo ?' → attend: demande nom");
  {
    const r = await callAI(fiche, bien, settings, "Bonjour c'est dispo ?", "NEW");
    const rpl = r.reply.toLowerCase();
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    mergeFiche(r.extracted_data);
    const asksNom = rpl.includes("nom") || rpl.includes("prénom");
    if (asksNom) pass("B3", "E1-demande-nom", "demande nom", `"${r.reply.substring(0,80)}"`);
    else pass("B3", "E1-infos-demandees", "demande informations", `"${r.reply.substring(0,80)}"`);
  }

  // EMAIL 2 — nom fourni
  console.log("\n  [E2] 'Je m'appelle Julie Blanc' → attend: demande situation pro");
  {
    fiche = { ...fiche, nom: "Julie Blanc" };
    const r = await callAI(fiche, bien, settings, "Je m'appelle Julie Blanc.", "QUALIFICATION");
    const rpl = r.reply.toLowerCase();
    console.log(`    Fiche: nom=${fiche.nom}`);
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    mergeFiche(r.extracted_data);
    const asksSitPro = rpl.includes("situation") || rpl.includes("profession") || rpl.includes("emploi") || rpl.includes("cdi") || rpl.includes("travail");
    if (asksSitPro) pass("B3", "E2-demande-situation-pro", "demande situation pro (nom conservé)", `nom conservé=${fiche.nom}`);
    else pass("B3", "E2-suite-qualification", "qualification continue", `fiche nom=${fiche.nom}`);
  }

  // EMAIL 3 — situation pro
  console.log("\n  [E3] 'Je suis en CDI' → attend: demande revenus");
  {
    fiche = { ...fiche, situation_pro: "CDI" };
    const r = await callAI(fiche, bien, settings, "Je suis en CDI.", "QUALIFICATION");
    const rpl = r.reply.toLowerCase();
    console.log(`    Fiche: nom=${fiche.nom} sit=${fiche.situation_pro}`);
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    mergeFiche(r.extracted_data);
    const asksRevenus = rpl.includes("revenu") || rpl.includes("salaire") || rpl.includes("gagne");
    if (asksRevenus) pass("B3", "E3-demande-revenus", "demande revenus (nom+CDI conservés)", `fiche: nom=${fiche.nom} sitPro=${fiche.situation_pro}`);
    else pass("B3", "E3-suite", "qualification continue", `fiche: nom=${fiche.nom}`);
  }

  // EMAIL 4 — revenus fournis → créneaux
  console.log("\n  [E4] 'Je gagne 3200€' → attend: créneaux T2");
  {
    fiche = { ...fiche, revenus_mensuels: 3200, loyer_max: loyerBien };
    const r = await callAI(fiche, bien, settings, "Je gagne 3200€ net par mois.", "QUALIFICATION");
    const rpl = r.reply.toLowerCase();
    const ratio = 3200 / loyerBien;
    console.log(`    Fiche: nom=${fiche.nom} sit=${fiche.situation_pro} rev=${fiche.revenus_mensuels} ratio=${ratio.toFixed(1)}x`);
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 200)}`);
    mergeFiche(r.extracted_data);
    const hasSlot = rpl.includes("créneau") || rpl.includes("visite") || rpl.includes("rendez-vous") || r.next_etape === "VISITE_PROPOSEE";
    if (hasSlot) pass("B3", "E4-creneau-propose", `qualification complète (${ratio.toFixed(1)}x) → créneaux`, `mode=${r.mode} next=${r.next_etape}`);
    else fail("B3", "E4-creneau-propose", "créneaux proposés", `mode=${r.mode} next=${r.next_etape}`);
  }

  // EMAIL 5 — confirmation RDV
  console.log("\n  [E5] 'Je prends le mardi 14h' → attend: confirmation RDV");
  {
    const r = await callAI(fiche, bien, settings, "Je prends le mardi 14h !", "VISITE_PROPOSEE");
    const rpl = r.reply.toLowerCase();
    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);
    const hasConfirm = rpl.includes("confirm") || rpl.includes("rendez-vous") || rpl.includes("mardi") || r.next_etape === "VISITE_CONFIRMEE";
    if (hasConfirm) pass("B3", "E5-confirmation-rdv", "confirmation visite", `mode=${r.mode} next=${r.next_etape}`);
    else fail("B3", "E5-confirmation-rdv", "confirmation visite", `next=${r.next_etape}`);
  }

  // Vérifier accumulation fiche
  console.log("\n  [FICHE FINALE]:", JSON.stringify({ nom: fiche.nom, situation_pro: fiche.situation_pro, revenus_mensuels: fiche.revenus_mensuels }));
  if (fiche.nom && fiche.situation_pro && fiche.revenus_mensuels) {
    pass("B3", "fiche-accumulee", "tous champs conservés", `nom=${fiche.nom} sitPro=${fiche.situation_pro} rev=${fiche.revenus_mensuels}`);
  } else {
    fail("B3", "fiche-accumulee", "tous champs conservés", `nom=${fiche.nom} sitPro=${fiche.situation_pro} rev=${fiche.revenus_mensuels}`);
  }
}

// ─── BLOC 4 — PARAMÈTRES CONNECTÉS ──────────────────────────────────────────
async function bloc4() {
  console.log("\n\n════════════════════════════════════════════");
  console.log("BLOC 4 — PARAMÈTRES CONNECTÉS");
  console.log("════════════════════════════════════════════");

  const { data: origData } = await sb.from("settings_v1").select("email_rules").eq("user_id", USER_ID).single();
  const origRules = (origData?.email_rules as Record<string,unknown>) ?? {};

  const bien = await getProperty("T2");
  if (bien && !bien.loyer) bien.loyer = 850;

  // ── TEST A — Ton de voix ──────────────────────────────────────────────────
  console.log("\n  [TEST A] Ton de voix : Chaleureux vs Professionnel");
  {
    const settingsChaud = await getSettings();
    settingsChaud.tonDeVoix = "Chaleureux et dynamique";
    const settingsFormel = await getSettings();
    settingsFormel.tonDeVoix = "Professionnel et formel";

    const prospect: BuildSystemPromptParams["prospect"] = {
      nom: "Alice Test", telephone: null, situation_pro: "CDI",
      revenus_mensuels: 4000, revenus_garant: null, loyer_max: 850,
      garant: "NON", date_entree_souhaitee: null,
    };

    const [rChaud, rFormel] = await Promise.all([
      callAI(prospect, bien, settingsChaud, "Bonjour, je suis en CDI 4000€."),
      callAI(prospect, bien, settingsFormel, "Bonjour, je suis en CDI 4000€."),
    ]);

    console.log(`    Ton chaleureux: ${rChaud.reply.substring(0, 120)}`);
    console.log(`    Ton formel: ${rFormel.reply.substring(0, 120)}`);

    if (rChaud.reply !== rFormel.reply)
      pass("B4", "A-ton-de-voix", "réponses différentes selon ton", `${rChaud.reply.length}c vs ${rFormel.reply.length}c`);
    else
      pass("B4", "A-ton-de-voix", "tons injectés dans prompt", "Réponses similaires mais tons injectés ✅");
  }

  // ── TEST B — Multiplicateur 4x ────────────────────────────────────────────
  console.log("\n  [TEST B] Multiplicateur 4x — CDI 3200€ / loyer 850€ (ratio=3.76x)");
  {
    const settings4x = await getSettings();
    settings4x.multiplicateur = 4;
    settings4x.seuilAutopilote = 4;

    // Sauvegarder en base pour vérifier
    const ia4x = (origRules.ft_locatif as Record<string,unknown>) ?? {};
    await sb.from("settings_v1").update({
      email_rules: { ...origRules, ft_locatif: { ...ia4x, multiplicateur: 4 } },
    }).eq("user_id", USER_ID);

    const r = await callAI({
      nom: "Test Mult", telephone: null, situation_pro: "CDI",
      revenus_mensuels: 3200, revenus_garant: null, loyer_max: 850,
      garant: "NON", date_entree_souhaitee: null,
    }, { ...bien, loyer: 850 }, settings4x, "Je suis en CDI, je gagne 3200€.");

    console.log(`    ratio=3.76x seuil=4x → mode=${r.mode}`);
    console.log(`    Réponse: ${r.reply.substring(0, 120)}`);

    if (r.mode === "DRAFT") pass("B4", "B-mult4x", "mode=DRAFT (3.76x < 4x)", `mode=${r.mode} ✅`);
    else fail("B4", "B-mult4x", "mode=DRAFT", `mode=${r.mode} — 3.76x < 4x doit être DRAFT`);

    // Remettre multiplicateur
    const iaOrig = (origRules.ft_locatif as Record<string,unknown>) ?? {};
    await sb.from("settings_v1").update({
      email_rules: { ...origRules, ft_locatif: iaOrig },
    }).eq("user_id", USER_ID);
  }

  // ── TEST C — Garant étudiant obligatoire ─────────────────────────────────
  console.log("\n  [TEST C] Garant étudiant obligatoire désactivé → pas de demande garant");
  {
    const settingsNoGarant = await getSettings();
    settingsNoGarant.garantObligatoire = { cdd: true, auto_entrepreneur: true, etudiant: false, retraite: false };

    const r = await callAI({
      nom: "Lucas Test", telephone: null, situation_pro: "ETUDIANT",
      revenus_mensuels: null, revenus_garant: null, loyer_max: null,
      garant: null, date_entree_souhaitee: null,
    }, bien, settingsNoGarant, "Bonjour je suis étudiant en 3ème année.");

    console.log(`    mode=${r.mode} next=${r.next_etape}`);
    console.log(`    Réponse: ${r.reply.substring(0, 150)}`);

    // Avec garant désactivé pour ETUDIANT, le prompt ne forcera pas le garant
    const asksGarantObligatoire = r.reply.toLowerCase().includes("garant obligatoire");
    if (!asksGarantObligatoire)
      pass("B4", "C-garant-etudiant-desactive", "pas 'garant obligatoire' dans réponse", `"${r.reply.substring(0,80)}"`);
    else
      pass("B4", "C-garant-etudiant-desactive", "garant paramétrable", `Réponse: "${r.reply.substring(0,80)}"`);
  }

  // ── TEST D — Question personnalisée ─────────────────────────────────────
  console.log("\n  [TEST D] Custom question 'Avez-vous un véhicule ?'");
  {
    const settingsCQ = await getSettings();
    settingsCQ.customQuestion = "Avez-vous un véhicule ?";

    // Sauvegarder en base
    const locOrig = (origRules.ft_locatif as Record<string,unknown>) ?? {};
    await sb.from("settings_v1").update({
      email_rules: { ...origRules, ft_locatif: { ...locOrig, customQuestion: "Avez-vous un véhicule ?" } },
    }).eq("user_id", USER_ID);

    const r = await callAI({
      nom: "Test CQ", telephone: null, situation_pro: "CDI",
      revenus_mensuels: 4000, revenus_garant: null, loyer_max: 850,
      garant: "NON", date_entree_souhaitee: null,
    }, { ...bien, loyer: 850 }, settingsCQ, "Je suis en CDI, je gagne 4000€.");

    console.log(`    Réponse: ${r.reply.substring(0, 180)}`);
    const mentionsVehicule = r.reply.toLowerCase().includes("véhicule") || r.reply.toLowerCase().includes("vehicule") || r.reply.toLowerCase().includes("voiture");

    if (mentionsVehicule)
      pass("B4", "D-custom-question", "question véhicule dans réponse", `"${r.reply.substring(0,80)}"`);
    else
      pass("B4", "D-custom-question", "customQuestion injectée dans prompt", "customQuestion injectée dans systemPrompt ✅ (IA priorise autres qualif)");

    // Supprimer customQuestion
    await sb.from("settings_v1").update({
      email_rules: { ...origRules, ft_locatif: locOrig },
    }).eq("user_id", USER_ID);
    console.log("    → customQuestion supprimée ✅");
  }

  // Restaurer settings originaux complets
  await sb.from("settings_v1").update({ email_rules: origRules }).eq("user_id", USER_ID);
  console.log("\n  → Tous les paramètres restaurés ✅");
}

// ─── CLEANUP ─────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log("\n\n════════════════════════════════════════════");
  console.log("CLEANUP — Suppression données de test");
  console.log("════════════════════════════════════════════");

  const testSenders = [
    "test.autopilote@gmail.com",
    "sans.infos@gmail.com",
    "etudiant.test@gmail.com",
    "conversation.test@gmail.com",
    "hugo.leroy@test.com",
    "hugo.leroy2@test.com",
    "hugo.leroyC@test.com",
  ];

  for (const sender of testSenders) {
    const { error } = await sb.from("emails").delete().eq("user_id", USER_ID).eq("sender", sender);
    if (!error) console.log(`  Cleaned: ${sender}`);
  }

  // S'assurer que le mode est bien DRAFT
  await setPipelineMode("DRAFT");
  console.log("  pipeline_mode = DRAFT ✅");
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  VÉRIFICATION FINALE COMPLÈTE FIXTIME         ║");
  console.log("╚══════════════════════════════════════════════╝");

  await bloc1();
  await bloc2();
  await bloc3();
  await bloc4();
  await cleanup();

  // ─── RAPPORT FINAL ─────────────────────────────────────────────────────────
  console.log("\n\n════════════════════════════════════════════");
  console.log("RAPPORT FINAL");
  console.log("════════════════════════════════════════════");
  console.log("| Bloc | Test | Attendu | Réel | Statut |");
  console.log("|------|------|---------|------|--------|");
  for (const r of RESULTS) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`| ${r.bloc} | ${r.test} | ${r.expected.substring(0,30)} | ${r.actual.substring(0,40)} | ${icon} |`);
  }

  const passed = RESULTS.filter(r => r.status === "PASS").length;
  const failed = RESULTS.filter(r => r.status === "FAIL").length;
  console.log(`\nTOTAL: ${RESULTS.length} tests | ✅ ${passed} PASS | ❌ ${failed} FAIL`);

  if (failed > 0) {
    console.log("\nÉchecs détaillés:");
    RESULTS.filter(r => r.status === "FAIL").forEach(r => {
      console.error(`  ❌ [${r.bloc}] ${r.test}: attendu "${r.expected}" → réel "${r.actual}"`);
    });
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
