import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authData.user.id;
  const since30d = daysAgo(30);
  const since7d = daysAgo(7);
  const weekEnd = daysFromNow(7);

  // ── TOUTES LES DONNÉES EN PARALLÈLE ────────────────────────────────
  const [
    { count: totalEmailsMois },
    { count: rdvSemaine },
    { count: visitesConfirmees },
    { count: relancesAuto },
    { data: locationEmails30d },
    { data: allEmails30d },
    { data: intentions7d },
    { data: rdvAll30d },
    { data: actionsRequises },
    { data: prochainRdv },
    { data: recentActivity },
  ] = await Promise.all([
    // 1. Emails reçus ce mois (tous)
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("received_at", since30d),

    // 2. RDV semaine : events dans les 7 prochains jours
    supabase
      .from("calendar_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("start_time", todayStart())
      .lte("start_time", weekEnd),

    // 3. Visites confirmées ce mois (etape_process = VISITE_CONFIRMEE)
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .gte("received_at", since30d)
      .filter("prospect_data->>etape_process", "eq", "VISITE_CONFIRMEE"),

    // 4. Relances auto envoyées (30j)
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("received_at", since30d)
      .gt("relance_count", 0)
      .not("last_relance_at", "is", null),

    // 5. Emails LOCATION 30j avec prospect_data (pour leads qualifiés + graph)
    supabase
      .from("emails")
      .select("received_at, prospect_data, ai_reply, created_at")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .gte("received_at", since30d)
      .order("received_at", { ascending: true })
      .limit(300),

    // 6. Emails LOCATION 30j (pour heuristique dossiers + temps réponse + leads qualifiés)
    supabase
      .from("emails")
      .select("id, body, summary, ai_reply, received_at, created_at, prospect_data")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .gte("received_at", since30d)
      .limit(200),

    // 7. Répartition intentions 7j
    supabase
      .from("emails")
      .select("category")
      .eq("user_id", userId)
      .gte("received_at", since7d)
      .not("category", "is", null),

    // 8. RDV 30j (graph)
    supabase
      .from("calendar_events")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", since30d)
      .order("created_at", { ascending: true }),

    // 9. Actions requises (emails LOCATION sans réponse IA)
    supabase
      .from("emails")
      .select("id, sender, subject, received_at, is_urgent, summary")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .is("ai_reply", null)
      .neq("decision", "ignorer")
      .order("is_urgent", { ascending: false })
      .order("received_at", { ascending: true })
      .limit(5),

    // 10. Prochains RDV
    supabase
      .from("calendar_events")
      .select("id, title, start_time, end_time")
      .eq("user_id", userId)
      .gte("start_time", todayStart())
      .lte("start_time", weekEnd)
      .order("start_time", { ascending: true })
      .limit(5),

    // 11. Activité récente
    supabase
      .from("emails")
      .select("id, sender, subject, decision, category, received_at, is_urgent")
      .eq("user_id", userId)
      .not("decision", "is", null)
      .order("received_at", { ascending: false })
      .limit(5),
  ]);

  // ── CALCULS MÉTRIQUES ROI ─────────────────────────────────────────

  // Leads qualifiés = emails LOCATION avec situation + revenus renseignés
  let leadsQualifies = 0;
  let emailsTraites = 0;
  let totalReponseMsSum = 0;
  let reponseMsCount = 0;

  for (const e of allEmails30d ?? []) {
    const pd = e.prospect_data as Record<string, unknown> | null;
    if (pd?.situation_pro && pd?.revenus_mensuels) {
      leadsQualifies++;
    }
    if (e.ai_reply) {
      emailsTraites++;
      // Temps moyen réponse IA : différence entre received_at et created_at (approximation)
      // Note : on n'a pas le timestamp exact d'envoi de l'ai_reply
      // Utiliser received_at comme base, l'analyse se fait généralement dans les 5 min
    }
  }

  // Emails LOCATION avec leads actifs
  const leadsActifs = (locationEmails30d ?? []).filter(e => {
    const pd = e.prospect_data as Record<string, unknown> | null;
    const etape = pd?.etape_process as string | null;
    return etape && etape !== "REFUSE" && etape !== "VALIDE";
  }).length;

  // Taux email → visite (%)
  const emailsLocationTotal = (locationEmails30d ?? []).length;
  const visitesCount = visitesConfirmees ?? 0;
  const tauxEmailVisite = emailsLocationTotal > 0
    ? Math.round((visitesCount / emailsLocationTotal) * 100)
    : 0;

  // Taux réponse IA
  const totalNonHorsSupjet = (allEmails30d ?? []).length;
  const totalReplies = (allEmails30d ?? []).filter(e => e.ai_reply).length;
  const tauxReponseIA = totalNonHorsSupjet > 0
    ? Math.min(100, Math.round((totalReplies / totalNonHorsSupjet) * 100))
    : 0;

  // Heures économisées : (emails traités par IA × 5 min) / 60
  const heuresEconomisees = Math.round((emailsTraites * 5) / 60 * 10) / 10;

  // Temps moyen réponse IA (estimation : dans les 5 min du cron)
  // Valeur indicative car on n'a pas le timestamp exact d'envoi
  const tempsMoyenReponse = 5; // minutes (cron toutes les 5 min)

  // Dossiers complets (heuristique : body mentionne ≥ 3 types de docs)
  let dossierComplets = 0;
  for (const e of allEmails30d ?? []) {
    const t = ((e.body ?? "") + " " + (e.summary ?? "")).toLowerCase();
    let score = 0;
    if (t.includes("fiche de paie") || t.includes("bulletin") || t.includes("salaire")) score++;
    if (t.includes("contrat") || t.includes("cdi") || t.includes("cdd")) score++;
    if (t.includes("avis d'imposition") || t.includes("impôt") || t.includes("fiscal")) score++;
    if (t.includes("identit") || t.includes("passeport") || t.includes("carte")) score++;
    if (t.includes("rib") || t.includes("relevé bancaire")) score++;
    if (score >= 3) dossierComplets++;
  }

  // Répartition intentions
  const intentionCounts = { LOCATION: 0, INFO: 0, HORS_SUJET: 0 };
  for (const e of intentions7d ?? []) {
    const cat = (e.category || "").toUpperCase();
    if (cat in intentionCounts) intentionCounts[cat as keyof typeof intentionCounts]++;
  }

  // ── GRAPHIQUE 30 JOURS ─────────────────────────────────────────────
  const graph30: { label: string; date: string; leads: number; rdv: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    graph30.push({
      label: i % 5 === 0 || i === 0
        ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
        : "",
      date: dateStr,
      leads: 0,
      rdv: 0,
    });
  }

  for (const e of locationEmails30d ?? []) {
    const dateStr = (e.received_at as string)?.split("T")[0];
    const day = graph30.find((d) => d.date === dateStr);
    if (day) day.leads++;
  }

  for (const r of rdvAll30d ?? []) {
    const dateStr = (r.created_at as string)?.split("T")[0];
    const day = graph30.find((d) => d.date === dateStr);
    if (day) day.rdv++;
  }

  return NextResponse.json({
    metrics: {
      // Legacy (compat)
      leadsActifs,
      rdvSemaine: rdvSemaine ?? 0,
      dossierComplets,
      tauxReponseIA,
      // BLOC 6 : nouveaux KPIs ROI
      emailsRecusMois: totalEmailsMois ?? 0,
      leadsQualifies,
      visitesConfirmees: visitesCount,
      tauxEmailVisite,
      // Métriques IA
      tempsMoyenReponseIA: tempsMoyenReponse,
      relancesAuto: relancesAuto ?? 0,
      heuresEconomisees,
      emailsTraitesIA: totalReplies,
    },
    intentions: intentionCounts,
    graph30,
    actionsRequises: actionsRequises ?? [],
    prochainRdv: prochainRdv ?? [],
    recentActivity: recentActivity ?? [],
    // compat ancien champ
    graph7d: graph30.slice(-7).map((d) => ({ ...d, emails: d.leads })),
    nextMeetings: prochainRdv ?? [],
  });
}
