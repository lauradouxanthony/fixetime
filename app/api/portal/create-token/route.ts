import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { emailId, sendEmail } = await req.json();
    if (!emailId) return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });

    // Fetch email to get prospect info
    const { data: email } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, prospect_data")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (!email) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    const pd = email.prospect_data as Record<string, unknown> | null;
    const rawSender = email.sender ?? "";
    const prospectEmail =
      rawSender.match(/<(.+)>/)?.[1] ?? rawSender;
    const prospectName =
      (pd?.nom as string) ??
      rawSender.replace(/<.*>/, "").trim() ??
      "";

    // Check if token already exists for this email
    const { data: existing } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("id, token, expires_at, last_sent_at")
      .eq("email_id", emailId)
      .maybeSingle();

    let tokenRow: {
      id: string;
      token: string;
      expires_at: string;
      last_sent_at: string | null;
    };

    if (existing) {
      tokenRow = existing;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("document_portal_tokens")
        .insert({
          email_id: emailId,
          user_id: user.id,
          prospect_email: prospectEmail,
          prospect_name: prospectName,
        })
        .select()
        .single();

      if (insertError || !inserted) {
        console.error("[PORTAL CREATE] Insert error:", insertError);
        return NextResponse.json({ error: "INSERT_FAILED" }, { status: 500 });
      }
      tokenRow = inserted;
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
    const portalUrl = `${baseUrl}/portal/${tokenRow.token}`;

    // Optionally send via Gmail
    let gmailError: string | null = null;
    if (sendEmail && prospectEmail) {
      try {
        const accessToken = await getValidGoogleAccessToken(user.id);

        const emailBody = [
          `Bonjour ${prospectName},`,
          "",
          "Pour avancer votre dossier de location, veuillez déposer vos documents via ce lien sécurisé :",
          "",
          portalUrl,
          "",
          "Ce lien est valable 7 jours.",
          "",
          "Cordialement,",
          "L'équipe FixTime",
        ].join("\n");

        const subjectEncoded = `=?UTF-8?B?${Buffer.from(
          "Dépôt de vos documents — dossier de location",
          "utf-8"
        ).toString("base64")}?=`;

        const mime = [
          "MIME-Version: 1.0",
          `To: ${prospectEmail}`,
          `Subject: ${subjectEncoded}`,
          "Content-Type: text/plain; charset=UTF-8",
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from(emailBody, "utf-8").toString("base64"),
        ].join("\r\n");

        const raw = Buffer.from(mime, "utf-8")
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const sendRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ raw }),
          }
        );

        if (!sendRes.ok) {
          const errText = await sendRes.text();
          console.error("[PORTAL CREATE] Gmail send failed:", errText);
          gmailError = errText;
        } else {
          const now = new Date().toISOString();
          await supabaseAdmin
            .from("document_portal_tokens")
            .update({ last_sent_at: now })
            .eq("id", tokenRow.id);
          tokenRow.last_sent_at = now;
        }
      } catch (e) {
        console.error("[PORTAL CREATE] Gmail exception:", e);
        gmailError = String(e);
      }
    }

    if (gmailError && sendEmail) {
      return NextResponse.json(
        {
          portalUrl,
          token: tokenRow.token,
          expiresAt: tokenRow.expires_at,
          lastSentAt: tokenRow.last_sent_at,
          gmailError: "GMAIL_UNAVAILABLE",
        },
        { status: 207 }
      );
    }

    return NextResponse.json({
      portalUrl,
      token: tokenRow.token,
      expiresAt: tokenRow.expires_at,
      lastSentAt: tokenRow.last_sent_at,
    });
  } catch (e) {
    console.error("[PORTAL CREATE] Fatal:", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
