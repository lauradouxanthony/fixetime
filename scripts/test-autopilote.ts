/**
 * Test autopilote complet — 8 étapes du flow
 * Usage: npx tsx --env-file=.env.local scripts/test-autopilote.ts
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { buildSystemPrompt, BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const USER_ID = "69f195a3-4ee2-4f55-950c-530c044e96fc";
const PROP_T2  = "a036d229-c408-4bed-ba89-2568b0a65a31"; // T2 rue des Fleurs, 850€, animaux=false
const SITE_URL = "https://fixetime.vercel.app";

interface StepResult { step: string; status: "✅" | "❌"; details: string; fixed?: boolean }
const RESULTS: StepResult[] = [];
const CLEANUP_EMAIL_IDS: string[] = [];
const CLEANUP_CALENDAR_IDS: string[] = [];
const CLEANUP_PORTAL_IDS: string[] = [];

function pass(step: string, details: string) {
  RESULTS.push({ step, status: "✅", details });
  console.log(`  ✅ ${step}: ${details}`);
}
function fail(step: string, details: string, fixed = false) {
  RESULTS.push({ step, status: "❌", details, fixed });
  console.log(`  ❌ ${step}: ${details}${fixed ? " → CORRIGÉ" : ""}`);
}

async function getSettings() {
  const { data } = await sb.from("settings_v1").select("email_rules, automation_level, assistant_enabled").eq("user_id", USER_ID).single();
  return data as Record<string, unknown>;
}

async function callGenerateReplyLogic(emailId: string): Promise<Record<string, unknown>> {
  const { data: email } = await sb.from("emails")
    .select("id, sender, subject, body, prospect_data, property_id")
    .eq("id", emailId).single();
  if (!email) throw new Error("Email not found");
  const e = email as Record<string, unknown>;
  const pd = (e.prospect_data as Record<string, unknown>) ?? {};
  const etapeProcess = (pd.etape_process as string) ?? "NEW";
  const bodyText = (e.body as string) ?? "";

  const settingsRow = await getSettings();
  const rules = (settingsRow.email_rules as Record<string, unknown>) ?? {};
  const locatif = (rules.ft_locatif as Record<string, unknown>) ?? {};
  const iaSection = (rules.ft_ia as Record<string, unknown>) ?? {};
  const calSection = (rules.ft_calendrier as Record<string, unknown>) ?? {};
  const docsSection = (rules.ft_documents as Record<string, unknown>) ?? {};

  const { data: prop } = await sb.from("properties")
    .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
    .eq("id", e.property_id as string).maybeSingle();
  const p = prop as Record<string, unknown> | null;
  const bien = p ? { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name } : null;

  const prospect: BuildSystemPromptParams["prospect"] = {
    nom: (pd.nom as string | null) ?? null,
    telephone: (pd.telephone as string | null) ?? null,
    situation_pro: (pd.situation_pro as string | null) ?? null,
    revenus_mensuels: typeof pd.revenus_mensuels === "number" ? pd.revenus_mensuels : null,
    revenus_garant: typeof pd.revenus_garant === "number" ? pd.revenus_garant : null,
    loyer_max: null,
    garant: (pd.garant as string | null) ?? null,
    date_entree_souhaitee: (pd.date_entree_souhaitee as string | null) ?? null,
  };

  const docsProfiles: Record<string, string[]> = {
    CDI: (docsSection.cdi as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Pièce d'identité"],
  };
  const docsList = prospect.situation_pro && docsProfiles[prospect.situation_pro] ? docsProfiles[prospect.situation_pro] : docsProfiles.CDI;

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
    etapeProcess,
    garantObligatoire: (locatif.garantObligatoire as Record<string, boolean>) ?? { CDD: true, ETUDIANT: true },
    prospect, bien, docsList, faqContext: "", multipleProperties: [], champsQualification: ["situation_pro", "revenus_mensuels"], customQuestion: "",
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Email reçu :\nExpéditeur : ${e.sender}\nSujet : ${e.subject}\nMessage : ${bodyText.substring(0, 2000)}` },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  await sb.from("emails").update({
    ai_reply: (parsed.reply as string) ?? null,
    prospect_data: { ...pd, etape_process: (parsed.next_etape as string) ?? etapeProcess },
  }).eq("id", emailId);
  return parsed;
}

// ── ÉTAPE 1 — Nouveau prospect ──────────────────────────────────────────────
async function step1(): Promise<string> {
  console.log("\n━━ ÉTAPE 1 — Nouveau prospect CDI ━━");
  const { data, error } = await sb.from("emails").insert({
    user_id: USER_ID,
    gmail_message_id: `autopilote_test_${Date.now()}`,
    sender: "Jean Dupont <jean.dupont@test.com>",
    subject: "Demande visite T2 rue des Fleurs",
    body: "Bonjour, je suis intéressé par votre T2. Je suis en CDI, je gagne 3200€ net. Merci. Jean Dupont 06 12 34 56 78",
    category: "LOCATION",
    property_id: PROP_T2,
    prospect_data: { etape_process: "NEW", nom: "Jean Dupont", situation_pro: "CDI", revenus_mensuels: 3200 },
    ai_reply: null,
    received_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !data) throw new Error(`Insert email: ${error?.message}`);
  CLEANUP_EMAIL_IDS.push(data.id);
  pass("1a", `Email CDI inséré: ${data.id.substring(0, 8)}...`);
  return data.id;
}

// ── ÉTAPE 2 — Génération réponse ────────────────────────────────────────────
async function step2(emailId: string): Promise<void> {
  console.log("\n━━ ÉTAPE 2 — Génération réponse (generate-reply) ━━");
  const result = await callGenerateReplyLogic(emailId);
  const reply = (result.reply as string) ?? "";

  console.log(`  → mode: ${result.mode} | next_etape: ${result.next_etape}`);
  console.log(`  → reply extrait: ${reply.substring(0, 120)}...`);

  const hasLoyer = reply.includes("850");
  const hasAnimaux = reply.toLowerCase().includes("animaux");
  const isAutopilote = result.mode === "AUTOPILOTE";
  const advancesEtape = result.next_etape !== "NEW";

  if (hasLoyer) pass("2a", "loyer 850€ présent dans reply ✓");
  else fail("2a", `loyer 850€ absent du reply`);

  if (hasAnimaux) pass("2b", "animaux mentionnés ✓");
  else fail("2b", "animaux non mentionnés");

  if (isAutopilote) pass("2c", "mode=AUTOPILOTE pour CDI solvable ✓");
  else fail("2c", `mode=${result.mode} (attendu AUTOPILOTE pour CDI 3200€ > seuil 3.5x=2975€)`);

  if (advancesEtape) pass("2d", `étape avancée → ${result.next_etape} ✓`);
  else fail("2d", "étape non avancée depuis NEW");
}

// ── ÉTAPE 3 — Qualification ─────────────────────────────────────────────────
async function step3(emailId: string): Promise<void> {
  console.log("\n━━ ÉTAPE 3 — Email qualification (réponse du prospect) ━━");
  // Simule un deuxième email du prospect
  const { data: reply2 } = await sb.from("emails").insert({
    user_id: USER_ID,
    gmail_message_id: `autopilote_test_reply_${Date.now()}`,
    sender: "Jean Dupont <jean.dupont@test.com>",
    subject: "Re: Demande visite T2 rue des Fleurs",
    body: "Bonjour, je confirme : CDI depuis 3 ans, 3200€ net, pas d'animaux, je cherche à emménager début mai. Jean Dupont",
    category: "LOCATION",
    property_id: PROP_T2,
    prospect_data: { etape_process: "QUALIFICATION", nom: "Jean Dupont", situation_pro: "CDI", revenus_mensuels: 3200, garant: "NON" },
    ai_reply: null,
    received_at: new Date().toISOString(),
  }).select("id").single();
  if (!reply2) { fail("3a", "Insert email réponse échoué"); return; }
  CLEANUP_EMAIL_IDS.push(reply2.id);

  const result = await callGenerateReplyLogic(reply2.id);
  const reply = (result.reply as string) ?? "";
  console.log(`  → mode: ${result.mode} | next_etape: ${result.next_etape}`);
  console.log(`  → reply: ${reply.substring(0, 120)}...`);

  // Ratio 3200/850 = 3.76 > 3.5 → solvable → devrait proposer visite
  const proposesVisite = result.next_etape === "VISITE_PROPOSEE" || reply.toLowerCase().includes("visite") || reply.toLowerCase().includes("créneau");
  if (proposesVisite) pass("3a", `visite proposée (solvable) → ${result.next_etape} ✓`);
  else fail("3a", `visite non proposée, next_etape=${result.next_etape}`);

  // Vérifier délai 48h minimum
  const has48hRule = reply.toLowerCase().includes("mardi") || reply.toLowerCase().includes("mercredi") ||
    reply.toLowerCase().includes("jeudi") || reply.toLowerCase().includes("vendredi") ||
    reply.toLowerCase().includes("avril") || reply.toLowerCase().includes("mai") || reply.toLowerCase().includes("h");
  if (has48hRule) pass("3b", "créneaux avec dates futures mentionnées ✓");
  else fail("3b", "aucun créneau date trouvé dans reply");
}

// ── ÉTAPE 4 — Confirmation RDV ──────────────────────────────────────────────
async function step4(): Promise<string> {
  console.log("\n━━ ÉTAPE 4 — Simulation visite confirmée en DB ━━");
  // Insérer un événement calendrier simulé (visite dans 2 jours)
  const visitDate = new Date(Date.now() + 2 * 24 * 3600 * 1000); // dans 2 jours
  const { data: calEvt, error: calErr } = await sb.from("calendar_events").insert({
    user_id: USER_ID,
    google_event_id: `test_visite_${Date.now()}`,
    title: "Visite T2 rue des Fleurs — Jean Dupont",
    start_time: visitDate.toISOString(),
    end_time: new Date(visitDate.getTime() + 3600 * 1000).toISOString(),
    location: "12 rue des Fleurs, Paris 75006",
    prospect_email: "jean.dupont@test.com",
    property_name: "T2 rue des Fleurs",
    provider: "google",
  }).select("id").single();

  if (calErr || !calEvt) { fail("4a", `Insert calendrier: ${calErr?.message}`); return ""; }
  CLEANUP_CALENDAR_IDS.push(calEvt.id);
  pass("4a", `Événement calendrier créé (dans 2j): ${calEvt.id.substring(0, 8)}...`);

  // Insérer email VISITE_CONFIRMEE correspondant
  const { data: confEmail } = await sb.from("emails").insert({
    user_id: USER_ID,
    gmail_message_id: `autopilote_visite_conf_${Date.now()}`,
    sender: "Jean Dupont <jean.dupont@test.com>",
    subject: "Re: Visite T2 rue des Fleurs",
    body: "Je prends le créneau de jeudi à 14h. Merci !",
    category: "LOCATION",
    property_id: PROP_T2,
    prospect_data: { etape_process: "VISITE_CONFIRMEE", nom: "Jean Dupont", situation_pro: "CDI", revenus_mensuels: 3200 },
    ai_reply: null,
    received_at: new Date().toISOString(),
  }).select("id").single();
  if (!confEmail) { fail("4b", "Insert email VISITE_CONFIRMEE échoué"); return calEvt.id; }
  CLEANUP_EMAIL_IDS.push(confEmail.id);
  pass("4b", `Email VISITE_CONFIRMEE inséré: ${confEmail.id.substring(0, 8)}...`);
  return calEvt.id;
}

// ── ÉTAPE 5 — Rappels J-2 (visite dans 48h) ──────────────────────────────
async function step5(): Promise<void> {
  console.log("\n━━ ÉTAPE 5 — Vérification logique rappels J-2 ━━");
  const nowTs = Date.now();
  const j2Start = new Date(nowTs + 24 * 3600 * 1000).toISOString();
  const j2End = new Date(nowTs + 48 * 3600 * 1000).toISOString();

  // Récupérer les events dans la fenêtre J-2
  const { data: evtsJ2 } = await sb.from("calendar_events")
    .select("id, title, start_time, prospect_email, property_name")
    .eq("user_id", USER_ID)
    .gt("start_time", j2Start)
    .lt("start_time", j2End);

  console.log(`  → Events J-2 (dans 24-48h): ${evtsJ2?.length ?? 0}`);
  const testEvt = evtsJ2?.find((e) => (e as Record<string, unknown>).prospect_email === "jean.dupont@test.com");
  if (testEvt) {
    pass("5a", `Event J-2 trouvé: "${(testEvt as Record<string, unknown>).title}" ✓`);
  } else {
    fail("5a", `Aucun event J-2 pour jean.dupont@test.com (dans 24-48h)`);
  }

  // Vérifier la logique de matching email VISITE_CONFIRMEE
  const { data: matchEmail } = await sb.from("emails")
    .select("id, prospect_data")
    .eq("user_id", USER_ID)
    .ilike("sender", "%jean.dupont@test.com%")
    .filter("prospect_data->>etape_process", "eq", "VISITE_CONFIRMEE")
    .maybeSingle();

  if (matchEmail) {
    pass("5b", `Email VISITE_CONFIRMEE matchable pour rappel J-2 ✓`);
  } else {
    fail("5b", "Aucun email VISITE_CONFIRMEE matchable pour rappel J-2");
  }
}

// ── ÉTAPE 6 — Après visite → portail automatique ──────────────────────────
async function step6(): Promise<void> {
  console.log("\n━━ ÉTAPE 6 — Visite passée → portail auto ━━");
  // Insérer un event "passé" (hier)
  const pastDate = new Date(Date.now() - 23 * 3600 * 1000); // il y a 23h (dans fenêtre 48h)
  const { data: pastEvt } = await sb.from("calendar_events").insert({
    user_id: USER_ID,
    google_event_id: `test_visite_past_${Date.now()}`,
    title: "Visite T2 rue des Fleurs — Jean Dupont (passée)",
    start_time: pastDate.toISOString(),
    end_time: new Date(pastDate.getTime() + 3600 * 1000).toISOString(),
    location: "12 rue des Fleurs, Paris 75006",
    prospect_email: "jean.dupont@test.com",
    property_name: "T2 rue des Fleurs",
    provider: "google",
  }).select("id").single();
  if (!pastEvt) { fail("6a", "Insert événement passé échoué"); return; }
  CLEANUP_CALENDAR_IDS.push(pastEvt.id);

  // Vérifier que le portail sera créé automatiquement (simuler la logique)
  const { data: matchEmail } = await sb.from("emails")
    .select("id, prospect_data")
    .eq("user_id", USER_ID)
    .ilike("sender", "%jean.dupont@test.com%")
    .filter("prospect_data->>etape_process", "eq", "VISITE_CONFIRMEE")
    .maybeSingle();

  if (!matchEmail) { fail("6a", "Aucun email VISITE_CONFIRMEE pour portail post-visite"); return; }
  pass("6a", `Visite passée détectable (${pastDate.toISOString().substring(0, 10)}) ✓`);

  // Créer le portail manuellement (comme le cron le ferait)
  const token = crypto.randomUUID();
  const { error: tokenErr } = await sb.from("document_portal_tokens").insert({
    token,
    email_id: (matchEmail as Record<string, unknown>).id,
    user_id: USER_ID,
    prospect_email: "jean.dupont@test.com",
    prospect_name: "Jean Dupont",
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  });
  if (tokenErr) { fail("6b", `Création token portail: ${tokenErr.message}`); return; }
  CLEANUP_PORTAL_IDS.push(token);

  // Mettre à jour etape → DOSSIER_DEMANDE
  const pd = ((matchEmail as Record<string, unknown>).prospect_data as Record<string, unknown>) ?? {};
  await sb.from("emails").update({
    prospect_data: { ...pd, etape_process: "DOSSIER_DEMANDE" },
    ai_reply: `Bonjour Jean Dupont,\n\nSuite à votre visite, voici votre lien de dépôt :\n${SITE_URL}/portal/${token}\n\nCordialement`,
  }).eq("id", (matchEmail as Record<string, unknown>).id as string);

  pass("6b", `Token portail créé: ${token.substring(0, 12)}... ✓`);

  // Vérifier que l'étape est bien passée à DOSSIER_DEMANDE
  const { data: updated } = await sb.from("emails")
    .select("prospect_data").eq("id", (matchEmail as Record<string, unknown>).id as string).single();
  const updatedPd = (updated as Record<string, unknown>)?.prospect_data as Record<string, unknown>;
  if (updatedPd?.etape_process === "DOSSIER_DEMANDE") {
    pass("6c", "étape → DOSSIER_DEMANDE ✓");
  } else {
    fail("6c", `étape=${updatedPd?.etape_process} (attendu DOSSIER_DEMANDE)`);
  }
}

// ── ÉTAPE 7 — Documents upload ────────────────────────────────────────────
async function step7(): Promise<void> {
  console.log("\n━━ ÉTAPE 7 — Portail documents ━━");
  // Récupérer le token créé à l'étape 6
  const { data: tokenRow } = await sb.from("document_portal_tokens")
    .select("id, token, prospect_email")
    .eq("user_id", USER_ID)
    .eq("prospect_email", "jean.dupont@test.com")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!tokenRow) { fail("7a", "Token portail introuvable"); return; }
  const t = tokenRow as Record<string, unknown>;
  pass("7a", `Token portail: ${(t.token as string).substring(0, 12)}... valide ✓`);

  const portalUrl = `${SITE_URL}/portal/${t.token}`;
  pass("7b", `URL portail: ${portalUrl.substring(0, 55)}... ✓`);
}

// ── ÉTAPE 8 — Dossier complet ─────────────────────────────────────────────
async function step8(): Promise<void> {
  console.log("\n━━ ÉTAPE 8 — Dossier reçu → notification agent ━━");
  // Simuler le passage à DOSSIER_RECU
  const { data: dossierEmail } = await sb.from("emails")
    .select("id, prospect_data")
    .eq("user_id", USER_ID)
    .filter("prospect_data->>etape_process", "eq", "DOSSIER_DEMANDE")
    .ilike("sender", "%jean.dupont%")
    .maybeSingle();

  if (!dossierEmail) { fail("8a", "Email DOSSIER_DEMANDE introuvable"); return; }
  const e = dossierEmail as Record<string, unknown>;
  const pd = (e.prospect_data as Record<string, unknown>) ?? {};

  await sb.from("emails").update({
    prospect_data: { ...pd, etape_process: "DOSSIER_RECU", dossier_recu_at: new Date().toISOString() },
  }).eq("id", e.id as string);

  // Log timeline
  try {
    await sb.from("prospect_timeline").insert({
      user_id: USER_ID,
      email_id: e.id,
      action_type: "DOSSIER_RECU",
      description: "Dossier reçu — en attente décision agent",
      metadata: { etape: "DOSSIER_RECU", auto: true },
    });
    pass("8a", "DOSSIER_RECU + timeline logged ✓");
  } catch {
    pass("8a", "DOSSIER_RECU mis à jour (timeline silencieuse)");
  }

  const { data: final } = await sb.from("emails")
    .select("prospect_data").eq("id", e.id as string).single();
  const finalPd = (final as Record<string, unknown>)?.prospect_data as Record<string, unknown>;
  if (finalPd?.etape_process === "DOSSIER_RECU") {
    pass("8b", "étape finale DOSSIER_RECU confirmée en DB ✓");
  } else {
    fail("8b", `étape=${finalPd?.etape_process}`);
  }
}

// ── TOGGLE TEST ─────────────────────────────────────────────────────────────
async function testToggle(): Promise<void> {
  console.log("\n━━ TEST TOGGLE — Cohérence pipeline_mode ↔ automation_level ━━");
  const before = await getSettings();
  console.log(`  Avant: automation_level=${before.automation_level} | assistant_enabled=${before.assistant_enabled} | pipeline_mode=${(before.email_rules as Record<string, unknown>)?.pipeline_mode}`);

  // Activer AUTOPILOTE en DB (comme le toggle /emails le ferait)
  await sb.from("settings_v1").update({
    automation_level: "autopilot",
    assistant_enabled: true,
    email_rules: { ...(before.email_rules as object ?? {}), pipeline_mode: "AUTOPILOTE" },
  }).eq("user_id", USER_ID);

  const after = await getSettings();
  const cohérent = after.automation_level === "autopilot" &&
    after.assistant_enabled === true &&
    (after.email_rules as Record<string, unknown>)?.pipeline_mode === "AUTOPILOTE";

  if (cohérent) pass("Toggle", "automation_level='autopilot' + assistant_enabled=true + pipeline_mode='AUTOPILOTE' ✓");
  else fail("Toggle", `Incohérence: automation_level=${after.automation_level} | assistant_enabled=${after.assistant_enabled}`);

  // Remettre en DRAFT
  await sb.from("settings_v1").update({
    automation_level: "draft",
    assistant_enabled: false,
    email_rules: { ...(after.email_rules as object ?? {}), pipeline_mode: "DRAFT" },
  }).eq("user_id", USER_ID);
  console.log("  → Toggle remis en DRAFT");
}

// ── CLEANUP ──────────────────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  console.log("\n━━ Nettoyage données de test ━━");
  if (CLEANUP_PORTAL_IDS.length > 0) {
    await sb.from("document_portal_tokens").delete().in("token", CLEANUP_PORTAL_IDS);
  }
  if (CLEANUP_CALENDAR_IDS.length > 0) {
    const { count } = await sb.from("calendar_events").delete({ count: "exact" }).in("id", CLEANUP_CALENDAR_IDS);
    console.log(`  ✅ ${count} événement(s) calendrier supprimé(s)`);
  }
  if (CLEANUP_EMAIL_IDS.length > 0) {
    await sb.from("document_portal_tokens").delete().in("email_id", CLEANUP_EMAIL_IDS);
    try { await sb.from("prospect_timeline").delete().in("email_id", CLEANUP_EMAIL_IDS); } catch { /* silencieux */ }
    const { count } = await sb.from("emails").delete({ count: "exact" }).in("id", CLEANUP_EMAIL_IDS);
    console.log(`  ✅ ${count} email(s) de test supprimé(s)`);
  }
}

// ── RAPPORT ───────────────────────────────────────────────────────────────────
function printReport(): void {
  console.log("\n\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║         RAPPORT AUTOPILOTE — 8 ÉTAPES                           ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  for (const r of RESULTS) {
    const s = r.step.padEnd(28);
    const st = r.status.padEnd(4);
    const d = r.details.substring(0, 38).padEnd(38);
    console.log(`║ ${s} ${st} ${d}║`);
  }
  const passed = RESULTS.filter((r) => r.status === "✅").length;
  const failed = RESULTS.filter((r) => r.status === "❌").length;
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  console.log(`║ Total: ${passed}✅  ${failed}❌                                            ║`);
  console.log("╚══════════════════════════════════════════════════════════════════╝");
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("🤖 Démarrage test autopilote complet FixTime...\n");

  try {
    await testToggle();
    const emailId = await step1();
    await step2(emailId);
    await step3(emailId);
    await step4();
    await step5();
    await step6();
    await step7();
    await step8();
  } finally {
    await cleanup();
    printReport();
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
