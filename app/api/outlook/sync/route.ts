import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidMicrosoftAccessToken } from "@/lib/microsoft/getValidAccessToken";
import { logActivity } from "@/lib/activity/logActivity";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let userId: string | null = null;
  try {
    const trace_id = req.headers.get("x-fixetime-trace-id") ?? "outlook-sync-" + Date.now().toString(36);
    // OK 1) user_id via session Supabase ou body JSON

    try {
      const supabase = await supabaseServer();
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
    } catch {}

    if (!userId) {
      try {
        const body = await req.json();
        if (body?.user_id) userId = body.user_id;
      } catch {}
    }

    if (!userId) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    let body: { user_id?: string; window_days?: number; max_messages?: number } = {};
    try {
      const raw = await req.json().catch(() => ({}));
      if (raw && typeof raw === "object") body = raw;
    } catch {}
    const window_days = body.window_days === 30 ? 30 : 7;
    const max_messages = Math.min(Math.max(1, Number(body.max_messages) || 50), 100);

    await logActivity({
      userId,
      type: "sync_started",
      actor: "system",
      title: "Synchronisation Outlook demarree",
      meta: { status: "info" },
    });

    // OK 2) token Microsoft valide (mais si pas connecte => on SKIP)
let accessToken: string;

try {
  try {
    accessToken = await getValidMicrosoftAccessToken(userId);
  } catch (e: any) {
    const msg = e?.message ?? "";
    if (msg === "NO_MICROSOFT_TOKEN" || msg === "NO_MICROSOFT_REFRESH_TOKEN") {
      return NextResponse.json(
        { success: true, skipped: true, reason: msg },
        { status: 200 }
      );
    }
    throw e;
  }
  } catch (e: any) {
  const msg = e?.message ?? "";

  if (msg === "NO_MICROSOFT_TOKEN" || msg === "NO_MICROSOFT_REFRESH_TOKEN") {
    return NextResponse.json(
      { success: true, skipped: true, reason: msg },
      { status: 200 }
    );
  }

  throw e; // autres erreurs => vrai 500
}


    const windowMs = window_days * 24 * 60 * 60 * 1000;
    const sinceIso = new Date(Date.now() - windowMs).toISOString();

    // OK 3) Pagination Graph
    const baseUrl = new URL("https://graph.microsoft.com/v1.0/me/messages");
    baseUrl.searchParams.set("$top", String(max_messages));
    baseUrl.searchParams.set(
      "$select",
      "id,subject,from,receivedDateTime,webLink,conversationId"
    );
    
    baseUrl.searchParams.set("$orderby", "receivedDateTime desc");
    baseUrl.searchParams.set(
      "$filter",
      `receivedDateTime ge datetimeoffset'${sinceIso}'`
    );
    

    let nextLink: string | null = baseUrl.toString();
    let fetched = 0;
    let upserted = 0;

    console.log("[OUTLOOK SYNC] FETCH_START", {
      trace_id,
      userId,
      window_days,
      max_messages,
      url: nextLink,
    });

    while (nextLink) {
      const listRes = await fetch(nextLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      // retry 1 fois si 401
      if (listRes.status === 401) {
        accessToken = await getValidMicrosoftAccessToken(userId);
      
        const retryRes: Response = await fetch(nextLink, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
      
        if (!retryRes.ok) {
          const txt = await retryRes.text();
          return NextResponse.json(
            { error: "OUTLOOK_LIST_ERROR", details: txt },
            { status: 400 }
          );
        }
      
        type OutlookListResponse = {
          value: any[];
          "@odata.nextLink"?: string;
        };
      
        const retryJson: OutlookListResponse = await retryRes.json();
      
        const messages = retryJson.value ?? [];
        nextLink = retryJson["@odata.nextLink"] ?? null;

        for (const msg of messages) {
          const from =
            msg?.from?.emailAddress?.address ||
            msg?.from?.emailAddress?.name ||
            "Inconnu";
          const subject = msg?.subject ?? "(Sans objet)";
          const receivedAt = msg?.receivedDateTime
            ? new Date(msg.receivedDateTime).toISOString()
            : new Date().toISOString();

          const { error } = await supabaseAdmin.from("emails").upsert(
            {
              user_id: userId,
              provider: "microsoft",
              provider_message_id: msg.id,
              outlook_conversation_id: msg.conversationId ?? null,
              sender: from,
              subject,
              received_at: receivedAt,
              // on garde gmail_message_id null pour outlook
              gmail_message_id: null,
              gmail_thread_id: null,

              // optionnel : on peut stocker un lien d’ouverture si tu ajoutes une colonne plus tard
              open_url: msg.webLink ?? null,
            },
            { onConflict: "user_id,provider,provider_message_id" }
          );

          fetched++;
          if (!error) upserted++;
          if (fetched >= 500) break;
        }

        if (fetched >= 500) break;
        continue;
      }

      if (!listRes.ok) {
        const txt = await listRes.text();
        return NextResponse.json(
          { error: "OUTLOOK_LIST_ERROR", details: txt },
          { status: 400 }
        );
      }

      const listJson = await listRes.json();
      const messages = listJson.value ?? [];
      nextLink = listJson["@odata.nextLink"] ?? null;

      if (!messages.length) break;

      for (const msg of messages) {
        const from =
          msg?.from?.emailAddress?.address ||
          msg?.from?.emailAddress?.name ||
          "Inconnu";
        const subject = msg?.subject ?? "(Sans objet)";
        const receivedAt = msg?.receivedDateTime
          ? new Date(msg.receivedDateTime).toISOString()
          : new Date().toISOString();

        const { error } = await supabaseAdmin.from("emails").upsert(
          {
            user_id: userId,
            provider: "microsoft",
            provider_message_id: msg.id,
            outlook_conversation_id: msg.conversationId ?? null,
            sender: from,
            subject,
            received_at: receivedAt,
            gmail_message_id: null,
            gmail_thread_id: null,
            open_url: msg.webLink ?? null,
          },
          { onConflict: "user_id,provider,provider_message_id" }
        );

        fetched++;
        if (!error) upserted++;
        if (fetched >= 500) break;
      }

      if (fetched >= 500) break;
    }

    console.log("[OUTLOOK SYNC] INSERT_RESULT", {
      trace_id,
      userId,
      fetched,
      upserted,
    });

    // 🔁 Déclenche une passe d'analyse après la sync Outlook (comme Gmail)
    try {
      const host = req.headers.get("host");
      const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
      const baseUrl = host ? `${protocol}://${host}` : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");

      fetch(`${baseUrl}/api/ai/analyze-inbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fixetime-analyze-now": "true",
          "x-fixetime-cron-key": process.env.FIXETIME_INTERNAL_CRON_KEY || "",
        },
        body: JSON.stringify({
          user_id: userId,
          period: "30d",
        }),
        cache: "no-store",
      }).catch((err) => {
        console.error("[OUTLOOK SYNC] post-analyze trigger failed:", err);
      });
    } catch (e) {
      console.error("[OUTLOOK SYNC] post-analyze trigger fatal:", e);
    }

    await logActivity({
      userId,
      type: "sync_completed",
      actor: "system",
      title: `Synchronisation Outlook terminee — ${upserted} emails`,
      meta: { status: "success", fetched, upserted },
    });

    return NextResponse.json({ success: true, fetched, upserted, trace_id });
  } catch (error: any) {
    const trace_id = req.headers.get("x-fixetime-trace-id") ?? "outlook-sync-error-" + Date.now().toString(36);
    console.error("[OUTLOOK SYNC] FULL ERROR:", { trace_id, error });
    if (userId) {
      await logActivity({
        userId,
        type: "sync_error",
        actor: "system",
        title: "Erreur synchronisation Outlook",
        meta: { status: "error" },
      });
    }
    return NextResponse.json(
      {
        error: "OUTLOOK_SYNC_FAILED",
        message: error?.message ?? null,
        stack: error?.stack ?? null,
      },
      { status: 500 }
    );
  }
}
