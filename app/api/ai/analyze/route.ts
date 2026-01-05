import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST() {
  try {
    // 1️⃣ Emails à analyser (non traités)
    const { data: emails, error } = await supabaseAdmin
      .from("emails")
      .select("id, subject, body, sender")
      .is("decision", null)
      .limit(30);

    if (error || !emails || emails.length === 0) {
      return NextResponse.json({ message: "No emails to analyze" });
    }

    for (const email of emails) {
      const prompt = `
Tu es un assistant exécutif pour dirigeant.

Analyse cet email et réponds STRICTEMENT en JSON :
{
  "decision": "ignorer | traiter | planifier",
  "estimated_time": number,
  "category": "newsletter | client | interne | autre",
  "summary": string
}

Règles :
- Si email marketing / promo / info → ignorer
- Si action humaine requise → traiter
- Si demande future / réunion → planifier
- Résumé max 2 phrases
- Sois TRÈS strict

EMAIL :
Objet: ${email.subject}
Expéditeur: ${email.sender}
Contenu:
${email.body}
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      });

      const raw = completion.choices[0].message.content;
      if (!raw) continue;

      const parsed = JSON.parse(raw);

      await supabaseAdmin
        .from("emails")
        .update({
          decision: parsed.decision,
          estimated_time: parsed.estimated_time,
          category: parsed.category,
          summary: parsed.summary,
        })
        .eq("id", email.id);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("AI_ANALYZE_ERROR", e);
    return NextResponse.json({ error: "AI_FAILED" }, { status: 500 });
  }
}
