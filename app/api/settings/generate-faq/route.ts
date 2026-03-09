import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST() {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // Load agency profile from settings
    const { data: settings } = await supabaseAdmin
      .from("settings_v1")
      .select("email_rules")
      .eq("user_id", user.id)
      .maybeSingle();

    const emailRules = (settings as { email_rules?: Record<string, unknown> } | null)?.email_rules ?? {};
    const locatifSettings = (emailRules.ft_locatif as Record<string, unknown>) ?? {};
    const iaSettings = (emailRules.ft_ia as Record<string, unknown>) ?? {};
    const agenceSettings = (emailRules.ft_agence as Record<string, unknown>) ?? {};
    const existingFaq: { question: string; reponse: string }[] =
      (emailRules.ft_faq as { question: string; reponse: string }[]) ?? [];

    const prompt = `Tu es un expert en agences immobilières françaises. Génère 5 questions-réponses fréquentes pour cette agence :

Profil agence :
- Nom : ${String(agenceSettings.name ?? "Agence immobilière")}
- Zones : ${String(iaSettings.zones ?? "Paris et banlieue")}
- Loyer moyen : ${iaSettings.loyer_moyen ? String(iaSettings.loyer_moyen) + "€/mois" : "variable"}
- Multiplicateur revenus : ${String(locatifSettings.multiplicateur ?? 3)}x le loyer
- Notes : ${String(iaSettings.instructions ?? "Agence standard")}

Questions existantes à ne PAS dupliquer : ${existingFaq.map((f) => f.question).join(", ") || "aucune"}

Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte autour :
[{"question": "...", "reponse": "..."}, ...]

Les réponses doivent être courtes (1-2 phrases), professionnelles et adaptées à l'agence immobilière.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content ?? "[]";

    let suggestions: { question: string; reponse: string }[] = [];
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      return NextResponse.json({ error: "PARSE_FAILED", raw }, { status: 500 });
    }

    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("GENERATE_FAQ_ERROR", e);
    return NextResponse.json({ error: "GENERATE_FAILED" }, { status: 500 });
  }
}
