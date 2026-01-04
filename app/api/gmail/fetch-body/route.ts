import { NextResponse } from "next/server";
import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const { gmailMessageId, emailId } = await req.json();

    if (!gmailMessageId || !emailId) {
      return NextResponse.json(
        { error: "Missing gmailMessageId or emailId" },
        { status: 400 }
      );
    }

    // récup token Gmail depuis Supabase
    const { data } = await supabaseAdmin
      .from("gmail_tokens")
      .select("access_token")
      .single();

    if (!data?.access_token) {
      return NextResponse.json({ error: "No Gmail token" }, { status: 401 });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: data.access_token });

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

    const body = extractText(message.data.payload);

    await supabaseAdmin
      .from("emails")
      .update({ body })
      .eq("id", emailId);

    return NextResponse.json({ success: true, body });
  } catch (e) {
    console.error("FETCH BODY ERROR", e);
    return NextResponse.json({ error: "FETCH_BODY_FAILED" }, { status: 500 });
  }
}
