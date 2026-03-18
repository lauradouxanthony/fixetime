/**
 * GET /api/admin/migrate-prospects
 * Endpoint one-shot : crée les prospects depuis les emails LOCATION existants.
 * - Groupe les emails par sender (= 1 prospect)
 * - Prend le prospect_data le plus riche (fusion cumulative)
 * - Lie tous les emails du groupe au prospect créé
 *
 * PEUT ÊTRE SUPPRIMÉ après exécution réussie.
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { upsertProspect } from "@/lib/prospects/upsertProspect";
import { isSpamSender } from "@/lib/prospects/isSpamSender";

export const runtime = "nodejs";
export const maxDuration = 60;

function extractEmailAddress(sender: string | null | undefined): string | null {
  if (!sender) return null;
  const m = sender.match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim();
  if (sender.includes("@") && !sender.includes(" ")) return sender.trim();
  return null;
}

/** Fusionne cumulativement deux prospect_data. Le champ existant prime (non-destructif). */
function mergeData(
  base: Record<string, unknown>,
  incoming: Record<string, unknown> | null
): Record<string, unknown> {
  if (!incoming) return base;
  const result = { ...base };

  const STEP_ORDER = ["NEW", "QUALIFICATION", "VISITE_PROPOSEE", "VISITE_CONFIRMEE", "DOSSIER_DEMANDE", "DOSSIER_RECU", "VALIDE", "REFUSE"];

  for (const [k, v] of Object.entries(incoming)) {
    if (k === "etape_process") {
      const cur = result.etape_process as string | undefined;
      const inc = v as string | undefined;
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

export async function GET(req: Request) {
  // Authentification
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";

  try {
    // ── 1. Récupérer tous les emails LOCATION ──────────────────────────────
    const { data: locationEmails, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, received_at, prospect_data, property_id, lead_score, prospect_id")
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .order("received_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "FETCH_FAILED", details: error.message }, { status: 500 });
    }

    const emails = locationEmails ?? [];

    // ── 2. Grouper par adresse email sender ───────────────────────────────
    const groups = new Map<string, typeof emails>();

    for (const email of emails) {
      const addr = extractEmailAddress(email.sender as string | null);
      if (!addr) continue;
      // Exclure les expéditeurs automatiques/spam
      if (isSpamSender(email.sender as string | null, email.subject as string | null)) continue;
      if (!groups.has(addr)) groups.set(addr, []);
      groups.get(addr)!.push(email);
    }

    // ── 3. Pour chaque groupe → créer/mettre à jour 1 prospect ───────────
    let prospectsCreated = 0;
    let prospectsUpdated = 0;
    let emailsLinked = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [senderEmail, emailGroup] of groups) {
      try {
        // Fusionner tous les prospect_data du groupe (du plus ancien au plus récent)
        let mergedData: Record<string, unknown> = {};
        let maxLeadScore = 0;
        let propertyId: string | null = null;

        for (const e of emailGroup) {
          if (e.prospect_data && typeof e.prospect_data === "object") {
            mergedData = mergeData(mergedData, e.prospect_data as Record<string, unknown>);
          }
          if (typeof e.lead_score === "number" && e.lead_score > maxLeadScore) {
            maxLeadScore = e.lead_score;
          }
          if (!propertyId && e.property_id) {
            propertyId = e.property_id as string;
          }
        }

        // Check si prospect déjà lié (tous les emails du groupe ont déjà un prospect_id)
        const alreadyLinked = emailGroup.every((e) => e.prospect_id != null);
        if (alreadyLinked) {
          skipped++;
          continue;
        }

        if (!dryRun) {
          const garant = (() => {
            const g = mergedData.garant;
            if (typeof g === "boolean") return g;
            if (g === "OUI") return true;
            if (g === "NON") return false;
            return null;
          })();
          const animaux = (() => {
            const a = mergedData.animaux;
            if (typeof a === "boolean") return a;
            if (a === "OUI") return true;
            if (a === "NON") return false;
            return null;
          })();

          // Utiliser le dernier email comme emailId de référence
          const lastEmail = emailGroup[emailGroup.length - 1];

          const wasExisting = await supabaseAdmin
            .from("prospects")
            .select("id")
            .eq("user_id", user.id)
            .eq("email", senderEmail)
            .maybeSingle()
            .then(({ data }) => !!data);

          await upsertProspect(user.id, lastEmail.id, {
            email: senderEmail,
            nom: (mergedData.nom as string | null) ?? (mergedData.nom_prenom as string | null) ?? null,
            telephone: (mergedData.telephone as string | null) ?? null,
            situation_pro: (mergedData.situation_pro as string | null) ?? null,
            revenus_mensuels: typeof mergedData.revenus_mensuels === "number" ? mergedData.revenus_mensuels : null,
            garant,
            nb_personnes: typeof mergedData.nb_personnes === "number" ? mergedData.nb_personnes : null,
            animaux,
            property_id: propertyId,
            etape_process: (mergedData.etape_process as string | null) ?? null,
            lead_score: maxLeadScore > 0 ? maxLeadScore : null,
          });

          // Récupérer le prospect_id créé et lier TOUS les emails du groupe
          const { data: prospect } = await supabaseAdmin
            .from("prospects")
            .select("id")
            .eq("user_id", user.id)
            .eq("email", senderEmail)
            .maybeSingle();

          if (prospect) {
            // Lier tous les emails (pas seulement le dernier)
            const otherEmailIds = emailGroup.slice(0, -1).map((e) => e.id);
            if (otherEmailIds.length > 0) {
              await supabaseAdmin
                .from("emails")
                .update({ prospect_id: prospect.id })
                .in("id", otherEmailIds);
              emailsLinked += otherEmailIds.length;
            }
            emailsLinked++; // le dernier email est lié par upsertProspect

            if (wasExisting) prospectsUpdated++;
            else prospectsCreated++;
          }
        } else {
          // Dry run : juste compter
          prospectsCreated++;
          emailsLinked += emailGroup.length;
        }
      } catch (err: any) {
        errors.push(`${senderEmail}: ${err?.message ?? "unknown"}`);
        console.error(`[MIGRATE-PROSPECTS] Erreur pour ${senderEmail}:`, err?.message);
      }
    }

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      total_groups: groups.size,
      prospects_created: prospectsCreated,
      prospects_updated: prospectsUpdated,
      emails_linked: emailsLinked,
      skipped_already_linked: skipped,
      errors: errors.length > 0 ? errors : undefined,
      message: dryRun
        ? `[DRY RUN] ${groups.size} groupes détectés → ${prospectsCreated} prospects à créer, ${emailsLinked} emails à lier`
        : `Migration terminée : ${prospectsCreated} créés, ${prospectsUpdated} mis à jour, ${emailsLinked} emails liés, ${skipped} déjà liés`,
    });
  } catch (err) {
    console.error("[MIGRATE-PROSPECTS] Fatal:", err);
    return NextResponse.json({ error: "MIGRATION_FAILED" }, { status: 500 });
  }
}
