// app/api/gmail/sync/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    // 1) Récupération du user_id transmis par sync/all
    const userId = request.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "NO_USER_ID" }, { status: 400 });
    }

    // 2) Récupération du token Gmail
    const { data: tokenRow } = await supabaseAdmin
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json({ error: "NO_GOOGLE_TOKEN" }, { status: 400 });
    }

    // 3) Appeler Gmail API (exemple INBOX)
    const gmailRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50",
      {
        headers: { Authorization: `Bearer ${tokenRow.access_token}` },
      }
    );

    if (!gmailRes.ok) {
      return NextResponse.json(
        { error: "GMAIL_API_ERROR", details: await gmailRes.text() },
        { status: 400 }
      );
    }

    const gmailJson = await gmailRes.json();
    const messages = gmailJson.messages ?? [];

    let inserted = 0;

    // 4) Enregistrer chaque email dans Supabase
    for (const msg of messages) {
      await supabaseAdmin.from("emails").upsert(
        {
          user_id: userId,
          gmail_message_id: msg.id,
          sender: "Inconnu",
          subject: "(Sujet non chargé)",
          summary: "(En attente d'analyse IA)",
        },
        { onConflict: "gmail_message_id" }
      );
      inserted++;
    }

    return NextResponse.json({
      success: true,
      total: messages.length,
      inserted,
    });
  } catch (err) {
    console.error("GMAIL_SYNC_ERROR:", err);
    return NextResponse.json({ error: "GMAIL_SYNC_FAILED" }, { status: 500 });
  }
}
