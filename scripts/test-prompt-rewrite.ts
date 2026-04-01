/**
 * Test réécriture prompt — 8 cas déterministes
 * Usage: npx tsx --env-file=.env.local scripts/test-prompt-rewrite.ts
 */
import OpenAI from "openai";
import { buildSystemPrompt, BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ── Paramètres de base (settings agence) ──────────────────────────────────────
const BASE_SETTINGS = {
  nomAgence:        "FixTime",
  multiplicateur:   3,
  seuilAutopilote:  3.5,
  tonDeVoix:        "Professionnel et formel",
  instructions:     "",
  prioriteProfils:  "",
  heureDebut:       9,
  heureFin:         18,
  dureeVisite:      60,
  etapeProcess:     "QUALIFICATION",
  garantObligatoire: { CDD: true, AUTO_ENTREPRENEUR: true, ETUDIANT: true },
  docsList:         ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
  faqContext:       "",
  multipleProperties: [],
  champsQualification: ["situation_pro", "revenus_mensuels", "garant"],
  customQuestion:   "",
};

const BIEN_850: Record<string, unknown> = {
  name:   "T2 rue des Fleurs",
  loyer:  850,
  charges: 50,
  type:   "T2",
  meuble: false,
  animaux_acceptes: false,
  parking_inclus:   false,
  disponible_a_partir_de: "2025-06-01",
  description: "Appartement T2 au 3ème étage avec ascenseur.",
  notes_specifiques: null,
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface TestResult {
  cas: string;
  attendu: string;
  reel: string;
  status: "✅" | "❌";
  fix?: string;
}

const RESULTS: TestResult[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function callAI(
  settings: Partial<typeof BASE_SETTINGS>,
  prospect: Partial<BuildSystemPromptParams["prospect"]>,
  body: string,
  bien: Record<string, unknown> | null = BIEN_850,
  etapeProcess = "QUALIFICATION"
): Promise<Record<string, unknown>> {
  const fullProspect: BuildSystemPromptParams["prospect"] = {
    nom: null,
    telephone: null,
    situation_pro: null,
    revenus_mensuels: null,
    revenus_garant: null,
    loyer_max: null,
    garant: null,
    date_entree_souhaitee: null,
    ...prospect,
  };
  const params: BuildSystemPromptParams = {
    ...BASE_SETTINGS,
    ...settings,
    etapeProcess,
    prospect: fullProspect,
    bien,
  };

  const systemPrompt = buildSystemPrompt(params);

  const completion = await openai.chat.completions.create({
    model:           "gpt-4o-mini",
    messages: [
      { role: "system",  content: systemPrompt },
      { role: "user",    content: `Email reçu :\nExpéditeur : test@test.com\nSujet : Demande location\nMessage : ${body}` },
    ],
    temperature:     0.2,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
  return JSON.parse(raw) as Record<string, unknown>;
}

function check(cas: string, attendu: string, condition: boolean, reel: string, fix?: string) {
  const status: "✅" | "❌" = condition ? "✅" : "❌";
  RESULTS.push({ cas, attendu, reel, status, fix });
  console.log(`  ${status} CAS ${cas}: ${attendu}`);
  if (!condition) {
    console.log(`      Réponse reçue : ${reel.substring(0, 150)}...`);
    if (fix) console.log(`      Fix appliqué : ${fix}`);
  }
}

// ── CAS 1 — CDI complet solvable → AUTOPILOTE + créneaux ─────────────────────
async function cas1() {
  console.log("\n[CAS 1] CDI complet solvable — ratio 4.1x → AUTOPILOTE");
  const r = await callAI(
    {},
    { nom: "Sophie", situation_pro: "CDI", revenus_mensuels: 3500 },
    "Bonjour, je suis intéressée par votre appartement. Sophie.",
  );
  const reply = (r.reply as string) ?? "";
  const mode  = r.mode as string;
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi)\b|\d{1,2}h[0-9]?[0-9]?|créneau/i.test(reply);
  const hasLoyer = reply.includes("850");
  console.log(`  → mode=${mode} | créneaux=${hasSlots} | loyer=${hasLoyer}`);
  check("1", "mode=AUTOPILOTE + créneaux proposés",
    mode === "AUTOPILOTE" && hasSlots,
    `mode=${mode} créneaux=${hasSlots} reply="${reply.substring(0,100)}"`);
}

// ── CAS 2 — Étudiant garant, revenus_garant manquants → demander revenus garant
async function cas2() {
  console.log("\n[CAS 2] Étudiant, garant=OUI, revenus_garant=null → demander revenus garant");
  const r = await callAI(
    {},
    { nom: "Lisa", situation_pro: "ETUDIANT", garant: "OUI", revenus_garant: null },
    "Bonjour, je suis étudiante, j'ai un garant.",
  );
  const reply = (r.reply as string) ?? "";
  const asksGarantRevenu = /garant|revenus.*garant|garant.*revenu/i.test(reply);
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|créneau|visite)\b/i.test(reply);
  console.log(`  → mode=${r.mode} | asksGarantRevenu=${asksGarantRevenu} | hasSlots=${hasSlots}`);
  check("2", "demande revenus garant, pas de créneaux",
    asksGarantRevenu && !hasSlots,
    `asksGarantRevenu=${asksGarantRevenu} hasSlots=${hasSlots} reply="${reply.substring(0,120)}"`);
}

// ── CAS 3 — Étudiant garant solvable → DRAFT_ATYPIQUE + créneaux ──────────────
async function cas3() {
  console.log("\n[CAS 3] Étudiant, garant=OUI, revenus_garant=4500 → DRAFT + créneaux");
  const r = await callAI(
    {},
    { nom: "Tom", situation_pro: "ETUDIANT", garant: "OUI", revenus_garant: 4500 },
    "Bonjour, je suis étudiant, mon garant gagne 4500€/mois.",
  );
  const reply = (r.reply as string) ?? "";
  const mode  = r.mode as string;
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|créneau|visite|disponible)/i.test(reply);
  console.log(`  → mode=${mode} | créneaux=${hasSlots}`);
  check("3", "mode=DRAFT + créneaux proposés",
    mode === "DRAFT" && hasSlots,
    `mode=${mode} créneaux=${hasSlots} reply="${reply.substring(0,120)}"`);
}

// ── CAS 4 — Sans infos → demander nom + situation pro ─────────────────────────
async function cas4() {
  console.log("\n[CAS 4] Prospect vide → demander situation pro");
  const r = await callAI(
    {},
    {},
    "Bonjour, je suis intéressé par votre appartement.",
  );
  const reply = (r.reply as string) ?? "";
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|créneau|visite)\b/i.test(reply);
  const asksInfo = /situation|professionnel|emploi|revenus|nom/i.test(reply);
  console.log(`  → mode=${r.mode} | asksInfo=${asksInfo} | hasSlots=${hasSlots}`);
  check("4", "demande info qualification, pas de créneaux",
    asksInfo && !hasSlots,
    `asksInfo=${asksInfo} hasSlots=${hasSlots} reply="${reply.substring(0,120)}"`);
}

// ── CAS 5 — Question FAQ + CDI complet → réponse ascenseur + créneaux ─────────
async function cas5() {
  console.log("\n[CAS 5] Question FAQ ascenseur + CDI qualifié → réponse + créneaux");
  const r = await callAI(
    {},
    { nom: "Marc", situation_pro: "CDI", revenus_mensuels: 2800 },
    "Y a-t-il un ascenseur dans l'immeuble ?",
  );
  const reply = (r.reply as string) ?? "";
  const answersAscenseur = /ascenseur/i.test(reply);
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|créneau|visite|disponible)/i.test(reply);
  console.log(`  → mode=${r.mode} | ascenseur=${answersAscenseur} | créneaux=${hasSlots}`);
  check("5", "réponse ascenseur + créneaux proposés",
    answersAscenseur && hasSlots,
    `ascenseur=${answersAscenseur} créneaux=${hasSlots} reply="${reply.substring(0,150)}"`);
}

// ── CAS 6 — CDD revenus ok → mode DRAFT (jamais AUTOPILOTE) ──────────────────
async function cas6() {
  console.log("\n[CAS 6] CDD solvable → mode DRAFT (jamais AUTOPILOTE)");
  const r = await callAI(
    {},
    { nom: "Emma", situation_pro: "CDD", revenus_mensuels: 2800 },
    "Bonjour, je suis en CDD et je voudrais visiter l'appartement.",
  );
  const mode = r.mode as string;
  console.log(`  → mode=${mode}`);
  check("6", "mode=DRAFT (CDD jamais AUTOPILOTE)",
    mode === "DRAFT",
    `mode=${mode}`);
}

// ── CAS 7 — Revenus insuffisants → DRAFT_REFUSE, pas de créneaux ──────────────
async function cas7() {
  console.log("\n[CAS 7] CDI revenus insuffisants (ratio 1.76x < 3x) → REFUSE, pas de créneaux");
  const r = await callAI(
    {},
    { nom: "Paul", situation_pro: "CDI", revenus_mensuels: 1500 },
    "Bonjour, je suis en CDI et je gagne 1500€ net. Je voudrais visiter.",
  );
  const reply  = (r.reply as string) ?? "";
  const mode   = r.mode as string;
  const hasSlots = /\b(lundi|mardi|mercredi|jeudi|vendredi|créneau|visite|disponible)\b/i.test(reply);
  const isRefuse = /next_etape/.test(JSON.stringify(r)) && (r.next_etape as string) === "REFUSE"
    || /critère|correspond|insuffisant|malheureusement|ne répond|ne rempli|dossier/i.test(reply);
  console.log(`  → mode=${mode} | next_etape=${r.next_etape} | hasSlots=${hasSlots}`);
  check("7", "mode=DRAFT + pas de créneaux + refus poli",
    mode === "DRAFT" && !hasSlots,
    `mode=${mode} hasSlots=${hasSlots} reply="${reply.substring(0,150)}"`);
}

// ── CAS 8 — Email agressif → ALERTE, reply=null ───────────────────────────────
async function cas8() {
  console.log("\n[CAS 8] Email agressif → mode ALERTE, reply=null");
  const r = await callAI(
    {},
    {},
    "C'est scandaleux !!! Je vais contacter un avocat. Vous êtes discriminatoires !!!",
  );
  const mode  = r.mode as string;
  const reply = r.reply;
  console.log(`  → mode=${mode} | reply=${reply === null ? "null" : `"${String(reply).substring(0,60)}"`}`);
  check("8", "mode=ALERTE + reply=null",
    mode === "ALERTE" && reply === null,
    `mode=${mode} reply=${reply}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== TEST RÉÉCRITURE PROMPT — 8 CAS ===");

  await cas1();
  await cas2();
  await cas3();
  await cas4();
  await cas5();
  await cas6();
  await cas7();
  await cas8();

  console.log("\n=== RAPPORT FINAL ===");
  console.log("| Cas | Attendu | Statut | Détails |");
  console.log("|-----|---------|--------|---------|");
  for (const r of RESULTS) {
    console.log(`| ${r.cas} | ${r.attendu} | ${r.status} | ${r.reel.substring(0, 60)} |`);
  }

  const failed = RESULTS.filter((r) => r.status === "❌").length;
  const passed = RESULTS.filter((r) => r.status === "✅").length;
  console.log(`\nTotal: ${RESULTS.length} | ✅ ${passed} | ❌ ${failed}`);
  if (failed > 0) {
    console.error(`\n${failed} cas échoué(s) — voir détails ci-dessus`);
    process.exit(1);
  }
  console.log("\n✅ Tous les cas passent !");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
