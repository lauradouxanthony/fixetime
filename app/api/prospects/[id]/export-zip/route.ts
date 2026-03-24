/**
 * GET /api/prospects/[id]/export-zip
 * Télécharge toutes les pièces jointes reçues d'un prospect dans un fichier ZIP.
 * id = email_id du prospect
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import JSZip from "jszip";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: emailId } = await params;

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // ── 1. Email + attachments ─────────────────────────────────────────────────
    const { data: emailRow, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, gmail_message_id, prospect_data, attachments")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !emailRow) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    const gmailMessageId = emailRow.gmail_message_id as string | null;
    if (!gmailMessageId) {
      return NextResponse.json({ error: "NO_GMAIL_MESSAGE_ID" }, { status: 400 });
    }

    const attachments = (emailRow.attachments ?? []) as Record<string, unknown>[];
    const exportableAtts = attachments.filter((a) => typeof a.attachmentId === "string" && a.attachmentId);

    if (exportableAtts.length === 0) {
      return NextResponse.json({ error: "NO_ATTACHMENTS" }, { status: 400 });
    }

    // ── 2. Access token Google ─────────────────────────────────────────────────
    let accessToken: string;
    try {
      accessToken = await getValidGoogleAccessToken(user.id);
    } catch {
      return NextResponse.json({ error: "TOKEN_ERROR" }, { status: 400 });
    }

    // ── 3. Télécharger chaque PJ et construire le ZIP ─────────────────────────
    const zip = new JSZip();
    const pd = (emailRow.prospect_data ?? {}) as Record<string, unknown>;
    const candidatName = ((pd.nom as string | null) ?? (emailRow.sender as string | null) ?? "candidat")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 20);

    const filenameCount = new Map<string, number>();

    const results = await Promise.allSettled(
      exportableAtts.map(async (att) => {
        const gmailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/attachments/${att.attachmentId as string}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!gmailRes.ok) throw new Error(`Gmail fetch failed for ${att.filename as string}`);

        const { data: base64Data } = await gmailRes.json() as { data: string | null };
        if (!base64Data) throw new Error(`No data for ${att.filename as string}`);

        const buffer = Buffer.from(base64Data.replace(/-/g, "+").replace(/_/g, "/"), "base64");

        // Construire un nom de fichier descriptif
        const docType = att.docType as string | null;
        const rawFilename = att.filename as string | null ?? "document";
        const prefix = docType ? `${docType}_` : "";
        let zipFilename = `${prefix}${rawFilename}`.replace(/[^a-zA-Z0-9._\-() ]/g, "_");

        // Éviter les doublons
        const count = (filenameCount.get(zipFilename) ?? 0) + 1;
        filenameCount.set(zipFilename, count);
        if (count > 1) {
          const ext = zipFilename.includes(".") ? `.${zipFilename.split(".").pop()}` : "";
          const base = ext ? zipFilename.slice(0, zipFilename.lastIndexOf(".")) : zipFilename;
          zipFilename = `${base}_${count}${ext}`;
        }

        zip.file(zipFilename, buffer);
      })
    );

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    if (successCount === 0) {
      return NextResponse.json({ error: "ALL_DOWNLOADS_FAILED" }, { status: 502 });
    }

    // ── 4. Générer le ZIP ──────────────────────────────────────────────────────
    const today = new Date().toISOString().split("T")[0];
    const zipName = `Dossier_${candidatName}_${today}.zip`;
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[export-zip]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
