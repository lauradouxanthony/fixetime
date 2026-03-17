import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Endpoint admin pour reparer les emails avec decision="traiter" mais lead_status=null et lead_json=null.
 * 
 * Ces emails ne sont jamais re-analyses car la requete filtre sur lead_json/lead_status.
 * 
 * Securise par le header x-fixetime-cron-key.
 * 
 * Query params:
 * - user_id (optionnel): reparer uniquement pour ce user
 * 
 * Exemple:
 * curl -X POST "http://localhost:3000/api/internal/repair-unanalysed?user_id=..." \
 *   -H "x-fixetime-cron-key: dev123"
 */
export async function POST(req: Request) {
  const cronKey = req.headers.get("x-fixetime-cron-key");
  if (!cronKey || cronKey !== (process.env.FIXETIME_INTERNAL_CRON_KEY || "dev123")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sinceISO = thirtyDaysAgo.toISOString();

  // D'abord compter les emails a reparer
  let countQuery = supabaseAdmin
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("decision", "traiter")
    .is("lead_status", null)
    .is("lead_json", null)
    .gte("received_at", sinceISO);

  if (userId) {
    countQuery = countQuery.eq("user_id", userId);
  }

  const { count, error: countError } = await countQuery;

  if (countError) {
    console.error("[REPAIR_UNANALYSED] Count error", countError);
    return NextResponse.json({ error: "REPAIR_FAILED", details: countError.message }, { status: 500 });
  }

  // Ensuite faire l'update
  let updateQuery = supabaseAdmin
    .from("emails")
    .update({ decision: null })
    .eq("decision", "traiter")
    .is("lead_status", null)
    .is("lead_json", null)
    .gte("received_at", sinceISO);

  if (userId) {
    updateQuery = updateQuery.eq("user_id", userId);
  }

  const { error: updateError } = await updateQuery;

  if (updateError) {
    console.error("[REPAIR_UNANALYSED] Update error", updateError);
    return NextResponse.json({ error: "REPAIR_FAILED", details: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    repaired_count: count ?? 0,
    since: sinceISO,
    user_id: userId || "all",
  });
}
