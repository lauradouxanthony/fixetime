import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

// Construit un message RFC 2822 encodé base64url pour l'API Gmail
function buildRawReply(to: string, subject: string, body: string): string {
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(`Re: ${subject}`, "utf-8").toString("base64")}?=`;

  const mime = [
    `MIME-Version: 1.0`,
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(body, "utf-8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function POST(req: Request) {
  try {
    // 1) Auth session
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { emailId, reply: replyOverride } = await req.json();
    if (!emailId) {
      return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });
    }

    // 2) Récupérer l'email en base
    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, gmail_message_id, sender, subject, ai_reply")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (error || !email) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    const replyBody = replyOverride || email.ai_reply;
    if (!replyBody) {
      return NextResponse.json({ error: "NO_REPLY_CONTENT" }, { status: 400 });
    }

    // 3) Token Google valide
    const accessToken = await getValidGoogleAccessToken(user.id);

    // 4) Récupérer le threadId depuis Gmail (pour répondre dans le même fil)
    let threadId: string | undefined;
    if (email.gmail_message_id) {
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.gmail_message_id}?format=minimal`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (msgRes.ok) {
          const msgJson = await msgRes.json();
          threadId = msgJson.threadId;
        }
      } catch {
        // threadId optionnel — on continue sans
      }
    }

    // 5) Construire et envoyer le message
    const raw = buildRawReply(
      email.sender ?? "",
      email.subject ?? "",
      replyBody
    );

    const sendPayload: any = { raw };
    if (threadId) sendPayload.threadId = threadId;

    const sendRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sendPayload),
      }
    );

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("[GMAIL SEND] Error:", errText);
      return NextResponse.json(
        { error: "GMAIL_SEND_FAILED", details: errText },
        { status: 400 }
      );
    }

    // 6) Marquer comme archivé (traité)
    await supabaseAdmin
      .from("emails")
      .update({ is_archived: true })
      .eq("id", email.id);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[GMAIL SEND] Fatal:", e);
    return NextResponse.json({ error: "SEND_FAILED" }, { status: 500 });
  }
}
