import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function getProviders(userId: string) {
  const [g, m] = await Promise.all([
    supabaseAdmin.from("gmail_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("microsoft_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  return {
    google: !!g?.data?.user_id,
    microsoft: !!m?.data?.user_id,
  };
}

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

  const url = new URL(req.url);
  const period = (url.searchParams.get("period") || "7d") as "7d" | "30d";

  const fromIso =
    period === "30d"
      ? isoDaysAgo(30)
      : isoDaysAgo(7);

  const yesterdayIso = isoDaysAgo(1);

  // Query 1: Emails sur la période (avec plus de champs pour anomalies)
  const { data: rows, error } = await supabaseAdmin
    .from("emails")
    .select("id, received_at, lead_status, lead_json, property_id, decision, lead_is_qualified, lead_score, ai_reply")
    .eq("user_id", user.id)
    .gte("received_at", fromIso)
    .order("received_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "DASHBOARD_FETCH_FAILED" }, { status: 500 });
  }

  const emails = rows ?? [];

  // Query 2: Activity log (pour ROI + autopilot + feed + errors)
  const ROI_ACTION_TYPES = ["email_analyzed", "lead_qualified", "visit_booked", "proposal_sent", "reply_sent"];
  const AUTOPILOT_TYPES = ["proposal_sent", "reply_sent"];
  const [activityRes, activityFeedRes, activityErrorsRes] = await Promise.all([
    supabaseAdmin
      .from("activity_log")
      .select("actor, type")
      .eq("user_id", user.id)
      .gte("created_at", fromIso)
      .in("type", ROI_ACTION_TYPES),
    supabaseAdmin
      .from("activity_log")
      .select("id, created_at, title, meta, type, actor")
      .eq("user_id", user.id)
      .gte("created_at", fromIso)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("activity_log")
      .select("id")
      .eq("user_id", user.id)
      .eq("type", "error")
      .gte("created_at", yesterdayIso),
  ]);

  const actionList = activityRes.data ?? [];
  const activityRows = activityFeedRes.data ?? [];
  const errorsLast24h = activityErrorsRes.data?.length ?? 0;

  // Query 3: Settings pour hourly_cost
  const { data: settingsRow } = await supabaseAdmin
    .from("settings_v1")
    .select("config")
    .eq("user_id", user.id)
    .maybeSingle();
  const hourlyCost = (settingsRow?.config as any)?.hourly_cost ?? 35;

  // Query 4: Providers + backlog + lastActivity
  const [providers, inboxStateRes, lastActivityRes] = await Promise.all([
    getProviders(user.id),
    supabaseAdmin
      .from("inbox_state")
      .select("remaining_to_analyze")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("activity_log")
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const backlog = inboxStateRes.data?.remaining_to_analyze ?? null;
  const lastActivityAt = lastActivityRes.data?.created_at ?? null;

  // Funnel
  const prospects = emails.length;
  const qualified = emails.filter((e) => {
    if (e.lead_is_qualified === true) return true;
    if (typeof e.lead_score === "number" && e.lead_score >= 8) return true;
    if (e.lead_status === "slots_proposed" || e.lead_status === "booked") return true;
    return false;
  }).length;
  const slotsProposed = emails.filter((e) => e.lead_status === "slots_proposed").length;
  const booked = emails.filter((e) => e.lead_status === "booked").length;

  // ROI: AI actions
  const aiActions = actionList.filter((x: any) => x.actor === "ai").length;
  const savedMinutes = aiActions * 5;
  const heuresEconomisees = savedMinutes / 60;
  const savedEuros = heuresEconomisees * hourlyCost;

  const prospectsTraites = emails.filter((e) => e.decision != null || e.lead_status != null).length;
  const visitesOrganisees = booked;

  // Autopilot rate: proposal_sent + reply_sent
  const autopilotBase = actionList.filter((x: any) => AUTOPILOT_TYPES.includes(x.type)).length;
  const autopilotAi = actionList.filter((x: any) => x.actor === "ai" && AUTOPILOT_TYPES.includes(x.type)).length;
  const autopilotRate = autopilotBase > 0 ? Math.round((autopilotAi / autopilotBase) * 100) : 0;

  // Average response time
  const responseDiffsMin: number[] = [];
  for (const e of emails) {
    const received = e.received_at ? new Date(e.received_at).getTime() : null;
    const lob = (e.lead_json as any)?.last_outbound;
    const outAt = lob?.at ? new Date(lob.at).getTime() : lob?.sent_at ? new Date(lob.sent_at).getTime() : null;
    if (received && outAt && outAt >= received) {
      responseDiffsMin.push((outAt - received) / (60 * 1000));
    }
  }
  const avgResponseMin =
    responseDiffsMin.length > 0
      ? Math.max(0, Math.round(responseDiffsMin.reduce((a, b) => a + b, 0) / responseDiffsMin.length))
      : 0;

  // valeur_pipeline : somme des loyers des leads qualifiés
  const qualifiedLeads = emails.filter((e) => {
    if (e.lead_is_qualified === true) return true;
    if (typeof e.lead_score === "number" && e.lead_score >= 8) return true;
    if (e.lead_status === "slots_proposed" || e.lead_status === "booked") return true;
    return false;
  });

  let valeurPipeline = 0;
  const qualifiedPropertyIds: string[] = Array.from(
    new Set(
      qualifiedLeads
        .map((e) => e.property_id as string | null)
        .filter((id): id is string => !!id)
    )
  );

  let propsFromDb: { id: string; rent?: number | null }[] = [];
  if (qualifiedPropertyIds.length > 0) {
    const { data: props } = await supabaseAdmin
      .from("properties")
      .select("id, rent")
      .in("id", qualifiedPropertyIds)
      .not("rent", "is", null);
    propsFromDb = props ?? [];
    valeurPipeline = propsFromDb.reduce((sum, p) => sum + (p.rent ?? 0), 0);
  }

  // Fallback : lead_json.rent
  for (const e of qualifiedLeads) {
    const lj = e.lead_json as any;
    const rentFromJson = typeof lj?.rent === "number" ? lj.rent : null;
    if (rentFromJson != null && rentFromJson > 0) {
      const pid = e.property_id as string | null;
      const foundInDb = !!pid && propsFromDb.some((p) => p.id === pid);
      if (!foundInDb) valeurPipeline += rentFromJson;
    }
  }

  // Anomalies (max 5)
  const anomalies: Array<{ key: string; count: number; sample_ids: string[] }> = [];
  const bookedNoProperty = emails.filter((e) => e.lead_status === "booked" && !e.property_id);
  if (bookedNoProperty.length > 0) {
    anomalies.push({
      key: "booked_no_property_id",
      count: bookedNoProperty.length,
      sample_ids: bookedNoProperty.slice(0, 3).map((e) => e.id),
    });
  }

  const slotsNoSlots = emails.filter((e) => {
    if (e.lead_status !== "slots_proposed") return false;
    const lj = e.lead_json as any;
    const slots = Array.isArray(lj?.slots_proposed) ? lj.slots_proposed : [];
    return slots.length < 3;
  });
  if (slotsNoSlots.length > 0) {
    anomalies.push({
      key: "slots_no_slots",
      count: slotsNoSlots.length,
      sample_ids: slotsNoSlots.slice(0, 3).map((e) => e.id),
    });
  }

  const analyzedNoDecision = emails.filter((e) => {
    const lj = e.lead_json as any;
    return lj != null && e.decision == null;
  });
  if (analyzedNoDecision.length > 0) {
    anomalies.push({
      key: "analyzed_no_decision",
      count: analyzedNoDecision.length,
      sample_ids: analyzedNoDecision.slice(0, 3).map((e) => e.id),
    });
  }

  const aiReplyMissing = emails.filter((e) => {
    if (e.lead_status !== "qualifying" && e.lead_status !== "slots_proposed") return false;
    return !e.ai_reply?.trim();
  });
  if (aiReplyMissing.length > 0) {
    anomalies.push({
      key: "ai_reply_missing",
      count: aiReplyMissing.length,
      sample_ids: aiReplyMissing.slice(0, 3).map((e) => e.id),
    });
  }

  // Feed enrichi
  const mapToBusinessTitle = (a: { type?: string | null; title?: string | null; meta?: any }) => {
    const type = String(a.type || "").toLowerCase();
    const title = (a.title || "").trim();
    const meta = (a.meta || {}) as Record<string, any>;
    const prospect = meta.prospect_name || meta.prospectName;
    const property = meta.property || meta.property_address;

    if (title.toLowerCase().includes("body fetch") || title.toLowerCase().includes("fetch vide") || (type === "error" && title.toLowerCase().includes("corps"))) {
      return "Erreur: corps email indisponible";
    }
    if (type === "email_analyzed" || title.toLowerCase().includes("email analysé")) {
      const suffix = prospect ? ` — ${prospect}` : "";
      return `Email analysé${suffix}`;
    }
    if (type === "slots_generated" || title.toLowerCase().includes("créneaux")) {
      return "Créneaux générés";
    }
    if (type === "ai_reply_sent" || title.toLowerCase().includes("réponse envoyée")) {
      const suffix = prospect ? ` — ${prospect}` : "";
      return `Réponse envoyée${suffix}`;
    }
    if (type === "proposal_sent" || title.toLowerCase().includes("proposition") || title.toLowerCase().includes("proposal")) {
      const suffix = prospect ? ` — ${prospect}` : property ? ` — ${property}` : "";
      return `Proposition envoyée${suffix}`;
    }
    if (type === "visit_booked" || title.toLowerCase().includes("visite confirmée") || title.toLowerCase().includes("confirmée")) {
      const suffix = prospect ? ` — ${prospect}` : "";
      return `Visite confirmée${suffix}`;
    }
    if (type === "error") {
      return title || "Erreur: corps email indisponible";
    }
    return title || "Action";
  };

  const feed = activityRows.map((a) => ({
    id: a.id,
    at: a.created_at as string,
    text: mapToBusinessTitle(a),
    status: ((a.meta as any)?.lead_status || a.type || "info") as string,
    actor: (a.actor || "system") as string,
    type: a.type || null,
  }));

  return NextResponse.json({
    period,
    funnel: { prospects, qualified, slotsProposed, booked },
    roi: {
      savedMinutes,
      savedEuros: Math.round(savedEuros * 100) / 100,
      autopilotRate,
      avgResponseMin,
      prospects_traites: prospectsTraites,
      visites_organisees: visitesOrganisees,
      heures_economisees: Math.round(heuresEconomisees * 10) / 10,
      valeur_pipeline: valeurPipeline,
    },
    health: {
      providers,
      backlog: { remaining_to_analyze: backlog },
      lastActivityAt,
      errorsLast24h,
    },
    anomalies: anomalies.slice(0, 5),
    feed,
  });
}
