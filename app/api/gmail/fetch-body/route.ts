import { NextResponse } from "next/server";
import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const gmailMessageId = body?.gmailMessageId ?? body?.gmail_message_id;
    const emailId = body?.emailId ?? body?.email_id;

    if (!gmailMessageId || !emailId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS", message: "Missing gmailMessageId or emailId" },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const { data: row, error: rowError } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, gmail_message_id, provider")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (rowError) {
      console.error("FETCH_BODY_DB_ERROR", rowError);
      return NextResponse.json(
        { ok: false, error: "FETCH_BODY_FAILED", message: "Database error" },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "EMAIL_NOT_FOUND", message: "Email not found for this user" },
        { status: 404 }
      );
    }

    if (row.provider !== "google") {
      return NextResponse.json(
        { ok: false, error: "INVALID_PROVIDER", message: "Email is not from Gmail" },
        { status: 400 }
      );
    }

    const rowGmailId = row.gmail_message_id ?? null;
    if (rowGmailId !== gmailMessageId) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PROVIDER_MESSAGE_ID", message: "gmail_message_id does not match row" },
        { status: 400 }
      );
    }

    const { data: token, error: tokenError } = await supabaseAdmin
      .from("gmail_tokens")
      .select("access_token")
      .eq("user_id", user.id)
      .single();

    if (tokenError || !token?.access_token) {
      return NextResponse.json(
        { ok: false, error: "NO_GMAIL_TOKEN" },
        { status: 401 }
      );
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token.access_token });

    const gmail = google.gmail({ version: "v1", auth });

    const message = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "full",
    });

    const extractText = (payload: any): string | null => {
      if (!payload) return null;

      if (payload.mimeType === "text/plain" && payload.body?.data) {
        return Buffer.from(payload.body.data, "base64").toString("utf-8");
      }

      if (payload.mimeType === "text/html" && payload.body?.data) {
        return Buffer.from(payload.body.data, "base64").toString("utf-8");
      }

      if (payload.parts) {
        for (const part of payload.parts) {
          const text = extractText(part);
          if (text) return text;
        }
      }

      return null;
    };

    const bodyText = extractText(message.data.payload);

    await supabaseAdmin
      .from("emails")
      .update({ body: bodyText })
      .eq("id", emailId)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true, success: true, body: bodyText });
  } catch (e) {
    console.error("FETCH_BODY_ERROR", e);
    return NextResponse.json(
      { ok: false, error: "FETCH_BODY_FAILED", message: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
