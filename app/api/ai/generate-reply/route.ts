import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    // 1️⃣ Vérifier l’utilisateur connecté
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // 2️⃣ Récupérer l’email
    const { emailId } = await req.json();

    if (!emailId) {
      return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });
    }

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, body, ai_reply")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (error || !email) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    // 3️⃣ Si réponse déjà générée → on la renvoie (anti-coût)
    if (email.ai_reply && email.ai_reply.trim().length > 0) {
      return NextResponse.json({ reply: email.ai_reply });
    }

    // 4️⃣ Prompt IA (réponse PRO, humaine, complète)
    const prompt = `
Tu es l’assistant personnel d’un dirigeant très occupé.
Rédige une réponse email professionnelle, claire, naturelle et prête à être envoyée.

Règles :
- Français professionnel
- Ton humain, poli, efficace
- Pas trop long
- Adapté au CONTENU réel
- Pas de promesse irréaliste
- Signature neutre (sans prénom)

Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${email.body || "Email sans contenu visible"}

Réponse :
`;

    // 5️⃣ Appel OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() || null;

    if (!reply) {
      return NextResponse.json({ error: "AI_NO_REPLY" }, { status: 500 });
    }

    // 6️⃣ Sauvegarde en base (clé anti-surcoût)
    await supabaseAdmin
      .from("emails")
      .update({ ai_reply: reply })
      .eq("id", email.id);

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("GENERATE_REPLY_API_ERROR", err);
    return NextResponse.json(
      { error: "GENERATE_REPLY_FAILED" },
      { status: 500 }
    );
  }
}
