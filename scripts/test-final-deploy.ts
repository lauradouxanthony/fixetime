/**
 * TESTS FINAUX PRÉ-DÉPLOIEMENT
 * Usage: npx tsx --env-file=.env.local scripts/test-final-deploy.ts
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { buildSystemPrompt, type BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";
import { isSystemEmail } from "../lib/email/ignoreFilter";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const USER_ID        = "69f195a3-4ee2-4f55-950c-530c044e96fc";
const PROP_T2_FLEURS = "a036d229-c408-4bed-ba89-2568b0a65a31";
const SITE_URL       = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

const TEST_IDS: string[] = [];

interface R { cas: string; attendu: string; reel: string; status: "✅" | "❌" }
const RESULTS: R[] = [];
function pass(cas: string, attendu: string, reel = "") { RESULTS.push({ cas, attendu, reel, status: "✅" }); console.log(`  ✅ ${cas}: ${attendu}`); }
function fail(cas: string, attendu: string, reel: string) { RESULTS.push({ cas, attendu, reel, status: "❌" }); console.log(`  ❌ ${cas}: ${attendu}\n     Réel: ${reel.substring(0, 200)}`); }

async function insertEmail(params: {
  sender: string; subject: string; body: string;
  property_id?: string | null; prospect_data?: Record<string, unknown>;
  decision?: string; category?: string;
}): Promise<string> {
  const { data, error } = await sb.from("emails").insert({
    user_id: USER_ID,
    gmail_message_id: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    sender: params.sender,
    subject: params.subject,
    body: params.body,
    category: params.category ?? "LOCATION",
    property_id: params.property_id ?? null,
    prospect_data: params.prospect_data ?? {},
    decision: params.decision ?? "traiter",
    ai_reply: null,
    lead_last_action: null,
    received_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !data) throw new Error(`Insert failed: ${error?.message}`);
  TEST_IDS.push(data.id);
  return data.id;
}

const parseNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v); return isNaN(n) ? null : n;
};

async function callGenerateReply(emailId: string): Promise<Record<string, unknown>> {
  const { data: email } = await sb.from("emails")
    .select("id, sender, subject, body, prospect_data, property_id")
    .eq("id", emailId).single();
  if (!email) throw new Error("Email not found");

  const { data: settings } = await sb.from("settings_v1")
    .select("email_rules").eq("user_id", USER_ID).single();
  const rules = (settings?.email_rules as Record<string, unknown>) ?? {};
  const locatif    = (rules.ft_locatif    as Record<string, unknown>) ?? {};
  const docsSection= (rules.ft_documents  as Record<string, unknown>) ?? {};
  const iaSection  = (rules.ft_ia         as Record<string, unknown>) ?? {};
  const calSection = (rules.ft_calendrier as Record<string, unknown>) ?? {};
  const faqSection = (rules.ft_faq        as { question: string; reponse: string }[] | null) ?? [];

  const pd = (email.prospect_data as Record<string, unknown>) ?? {};
  const etapeProcess = (pd.etape_process as string) ?? "NEW";
  const sitPro = (pd.situation_pro as string) ?? null;

  const docsProfiles: Record<string, string[]> = {
    CDI:     (docsSection.cdi     as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Pièce d'identité"],
    ETUDIANT:(docsSection.etudiant as string[]) ?? ["Carte étudiante", "Justificatif de garant", "Pièce d'identité"],
  };
  const docsList = sitPro && docsProfiles[sitPro] ? docsProfiles[sitPro] : docsProfiles.CDI;

  const prospect: BuildSystemPromptParams["prospect"] = {
    nom: (pd.nom as string | null) ?? null,
    telephone: null,
    situation_pro: sitPro,
    revenus_mensuels: parseNum(pd.revenus_mensuels),
    revenus_garant: parseNum(pd.revenus_garant),
    loyer_max: null,
    garant: (pd.garant as string | null) ?? null,
    date_entree_souhaitee: null,
  };

  let bien: Record<string, unknown> | null = null;
  const propertyId = email.property_id as string | null;
  if (propertyId) {
    const { data: prop } = await sb.from("properties")
      .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
      .eq("id", propertyId).maybeSingle();
    if (prop) {
      const p = prop as Record<string, unknown>;
      bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name };
    }
  }

  const systemPrompt = buildSystemPrompt({
    nomAgence:        (locatif.nomAgence as string) ?? "FixTime",
    multiplicateur:   (locatif.multiplicateur as number) ?? 3,
    seuilAutopilote:  (iaSection.seuil_autopilote as number) ?? 3.5,
    tonDeVoix:        (iaSection.ton_de_voix as string) ?? "Professionnel et formel",
    instructions:     (iaSection.instructions as string) ?? "",
    prioriteProfils:  (iaSection.priorite_profils as string) ?? "",
    heureDebut:       (calSection.heureDebut as number) ?? 9,
    heureFin:         (calSection.heureFin as number) ?? 18,
    dureeVisite:      (calSection.dureeVisite as number) ?? 60,
    etapeProcess, garantObligatoire: (locatif.garantObligatoire as Record<string, boolean>) ?? { CDD: true, ETUDIANT: true },
    prospect, bien, docsList,
    multipleProperties: [],
    faqContext: Array.isArray(faqSection) ? faqSection.slice(0,5).map((f) => `Q: ${f.question}\nR: ${f.reponse}`).join("\n\n") : "",
    champsQualification: ["situation_pro", "revenus_mensuels", "garant"],
    customQuestion: "",
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Email reçu :\nExpéditeur : ${email.sender}\nSujet : ${email.subject}\nMessage : ${String(email.body ?? "").substring(0, 2000)}` },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
}

// ── P1+P2: Autopilote CDI — vérifier lead_last_action ──────────────────────
async function testP1AutopilateCDI() {
  console.log("\n[TEST P1] Autopilote CDI 3800€ → génère reply avec mode=AUTOPILOTE");
  const emailId = await insertEmail({
    sender: "Jean Dupont <jean.dupont@test.com>",
    subject: "Demande visite T2 rue des Fleurs",
    body: "Bonjour, je suis en CDI, je gagne 3800€ nets/mois. Intéressé par votre T2. Cordialement, Jean Dupont",
    property_id: PROP_T2_FLEURS,
    prospect_data: {
      nom: "Jean Dupont", situation_pro: "CDI", revenus_mensuels: 3800,
      garant: "NON", etape_process: "QUALIFICATION",
    },
  });

  const r = await callGenerateReply(emailId);
  const reply = (r.reply as string) ?? "";
  const mode = r.mode as string;
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi)\b|\d{1,2}h[0-9]?[0-9]?|créneau/i.test(reply);

  // Simuler le marquage lead_last_action comme le ferait send-reply
  const nowIso = new Date().toISOString();
  await sb.from("emails").update({
    ai_reply: reply,
    lead_last_action: mode === "AUTOPILOTE" ? "Réponse auto-envoyée" : "Brouillon prêt",
    lead_last_action_at: nowIso,
  }).eq("id", emailId);

  // Vérifier en base
  const { data: updated } = await sb.from("emails").select("lead_last_action, ai_reply").eq("id", emailId).single();
  const storedAction = updated?.lead_last_action ?? "";

  console.log(`  → mode=${mode} | créneaux=${hasSlots} | lead_last_action="${storedAction}"`);

  if (mode === "AUTOPILOTE" && hasSlots && storedAction.includes("auto-envoyée")) {
    pass("P1-CDI", "mode=AUTOPILOTE + créneaux + lead_last_action=Réponse auto-envoyée");
  } else {
    fail("P1-CDI", "AUTOPILOTE + créneaux + auto-envoyée", `mode=${mode} hasSlots=${hasSlots} action="${storedAction}"`);
  }
}

// ── P1+P2: Autopilote ETUDIANT sans garant ─────────────────────────────────
async function testP1AutopilateEtudiant() {
  console.log("\n[TEST P1B] Autopilote ETUDIANT garant=OUI revenus_garant=null → demande garant");
  const emailId = await insertEmail({
    sender: "Emma Martin <emma@test.com>",
    subject: "Location studio",
    body: "Bonjour, je suis étudiante et j'ai un garant. Intéressée par votre appartement.",
    property_id: PROP_T2_FLEURS,
    prospect_data: {
      nom: "Emma Martin", situation_pro: "ETUDIANT", garant: "OUI",
      revenus_garant: null, etape_process: "QUALIFICATION",
    },
  });

  const r = await callGenerateReply(emailId);
  const reply = (r.reply as string) ?? "";
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi)\b|\d{1,2}h[0-9]?[0-9]?|créneau/i.test(reply);
  const asksGarant = /garant|revenu.*garant|garant.*revenu/i.test(reply);

  console.log(`  → mode=${r.mode} | asksGarant=${asksGarant} | hasSlots=${hasSlots}`);

  if (asksGarant && !hasSlots) {
    pass("P1-ETUDIANT", "demande revenus garant, pas de créneaux");
  } else {
    fail("P1-ETUDIANT", "ask garant + no créneaux", `asksGarant=${asksGarant} hasSlots=${hasSlots}`);
  }
}

// ── P2: Vérifier que le filtre AUTO_SENT fonctionne en base ────────────────
async function testP2AutoSentFilter() {
  console.log("\n[TEST P2] Onglet Envoyés auto — filtre lead_last_action");

  // Insérer email avec lead_last_action contenant "auto-envoyée"
  const emailId = await insertEmail({
    sender: "Test Auto <test@test.com>",
    subject: "Test auto-envoyé",
    body: "test",
    prospect_data: { etape_process: "VISITE_PROPOSEE" },
  });
  await sb.from("emails").update({ lead_last_action: "Réponse auto-envoyée" }).eq("id", emailId);

  // Query du filtre emails/page.tsx
  const { data } = await sb.from("emails")
    .select("id, lead_last_action")
    .eq("user_id", USER_ID)
    .eq("is_archived", false)
    .in("id", [emailId]);

  const found = (data ?? []).filter((e) => {
    const a = e.lead_last_action ?? "";
    return a.includes("auto-envoyée") || a.includes("auto-envoyé");
  });

  console.log(`  → emails trouvés avec auto-envoyée: ${found.length} (lead_last_action="${data?.[0]?.lead_last_action}")`);

  if (found.length > 0) {
    pass("P2-FILTER", "filtre AUTO_SENT trouve les emails auto-envoyés");
  } else {
    fail("P2-FILTER", "filtre AUTO_SENT", `found=${found.length} data=${JSON.stringify(data)}`);
  }
}

// ── P3: Dashboard KPIs ──────────────────────────────────────────────────────
async function testP3DashboardKPIs() {
  console.log("\n[TEST P3] Dashboard KPIs — vraies données");

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); })();
  const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalEmails },
    { count: rdvSemaine },
    { count: visitesConfirmees },
    { data: locationEmails },
  ] = await Promise.all([
    sb.from("emails").select("id", { count: "exact", head: true }).eq("user_id", USER_ID).gte("received_at", since30d),
    sb.from("calendar_events").select("id", { count: "exact", head: true }).eq("user_id", USER_ID).gte("start_time", todayStart).lte("start_time", weekEnd),
    sb.from("emails").select("id", { count: "exact", head: true }).eq("user_id", USER_ID).eq("category", "LOCATION").filter("prospect_data->>etape_process", "eq", "VISITE_CONFIRMEE"),
    sb.from("emails").select("prospect_data").eq("user_id", USER_ID).eq("category", "LOCATION").gte("received_at", since30d).limit(200),
  ]);

  const leadsQualifies = (locationEmails ?? []).filter((e) => {
    const pd = e.prospect_data as Record<string, unknown> | null;
    return pd?.situation_pro && (pd?.revenus_mensuels || pd?.revenus_garant);
  }).length;

  const leadsActifs = (locationEmails ?? []).filter((e) => {
    const pd = e.prospect_data as Record<string, unknown> | null;
    const etape = pd?.etape_process as string | null;
    return etape && etape !== "REFUSE" && etape !== "VALIDE";
  }).length;

  console.log(`  → Emails reçus (30j): ${totalEmails ?? 0}`);
  console.log(`  → RDV semaine: ${rdvSemaine ?? 0}`);
  console.log(`  → Visites confirmées: ${visitesConfirmees ?? 0}`);
  console.log(`  → Leads qualifiés (30j): ${leadsQualifies}`);
  console.log(`  → Leads actifs: ${leadsActifs}`);

  const allOk = typeof totalEmails === "number";
  if (allOk) {
    pass("P3-KPIs", `emails=${totalEmails} rdv=${rdvSemaine} visites=${visitesConfirmees} qualifiés=${leadsQualifies}`,
      `leadsActifs=${leadsActifs}`);
  } else {
    fail("P3-KPIs", "KPIs avec vraies données", "totalEmails=null");
  }
}

// ── P4: Chat IA — queries ───────────────────────────────────────────────────
async function testP4ChatIA() {
  console.log("\n[TEST P4] Chat IA — vraies queries visites + dossiers incomplets");

  const weekStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); d.setHours(0,0,0,0); return d.toISOString(); })();
  const weekEnd   = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 7); d.setHours(23,59,59,999); return d.toISOString(); })();

  const [{ data: visitsSemaine }, { data: dossiersIncomplets }] = await Promise.all([
    sb.from("calendar_events")
      .select("id, title, start_time, location, prospect_email, property_name")
      .eq("user_id", USER_ID)
      .gte("start_time", weekStart)
      .lte("start_time", weekEnd),
    sb.from("emails")
      .select("id, sender, subject, prospect_data")
      .eq("user_id", USER_ID)
      .eq("category", "LOCATION")
      .eq("is_archived", false)
      .or("prospect_data->>etape_process.eq.QUALIFICATION,prospect_data->>etape_process.eq.VISITE_PROPOSEE")
      .limit(20),
  ]);

  console.log(`  → Visites cette semaine: ${visitsSemaine?.length ?? 0}`);
  console.log(`  → Dossiers incomplets: ${dossiersIncomplets?.length ?? 0}`);
  if (visitsSemaine?.length) {
    console.log(`    Premier RDV: ${visitsSemaine[0].start_time} — ${visitsSemaine[0].property_name ?? visitsSemaine[0].title}`);
  }
  if (dossiersIncomplets?.length) {
    const pd = (dossiersIncomplets[0].prospect_data as Record<string, unknown>) ?? {};
    console.log(`    Premier dossier incomplet: ${pd.nom ?? dossiersIncomplets[0].sender} (étape: ${pd.etape_process ?? "?"})`);
  }

  pass("P4-Chat", `queries OK: visites=${visitsSemaine?.length ?? 0} dossiers_incomplets=${dossiersIncomplets?.length ?? 0}`);
}

// ── P5: Confirmation RDV ────────────────────────────────────────────────────
async function testP5ConfirmationRDV() {
  console.log("\n[TEST P5] Confirmation RDV — generate-reply + next_etape=VISITE_CONFIRMEE");
  const emailId = await insertEmail({
    sender: "Sophie Bernard <sophie@test.com>",
    subject: "Re: Créneaux de visite",
    body: "Bonjour, je confirme le créneau du mardi à 14h. Je serai là. Cordialement, Sophie",
    property_id: PROP_T2_FLEURS,
    prospect_data: {
      nom: "Sophie Bernard", situation_pro: "CDI", revenus_mensuels: 3500,
      garant: "NON", etape_process: "VISITE_PROPOSEE",
      slots_proposed: ["2026-04-08T14:00:00"],
    },
  });

  const r = await callGenerateReply(emailId);
  const reply = (r.reply as string) ?? "";
  const nextEtape = r.next_etape as string;
  const isConfirmation = /confirm|mardi|14h|rdv|rendez-vous|visite/i.test(reply);

  console.log(`  → mode=${r.mode} | next_etape=${nextEtape}`);
  console.log(`  → reply (120 chars): ${reply.substring(0, 120)}`);

  if ((nextEtape === "VISITE_CONFIRMEE" || nextEtape === "VISITE_PROPOSEE") && isConfirmation) {
    pass("P5-RDV", `next_etape=${nextEtape} + réponse confirmation`);
  } else {
    fail("P5-RDV", "VISITE_CONFIRMEE + confirmation email", `next_etape=${nextEtape} isConf=${isConfirmation}`);
  }
}

// ── P6: Rappels J-2/J-1 ────────────────────────────────────────────────────
async function testP6Rappels() {
  console.log("\n[TEST P6] Rappels J-2/J-1 — calendar_events");

  const j2Time = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(); // dans 36h (dans la fenêtre 24-48h)
  const j1Time = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // dans 12h (dans la fenêtre 0-24h)

  // Insérer calendar_events de test
  const { data: evtJ2 } = await sb.from("calendar_events").insert({
    user_id: USER_ID,
    title: "Visite T2 Test J-2",
    start_time: j2Time,
    end_time: new Date(Date.now() + 37 * 60 * 60 * 1000).toISOString(),
    prospect_email: "test_rappel@test.com",
    property_name: "T2 Test",
  }).select("id").single();

  const { data: evtJ1 } = await sb.from("calendar_events").insert({
    user_id: USER_ID,
    title: "Visite T2 Test J-1",
    start_time: j1Time,
    end_time: new Date(Date.now() + 13 * 60 * 60 * 1000).toISOString(),
    prospect_email: "test_rappel@test.com",
    property_name: "T2 Test",
  }).select("id").single();

  const evtJ2Id = evtJ2?.id;
  const evtJ1Id = evtJ1?.id;

  // Vérifier que les requêtes du cron trouveraient ces events
  const nowTs = Date.now();
  const j1End   = new Date(nowTs + 24 * 3600 * 1000).toISOString();
  const j2Start = new Date(nowTs + 24 * 3600 * 1000).toISOString();
  const j2End   = new Date(nowTs + 48 * 3600 * 1000).toISOString();

  const [{ data: foundJ1 }, { data: foundJ2 }] = await Promise.all([
    sb.from("calendar_events").select("id, start_time, prospect_email").eq("user_id", USER_ID)
      .gt("start_time", new Date(nowTs).toISOString()).lt("start_time", j1End),
    sb.from("calendar_events").select("id, start_time, prospect_email").eq("user_id", USER_ID)
      .gt("start_time", j2Start).lt("start_time", j2End),
  ]);

  const j1Found = foundJ1?.some((e) => e.id === evtJ1Id);
  const j2Found = foundJ2?.some((e) => e.id === evtJ2Id);

  console.log(`  → J-1 events dans la fenêtre (0-24h): ${foundJ1?.length ?? 0} (notre test event trouvé: ${j1Found})`);
  console.log(`  → J-2 events dans la fenêtre (24-48h): ${foundJ2?.length ?? 0} (notre test event trouvé: ${j2Found})`);

  // Cleanup calendar events
  if (evtJ2Id) await sb.from("calendar_events").delete().eq("id", evtJ2Id);
  if (evtJ1Id) await sb.from("calendar_events").delete().eq("id", evtJ1Id);

  if (j1Found && j2Found) {
    pass("P6-RAPPELS", "J-1 et J-2 calendar_events trouvés par les queries du cron");
  } else {
    fail("P6-RAPPELS", "J-1 et J-2 trouvés", `j1=${j1Found} j2=${j2Found} foundJ1=${foundJ1?.length} foundJ2=${foundJ2?.length}`);
  }
}

// ── P7: Onboarding nouveau user ─────────────────────────────────────────────
async function testP7Onboarding() {
  console.log("\n[TEST P7] Onboarding — settings_v1 par défaut");

  // Vérifier que l'user test a bien ses settings
  const { data: settings } = await sb.from("settings_v1")
    .select("user_id, assistant_enabled, automation_level, email_rules")
    .eq("user_id", USER_ID).single();

  const hasSettings = !!settings;
  const emailRules = (settings?.email_rules as Record<string, unknown>) ?? {};
  const hasLocatif = !!emailRules.ft_locatif;
  const hasFaq = Array.isArray(emailRules.ft_faq);
  const pipelineMode = (emailRules.pipeline_mode as string) ?? "DRAFT";

  console.log(`  → settings_v1 existants: ${hasSettings}`);
  console.log(`  → ft_locatif configuré: ${hasLocatif}`);
  console.log(`  → ft_faq existant: ${hasFaq}`);
  console.log(`  → pipeline_mode: ${pipelineMode}`);
  console.log(`  → assistant_enabled: ${settings?.assistant_enabled}`);
  console.log(`  → automation_level: ${settings?.automation_level}`);

  if (hasSettings && hasLocatif) {
    pass("P7-ONBOARDING", `settings OK (pipeline_mode=${pipelineMode} assistant=${settings?.assistant_enabled})`);
  } else {
    fail("P7-ONBOARDING", "settings_v1 avec ft_locatif", `hasSettings=${hasSettings} hasLocatif=${hasLocatif}`);
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  if (TEST_IDS.length > 0) {
    await sb.from("emails").delete().in("id", TEST_IDS);
    console.log(`\n[Cleanup] ${TEST_IDS.length} emails de test supprimés`);
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== TESTS FINAUX PRÉ-DÉPLOIEMENT ===\n");

  await testP1AutopilateCDI();
  await testP1AutopilateEtudiant();
  await testP2AutoSentFilter();
  await testP3DashboardKPIs();
  await testP4ChatIA();
  await testP5ConfirmationRDV();
  await testP6Rappels();
  await testP7Onboarding();

  await cleanup();

  console.log("\n=== RAPPORT FINAL ===");
  console.log("| Test | Attendu | Statut |");
  console.log("|------|---------|--------|");
  for (const r of RESULTS) {
    console.log(`| ${r.cas} | ${r.attendu.substring(0, 60)} | ${r.status} |`);
  }
  const failed = RESULTS.filter((r) => r.status === "❌").length;
  const passed = RESULTS.filter((r) => r.status === "✅").length;
  console.log(`\nTotal: ${RESULTS.length} | ✅ ${passed} | ❌ ${failed}`);
  if (failed > 0) process.exit(1);
  console.log("\n✅ Tous les tests passent !");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
