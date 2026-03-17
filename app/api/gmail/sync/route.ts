import { NextResponse } from "next/server";
import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const trace_id =
    req.headers.get("x-fixetime-trace-id") ?? "gmail-sync-" + Date.now().toString(36);

  let stage: string = "start";
  let lastSupabaseError: string | null = null;
  let googleStatus: string | number | null = null;
  let googleErrorMessage: string | null = null;
  let userIdForCatch: string | null = null;

  try {
    stage = "parse_body";
    const body = await req.json().catch(() => ({}));
    const { user_id, window_days: wd, max_messages: maxMsg } = body;
    const window_days = wd === 30 ? 30 : 7;
    const max_messages = Math.min(Math.max(1, Number(maxMsg) || 50), 500);

    if (!user_id) {
      console.error("GMAIL_SYNC_ERR", { trace_id, stage: "NO_USER_ID", message: "user_id manquant" });
      return NextResponse.json(
        { ok: false, error: "NO_USER_ID", trace_id, stage: "NO_USER_ID" },
        { status: 400 }
      );
    }

    userIdForCatch = user_id;

    stage = "load_token";
    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    if (tokenError) {
      lastSupabaseError = tokenError.message;
      console.error("GMAIL_SYNC_ERR", {
        trace_id,
        stage: "TOKEN_ROW",
        user_id,
        message: tokenError.message,
      });
    }

    if (!tokenRow) {
      console.error("GMAIL_SYNC_ERR", {
        trace_id,
        stage: "NO_GMAIL_TOKEN",
        user_id,
        message: "Aucun token Gmail",
      });
      return NextResponse.json(
        { ok: false, error: "NO_GMAIL_TOKEN", trace_id, stage: "NO_GMAIL_TOKEN" },
        { status: 400 }
      );
    }

    // Log non-sensible de l'état du token en base
    const refreshToken = (tokenRow as any).refresh_token as string | null | undefined;
    const accessToken = (tokenRow as any).access_token as string | null | undefined;
    const tokenExpiresAt = (tokenRow as any).expires_at ?? null;
    console.log("GMAIL_TOKEN_STATE", {
      trace_id,
      user_id,
      has_refresh_token: !!refreshToken,
      refresh_token_length: typeof refreshToken === "string" ? refreshToken.length : 0,
      has_access_token: !!accessToken,
      token_expires_at: tokenExpiresAt,
    });

    stage = "google_auth";
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      console.error("[GOOGLE_OAUTH_ENV_MISSING]", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        presentKeys: Object.keys(process.env)
          .filter((k) => k.includes("GOOGLE"))
          .sort(),
      });
      throw new Error("GOOGLE_OAUTH_MISSING_CLIENT_CREDENTIALS");
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
    });

    const gmail = google.gmail({ version: "v1", auth });

    stage = "google_list";
    console.log("GMAIL_SYNC_START", { trace_id, user_id, window_days, max_messages });

    const newerThan = window_days === 30 ? "30d" : "7d";
    const allMessages: { id?: string | null }[] = [];
    let nextPageToken: string | undefined = undefined;
    let remaining = max_messages;

    type GmailListResponse = { data: { messages?: { id?: string | null }[]; nextPageToken?: string } };
    do {
      const page: GmailListResponse = await gmail.users.messages.list({
        userId: "me",
        maxResults: Math.min(100, Math.max(1, remaining)),
        labelIds: ["INBOX"],
        q: `newer_than:${newerThan}`,
        pageToken: nextPageToken,
      }) as GmailListResponse;
      const pageMessages = page.data.messages ?? [];
      allMessages.push(...pageMessages);
      remaining -= pageMessages.length;
      nextPageToken = page.data.nextPageToken ?? undefined;
    } while (nextPageToken && remaining > 0);

    const messages = allMessages;
    const messageIds = (messages.map((m) => m.id).filter(Boolean) as string[]);

    console.log("GMAIL_SYNC_LIST_OK", {
      trace_id,
      user_id,
      fetched: messages.length,
      ids_count: messageIds.length,
      window_days,
    });

    stage = "load_existing";
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("emails")
      .select("gmail_message_id")
      .eq("user_id", user_id)
      .in("gmail_message_id", messageIds);

    if (existingError) {
      lastSupabaseError = existingError.message;
      console.error("GMAIL_SYNC_ERR", {
        trace_id,
        stage: "LOAD_EXISTING",
        user_id,
        message: existingError.message,
      });
    }

    const existingSet = new Set(
      (existing?.map((e: { gmail_message_id: string | null }) => e.gmail_message_id) ?? []).filter(
        Boolean
      )
    );
    const toInsert = messageIds.filter((id) => !existingSet.has(id));

    console.log("GMAIL_SYNC_GET_OK", {
      trace_id,
      user_id,
      total_ids: messageIds.length,
      existing_count: existingSet.size,
      to_upsert: toInsert.length,
    });

    stage = "upsert_loop";
    let insertedCount = 0;
    let lastUpsertError: string | null = null;

    for (const id of toInsert) {
      stage = "google_get";
      const detail = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
      });

      const internalDate = Number(detail.data.internalDate ?? Date.now());
      const headers = detail.data.payload?.headers ?? [];
      const from = headers.find((h) => h.name === "From")?.value ?? "";
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "";

      stage = "supabase_upsert";
      const { error: upsertError } = await supabaseAdmin
        .from("emails")
        .upsert(
          {
            user_id,
            provider: "google",
            gmail_message_id: id,
            gmail_thread_id: detail.data.threadId ?? null,
            received_at: new Date(internalDate).toISOString(),
            sender: from,
            subject,
            lead_status: null,
            lead_json: null,
          },
          { onConflict: "user_id,gmail_message_id" }
        );

      if (upsertError) {
        lastSupabaseError = upsertError.message;
        lastUpsertError = upsertError.message;
        console.error("GMAIL_SYNC_ERR", {
          trace_id,
          stage: "SUPABASE_UPSERT",
          user_id,
          gmail_message_id: id,
          message: upsertError.message,
        });
      } else {
        insertedCount++;
      }
    }

    stage = "done";
    console.log("GMAIL_SYNC_DB_OK", {
      trace_id,
      user_id,
      fetched: messages.length,
      ids_count: messageIds.length,
      inserted: insertedCount,
      skipped_existing: messageIds.length - insertedCount,
      last_error: lastUpsertError,
    });

    return NextResponse.json({
      ok: true,
      trace_id,
      gmail_fetched: messageIds.length,
      gmail_inserted: insertedCount,
      skipped_existing: messageIds.length - insertedCount,
      last_error: lastUpsertError,
    });
  } catch (e: unknown) {
    const err = e as any;
    const message: string = err?.message ?? String(e);
    const stack: string | undefined = err?.stack;

    // Essayer d'extraire des infos Google si dispo (code HTTP, errors[] ou réponse OAuth)
    if (typeof err?.code !== "undefined") {
      googleStatus = err.code;
    }
    if (Array.isArray(err?.errors) && err.errors[0]?.message) {
      googleErrorMessage = String(err.errors[0].message);
    } else if (err?.response?.data?.error?.message) {
      googleErrorMessage = String(err.response.data.error.message);
    }

    const oauthError = err?.response?.data ?? null;
    const oauthStatus = err?.response?.status ?? null;
    const oauthUrl =
      err?.config?.url ??
      err?.response?.config?.url ??
      err?.request?.path ??
      null;

    // Si erreur OAuth invalid_grant / token révoqué → marquer needs_reconnect et retourner un code clair
    const oauthErrorCode = oauthError?.error;
    const oauthErrorDesc = String(oauthError?.error_description || "").toLowerCase();
    const isInvalidGrant =
      oauthErrorCode === "invalid_grant" ||
      oauthErrorDesc.includes("revoked") ||
      oauthErrorDesc.includes("expired");

    if (isInvalidGrant && userIdForCatch) {
      try {
        await supabaseAdmin
          .from("gmail_tokens")
          .update({ needs_reconnect: true })
          .eq("user_id", userIdForCatch);
      } catch (e2) {
        console.error("GMAIL_SYNC_MARK_RECONNECT_ERROR", {
          trace_id,
          user_id: userIdForCatch,
          error: (e2 as any)?.message,
        });
      }

      console.error("GMAIL_SYNC_ERR", {
        trace_id,
        stage,
        message: "GMAIL_NEEDS_RECONNECT",
        oauth_error: oauthError,
        oauth_status: oauthStatus,
        oauth_url: oauthUrl,
        supabase_error: lastSupabaseError,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "GMAIL_NEEDS_RECONNECT",
          stage,
          oauth_error: oauthError,
          oauth_status: oauthStatus,
          oauth_message: err?.message ?? null,
        },
        { status: 401 }
      );
    }

    console.error("GMAIL_SYNC_ERR", {
      trace_id,
      stage,
      message,
      googleStatus,
      googleErrorMessage,
      supabase_error: lastSupabaseError,
      oauth_error: oauthError,
      oauth_status: oauthStatus,
      oauth_url: oauthUrl,
      stack,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "GMAIL_SYNC_FATAL",
        stage,
        message,
        stack,
        google_status: googleStatus ?? null,
        google_error: googleErrorMessage ?? null,
        supabase_error: lastSupabaseError,
        oauth_error: oauthError,
        oauth_status: oauthStatus,
        oauth_message: err?.message ?? null,
      },
      { status: 500 }
    );
  }
}
