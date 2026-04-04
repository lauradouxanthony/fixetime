import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { message, history = [] } = await req.json();
    if (!message) return NextResponse.json({ error: "MESSAGE_REQUIRED" }, { status: 400 });

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const weekStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); d.setHours(0,0,0,0); return d.toISOString(); })();
    const weekEnd   = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 7); d.setHours(23,59,59,999); return d.toISOString(); })();

    // Fetch all context in parallel
    const [{ data: emails }, { data: settings }, { data: leads }, { data: visitsSemaine }, { data: dossiersIncomplets }] = await Promise.all([
      supabaseAdmin
        .from("emails")
        .select("id, sender, subject, summary, category, is_urgent, is_important, decision, received_at, classification_reason, prospect_data")
        .eq("user_id", user.id)
        .gte("received_at", since30d)
        .order("received_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("settings_v1")
        .select("pipeline_mode, email_rules")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("emails")
        .select("id, sender, subject, summary, is_urgent, is_important, decision, received_at, prospect_data, lead_last_action")
        .eq("user_id", user.id)
        .eq("category", "LOCATION")
        .gte("received_at", since30d)
        .order("received_at", { ascending: false })
        .limit(30),
      // Visites cette semaine depuis calendar_events
      supabaseAdmin
        .from("calendar_events")
        .select("id, title, start_time, location, prospect_email, property_name")
        .eq("user_id", user.id)
        .gte("start_time", weekStart)
        .lte("start_time", weekEnd)
        .order("start_time", { ascending: true }),
      // Dossiers incomplets : LOCATION avec étape QUALIFICATION ou VISITE_PROPOSEE
      supabaseAdmin
        .from("emails")
        .select("id, sender, subject, prospect_data, lead_last_action")
        .eq("user_id", user.id)
        .eq("category", "LOCATION")
        .eq("is_archived", false)
        .or("prospect_data->>etape_process.eq.QUALIFICATION,prospect_data->>etape_process.eq.VISITE_PROPOSEE")
        .limit(20),
    ]);

    const emailRules = (settings as { email_rules?: Record<string, unknown> } | null)?.email_rules ?? {};
    const faq: { question: string; reponse: string }[] = (emailRules.ft_faq as { question: string; reponse: string }[]) ?? [];
    const pipelineMode = (settings as { pipeline_mode?: string } | null)?.pipeline_mode
      ?? ((emailRules as Record<string, unknown>)?.pipeline_mode as string)
      ?? "DRAFT";

    // Agency profile from ft_* settings
    const locatifSettings = (emailRules.ft_locatif as Record<string, unknown>) ?? {};
    const iaSettings = (emailRules.ft_ia as Record<string, unknown>) ?? {};
    const agenceSettings = (emailRules.ft_agence as Record<string, unknown>) ?? {};

    // Stats
    const total = emails?.length ?? 0;
    const urgent = emails?.filter((e) => e.is_urgent).length ?? 0;
    const location = emails?.filter((e) => e.category === "LOCATION").length ?? 0;
    const info = emails?.filter((e) => e.category === "INFO").length ?? 0;
    const horssujet = emails?.filter((e) => e.category === "HORS_SUJET").length ?? 0;
    const rdvConfirmes = emails?.filter((e) => e.classification_reason === "RDV_CONFIRMÉ").length ?? 0;
    const autoEnvoyes = leads?.filter((e) => {
      const a = (e.lead_last_action ?? ""); return a.includes("auto-envoyée") || a.includes("auto-envoyé");
    }).length ?? 0;
    const conversionRate = location > 0 ? Math.round((rdvConfirmes / location) * 100) : 0;

    // Lead stages
    const stageMap: Record<string, number> = {};
    for (const lead of leads ?? []) {
      const pd = (lead.prospect_data as Record<string, unknown> | null) ?? {};
      const etape = (pd.etape_process as string) ?? "INCONNU";
      stageMap[etape] = (stageMap[etape] ?? 0) + 1;
    }
    const stagesText = Object.entries(stageMap).map(([k, v]) => `${k}: ${v}`).join(", ") || "Aucun";

    // Dossiers incomplets
    const incompletCount = dossiersIncomplets?.length ?? 0;
    const incompletText = (dossiersIncomplets ?? []).slice(0, 5)
      .map((e) => {
        const pd = (e.prospect_data as Record<string, unknown> | null) ?? {};
        return `- ${pd.nom ?? e.sender ?? "?"} (${pd.etape_process ?? "?"})`;
      }).join("\n") || "Aucun dossier incomplet";

    // Visites cette semaine
    const visitCount = visitsSemaine?.length ?? 0;
    const visitsText = (visitsSemaine ?? []).slice(0, 5)
      .map((v) => {
        const dt = new Date(v.start_time as string);
        return `- ${dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })} à ${dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} — ${v.property_name ?? v.title ?? "bien"} (${v.prospect_email ?? "?"})`;
      }).join("\n") || "Aucune visite planifiée cette semaine";

    // Active leads
    const activeLeads = (leads ?? []).filter((e) => {
      const pd = (e.prospect_data as Record<string, unknown> | null) ?? {};
      const etape = pd.etape_process as string;
      return !etape || !["REFUSE", "VALIDE"].includes(etape);
    });
    const urgentLeads = (leads ?? []).filter((e) => e.is_urgent);

    const recentEmailsText = (emails ?? []).slice(0, 10)
      .map((e) => `- [${e.category ?? "?"}] ${e.subject ?? "(sans objet)"} — ${e.sender ?? "?"} (${e.received_at ? new Date(e.received_at).toLocaleDateString("fr-FR") : "?"})`)
      .join("\n");

    const activeLeadsText = activeLeads.slice(0, 8)
      .map((e) => {
        const pd = (e.prospect_data as Record<string, unknown> | null) ?? {};
        return `- ${e.is_urgent ? "🔴 URGENT" : "🟡"} ${pd.nom ?? e.sender ?? "?"} — étape: ${pd.etape_process ?? "NEW"} — ${e.subject ?? "(sans objet)"}`;
      })
      .join("\n") || "Aucun prospect actif";

    const faqText = faq.length > 0
      ? faq.map((f) => `Q: ${f.question} → R: ${f.reponse}`).join("\n")
      : "Aucune FAQ configurée.";

    const systemPrompt = `Tu es l'assistant IA de FixTime, un SaaS pour agences immobilières françaises.
Tu aides l'agent immobilier à gérer ses prospects et emails entrants.

FONCTIONNEMENT DE FIXTIME (à utiliser si on te le demande) :
- Mode DRAFT : l'IA analyse les emails et génère des brouillons de réponse. L'agent les valide et envoie manuellement.
- Mode AUTOPILOTE : l'IA analyse, génère ET envoie automatiquement les réponses sans intervention humaine. Actif ${pipelineMode === "AUTOPILOTE" ? "✅ EN CE MOMENT" : "❌ inactif (mode DRAFT actuel)"}.
- Sync Gmail : toutes les minutes via cron Vercel. Latence max ~1 min entre réception email et analyse IA.
- Qualification : ratio revenus/loyer ≥ ${locatifSettings.multiplicateur ?? 3}x requis pour accepter un dossier.
- Relances auto : J+2 (qualification), J+1 (visite proposée), J+3 (dossier demandé) — max 3 relances/prospect.

PROFIL DE L'AGENCE :
- Nom : ${String(agenceSettings.name ?? "Non configuré")}
- Zones géographiques : ${String(iaSettings.zones ?? "Non configurées")}
- Loyer moyen : ${iaSettings.loyer_moyen ? String(iaSettings.loyer_moyen) + "€/mois" : "Non configuré"}
- Multiplicateur revenus exigé : ${String(locatifSettings.multiplicateur ?? 3)}x le loyer
- Mode pipeline actuel : ${pipelineMode}

STATISTIQUES (30 derniers jours) :
- Total emails reçus : ${total}
- Emails urgents : ${urgent}
- Prospects locataires (LOCATION) : ${location}
- Demandes d'infos (INFO) : ${info}
- Hors sujet : ${horssujet}
- RDV Confirmés : ${rdvConfirmes}
- Réponses auto-envoyées (autopilote) : ${autoEnvoyes}
- Taux de conversion prospect → RDV : ${conversionRate}%
- Dossiers incomplets (en qualification) : ${incompletCount}

PIPELINE PAR ÉTAPE : ${stagesText}

VISITES CETTE SEMAINE (${visitCount}) :
${visitsText}

DOSSIERS INCOMPLETS (${incompletCount}) :
${incompletText}

PROSPECTS ACTIFS (${activeLeads.length} dossiers, ${urgentLeads.length} urgents) :
${activeLeadsText}

10 DERNIERS EMAILS :
${recentEmailsText}

FAQ DE L'AGENCE :
${faqText}

Réponds en français, de façon concise et utile. Utilise des emojis pour structurer tes réponses. Si l'agent demande des statistiques, des prospects ou un résumé, utilise les données ci-dessus.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...history.slice(-8).map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: message },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const reply = completion.choices[0]?.message?.content ?? "Je n'ai pas pu répondre.";

    return NextResponse.json({ reply });
  } catch (e) {
    console.error("CHAT_AI_ERROR", e);
    return NextResponse.json({ error: "CHAT_FAILED" }, { status: 500 });
  }
}
