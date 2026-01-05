import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // ✅ 1) Récupérer user_id: soit cookie session, soit body JSON
    let userId: string | null = null;

    // session cookie (stable pour le bouton dans l’app)
    try {
      const supabase = await supabaseServer();
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
    } catch {}

    // fallback body JSON (pour tests curl)
    if (!userId) {
      try {
        const body = await req.json();
        if (body?.user_id) userId = body.user_id;
      } catch {}
    }

    if (!userId) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    // ✅ 2) Token Google valide + retry si Gmail renvoie 401
    let accessToken = await getValidGoogleAccessToken(userId);

    const callList = (token: string, pageToken?: string) => {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      // ⚠️ PAS de q (car certains tokens “metadata-only” font planter q)
      return fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    };

    let pageToken: string | undefined = undefined;
    let fetched = 0;
    let upserted = 0;

    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    while (true) {
      let listRes = await callList(accessToken, pageToken);

      // retry 1 fois si 401
      if (listRes.status === 401) {
        accessToken = await getValidGoogleAccessToken(userId);
        listRes = await callList(accessToken, pageToken);
      }

      if (!listRes.ok) {
        const txt = await listRes.text();
        return NextResponse.json({ error: "GMAIL_LIST_ERROR", details: txt }, { status: 400 });
      }

      const listJson = await listRes.json();
      const messages = listJson.messages ?? [];
      pageToken = listJson.nextPageToken;

      if (!messages.length) break;

      for (const msg of messages) {
        // on récupère internalDate + headers avec metadata (plus léger)
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!detailRes.ok) continue;

        const detail = await detailRes.json();
        const internalDate = Number(detail.internalDate ?? 0);

        // ✅ filtre 30j côté serveur (stable)
        if (internalDate && Date.now() - internalDate > THIRTY_DAYS) {
          continue;
        }

        const headers = detail.payload?.headers || [];
        const from = headers.find((h: any) => h.name === "From")?.value ?? "Inconnu";
        const subject = headers.find((h: any) => h.name === "Subject")?.value ?? "(Sans objet)";
        const date = headers.find((h: any) => h.name === "Date")?.value;

        const receivedAt = date ? new Date(date).toISOString() : new Date().toISOString();

        const { error } = await supabaseAdmin.from("emails").upsert(
          {
            user_id: userId,
            gmail_message_id: msg.id,
            sender: from,
            subject,
            received_at: receivedAt,
          },
          { onConflict: "gmail_message_id" }
        );

        fetched++;
        if (!error) upserted++;

        // sécurité perf
        if (fetched >= 300) break;
      }

      if (fetched >= 300) break;
      if (!pageToken) break;
    }

    return NextResponse.json({ success: true, fetched, upserted });
  } catch (error: any) {
    console.error("[GMAIL SYNC] FULL ERROR:", error);
    return NextResponse.json(
      {
        error: "GMAIL_SYNC_FAILED",
        message: error?.message ?? null,
        stack: error?.stack ?? null,
      },
      { status: 500 }
    );
  }
}
