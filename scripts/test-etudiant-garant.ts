/**
 * Test autonome — ETUDIANT revenus garant
 * Usage: npx tsx --env-file=.env.local scripts/test-etudiant-garant.ts
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

interface TestResult { test: string; status: "PASS" | "FAIL"; details: string; }
const RESULTS: TestResult[] = [];
function pass(t: string, d: string) { console.log(`  ✅ ${t}: ${d}`); RESULTS.push({ test: t, status: "PASS", details: d }); }
function fail(t: string, d: string) { console.error(`  ❌ ${t}: ${d}`); RESULTS.push({ test: t, status: "FAIL", details: d }); }

async function getProperty() {
  const { data } = await sb.from("properties").select("id,name,loyer,charges,type,meuble,animaux_acceptes,parking_inclus,disponible_a_partir_de,address").eq("user_id", USER_ID).limit(1).single();
  return data as Record<string, unknown> | null;
}

async function getSettings() {
  const { data } = await sb.from("settings_v1").select("email_rules").eq("user_id", USER_ID).single();
  const rules = (data?.email_rules as Record<string, unknown>) ?? {};
  const ia = (rules.ft_ia as Record<string, unknown>) ?? {};
  const loc = (rules.ft_locatif as Record<string, unknown>) ?? {};
  return {
    multiplicateur: (loc.multiplicateur as number) ?? 3,
    seuilAutopilote: (loc.seuil_autopilote as number) ?? 3.5,
    tonDeVoix: (ia.ton_de_voix as string) ?? "Professionnel et formel",
    nomAgence: (ia.nom_agence as string) ?? "Agence Test",
  };
}

async function callAI(params: BuildSystemPromptParams, userMessage: string): Promise<{ reply: string; mode: string; next_etape: string; extracted_data: Record<string, unknown> }> {
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
    const parsed = JSON.parse(raw) as { reply?: string; mode?: string; next_etape?: string; extracted_data?: Record<string, unknown> };
    return {
      reply: parsed.reply ?? raw,
      mode: parsed.mode ?? "DRAFT",
      next_etape: parsed.next_etape ?? "QUALIFICATION",
      extracted_data: parsed.extracted_data ?? {},
    };
  } catch {
    return { reply: raw, mode: "DRAFT", next_etape: "QUALIFICATION", extracted_data: {} };
  }
}

function makeParams(
  bien: Record<string, unknown> | null,
  prospect: BuildSystemPromptParams["prospect"],
  settings: { multiplicateur: number; seuilAutopilote: number; tonDeVoix: string; nomAgence: string }
): BuildSystemPromptParams {
  return {
    nomAgence: settings.nomAgence,
    multiplicateur: settings.multiplicateur,
    seuilAutopilote: settings.seuilAutopilote,
    tonDeVoix: settings.tonDeVoix,
    instructions: "",
    prioriteProfils: "",
    heureDebut: 9,
    heureFin: 18,
    dureeVisite: 60,
    etapeProcess: "QUALIFICATION",
    garantObligatoire: { cdd: true, auto_entrepreneur: true, etudiant: true, retraite: false },
    prospect,
    bien,
    docsList: ["Carte étudiante", "Justificatif de garant (3 fiches de paie + contrat)", "Pièce d'identité"],
    faqContext: "",
    multipleProperties: [],
    champsQualification: ["situation_pro", "revenus_mensuels", "garant"],
    customQuestion: "",
  };
}

// ─── TEST A ──────────────────────────────────────────────────────────────────
async function testA() {
  console.log("\n[TEST A] ETUDIANT + garant OUI + revenus_garant null → doit demander revenus garant");
  const [bien, settings] = await Promise.all([getProperty(), getSettings()]);

  const params = makeParams(bien, {
    nom: "Hugo Leroy",
    telephone: null,
    situation_pro: "ETUDIANT",
    revenus_mensuels: null,
    revenus_garant: null,
    loyer_max: null,
    garant: "OUI",
    date_entree_souhaitee: null,
  }, settings);

  const res = await callAI(params, "Bonjour, je suis étudiant. Mes parents sont garants.");
  const reply = res.reply.toLowerCase();
  console.log("  Réponse:", res.reply.substring(0, 200));
  console.log("  next_etape:", res.next_etape, "| mode:", res.mode);

  const mentionneGarantRevenu = reply.includes("garant") && (reply.includes("revenu") || reply.includes("salaire") || reply.includes("gagne") || reply.includes("perceiv"));
  const mentionneRevenusPerso = reply.includes("vos revenus mensuels") || reply.includes("votre salaire") || reply.includes("vos revenus personnels") || reply.includes("revenus mensuels de l'étudiant");

  if (mentionneRevenusPerso) {
    fail("A", `Demande revenus personnels étudiant → INTERDIT. Réponse: "${res.reply.substring(0, 120)}"`);
  } else if (mentionneGarantRevenu) {
    pass("A", `Demande revenus garant ✅, pas revenus personnels ✅`);
  } else {
    fail("A", `Ne mentionne pas les revenus du garant. Réponse: "${res.reply.substring(0, 120)}"`);
  }
}

// ─── TEST B ──────────────────────────────────────────────────────────────────
async function testB() {
  console.log("\n[TEST B] ETUDIANT + garant OUI + revenus_garant 4500€ → doit proposer créneaux");
  const [bien, settings] = await Promise.all([getProperty(), getSettings()]);

  const params = makeParams(bien, {
    nom: "Hugo Leroy",
    telephone: null,
    situation_pro: "ETUDIANT",
    revenus_mensuels: null,
    revenus_garant: 4500,
    loyer_max: null,
    garant: "OUI",
    date_entree_souhaitee: null,
  }, settings);

  const res = await callAI(params, "Bonjour, mon père gagne 4500€/mois et est garant.");
  const reply = res.reply.toLowerCase();
  console.log("  next_etape:", res.next_etape, "| mode:", res.mode);
  console.log("  Réponse:", res.reply.substring(0, 200));

  const proposeCreneau = reply.includes("créneau") || reply.includes("visite") || reply.includes("rendez-vous") || res.next_etape === "VISITE_PROPOSEE";
  if (proposeCreneau) {
    pass("B", `Qualification complète → créneaux proposés ✅ (next_etape=${res.next_etape}, mode=${res.mode})`);
  } else {
    fail("B", `Pas de créneaux. next_etape=${res.next_etape}. Réponse: "${res.reply.substring(0, 150)}"`);
  }
}

// ─── TEST C — Multi-emails simulation ─────────────────────────────────────────
async function testC() {
  console.log("\n[TEST C] Conversation multi-emails simulée (accumulation prospect_data)");
  const [bien, settings] = await Promise.all([getProperty(), getSettings()]);

  // EMAIL 1 — étudiant, garant inconnu
  console.log("  → Email 1: premier contact étudiant");
  const params1 = makeParams(bien, {
    nom: "Hugo Leroy",
    telephone: null,
    situation_pro: "ETUDIANT",
    revenus_mensuels: null,
    revenus_garant: null,
    loyer_max: null,
    garant: null,
    date_entree_souhaitee: null,
  }, settings);
  const r1 = await callAI(params1, "Bonjour, le studio est encore disponible ? Je suis Hugo Leroy, étudiant en 3ème année.");
  const reply1 = r1.reply.toLowerCase();
  console.log("    next_etape:", r1.next_etape, "| Réponse:", r1.reply.substring(0, 150));

  const askGarant = reply1.includes("garant") || reply1.includes("caution") || reply1.includes("se porter garant");
  if (askGarant) pass("C-E1", "Demande garant ✅");
  else fail("C-E1", `Email 1 ne demande pas le garant. Réponse: "${r1.reply.substring(0, 150)}"`);

  // EMAIL 2 — garant confirmé, revenus_garant null → accumulation
  console.log("  → Email 2: parents garants CDI");
  const params2 = makeParams(bien, {
    nom: "Hugo Leroy",
    telephone: null,
    situation_pro: "ETUDIANT",
    revenus_mensuels: null,
    revenus_garant: null,
    loyer_max: null,
    garant: "OUI", // accumulé depuis E1
    date_entree_souhaitee: null,
  }, settings);
  const r2 = await callAI(params2, "Mes parents sont garants, ils sont tous les deux en CDI.");
  const reply2 = r2.reply.toLowerCase();
  console.log("    next_etape:", r2.next_etape, "| Réponse:", r2.reply.substring(0, 150));

  const askRevenusGarant = reply2.includes("garant") && (reply2.includes("revenu") || reply2.includes("salaire") || reply2.includes("gagne") || reply2.includes("perçoiv"));
  const askRevenusPerso = reply2.includes("vos revenus mensuels") || reply2.includes("votre salaire mensuel");
  if (askRevenusGarant && !askRevenusPerso) {
    pass("C-E2", "Demande revenus garant ✅, pas revenus personnels ✅");
  } else if (askRevenusPerso) {
    fail("C-E2", `Demande revenus personnels → INTERDIT. Réponse: "${r2.reply.substring(0, 150)}"`);
  } else {
    fail("C-E2", `Ne demande pas revenus garant. Réponse: "${r2.reply.substring(0, 150)}"`);
  }

  // EMAIL 3 — revenus garant connus → créneaux
  console.log("  → Email 3: père gagne 4500€");
  const params3 = makeParams(bien, {
    nom: "Hugo Leroy",
    telephone: null,
    situation_pro: "ETUDIANT",
    revenus_mensuels: null,
    revenus_garant: 4500, // accumulé depuis E2
    loyer_max: null,
    garant: "OUI",
    date_entree_souhaitee: null,
  }, settings);
  const r3 = await callAI(params3, "Mon père gagne 4500€ par mois, il peut être garant.");
  const reply3 = r3.reply.toLowerCase();
  console.log("    next_etape:", r3.next_etape, "| mode:", r3.mode, "| Réponse:", r3.reply.substring(0, 150));

  const proposeCreneau = reply3.includes("créneau") || reply3.includes("visite") || reply3.includes("rendez-vous") || r3.next_etape === "VISITE_PROPOSEE";
  if (proposeCreneau) pass("C-E3", `Créneaux proposés ✅ (next_etape=${r3.next_etape}, mode=${r3.mode})`);
  else fail("C-E3", `Pas de créneaux. next_etape=${r3.next_etape}. Réponse: "${r3.reply.substring(0, 150)}"`);
}

async function main() {
  console.log("=== TEST AUTONOME ETUDIANT REVENUS GARANT ===");
  await testA();
  await testB();
  await testC();

  console.log("\n=== RAPPORT ===");
  console.log("| Test | Détails | Statut |");
  console.log("|------|---------|--------|");
  for (const r of RESULTS) {
    console.log(`| ${r.test} | ${r.details.substring(0, 65)} | ${r.status === "PASS" ? "✅" : "❌"} |`);
  }

  const failed = RESULTS.filter(r => r.status === "FAIL").length;
  console.log(`\nTotal: ${RESULTS.length} | ✅ ${RESULTS.filter(r => r.status === "PASS").length} | ❌ ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
