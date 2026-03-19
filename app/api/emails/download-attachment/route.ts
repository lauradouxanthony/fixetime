/**
 * GET /api/emails/download-attachment
 * Télécharge une pièce jointe Gmail via l'API Gmail.
 * Params : gmailMessageId, attachmentId, filename, mimeType
 * ?inline=true → Content-Disposition: inline (pour aperçu dans iframe/img)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = authData.user.id;

  const { searchParams } = req.nextUrl;
  const gmailMessageId = searchParams.get("gmailMessageId");
  const attachmentId = searchParams.get("attachmentId");
  const filename = searchParams.get("filename") ?? "document";
  const mimeType = searchParams.get("mimeType") ?? "application/octet-stream";
  const inline = searchParams.get("inline") === "true";

  if (!gmailMessageId || !attachmentId) {
    return NextResponse.json({ error: "Missing gmailMessageId or attachmentId" }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(userId);
  } catch {
    return NextResponse.json({ error: "TOKEN_ERROR" }, { status: 400 });
  }

  // Appel Gmail API pour récupérer le contenu de la PJ
  const gmailRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!gmailRes.ok) {
    const err = await gmailRes.text();
    console.error("[DOWNLOAD-ATT] Gmail error:", err);
    return NextResponse.json({ error: "GMAIL_FETCH_ERROR", details: err }, { status: 502 });
  }

  const { data: base64Data } = await gmailRes.json();
  if (!base64Data) {
    return NextResponse.json({ error: "NO_DATA" }, { status: 502 });
  }

  // Décoder base64url → Buffer
  const buffer = Buffer.from(base64Data.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  // Sanitiser le nom de fichier pour le header
  const safeFilename = filename.replace(/[^\w.\-() ]/g, "_");
  const disposition = inline
    ? `inline; filename="${safeFilename}"`
    : `attachment; filename="${safeFilename}"`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(buffer.length),
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
