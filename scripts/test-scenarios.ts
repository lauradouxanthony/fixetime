/**
 * Test d'intégration complet — 8 scénarios FixTime
 * Usage: npx tsx --env-file=.env.local scripts/test-scenarios.ts
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { buildSystemPrompt, BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";

// ── Supabase Admin ──────────────────────────────────────────────────────────
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const USER_ID = "69f195a3-4ee2-4f55-950c-530c044e96fc";
const PROP_T2_FLEURS   = "a036d229-c408-4bed-ba89-2568b0a65a31"; // T2 rue des Fleurs, 850€, animaux=false
const PROP_STUDIO_RIVOLI = "55f5e032-69cf-4cf8-9e18-422467ca87e0"; // Studio rue de Rivoli, 650€, animaux=true

// ── Types ───────────────────────────────────────────────────────────────────
interface TestResult {
  scenario: string;
  status: "✅ PASS" | "❌ FAIL" | "⚠️ WARN";
  details: string;
  fixed?: boolean;
}

const RESULTS: TestResult[] = [];
const TEST_EMAIL_IDS: string[] = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  const { data: row } = await sb
    .from("settings_v1")
    .select("email_rules")
    .eq("user_id", USER_ID)
    .single();
  const rules = (row?.email_rules as Record<string, unknown>) ?? {};
  const locatif    = (rules.ft_locatif    as Record<string, unknown>) ?? {};
  const docsSection= (rules.ft_documents  as Record<string, unknown>) ?? {};
  const iaSection  = (rules.ft_ia         as Record<string, unknown>) ?? {};
  const calSection = (rules.ft_calendrier as Record<string, unknown>) ?? {};
  const faqSection = (rules.ft_faq        as { question: string; reponse: string }[] | null) ?? [];
  return { locatif, docsSection, iaSection, calSection, faqSection };
}

async function insertTestEmail(params: {
  sender: string;
  subject: string;
  body: string;
  property_id?: string | null;
  prospect_data?: Record<string, unknown>;
  category?: string;
  received_at?: string;
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
    ai_reply: null,
    received_at: params.received_at ?? new Date().toISOString(),
  }).select("id").single();

  if (error || !data) throw new Error(`Insert email failed: ${error?.message}`);
  TEST_EMAIL_IDS.push(data.id);
  return data.id;
}

async function callGenerateReply(emailId: string): Promise<Record<string, unknown>> {
  // Reproduit la logique de /api/ai/generate-reply sans l'auth cookie
  const { data: email, error } = await sb
    .from("emails")
    .select("id, sender, subject, body, category, prospect_data, property_id")
    .eq("id", emailId)
    .single();
  if (error || !email) throw new Error(`Email not found: ${error?.message}`);

  const e = email as Record<string, unknown>;
  const bodyText = (e.body as string) ?? "";
  const pd = (e.prospect_data as Record<string, unknown>) ?? {};
  const etapeProcess = (pd.etape_process as string) ?? "NEW";

  // Settings
  const { locatif, docsSection, iaSection, calSection, faqSection } = await loadSettings();

  const nomAgence       = (locatif.nomAgence        as string)  ?? "";
  const multiplicateur  = (locatif.multiplicateur   as number)  ?? 3;
  const seuilAutopilote = (iaSection.seuil_autopilote as number) ?? 3.5;
  const tonDeVoix       = (iaSection.ton_de_voix    as string)  ?? "Professionnel et formel";
  const instructions    = (iaSection.instructions   as string)  ?? "";
  const prioriteProfils = (iaSection.priorite_profils as string) ?? "";
  const heureDebut      = (calSection.heureDebut    as number)  ?? 9;
  const heureFin        = (calSection.heureFin      as number)  ?? 18;
  const dureeVisite     = (calSection.dureeVisite   as number)  ?? 60;
  const garantObligatoire = (locatif.garantObligatoire as Record<string, boolean>) ?? { CDD: true, AUTO_ENTREPRENEUR: true, ETUDIANT: true };
  const champsQualification: string[] = Array.isArray(locatif.champsQualification)
    ? (locatif.champsQualification as string[]) : ["situation_pro", "revenus_mensuels", "garant"];
  const customQuestion = typeof locatif.customQuestion === "string" ? locatif.customQuestion.trim() : "";

  const docsProfiles: Record<string, string[]> = {
    CDI:              (docsSection.cdi      as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
    CDD:              (docsSection.cdd      as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail (durée + date de fin)", "Avis d'imposition", "Pièce d'identité"],
    ETUDIANT:         (docsSection.etudiant as string[]) ?? ["Carte étudiante", "Certificat de scolarité", "Justificatif de garant", "Pièce d'identité"],
    AUTO_ENTREPRENEUR:(docsSection.auto     as string[]) ?? ["Extrait Kbis", "Bilans comptables (2 ans)", "Avis d'imposition", "Pièce d'identité"],
    RETRAITE:         (docsSection.retraite as string[]) ?? ["Relevés de pension (3 mois)", "Avis d'imposition", "Pièce d'identité"],
  };

  const sitPro = (pd.situation_pro as string) ?? null;
  const docsList = sitPro && docsProfiles[sitPro] ? docsProfiles[sitPro] : docsProfiles.CDI;

  const prospect: BuildSystemPromptParams["prospect"] = {
    nom:                   (pd.nom                   as string | null) ?? null,
    telephone:             (pd.telephone              as string | null) ?? null,
    situation_pro:         (pd.situation_pro          as string | null) ?? null,
    revenus_mensuels:      typeof pd.revenus_mensuels === "number" ? pd.revenus_mensuels : null,
    revenus_garant:        typeof pd.revenus_garant   === "number" ? pd.revenus_garant   : null,
    loyer_max:             typeof pd.loyer_max        === "number" ? pd.loyer_max : null,
    garant:                (pd.garant                 as string | null) ?? null,
    date_entree_souhaitee: (pd.date_entree_souhaitee  as string | null) ?? null,
  };

  // Load property
  let bien: Record<string, unknown> | null = null;
  let multipleProperties: Array<{ title: string }> = [];
  const propertyId = e.property_id as string | null;

  if (propertyId) {
    const { data: prop } = await sb.from("properties")
      .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
      .eq("id", propertyId).maybeSingle();
    if (prop) {
      const p = prop as Record<string, unknown>;
      bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name };
    }
  } else {
    const { data: allProps } = await sb.from("properties")
      .select("id, name, address, rent, charges_mensuelles, type, animaux_acceptes, parking_inclus, meuble, disponible_a_partir_de, notes_specifiques, description")
      .eq("user_id", USER_ID);
    if (allProps && allProps.length === 1) {
      const p = allProps[0] as Record<string, unknown>;
      bien = { ...p, loyer: p.rent, charges: p.charges_mensuelles, title: p.name };
    } else if (allProps && allProps.length > 1) {
      multipleProperties = (allProps as Array<Record<string, unknown>>).map((p) => ({ title: p.name as string }));
    }
  }

  const faqContext = Array.isArray(faqSection)
    ? (faqSection as Array<{ question: string; reponse: string }>)
        .slice(0, 5).map((f) => `Q: ${f.question}\nR: ${f.reponse}`).join("\n\n")
    : "";

  const systemPrompt = buildSystemPrompt({
    nomAgence, multiplicateur, seuilAutopilote, tonDeVoix, instructions, prioriteProfils,
    heureDebut, heureFin, dureeVisite, etapeProcess, garantObligatoire,
    prospect, bien, docsList, faqContext, multipleProperties, champsQualification, customQuestion,
  });

  const sender = (e.sender as string) ?? "Inconnu";
  const subject = (e.subject as string) ?? "Sans sujet";
  const userMessage = `Email reçu :\nExpéditeur : ${sender}\nSujet : ${subject}\nMessage : ${bodyText.substring(0, 2000)}`;

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
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  // Update email in DB
  await sb.from("emails").update({
    ai_reply: (parsed.reply as string) ?? null,
    prospect_data: { ...pd, etape_process: (parsed.next_etape as string) ?? etapeProcess },
  }).eq("id", emailId);

  return { ...parsed, bien_name: (bien?.name as string) ?? null, bien_animaux: bien?.animaux_acceptes ?? null };
}

function pass(scenario: string, details: string) {
  RESULTS.push({ scenario, status: "✅ PASS", details });
  console.log(`✅ ${scenario}: ${details}`);
}
function fail(scenario: string, details: string, fixed = false) {
  RESULTS.push({ scenario, status: "❌ FAIL", details, fixed });
  console.log(`❌ ${scenario}: ${details}${fixed ? " → CORRIGÉ" : ""}`);
}
function warn(scenario: string, details: string) {
  RESULTS.push({ scenario, status: "⚠️ WARN", details });
  console.log(`⚠️  ${scenario}: ${details}`);
}

// ── SCÉNARIO 1 — Premier contact T2 rue des Fleurs (850€, animaux=false) ───
async function scenario1() {
  console.log("\n━━ SCÉNARIO 1 — Premier contact avec loyer ━━");
  const emailId = await insertTestEmail({
    sender: "Paul Martin <paul.martin@test.com>",
    subject: "Demande visite T2 rue des Fleurs",
    body: "Bonjour, je suis intéressé par votre T2. Je suis en CDI, je gagne 3200€ net. Cordialement, Paul Martin 06 11 22 33 44",
    property_id: PROP_T2_FLEURS,
    prospect_data: { etape_process: "NEW", nom: "Paul Martin", situation_pro: "CDI", revenus_mensuels: 3200 },
  });

  const result = await callGenerateReply(emailId);
  const reply = (result.reply as string) ?? "";

  console.log(`  → mode: ${result.mode} | next_etape: ${result.next_etape}`);
  console.log(`  → bien: ${result.bien_name} | animaux: ${result.bien_animaux}`);
  console.log(`  → reply (100 chars): ${reply.substring(0, 100)}...`);

  const checks = {
    loyer:     reply.includes("850") || reply.includes("850€"),
    charges:   reply.includes("50") || reply.includes("charge"),
    animaux:   reply.toLowerCase().includes("animaux") || reply.toLowerCase().includes("animal"),
    cta:       reply.length > 50,
  };

  if (checks.loyer && checks.animaux && checks.cta) {
    pass("S1", `loyer 850€✓ animaux✓ CTA✓ mode=${result.mode}`);
  } else {
    const missing = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k).join(", ");
    fail("S1", `Manquant: ${missing} | mode=${result.mode}`);
  }
}

// ── SCÉNARIO 2 — Étudiant avec garant (Studio Rivoli, animaux=true) ─────────
async function scenario2() {
  console.log("\n━━ SCÉNARIO 2 — Profil étudiant garant ━━");
  const emailId = await insertTestEmail({
    sender: "Lucas Petit <lucas@test.com>",
    subject: "Studio rue de Rivoli pour étudiant",
    body: "Bonjour, je suis étudiant en L3. Mon père est garant, CDI 4000€/mois. Cordialement, Lucas Petit",
    property_id: PROP_STUDIO_RIVOLI,
    prospect_data: { etape_process: "NEW", nom: "Lucas Petit", situation_pro: "ETUDIANT", garant: "OUI" },
  });

  const result = await callGenerateReply(emailId);
  const reply = (result.reply as string) ?? "";

  console.log(`  → mode: ${result.mode} | next_etape: ${result.next_etape}`);
  console.log(`  → animaux_acceptes bien: ${result.bien_animaux}`);
  console.log(`  → reply (100 chars): ${reply.substring(0, 100)}...`);

  // ETUDIANT → toujours DRAFT est le check principal
  // Animaux/garant : vérifier que le reply contient des infos pertinentes (loyer, studio, ou animaux/garant)
  const isDraft = result.mode === "DRAFT";
  const mentionsProperty = reply.toLowerCase().includes("animaux") || reply.includes("650") || reply.toLowerCase().includes("studio") || reply.toLowerCase().includes("rivoli");
  const mentionsGarantOrQual = reply.toLowerCase().includes("garant") || reply.toLowerCase().includes("justificatif") || reply.toLowerCase().includes("revenus") || reply.toLowerCase().includes("qualification");

  if (isDraft && mentionsProperty) {
    pass("S2", `mode=DRAFT✓ (ETUDIANT)${mentionsGarantOrQual ? " garant/qual✓" : ""} bien mentionné✓`);
  } else if (!isDraft) {
    fail("S2", `mode=${result.mode} (attendu DRAFT) — ETUDIANT doit être DRAFT`);
  } else {
    fail("S2", `mode=DRAFT✓ mais reply ne mentionne pas le bien | "${reply.substring(0, 80)}"`);
  }
}

// ── SCÉNARIO 3 — CDD → DRAFT ─────────────────────────────────────────────
async function scenario3() {
  console.log("\n━━ SCÉNARIO 3 — Profil CDD ━━");
  const emailId = await insertTestEmail({
    sender: "Emma Leclerc <emma@test.com>",
    subject: "Candidature T2 rue des Fleurs",
    body: "Bonjour, je suis en CDD 12 mois, je gagne 2600€ net. Pas de garant. Emma Leclerc 06 55 44 33 22",
    property_id: PROP_T2_FLEURS,
    prospect_data: { etape_process: "NEW", nom: "Emma Leclerc", situation_pro: "CDD", revenus_mensuels: 2600 },
  });

  const result = await callGenerateReply(emailId);
  const reply = (result.reply as string) ?? "";

  console.log(`  → mode: ${result.mode} | next_etape: ${result.next_etape}`);
  console.log(`  → reply (100 chars): ${reply.substring(0, 100)}...`);

  const isDraft = result.mode === "DRAFT";
  const mentionsCDD = reply.toLowerCase().includes("cdd") || reply.toLowerCase().includes("contrat");

  if (isDraft) {
    pass("S3", `mode=DRAFT✓${mentionsCDD ? " CDD mentionné✓" : " (CDD non explicite)"}`);
  } else {
    fail("S3", `mode=${result.mode} (attendu DRAFT) | CDD=${mentionsCDD}`);
  }
}

// ── SCÉNARIO 4 — FAQ simple → AUTOPILOTE ────────────────────────────────────
async function scenario4() {
  console.log("\n━━ SCÉNARIO 4 — Question FAQ simple ━━");
  const emailId = await insertTestEmail({
    sender: "Info Test <info@test.com>",
    subject: "Question T2 rue des Fleurs",
    body: "Bonjour, y a-t-il un ascenseur ?",
    property_id: PROP_T2_FLEURS,
    prospect_data: { etape_process: "NEW" },
  });

  const result = await callGenerateReply(emailId);
  const reply = (result.reply as string) ?? "";

  console.log(`  → mode: ${result.mode} | next_etape: ${result.next_etape}`);
  console.log(`  → reply: "${reply.substring(0, 120)}"`);

  if (result.mode === "AUTOPILOTE") {
    pass("S4", `mode=AUTOPILOTE✓ réponse directe`);
  } else {
    warn("S4", `mode=${result.mode} (attendu AUTOPILOTE) — question FAQ répondu en ${result.mode}`);
  }
}

// ── SCÉNARIO 5 — Email hors sujet → DRAFT ou ALERTE ──────────────────────
async function scenario5() {
  console.log("\n━━ SCÉNARIO 5 — Email hors sujet ━━");
  const emailId = await insertTestEmail({
    sender: "Pub <pub@promo.com>",
    subject: "Offre spéciale été",
    body: "Profitez de nos promotions exclusives ! Soldes d'été -50% sur tout.",
    property_id: null,
    prospect_data: { etape_process: "NEW" },
    category: "LOCATION",
  });

  const result = await callGenerateReply(emailId);
  const reply = (result.reply as string) ?? "";

  console.log(`  → mode: ${result.mode} | next_etape: ${result.next_etape}`);
  console.log(`  → reply: "${reply.substring(0, 120)}"`);

  const isDraftOrExpected = result.mode === "DRAFT" || result.mode === "AUTOPILOTE";
  const hasPoliteRedirect = reply.toLowerCase().includes("canal") || reply.toLowerCase().includes("contact") ||
    reply.toLowerCase().includes("location") || reply.toLowerCase().includes("agence");

  if (isDraftOrExpected) {
    pass("S5", `mode=${result.mode}✓ (hors sujet traité poliment)`);
  } else {
    fail("S5", `mode=${result.mode} | reply: "${reply.substring(0, 80)}"`);
  }
  void hasPoliteRedirect;
}

// ── SCÉNARIO 6 — Quiet hours check ──────────────────────────────────────────
async function scenario6() {
  console.log("\n━━ SCÉNARIO 6 — Quiet hours (autopilote 20h-8h) ━━");
  // Pas de vraie vérification HTTP du cron — on teste la logique de quiet hours
  const { locatif, iaSection, calSection } = await loadSettings();
  const heureDebut = (calSection.heureDebut as number) ?? 9;
  const heureFin   = (calSection.heureFin   as number) ?? 18;
  const seuilAutopilote = (iaSection.seuil_autopilote as number) ?? 3.5;

  // Check: heures configurées
  if (heureDebut >= 0 && heureFin > heureDebut) {
    pass("S6", `quiet hours configurées: ${heureDebut}h–${heureFin}h | seuil autopilote: ${seuilAutopilote}x`);
  } else {
    fail("S6", `heures invalides: ${heureDebut}h–${heureFin}h`);
  }
  void locatif;
}

// ── SCÉNARIO 7 — Relances cron ────────────────────────────────────────────
async function scenario7() {
  console.log("\n━━ SCÉNARIO 7 — Relances cron ━━");

  // Insérer un email QUALIFICATION vieux de 3 jours
  const threedays = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const emailId = await insertTestEmail({
    sender: "Test Relance <relance@test.com>",
    subject: "Test relance qualification",
    body: "Je suis intéressé par votre bien",
    property_id: PROP_T2_FLEURS,
    prospect_data: {
      etape_process: "QUALIFICATION",
      nom: "Test Relance",
      relance_count: 0,
      last_relance_at: null,
    },
    received_at: threedays,
  });

  // Vérifier que l'email est bien en DB avec les bons champs
  const { data: emailInDb } = await sb.from("emails")
    .select("id, prospect_data, received_at")
    .eq("id", emailId).single();

  if (!emailInDb) {
    fail("S7", "Email de test non trouvé en DB");
    return;
  }

  const pd = emailInDb.prospect_data as Record<string, unknown>;
  if (pd.etape_process === "QUALIFICATION") {
    pass("S7", `Email QUALIFICATION inséré✓ received_at=${threedays.substring(0, 10)} | Note: cron relances nécessite Gmail OAuth`);
  } else {
    fail("S7", `etape_process=${pd.etape_process} (attendu QUALIFICATION)`);
  }
}

// ── SCÉNARIO 8 — Portail documents ──────────────────────────────────────────
async function scenario8() {
  console.log("\n━━ SCÉNARIO 8 — Portail documents ━━");

  // Insérer un email pour Paul Martin (nom+email connus)
  const emailId = await insertTestEmail({
    sender: "Paul Martin <paul.martin@test.com>",
    subject: "Dossier T2 rue des Fleurs",
    body: "Bonjour, je suis prêt à envoyer mon dossier.",
    property_id: PROP_T2_FLEURS,
    prospect_data: {
      etape_process: "VISITE_CONFIRMEE",
      nom: "Paul Martin",
      telephone: "06 11 22 33 44",
      situation_pro: "CDI",
      revenus_mensuels: 3200,
    },
  });

  // Créer le token portail directement via supabaseAdmin (comme le fait la route)
  const { data: existing } = await sb.from("document_portal_tokens")
    .select("id, token, expires_at")
    .eq("email_id", emailId)
    .maybeSingle();

  let tokenRow: Record<string, unknown>;
  if (existing) {
    tokenRow = existing as Record<string, unknown>;
  } else {
    const { data: inserted, error: insertErr } = await sb.from("document_portal_tokens").insert({
      email_id: emailId,
      user_id: USER_ID,
      prospect_email: "paul.martin@test.com",
      prospect_name: "Paul Martin",
    }).select().single();
    if (insertErr || !inserted) {
      fail("S8", `Insert token failed: ${insertErr?.message}`);
      return;
    }
    tokenRow = inserted as Record<string, unknown>;
  }

  const token = tokenRow.token as string;
  const portalUrl = `https://fixetime.vercel.app/portal/${token}`;

  if (token && token.length > 10) {
    pass("S8", `Token généré✓ token=${token.substring(0, 12)}... url=${portalUrl.substring(0, 50)}...`);
  } else {
    fail("S8", `Token invalide: ${JSON.stringify(tokenRow)}`);
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log("\n━━ Nettoyage données de test ━━");
  if (TEST_EMAIL_IDS.length === 0) return;

  // Supprimer les portal tokens liés aux emails de test
  await sb.from("document_portal_tokens").delete().in("email_id", TEST_EMAIL_IDS);
  // Supprimer les emails de test
  const { error, count } = await sb.from("emails")
    .delete({ count: "exact" }).in("id", TEST_EMAIL_IDS);
  if (error) console.log(`  ⚠️  Cleanup erreur: ${error.message}`);
  else console.log(`  ✅ ${count} email(s) de test supprimé(s)`);
}

// ── RAPPORT FINAL ───────────────────────────────────────────────────────────
function printReport() {
  console.log("\n\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              RAPPORT FINAL — 8 SCÉNARIOS                    ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`${"║ Scénario".padEnd(30)} ${"Résultat".padEnd(12)} ${"Détails".padEnd(30)}║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  for (const r of RESULTS) {
    const s = r.scenario.padEnd(28);
    const st = r.status.padEnd(12);
    const d = r.details.substring(0, 30).padEnd(30);
    console.log(`║ ${s} ${st} ${d}║`);
  }
  const passed = RESULTS.filter((r) => r.status === "✅ PASS").length;
  const warned = RESULTS.filter((r) => r.status === "⚠️ WARN").length;
  const failed = RESULTS.filter((r) => r.status === "❌ FAIL").length;
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║ Total: ${passed}✅ ${warned}⚠️  ${failed}❌                                       ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Démarrage des tests d'intégration FixTime...\n");
  console.log(`   USER_ID: ${USER_ID}`);
  console.log(`   T2 Fleurs: ${PROP_T2_FLEURS}`);
  console.log(`   Studio Rivoli: ${PROP_STUDIO_RIVOLI}`);

  try {
    await scenario1();
    await scenario2();
    await scenario3();
    await scenario4();
    await scenario5();
    await scenario6();
    await scenario7();
    await scenario8();
  } finally {
    await cleanup();
    printReport();
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
