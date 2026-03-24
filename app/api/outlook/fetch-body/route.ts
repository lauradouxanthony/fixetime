import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidMicrosoftAccessToken } from "@/lib/microsoft/getValidAccessToken";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const providerMessageId = body?.providerMessageId ?? body?.provider_message_id;
    const emailId = body?.emailId ?? body?.email_id;

    if (!providerMessageId || !emailId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS", message: "Missing providerMessageId or emailId" },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const { data: row, error: rowError } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, provider_message_id, provider")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (rowError) {
      console.error("OUTLOOK_FETCH_BODY_DB_ERROR", rowError);
      return NextResponse.json(
        { ok: false, error: "OUTLOOK_FETCH_BODY_FAILED", message: "Database error" },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "EMAIL_NOT_FOUND", message: "Email not found for this user" },
        { status: 404 }
      );
    }

    if (row.provider !== "microsoft") {
      return NextResponse.json(
        { ok: false, error: "INVALID_PROVIDER", message: "Email is not from Outlook" },
        { status: 400 }
      );
    }

    const rowProviderId = row.provider_message_id ?? null;
    if (rowProviderId !== providerMessageId) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PROVIDER_MESSAGE_ID", message: "provider_message_id does not match row" },
        { status: 400 }
      );
    }

    const accessToken = await getValidMicrosoftAccessToken(user.id);

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${providerMessageId}?$select=body`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json(
        { ok: false, error: "OUTLOOK_FETCH_BODY_ERROR", details: txt },
        { status: 400 }
      );
    }

    const data = await res.json();
    const content = data?.body?.content ?? null;

    await supabaseAdmin
      .from("emails")
      .update({ body: content })
      .eq("id", emailId)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true, success: true, body: content });
  } catch (e) {
    console.error("OUTLOOK_FETCH_BODY_FATAL", e);
    return NextResponse.json(
      { ok: false, error: "OUTLOOK_FETCH_BODY_FAILED", message: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
