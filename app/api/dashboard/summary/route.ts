import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayEnd() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authData.user.id;
  const since7d = daysAgo(7);

  // ── MÉTRIQUES GLOBALES ──────────────────────────────────────────
  const [
    { count: emailsTraites },
    { count: rdvPris },
    { data: emailsWithTime },
    { data: intentions },
  ] = await Promise.all([
    // Emails traités (decision != ignorer, 7 derniers jours)
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("decision", "ignorer")
      .not("decision", "is", null)
      .gte("received_at", since7d),

    // RDV pris (calendar events créés dans les 7 derniers jours)
    supabase
      .from("calendar_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since7d),

    // Temps économisé (sum estimated_time)
    supabase
      .from("emails")
      .select("estimated_time")
      .eq("user_id", userId)
      .gte("received_at", since7d)
      .not("estimated_time", "is", null),

    // Répartition intentions
    supabase
      .from("emails")
      .select("category")
      .eq("user_id", userId)
      .gte("received_at", since7d)
      .not("category", "is", null),
  ]);

  // Heures économisées (2 min /email traitée)
  const totalMinutesSaved = (emailsWithTime || []).reduce(
    (sum, e) => sum + (e.estimated_time ?? 0),
    0
  );
  const heuresSaved = Math.round(totalMinutesSaved / 60 * 10) / 10;

  // Répartition intentions
  const intentionCounts = { LOCATION: 0, INFO: 0, HORS_SUJET: 0 };
  for (const e of intentions || []) {
    const cat = (e.category || "").toUpperCase();
    if (cat in intentionCounts) intentionCounts[cat as keyof typeof intentionCounts]++;
  }

  // ── GRAPHIQUE 7 JOURS ────────────────────────────────────────────
  const { data: emailsByDay } = await supabase
    .from("emails")
    .select("received_at, decision")
    .eq("user_id", userId)
    .gte("received_at", since7d)
    .order("received_at", { ascending: true });

  const { data: rdvByDay } = await supabase
    .from("calendar_events")
    .select("created_at")
    .eq("user_id", userId)
    .gte("created_at", since7d)
    .order("created_at", { ascending: true });

  // Générer les 7 derniers jours
  const days7: { label: string; date: string; emails: number; rdv: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    days7.push({
      label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }),
      date: dateStr,
      emails: 0,
      rdv: 0,
    });
  }

  for (const e of emailsByDay || []) {
    const dateStr = e.received_at?.split("T")[0];
    const day = days7.find((d) => d.date === dateStr);
    if (day) day.emails++;
  }

  for (const r of rdvByDay || []) {
    const dateStr = (r.created_at as string)?.split("T")[0];
    const day = days7.find((d) => d.date === dateStr);
    if (day) day.rdv++;
  }

  // ── ACTIVITÉ RÉCENTE ─────────────────────────────────────────────
  const { data: recentActivity } = await supabase
    .from("emails")
    .select("id, sender, subject, decision, category, received_at, is_urgent")
    .eq("user_id", userId)
    .not("decision", "is", null)
    .order("received_at", { ascending: false })
    .limit(5);

  // ── RDV AUJOURD'HUI ──────────────────────────────────────────────
  const { data: nextMeetings } = await supabase
    .from("calendar_events")
    .select("id, title, start_time, end_time")
    .eq("user_id", userId)
    .gte("start_time", todayStart())
    .lte("start_time", todayEnd())
    .order("start_time", { ascending: true })
    .limit(5);

  return NextResponse.json({
    metrics: {
      emailsTraites: emailsTraites ?? 0,
      rdvPris: rdvPris ?? 0,
      heuresSaved,
      tempsReponseMoyen: 4, // minutes (valeur fixe pour MVP)
    },
    intentions: intentionCounts,
    graph7d: days7,
    recentActivity: recentActivity ?? [],
    nextMeetings: nextMeetings ?? [],
  });
}
