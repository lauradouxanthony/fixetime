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

    // Fetch context: recent emails stats
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: emails }, { data: settings }] = await Promise.all([
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
    ]);

    const emailRules = (settings as any)?.email_rules ?? {};
    const faq: { question: string; reponse: string }[] = emailRules.ft_faq ?? [];
    const pipelineMode = (settings as any)?.pipeline_mode ?? "DRAFT";

    // Build stats
    const total = emails?.length ?? 0;
    const urgent = emails?.filter((e) => e.is_urgent).length ?? 0;
    const location = emails?.filter((e) => e.category === "LOCATION").length ?? 0;
    const info = emails?.filter((e) => e.category === "INFO").length ?? 0;
    const horssujet = emails?.filter((e) => e.category === "HORS_SUJET").length ?? 0;
    const rdvConfirmes = emails?.filter((e) => e.classification_reason === "RDV_CONFIRMÉ").length ?? 0;

    const recentEmailsText = (emails ?? []).slice(0, 10)
      .map((e) => `- [${e.category ?? "?"}] ${e.subject ?? "(sans objet)"} — ${e.sender ?? "?"} (${e.received_at ? new Date(e.received_at).toLocaleDateString("fr-FR") : "?"})`)
      .join("\n");

    const faqText = faq.length > 0
      ? faq.map((f) => `Q: ${f.question} → R: ${f.reponse}`).join("\n")
      : "Aucune FAQ configurée.";

    const systemPrompt = `Tu es l'assistant IA de FixTime, un SaaS pour agences immobilières françaises.
Tu aides l'agent immobilier à gérer ses prospects et emails entrants.

STATISTIQUES (30 derniers jours) :
- Total emails : ${total}
- Urgents : ${urgent}
- LOCATION (prospects locataires) : ${location}
- INFO (demandes d'infos) : ${info}
- HORS_SUJET : ${horssujet}
- RDV Confirmés : ${rdvConfirmes}
- Mode pipeline actuel : ${pipelineMode}

10 DERNIERS EMAILS :
${recentEmailsText}

FAQ DE L'AGENCE :
${faqText}

Réponds en français, de façon concise et utile. Si l'agent demande des statistiques, utilise les données ci-dessus.`;

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
