import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export async function GET(request: NextRequest) {
  try {
    // 1️⃣ User via session Supabase
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const userId = user.id;

    // 2️⃣ Vérifier token Google
    const { data: tokenRow } = await supabaseAdmin
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json(
        { error: "NO_GOOGLE_TOKEN" },
        { status: 400 }
      );
    }

    // 3️⃣ Access token TOUJOURS valide (🔥 clé)
    const accessToken = await getValidGoogleAccessToken(userId);

    // 4️⃣ Lister les emails récents
    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!listRes.ok) {
      const txt = await listRes.text();
      console.error("GMAIL_LIST_ERROR", txt);
      return NextResponse.json(
        { error: "GMAIL_LIST_ERROR", details: txt },
        { status: 400 }
      );
    }

    const listJson = await listRes.json();
    const messages = listJson.messages ?? [];

    console.log(`[GMAIL SYNC] Messages trouvés: ${messages.length}`);

    let inserted = 0;

    // 5️⃣ Détails + insertion
    for (const msg of messages) {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!detailRes.ok) continue;

      const detail = await detailRes.json();
      const headers = detail.payload?.headers || [];

      const dateHeader = headers.find((h: any) => h.name === "Date");
      const fromHeader = headers.find((h: any) => h.name === "From");
      const subjectHeader = headers.find((h: any) => h.name === "Subject");

      const receivedAt = dateHeader
        ? new Date(dateHeader.value).toISOString()
        : new Date().toISOString();

      const { error: upsertError } = await supabaseAdmin
        .from("emails")
        .upsert(
          {
            user_id: userId,
            gmail_message_id: msg.id,
            sender: fromHeader?.value ?? "Inconnu",
            subject: subjectHeader?.value ?? "(Sans objet)",
            summary: "",
            received_at: receivedAt,
            is_urgent: false,
          },
          { onConflict: "gmail_message_id" }
        );

      if (!upsertError) inserted++;
    }

    return NextResponse.json({
      success: true,
      total_messages: messages.length,
      inserted,
    });
  } catch (err) {
    console.error("GMAIL_SYNC_FATAL", err);
    return NextResponse.json(
      { error: "GMAIL_SYNC_FAILED" },
      { status: 500 }
    );
  }
}
