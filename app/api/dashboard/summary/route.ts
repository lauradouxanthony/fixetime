import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/* ===================== HELPERS ===================== */

function startOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
}

function endOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
}

function sinceDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function safeString(v: any) {
  if (typeof v === "string") return v;
  return "";
}

/* ===================== ROUTE ===================== */

export async function GET() {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authData.user.id;

  /* ===================== TODAY (EXISTANT, ON GARDE) ===================== */

  const todayStart = startOfTodayUTC().toISOString();
  const todayEnd = endOfTodayUTC().toISOString();

  const { count: emailsToday } = await supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("received_at", todayStart)
    .lte("received_at", todayEnd);

  const { count: urgentToday } = await supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_urgent", true)
    .gte("received_at", todayStart)
    .lte("received_at", todayEnd);

  const { data: importantEmails } = await supabase
    .from("emails")
    .select("id,sender,subject")
    .eq("user_id", userId)
    .eq("is_important", true)
    .order("received_at", { ascending: false })
    .limit(5);

  const { data: nextMeetings } = await supabase
    .from("calendar_events")
    .select("id,title,start_time,end_time")
    .eq("user_id", userId)
    .gte("start_time", todayStart)
    .lte("start_time", todayEnd)
    .order("start_time", { ascending: true })
    .limit(10);

  /* ===================== KPIs LEGACY 7 JOURS (ON GARDE) ===================== */
  /* ===================== KPIs LEGACY 7 JOURS (ON GARDE) ===================== */

  // On réutilise la même fenêtre de temps que l'IMMO (7 jours)
  const since7dISO = sinceDaysISO(7);

  // Emails "analysés" = ceux qui ont une décision IA (ton modèle FixTime)
  const { count: emailsAnalyzed7d } = await supabaseAdmin
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("received_at", since7dISO)
    .not("decision", "is", null);

  // "Décisions IA" = même base (si tu n'as pas un champ plus précis)
  const decisions7d = emailsAnalyzed7d ?? 0;

  // Minutes déléguées = somme de estimated_time (si la colonne existe)
  const { data: delegatedRows } = await supabaseAdmin
    .from("emails")
    .select("estimated_time")
    .eq("user_id", userId)
    .gte("received_at", since7dISO)
    .not("decision", "is", null)
    .limit(1000);

  const delegatedMinutes7d =
    (delegatedRows ?? []).reduce((sum: number, r: any) => {
      const v = Number(r?.estimated_time ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0) ?? 0;

  /* ===================== KPIs 7 JOURS (IMMO ROI) ===================== */

// 1) Leads entrants (tous statuts immo, sauf other/raw si tu veux “pur pipeline”)
const { count: leadsIn7d } = await supabaseAdmin
  .from("emails")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("received_at", since7dISO)
  .not("lead_status", "is", null);

// 2) Qualifiés stricts (règle métier réelle)
const { count: qualifiedStrict7d } = await supabaseAdmin
  .from("emails")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("received_at", since7dISO)
  .eq("lead_is_qualified", true);

// 3) Qualifiés opérationnels (prêts / en cours de booking)
const { count: qualifiedOperational7d } = await supabaseAdmin
  .from("emails")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("received_at", since7dISO)
  .in("lead_status", ["slots_proposed", "booked"]);

// 4) Visites confirmées
const { count: booked7d } = await supabaseAdmin
  .from("emails")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("received_at", since7dISO)
  .eq("lead_status", "booked");

// 5) Temps de réponse moyen (si tu as lead_json.first_response_at, sinon on met 0)
const { data: responseRows } = await supabaseAdmin
  .from("emails")
  .select("received_at, lead_json")
  .eq("user_id", userId)
  .gte("received_at", since7dISO)
  .not("lead_json", "is", null)
  .limit(500);

const responseMins: number[] =
  (responseRows ?? [])
    .map((r: any) => {
      const received = r?.received_at ? new Date(r.received_at).getTime() : null;
      const first = r?.lead_json?.first_action_at ? new Date(r.lead_json.first_action_at).getTime() : null;
      if (!received || !first) return null;
      const diffMin = (first - received) / 60000;
      if (!Number.isFinite(diffMin) || diffMin < 0) return null;
      return diffMin;
    })
    .filter((x: any) => typeof x === "number") as number[];

const avgResponseMin7d =
  responseMins.length > 0
    ? Math.round(responseMins.reduce((a, b) => a + b, 0) / responseMins.length)
    : 0;

// ====== ROI / FUNNEL (30 jours) ======
const since30d = new Date();
since30d.setDate(since30d.getDate() - 30);
const since30dISO = since30d.toISOString();

// Prospects "in scope" : tout ce qui n'est pas other/raw
const { count: prospects30d } = await supabaseAdmin
  .from("emails")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("received_at", since30dISO)
  .not("lead_status", "in", '("other")');

// Qualifiés : lead_is_qualified true OU slots_proposed/booked
const { count: qualified30d } = await supabaseAdmin
  .from("emails")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("received_at", since30dISO)
  .or("lead_is_qualified.eq.true,lead_status.eq.slots_proposed,lead_status.eq.booked");

// Booked
const { count: booked30d } = await supabaseAdmin
  .from("emails")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("received_at", since30dISO)
  .eq("lead_status", "booked");

// ====== COST MODEL ======
const hourlyRate = 25; // default, configurable plus tard
const humanMinutes = (prospects30d ?? 0) * 5;
const humanCost = (humanMinutes / 60) * hourlyRate;

// IA cost = 0 ici (tu pourras brancher token usage plus tard)
const aiCost = 0;


  /* ===================== NOUVEAU : ROI IMMO 7 JOURS ===================== */

  // On se base sur le pipeline lead_status (c’est ton produit)
  const { data: leadRows, error: leadErr } = await supabaseAdmin
    .from("emails")
    .select(
      "id, received_at, lead_status, lead_is_qualified, lead_last_action, lead_last_action_at, candidate_name, lead_profile, lead_property_address, subject"
    )
    .eq("user_id", userId)
    .gte("received_at", since7dISO)
    .not("lead_status", "is", null);

  if (leadErr) {
    // On n’échoue pas le dashboard : on renvoie quand même l’existant.
    return NextResponse.json({
      stats: {
        emailsToday: emailsToday ?? 0,
        urgentToday: urgentToday ?? 0,
        emailsAnalyzed7d: emailsAnalyzed7d ?? 0,
        decisions7d,
        delegatedMinutes7d,

        leadsIn7d: leadsIn7d ?? 0,
qualifiedStrict7d: qualifiedStrict7d ?? 0,
qualifiedOperational7d: qualifiedOperational7d ?? 0,
booked7d: booked7d ?? 0,
avgResponseMin7d,

      },
      importantEmails: importantEmails ?? [],
      nextMeetings: nextMeetings ?? [],
      roi: {
        leads_received_7d: 0,
        qualified_7d: 0,
        slots_proposed_7d: 0,
        booked_7d: 0,
        avg_first_action_minutes_7d: null,
        human_minutes_est_7d: 0,
        human_hours_est_7d: 0,
        hours_saved_est_7d: 0,
      },
      activity_feed: [],
    });
  }

  const rows = Array.isArray(leadRows) ? leadRows : [];

  // Funnel
  const isLead = (st: any) =>
    ["new_lead", "qualifying", "slots_proposed", "booked", "unqualified"].includes(String(st || ""));

  const leads = rows.filter((r: any) => isLead(r.lead_status));
  const leads_received_7d = leads.length;

  const slots_proposed_7d = leads.filter((r: any) => r.lead_status === "slots_proposed").length;
  const booked_7d = leads.filter((r: any) => r.lead_status === "booked").length;

  const qualified_7d = leads.filter((r: any) => {
    if (r.lead_is_qualified === true) return true;
    return r.lead_status === "slots_proposed" || r.lead_status === "booked";
  }).length;
// % AUTOPILOT (30 jours)
const { data: triggerRows } = await supabaseAdmin
  .from("emails")
  .select("lead_json")
  .eq("user_id", userId)
  .gte("received_at", since30dISO)
  .not("lead_json", "is", null)
  .limit(1000);

const autopilotCount =
  (triggerRows ?? []).filter(
    (r: any) => r?.lead_json?.first_action_trigger === "autopilot"
  ).length;

const manualCount =
  (triggerRows ?? []).filter(
    (r: any) => r?.lead_json?.first_action_trigger === "manual"
  ).length;

const autopilotRate =
  autopilotCount + manualCount > 0
    ? Math.round((autopilotCount / (autopilotCount + manualCount)) * 100)
    : 0;

  // Réactivité (received_at -> lead_last_action_at)
  const responseDelaysMin: number[] = [];
  for (const r of leads) {
    const ra = r?.received_at ? new Date(r.received_at) : null;
    const la = r?.lead_last_action_at ? new Date(r.lead_last_action_at) : null;
    if (!ra || !la) continue;
    const diff = (la.getTime() - ra.getTime()) / 60000;
    if (Number.isFinite(diff) && diff >= 0 && diff <= 60 * 24 * 7) responseDelaysMin.push(diff);
  }

  const avg_first_action_minutes_7d =
    responseDelaysMin.length > 0
      ? Math.round(
          (responseDelaysMin.reduce((a, b) => a + b, 0) / responseDelaysMin.length) * 10
        ) / 10
      : null;

  // Coût humain vs IA (estimation vendable)
  const human_minutes_est_7d = leads_received_7d * 5; // 5 min / demande
  const human_hours_est_7d = Math.round((human_minutes_est_7d / 60) * 10) / 10;
  const hours_saved_est_7d = human_hours_est_7d;

  // Live feed (15 dernières actions)
  const activity_feed = leads
    .filter((r: any) => r.lead_last_action_at)
    .sort((a: any, b: any) => {
      const ta = new Date(a.lead_last_action_at).getTime();
      const tb = new Date(b.lead_last_action_at).getTime();
      return tb - ta;
    })
    .slice(0, 15)
    .map((r: any) => {
      const candidate =
        safeString(r.candidate_name) ||
        safeString(r?.lead_profile?.prospect_name) ||
        "Candidat";
      const property =
        safeString(r.lead_property_address) || safeString(r.subject) || "Bien";
      return {
        at: r.lead_last_action_at,
        label: safeString(r.lead_last_action) || "Action IA",
        status: r.lead_status || "raw",
        candidate,
        property,
      };
    });

  /* ===================== RESPONSE ===================== */

  return NextResponse.json({
    stats: {
      // EXISTANT (inchangé)
      emailsToday: emailsToday ?? 0,
      urgentToday: urgentToday ?? 0,

      // LEGACY (on garde pour compat)
      emailsAnalyzed7d: emailsAnalyzed7d ?? 0,
      decisions7d,
      delegatedMinutes7d,
    },
    importantEmails: importantEmails ?? [],
    nextMeetings: nextMeetings ?? [],

    // NOUVEAU ROI IMMO
    roi: {
      funnel: {
        prospects30d: prospects30d ?? 0,
        qualified30d: qualified30d ?? 0,
        booked30d: booked30d ?? 0,
        automation: {
          autopilot_rate_percent: autopilotRate,
          autopilot_count: autopilotCount,
          manual_count: manualCount,
        },
        
      },
      cost: {
        hourly_rate: hourlyRate,
        human_minutes_est: humanMinutes,
        human_cost_est: Math.round(humanCost),
        ai_cost_est: aiCost,
      },
    },
    

    activity_feed,
  });
}
