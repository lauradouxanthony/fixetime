import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { dateLabel, events } = await req.json();

    if (!events || !Array.isArray(events)) {
      return NextResponse.json({ error: "NO_EVENTS" }, { status: 400 });
    }

    const compact = events
      .slice(0, 40)
      .map((e: any) => ({
        title: e.title,
        start: e.start_time,
        end: e.end_time,
        calendar: e.calendar_name,
      }));

    const prompt = `
Tu es l'assistant exécutif d'un dirigeant très occupé.

Contexte: Planning du ${dateLabel}.
Voici les événements (JSON):
${JSON.stringify(compact)}

Retourne STRICTEMENT un JSON valide:
{
  "summary": "1 paragraphe executive (4-6 lignes max)",
  "recommendations": ["3 à 6 recommandations concrètes et actionnables"]
}

Règles:
- Si journée surchargée, propose de regrouper / déplacer / ajouter des breaks.
- Si créneaux libres, propose où placer deep work.
- Style: direct, utile, sans blabla.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: "NO_JSON_RETURNED", raw }, { status: 500 });
    }

    const result = JSON.parse(match[0]);
    return NextResponse.json({ success: true, result });
  } catch (e) {
    console.error("CALENDAR_INSIGHTS_ERROR", e);
    return NextResponse.json({ error: "CALENDAR_INSIGHTS_FAILED" }, { status: 500 });
  }
}
