/**
 * POST /api/portal/create-token
 * Crée ou récupère un token de portail pour un prospect.
 * Si sendEmail: true, envoie le lien via Gmail API et met à jour last_sent_at.
 *
 * Input  : { emailId: string, sendEmail?: boolean }
 * Output : { portalUrl, token, expiresAt, lastSentAt, prospectEmail, prospectName }
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

function buildPortalEmail(params: {
  prospectName: string;
  portalUrl: string;
  propertySubject: string | null;
}): string {
  const greeting = `Bonjour ${params.prospectName},`;
  const intro = `Suite à votre demande de location${params.propertySubject ? ` concernant : "${params.propertySubject}"` : ""}, nous vous invitons à déposer vos documents via notre portail sécurisé.`;
  const link = `👉 Déposez votre dossier ici : ${params.portalUrl}`;
  const validity = `Ce lien est valable 7 jours. Vous pouvez y déposer vos documents en quelques clics, depuis votre téléphone ou ordinateur.`;
  const closing = `N'hésitez pas à nous contacter si vous avez la moindre question.\n\nCordialement,\nL'équipe de l'agence`;
  return [greeting, "", intro, "", link, "", validity, "", closing].join("\n");
}

async function sendGmailEmail(params: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  gmailMessageId: string | null;
}): Promise<void> {
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(params.subject, "utf-8").toString("base64")}?=`;
  const mime = [
    `MIME-Version: 1.0`,
    `To: ${params.to}`,
    `Subject: ${subjectEncoded}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(params.body, "utf-8").toString("base64"),
  ].join("\r\n");

  const raw = Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Récupérer le threadId pour rester dans le même fil
  let threadId: string | undefined;
  if (params.gmailMessageId) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${params.gmailMessageId}?format=minimal`,
        { headers: { Authorization: `Bearer ${params.accessToken}` } }
      );
      if (msgRes.ok) threadId = (await msgRes.json()).threadId;
    } catch { /* threadId optionnel */ }
  }

  const payload: Record<string, unknown> = { raw };
  if (threadId) payload.threadId = threadId;

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send error ${res.status}: ${err}`);
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { emailId, sendEmail = false } = await req.json() as {
      emailId: string;
      sendEmail?: boolean;
    };
    if (!emailId) return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });

    // ── 1. Vérifier que l'email appartient à cet agent ────────────────────────
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, gmail_message_id, prospect_data")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!emailRow) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    // ── 2. Extraire email et nom du prospect ──────────────────────────────────
    const prospectEmail = (emailRow.sender ?? "")
      .replace(/.*<(.+)>.*/, "$1")
      .trim() || (emailRow.sender ?? "");
    const pd = (emailRow.prospect_data ?? {}) as Record<string, unknown>;
    const prospectName = (pd.nom as string | null) ?? prospectEmail ?? "Candidat";

    // ── 3. Token existant non expiré ? ────────────────────────────────────────
    const { data: existing } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("id, token, expires_at, last_sent_at, created_at")
      .eq("email_id", emailId)
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let tokenRow = existing;

    if (!tokenRow) {
      // ── 4a. Créer un nouveau token ─────────────────────────────────────────
      const { data: created, error: createErr } = await supabaseAdmin
        .from("document_portal_tokens")
        .insert({
          email_id: emailId,
          user_id: user.id,
          prospect_email: prospectEmail,
          prospect_name: prospectName,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select("id, token, expires_at, last_sent_at, created_at")
        .single();

      if (createErr || !created) {
        console.error("[create-token] DB insert error:", createErr);
        return NextResponse.json({ error: "TOKEN_CREATION_FAILED" }, { status: 500 });
      }
      tokenRow = created;
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
    const portalUrl = `${siteUrl}/portal/${tokenRow.token}`;

    // ── 5. Envoyer l'email si demandé ─────────────────────────────────────────
    let lastSentAt = tokenRow.last_sent_at ?? null;

    if (sendEmail) {
      try {
        const accessToken = await getValidGoogleAccessToken(user.id);
        const emailBody = buildPortalEmail({
          prospectName,
          portalUrl,
          propertySubject: (emailRow.subject as string | null) ?? null,
        });

        await sendGmailEmail({
          accessToken,
          to: prospectEmail,
          subject: `Déposez votre dossier de location`,
          body: emailBody,
          gmailMessageId: (emailRow.gmail_message_id as string | null) ?? null,
        });

        lastSentAt = new Date().toISOString();
        await supabaseAdmin
          .from("document_portal_tokens")
          .update({ last_sent_at: lastSentAt })
          .eq("id", tokenRow.id);
      } catch (sendErr) {
        console.error("[create-token] Gmail send error:", sendErr);
        // On retourne quand même le token même si l'envoi échoue
        return NextResponse.json(
          { error: "EMAIL_SEND_FAILED", portalUrl, token: tokenRow.token },
          { status: 207 }
        );
      }
    }

    return NextResponse.json({
      portalUrl,
      token: tokenRow.token,
      expiresAt: tokenRow.expires_at,
      lastSentAt,
      prospectEmail,
      prospectName,
    });
  } catch (err) {
    console.error("[create-token]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
