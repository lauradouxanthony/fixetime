import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export async function POST(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const gmailMessageId = body?.gmailMessageId as string | undefined;
    const emailId = body?.emailId as string | undefined;

    if (!gmailMessageId) {
      return NextResponse.json({ error: "MISSING_GMAIL_MESSAGE_ID" }, { status: 400 });
    }

    const accessToken = await getValidGoogleAccessToken(user.id);

    // Archiver = retirer le label INBOX (Gmail)
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          removeLabelIds: ["INBOX"],
        }),
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      console.error("GMAIL_ARCHIVE_ERROR", txt);
      return NextResponse.json({ error: "GMAIL_ARCHIVE_ERROR", details: txt }, { status: 400 });
    }

    // Marquer archivé en base (si on a l'id Supabase)
    if (emailId) {
      await supabaseAdmin
        .from("emails")
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq("id", emailId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("ARCHIVE_FATAL", e);
    return NextResponse.json({ error: "ARCHIVE_FAILED" }, { status: 500 });
  }
}
