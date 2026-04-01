/**
 * Test anti-doublon autopilote
 * Vérifie que autopilot-dispatch ne traite pas le même email deux fois.
 * Usage: npx tsx --env-file=.env.local scripts/test-doublon-autopilote.ts
 */
import { createClient } from "@supabase/supabase-js";
import { isReplyAlreadySent, isAlreadySent } from "../lib/email/alreadySent";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const USER_ID = "69f195a3-4ee2-4f55-950c-530c044e96fc";

interface TestResult { test: string; status: "PASS"|"FAIL"; details: string; }
const RESULTS: TestResult[] = [];
function pass(t: string, d: string) { console.log(`  ✅ ${t}: ${d}`); RESULTS.push({ test: t, status: "PASS", details: d }); }
function fail(t: string, d: string) { console.error(`  ❌ ${t}: ${d}`); RESULTS.push({ test: t, status: "FAIL", details: d }); }

// ── Test 1 : isReplyAlreadySent avec "Réponse auto-envoyée" ──────────────────
function testAlreadySentLogic() {
  console.log("\n[Test 1] Logique isReplyAlreadySent / isAlreadySent");

  const cases = [
    // [desc, leadJson, leadLastAction, expectReply, expectAll]
    ["reply_sent outbound", { last_outbound: { type: "reply_sent" } }, null, true, true],
    ["ai_reply outbound", { last_outbound: { type: "ai_reply" } }, null, true, true],
    ["Réponse auto-envoyée label", null, "Réponse auto-envoyée", true, true],
    ["Réponse FAQ auto-envoyée label", null, "Réponse FAQ auto-envoyée", true, true],
    ["reply_sent label", null, "reply_sent", true, true],
    ["Brouillon prêt — pas envoyé", { last_outbound: { type: "draft_created" } }, "Brouillon prêt", false, false],
    ["Null — jamais traité", null, null, false, false],
    ["autopilot_blocked — pas envoyé", { last_outbound: null }, "Autopilot bloqué (quiet hours)", false, false],
  ];

  let allOk = true;
  for (const [desc, lj, lla, expectReply, expectAll] of cases as [string, any, string | null, boolean, boolean][]) {
    const gotReply = isReplyAlreadySent(lj, lla);
    const gotAll = isAlreadySent(lj, lla);
    if (gotReply === expectReply && gotAll === expectAll) {
      console.log(`    ✅ "${desc}" → reply=${gotReply} all=${gotAll}`);
    } else {
      console.error(`    ❌ "${desc}" → reply got=${gotReply} want=${expectReply}, all got=${gotAll} want=${expectAll}`);
      allOk = false;
    }
  }
  if (allOk) pass("1-already-sent-logic", `${cases.length}/${cases.length} cas corrects`);
  else fail("1-already-sent-logic", "Certains cas échouent");
}

// ── Test 2 : Filtre DB — email avec lead_last_action "auto-envoyée" exclu ────
async function testDbFilter() {
  console.log("\n[Test 2] Filtre DB : email auto-envoyé exclu du SELECT autopilot-dispatch");

  // Insérer un email "déjà envoyé"
  const { data: inserted, error } = await sb.from("emails").insert({
    user_id: USER_ID,
    sender: "doublon.test@gmail.com",
    subject: "Test doublon",
    body: "Test",
    category: "LOCATION",
    lead_status: "qualifying",
    decision: "traiter",
    lead_last_action: "Réponse auto-envoyée",
    prospect_data: { etape_process: "QUALIFICATION" },
  }).select("id").single();

  if (error || !inserted) { fail("2-db-filter", `Erreur insert: ${error?.message}`); return; }
  const emailId = inserted.id as string;

  // Simuler la query de autopilot-dispatch (avec le filtre)
  const { data: fetched } = await sb
    .from("emails")
    .select("id, lead_last_action")
    .eq("user_id", USER_ID)
    .in("lead_status", ["qualifying", "unqualified", "slots_proposed", "other"])
    .eq("decision", "traiter")
    .or("lead_last_action.is.null,lead_last_action.not.like.%auto-envoyée%")
    .eq("id", emailId);

  if (!fetched || fetched.length === 0) {
    pass("2-db-filter", "Email 'auto-envoyée' correctement exclu par le filtre DB ✅");
  } else {
    fail("2-db-filter", `Email 'auto-envoyée' encore dans la query → doublon possible`);
  }

  // Vérifier aussi que sans le filtre il apparaîtrait
  const { data: withoutFilter } = await sb
    .from("emails")
    .select("id")
    .eq("user_id", USER_ID)
    .eq("id", emailId)
    .in("lead_status", ["qualifying"])
    .eq("decision", "traiter");

  if (withoutFilter && withoutFilter.length > 0) {
    pass("2-sanity-check", "Email présent sans filtre (confirme que le filtre est bien actif)");
  } else {
    fail("2-sanity-check", "Email absent même sans filtre — problème d'insert");
  }

  await sb.from("emails").delete().eq("id", emailId);
}

// ── Test 3 : Email non-envoyé reste dans la query ────────────────────────────
async function testDbFilterKeepsUnsent() {
  console.log("\n[Test 3] Filtre DB : email non-envoyé reste dans le SELECT");

  const { data: inserted, error } = await sb.from("emails").insert({
    user_id: USER_ID,
    sender: "doublon.unsent@gmail.com",
    subject: "Test non envoyé",
    body: "Test",
    category: "LOCATION",
    lead_status: "qualifying",
    decision: "traiter",
    lead_last_action: null,
    prospect_data: { etape_process: "QUALIFICATION" },
  }).select("id").single();

  if (error || !inserted) { fail("3-keeps-unsent", `Erreur insert: ${error?.message}`); return; }
  const emailId = inserted.id as string;

  const { data: fetched } = await sb
    .from("emails")
    .select("id, lead_last_action")
    .eq("user_id", USER_ID)
    .in("lead_status", ["qualifying", "unqualified", "slots_proposed", "other"])
    .eq("decision", "traiter")
    .or("lead_last_action.is.null,lead_last_action.not.like.%auto-envoyée%")
    .eq("id", emailId);

  if (fetched && fetched.length > 0) {
    pass("3-keeps-unsent", "Email non-envoyé (lead_last_action=null) bien inclus dans la query ✅");
  } else {
    fail("3-keeps-unsent", "Email non-envoyé absent de la query → emails légitimes exclus");
  }

  await sb.from("emails").delete().eq("id", emailId);
}

// ── Test 4 : Email avec lead_last_action "Brouillon prêt" reste inclus ───────
async function testDbFilterKeepsDraft() {
  console.log("\n[Test 4] Filtre DB : email en brouillon reste dans le SELECT");

  const { data: inserted, error } = await sb.from("emails").insert({
    user_id: USER_ID,
    sender: "doublon.draft@gmail.com",
    subject: "Test brouillon",
    body: "Test",
    category: "LOCATION",
    lead_status: "qualifying",
    decision: "traiter",
    lead_last_action: "Brouillon prêt",
    prospect_data: { etape_process: "QUALIFICATION" },
  }).select("id").single();

  if (error || !inserted) { fail("4-keeps-draft", `Erreur insert: ${error?.message}`); return; }
  const emailId = inserted.id as string;

  const { data: fetched } = await sb
    .from("emails")
    .select("id, lead_last_action")
    .eq("user_id", USER_ID)
    .in("lead_status", ["qualifying"])
    .eq("decision", "traiter")
    .or("lead_last_action.is.null,lead_last_action.not.like.%auto-envoyée%")
    .eq("id", emailId);

  if (fetched && fetched.length > 0) {
    pass("4-keeps-draft", "Email en brouillon bien inclus dans la query ✅");
  } else {
    fail("4-keeps-draft", "Email en brouillon exclu par le filtre → faux positif");
  }

  await sb.from("emails").delete().eq("id", emailId);
}

// ── Test 5 : Simulation double dispatch (la logique centrale) ────────────────
async function testDoubleDispatchSimulation() {
  console.log("\n[Test 5] Simulation double dispatch — un email, deux cycles");

  // Insérer email non traité
  const { data: inserted, error } = await sb.from("emails").insert({
    user_id: USER_ID,
    sender: "doublon.dispatch@gmail.com",
    subject: "Test double dispatch",
    body: "CDI 4200€",
    category: "LOCATION",
    lead_status: "qualifying",
    decision: "traiter",
    lead_last_action: null,
    lead_json: { autopilot_pending: true },
    prospect_data: { etape_process: "QUALIFICATION" },
  }).select("id").single();

  if (error || !inserted) { fail("5-double-dispatch", `Erreur insert: ${error?.message}`); return; }
  const emailId = inserted.id as string;

  // Cycle 1 : vérifier que l'email est dans la query
  const { data: cycle1 } = await sb
    .from("emails")
    .select("id, lead_last_action, lead_json")
    .eq("id", emailId)
    .or("lead_last_action.is.null,lead_last_action.not.like.%auto-envoyée%")
    .maybeSingle();

  if (!cycle1) { fail("5-double-dispatch", "Email absent au cycle 1 avant envoi"); await sb.from("emails").delete().eq("id", emailId); return; }
  pass("5-cycle1-inclus", "Email présent au cycle 1 (avant envoi) ✅");

  // Simuler l'envoi : mettre à jour lead_last_action + lead_json
  await sb.from("emails").update({
    lead_last_action: "Réponse auto-envoyée",
    lead_last_action_at: new Date().toISOString(),
    ai_reply: "Bonjour, voici les créneaux...",
    lead_json: { autopilot_pending: false, last_outbound: { type: "reply_sent", at: new Date().toISOString() } },
  }).eq("id", emailId);

  // Cycle 2 : vérifier que l'email est EXCLU par le filtre DB
  const { data: cycle2 } = await sb
    .from("emails")
    .select("id, lead_last_action")
    .eq("id", emailId)
    .or("lead_last_action.is.null,lead_last_action.not.like.%auto-envoyée%")
    .maybeSingle();

  if (!cycle2) {
    pass("5-cycle2-exclu", "Email EXCLU au cycle 2 après envoi ✅ — doublon impossible");
  } else {
    fail("5-cycle2-exclu", `Email encore présent au cycle 2 → doublon possible. lead_last_action=${cycle2.lead_last_action}`);
  }

  await sb.from("emails").delete().eq("id", emailId);
}

async function main() {
  console.log("=== TEST ANTI-DOUBLON AUTOPILOTE ===");

  testAlreadySentLogic();
  await testDbFilter();
  await testDbFilterKeepsUnsent();
  await testDbFilterKeepsDraft();
  await testDoubleDispatchSimulation();

  console.log("\n=== RAPPORT ===");
  for (const r of RESULTS) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} ${r.test}: ${r.details}`);
  }

  const failed = RESULTS.filter(r => r.status === "FAIL").length;
  console.log(`\nTotal: ${RESULTS.length} | ✅ ${RESULTS.filter(r => r.status === "PASS").length} | ❌ ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
