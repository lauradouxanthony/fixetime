/**
 * Script de migration prospects (dry-run + réel)
 * Usage: node scripts/test-migrate-dry.mjs        → dry-run
 *        node scripts/test-migrate-dry.mjs --real  → migration réelle
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// Lire .env.local
const envPath = join(__dir, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
const env = Object.fromEntries(
  envContent
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function extractEmailAddress(sender) {
  if (!sender) return null;
  const m = sender.match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim();
  if (sender.includes("@") && !sender.includes(" ")) return sender.trim();
  return null;
}

const SENDER_BLACKLIST = [
  "noreply", "no-reply", "donotreply", "do-not-reply", "mailer",
  "notification", "newsletter", "facebook.com", "revolut.com",
  "google.com", "apple.com", "linkedin.com", "twitter.com", "instagram.com",
];
const SUBJECT_BLACKLIST = [
  "abonnement", "facture", "invoice", "receipt",
  "confirmation de commande", "your order", "verify your", "reset your password",
];

function isSpamSender(sender, subject) {
  const senderLow = (sender ?? "").toLowerCase();
  const subjectLow = (subject ?? "").toLowerCase();
  if (SENDER_BLACKLIST.some((p) => senderLow.includes(p))) return true;
  if (SUBJECT_BLACKLIST.some((p) => subjectLow.includes(p))) return true;
  return false;
}

const STEP_ORDER = ["NEW", "QUALIFICATION", "VISITE_PROPOSEE", "VISITE_CONFIRMEE", "DOSSIER_DEMANDE", "DOSSIER_RECU", "VALIDE", "REFUSE"];

function mergeData(base, incoming) {
  if (!incoming) return base;
  const result = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "etape_process") {
      const cur = result.etape_process;
      const inc = v;
      if (!cur || !inc) { result[k] = v; continue; }
      const curIdx = STEP_ORDER.indexOf(cur);
      const incIdx = STEP_ORDER.indexOf(inc);
      if (incIdx > curIdx) result[k] = v;
      continue;
    }
    const existing = result[k];
    if ((existing === null || existing === undefined || existing === "") && v !== null && v !== undefined && v !== "") {
      result[k] = v;
    }
  }
  return result;
}

const IS_REAL = process.argv.includes("--real");
let prospectsCreatedReal = 0;
let prospectsUpdatedReal = 0;
let emailsLinkedReal = 0;

async function upsertProspectDirect(supabase, userId, emailId, data) {
  // 1. Chercher prospect existant
  const { data: existing } = await supabase
    .from("prospects")
    .select("id, etape_process, revenus_mensuels, lead_score")
    .eq("user_id", userId)
    .eq("email", data.email)
    .maybeSingle();

  if (existing) {
    // Mise à jour non-destructive
    const patch = {};
    if (!existing.revenus_mensuels && data.revenus_mensuels) patch.revenus_mensuels = data.revenus_mensuels;
    if (data.nom && !existing.nom) patch.nom = data.nom;
    if (data.situation_pro && !existing.situation_pro) patch.situation_pro = data.situation_pro;
    if (data.lead_score > (existing.lead_score ?? 0)) patch.lead_score = data.lead_score;
    // Étape : avance seulement
    const curIdx = STEP_ORDER.indexOf(existing.etape_process ?? "NEW");
    const incIdx = STEP_ORDER.indexOf(data.etape ?? "NEW");
    if (incIdx > curIdx) patch.etape_process = data.etape;
    if (Object.keys(patch).length > 0) {
      await supabase.from("prospects").update(patch).eq("id", existing.id);
    }
    await supabase.from("emails").update({ prospect_id: existing.id }).eq("id", emailId);
    return { id: existing.id, created: false };
  }

  // 2. INSERT
  const { data: created, error } = await supabase
    .from("prospects")
    .insert({
      user_id: userId,
      email: data.email,
      nom: data.nom ?? null,
      situation_pro: data.situation_pro ?? null,
      revenus_mensuels: data.revenus_mensuels ?? null,
      etape_process: data.etape ?? "NEW",
      lead_score: data.lead_score ?? 0,
      property_id: data.property_id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await supabase.from("emails").update({ prospect_id: created.id }).eq("id", emailId);
  return { id: created.id, created: true };
}

async function main() {
  console.log(IS_REAL ? "🚀 Migration RÉELLE prospects\n" : "🔍 Dry-run migration prospects\n");

  // 1. Récupérer tous les users
  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 100 });
  if (!users?.users?.length) {
    console.log("Aucun utilisateur trouvé.");
    return;
  }

  for (const user of users.users) {
    console.log(`\n👤 User: ${user.email} (${user.id})`);

    // 2. Emails LOCATION
    const { data: locationEmails, error } = await supabase
      .from("emails")
      .select("id, sender, subject, received_at, prospect_data, property_id, lead_score, prospect_id")
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .order("received_at", { ascending: true });

    if (error) {
      console.log(`  ❌ Erreur fetch emails: ${error.message}`);
      continue;
    }

    const emails = locationEmails ?? [];
    console.log(`  📧 ${emails.length} emails LOCATION`);

    if (emails.length === 0) continue;

    // 3. Grouper par sender
    const groups = new Map();
    let spamSkipped = 0;
    for (const email of emails) {
      const addr = extractEmailAddress(email.sender);
      if (!addr) continue;
      if (isSpamSender(email.sender, email.subject)) { spamSkipped++; continue; }
      if (!groups.has(addr)) groups.set(addr, []);
      groups.get(addr).push(email);
    }
    if (spamSkipped > 0) console.log(`  🚫 ${spamSkipped} emails exclus (spam/auto)`);

    console.log(`  📦 ${groups.size} groupes (= prospects potentiels)`);

    let toCreate = 0, alreadyLinked = 0;
    const details = [];

    for (const [senderEmail, emailGroup] of groups) {
      const isLinked = emailGroup.every((e) => e.prospect_id != null);
      if (isLinked) { alreadyLinked++; continue; }

      let mergedData = {};
      let maxLeadScore = 0;
      let propertyId = null;

      for (const e of emailGroup) {
        if (e.prospect_data && typeof e.prospect_data === "object") {
          mergedData = mergeData(mergedData, e.prospect_data);
        }
        if (typeof e.lead_score === "number" && e.lead_score > maxLeadScore) maxLeadScore = e.lead_score;
        if (!propertyId && e.property_id) propertyId = e.property_id;
      }

      const detail = {
        email: senderEmail,
        nom: mergedData.nom ?? mergedData.nom_prenom ?? null,
        etape: mergedData.etape_process ?? "NEW",
        revenus: mergedData.revenus_mensuels ?? null,
        situation_pro: mergedData.situation_pro ?? null,
        lead_score: maxLeadScore,
        email_count: emailGroup.length,
        property_id: propertyId,
        emailIds: emailGroup.map((e) => e.id),
        lastEmailId: emailGroup[emailGroup.length - 1].id,
      };
      toCreate++;
      details.push(detail);

      if (IS_REAL) {
        try {
          const result = await upsertProspectDirect(supabase, user.id, detail.lastEmailId, detail);
          // Lier tous les autres emails du groupe
          const otherIds = detail.emailIds.slice(0, -1);
          if (otherIds.length > 0) {
            await supabase.from("emails").update({ prospect_id: result.id }).in("id", otherIds);
            emailsLinkedReal += otherIds.length;
          }
          emailsLinkedReal++; // le dernier email
          if (result.created) prospectsCreatedReal++;
          else prospectsUpdatedReal++;
        } catch (err) {
          console.log(`  ❌ Erreur pour ${senderEmail}: ${err.message}`);
        }
      }
    }

    console.log(`\n  ✅ Déjà liés      : ${alreadyLinked}`);
    console.log(`  🆕 ${IS_REAL ? "Créés" : "À créer"} : ${toCreate}`);

    if (!IS_REAL && details.length > 0) {
      console.log(`\n  Détail des prospects à créer :`);
      console.log(`  ${"Email".padEnd(35)} ${"Nom".padEnd(20)} ${"Étape".padEnd(20)} ${"Score".padEnd(6)} ${"Emails"}`);
      console.log(`  ${"-".repeat(100)}`);
      for (const d of details) {
        console.log(
          `  ${d.email.padEnd(35)} ${(d.nom ?? "—").padEnd(20)} ${d.etape.padEnd(20)} ${String(d.lead_score).padEnd(6)} ${d.email_count}`
        );
      }
    }

    if (IS_REAL) {
      console.log(`\n  ══ Résultat migration ══`);
      console.log(`  🆕 Prospects créés   : ${prospectsCreatedReal}`);
      console.log(`  🔄 Prospects mis à jour : ${prospectsUpdatedReal}`);
      console.log(`  📧 Emails liés       : ${emailsLinkedReal}`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
