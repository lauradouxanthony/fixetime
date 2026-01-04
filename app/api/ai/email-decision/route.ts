import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const { email_id } = await req.json();

    if (!email_id) {
      return NextResponse.json({ error: "NO_EMAIL_ID" }, { status: 400 });
    }

    // 1️⃣ Récupérer l’email
    const { data: email } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, body")
      .eq("id", email_id)
      .single();

    if (!email) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    // 2️⃣ Prompt IA (orienté dirigeant)
    const prompt = `
Tu es l'assistant exécutif d’un dirigeant très occupé.

Analyse cet email et retourne STRICTEMENT un JSON valide avec :
- decision: TRAITER | DELEGUER | IGNORER
- priority: URGENT | IMPORTANT | NORMAL
- estimated_time: 2 | 5 | 15
- recommended_action: reply | archive | task

Email :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${email.body}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const raw = completion.choices[0].message.content || "";

// extraction JSON sécurisée
const match = raw.match(/\{[\s\S]*\}/);

if (!match) {
  throw new Error("NO_JSON_RETURNED");
}

const result = JSON.parse(match[0]);


    // 3️⃣ Sauvegarde dans Supabase
    await supabaseAdmin.from("emails").update({
      decision: result.decision,
      priority: result.priority,
      estimated_time: result.estimated_time,
      recommended_action: result.recommended_action,
    }).eq("id", email_id);

    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error("EMAIL_DECISION_ERROR", err);
    return NextResponse.json(
      { error: "EMAIL_DECISION_FAILED" },
      { status: 500 }
    );
  }
}
