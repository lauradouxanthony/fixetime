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

    // Fetch all context in parallel
    const [{ data: emails }, { data: settings }, { data: leads }] = await Promise.all([
      supabaseAdmin
        .from("emails")
        .select("id, sender, subject, summary, category, is_urgent, is_important, decision, received_at, classification_reason")
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
        .select("id, sender, subject, summary, is_urgent, is_important, decision, received_at")
        .eq("user_id", user.id)
        .eq("category", "LOCATION")
        .gte("received_at", since30d)
        .order("received_at", { ascending: false })
        .limit(15),
    ]);

    const emailRules = (settings as { email_rules?: Record<string, unknown> } | null)?.email_rules ?? {};
    const faq: { question: string; reponse: string }[] = (emailRules.ft_faq as { question: string; reponse: string }[]) ?? [];
    const pipelineMode = (settings as { pipeline_mode?: string } | null)?.pipeline_mode ?? "DRAFT";

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
    const conversionRate = location > 0 ? Math.round((rdvConfirmes / location) * 100) : 0;

    // Active leads
    const activeLeads = (leads ?? []).filter((e) => !e.decision || e.decision === "IGNORER");
    const urgentLeads = (leads ?? []).filter((e) => e.is_urgent);

    const recentEmailsText = (emails ?? []).slice(0, 10)
      .map((e) => `- [${e.category ?? "?"}] ${e.subject ?? "(sans objet)"} — ${e.sender ?? "?"} (${e.received_at ? new Date(e.received_at).toLocaleDateString("fr-FR") : "?"})`)
      .join("\n");

    const activeLeadsText = activeLeads.slice(0, 8)
      .map((e) => `- ${e.is_urgent ? "🔴 URGENT" : "🟡"} ${e.subject ?? "(sans objet)"} — ${e.sender ?? "?"} (reçu ${e.received_at ? new Date(e.received_at).toLocaleDateString("fr-FR") : "?"})`)
      .join("\n") || "Aucun prospect actif";

    const faqText = faq.length > 0
      ? faq.map((f) => `Q: ${f.question} → R: ${f.reponse}`).join("\n")
      : "Aucune FAQ configurée.";

    const systemPrompt = `Tu es l'assistant IA de FixTime, un SaaS pour agences immobilières françaises.
Tu aides l'agent immobilier à gérer ses prospects et emails entrants.

PROFIL DE L'AGENCE :
- Nom : ${String(agenceSettings.name ?? "Non configuré")}
- Zones géographiques : ${String(iaSettings.zones ?? "Non configurées")}
- Loyer moyen : ${iaSettings.loyer_moyen ? String(iaSettings.loyer_moyen) + "€/mois" : "Non configuré"}
- Multiplicateur revenus exigé : ${String(locatifSettings.multiplicateur ?? 3)}x le loyer
- Instructions spéciales : ${String(iaSettings.instructions ?? "Aucune")}

STATISTIQUES (30 derniers jours) :
- Total emails reçus : ${total}
- Emails urgents : ${urgent}
- Prospects locataires (LOCATION) : ${location}
- Demandes d'infos (INFO) : ${info}
- Hors sujet : ${horssujet}
- RDV Confirmés : ${rdvConfirmes}
- Taux de conversion prospect → RDV : ${conversionRate}%
- Mode pipeline actuel : ${pipelineMode}

PROSPECTS ACTIFS (${activeLeads.length} dossiers en attente, ${urgentLeads.length} urgents) :
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
