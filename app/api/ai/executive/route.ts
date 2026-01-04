import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type AIItem = {
  id: string;
  decision: "ignorer" | "traiter" | "planifier";
  category: "newsletter" | "client" | "interne" | "autre";
  estimated_time: number;
  summary: string;
  reason: string;
};

function extractJson(raw: string): any {
  let s = raw.trim();

  // retire ```json ... ```
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z]*\n?/, "");
    s = s.replace(/```$/, "");
    s = s.trim();
  }

  // récupère le JSON même si le modèle ajoute du texte autour
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  return JSON.parse(s);
}

export async function POST() {
  try {
    // 1) user connecté
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    // 2) emails récents DU user
    const { data: emails, error } = await supabaseAdmin
      .from("emails")
      .select("id, subject, sender, body, received_at")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!emails || emails.length === 0) {
      return NextResponse.json({ success: true, analyzed: 0, updated: 0 });
    }

    const packed = emails.map((e) => ({
      id: e.id,
      sender: e.sender,
      subject: e.subject,
      received_at: e.received_at,
      body: typeof e.body === "string" ? e.body.slice(0, 3500) : "",
    }));

    const prompt = `
Retourne UNIQUEMENT un JSON valide (pas de markdown, pas de texte).
Format strict:
{
  "items": [
    {
      "id": "...",
      "decision": "ignorer|traiter|planifier",
      "category": "newsletter|client|interne|autre",
      "estimated_time": 1,
      "summary": "2 phrases max, actionnable",
      "reason": "1 phrase pourquoi"
    }
  ]
}

Règles:
- newsletter/promo/info sans action -> ignorer
- action humaine requise -> traiter
- rdv/date/créneau -> planifier
- estimated_time: 1,2,3,5,10

Emails:
${JSON.stringify(packed)}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const raw = completion.choices[0].message.content || "";

    let parsed: { items: AIItem[] };
    try {
      parsed = extractJson(raw);
    } catch {
      console.error("AI_JSON_PARSE_FAILED_RAW:", raw);
      return NextResponse.json(
        { error: "AI_JSON_PARSE_FAILED" },
        { status: 500 }
      );
    }

    const items = parsed.items || [];
    let updated = 0;

    for (const item of items) {
      const { error: upErr } = await supabaseAdmin
        .from("emails")
        .update({
          decision: item.decision,
          category: item.category,
          estimated_time: item.estimated_time,
          summary: item.summary,
          recommended_action:
            item.decision === "traiter"
              ? "reply"
              : item.decision === "planifier"
              ? "schedule"
              : "archive",
        })
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (!upErr) updated++;
    }

    return NextResponse.json({ success: true, analyzed: items.length, updated });
  } catch (e: any) {
    console.error("AI_EXECUTIVE_FATAL", e);
    return NextResponse.json(
      { error: e.message || "AI_EXECUTIVE_FAILED" },
      { status: 500 }
    );
  }
}
