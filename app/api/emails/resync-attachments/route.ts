/**
 * GET /api/emails/resync-attachments
 * Re-scanne les emails LOCATION des 7 derniers jours pour détecter les PJ manquantes.
 * À appeler une fois après le fix extractAttachments.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";
export const maxDuration = 60;

function buildGmailLink(gmailMsgId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${gmailMsgId}`;
}

function classifyDocument(filename: string): string {
  const f = filename.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (f.includes("paie") || f.includes("salaire") || f.includes("bulletin") || f.includes("fiche")) return "fiche_paie";
  if (f.includes("contrat") || f.includes("cdi") || f.includes("cdd") || f.includes("emploi")) return "contrat_travail";
  if (f.includes("impos") || f.includes("avis") || f.includes("impot") || f.includes("fiscal")) return "avis_imposition";
  if (f.includes("identit") || f.includes("cni") || f.includes("passeport") || f.includes("carte") || f.includes(" id")) return "piece_identite";
  if (f.includes("rib") || f.includes("bancaire") || f.includes("releve") || f.includes("compte")) return "releve_bancaire";
  if (f.includes("etudiant") || f.includes("scolari") || f.includes("universite") || f.includes("ecole")) return "carte_etudiant";
  if (f.includes("kbis") || f.includes("siret") || f.includes("entreprise")) return "kbis";
  if (f.includes("garant") || f.includes("caution")) return "document_garant";
  return "autre";
}

function extractAttachments(payload: any): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
  const result: { filename: string; mimeType: string; attachmentId: string; size: number }[] = [];
  const seen = new Set<string>();
  const scan = (part: any) => {
    if (!part) return;
    if (part.body?.attachmentId && part.filename && part.filename.trim().length > 0) {
      const key = `${part.body.attachmentId}:${part.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ filename: part.filename.trim(), mimeType: part.mimeType ?? "application/octet-stream", attachmentId: part.body.attachmentId, size: part.body.size ?? 0 });
      }
    }
    if (Array.isArray(part.parts)) part.parts.forEach(scan);
  };
  if (payload) {
    scan(payload);
    if (Array.isArray(payload.parts)) payload.parts.forEach(scan);
  }
  return result;
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = authData.user.id;

  // Récupérer les emails LOCATION des 7 derniers jours avec gmail_message_id
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: emails } = await supabaseAdmin
    .from("emails")
    .select("id, gmail_message_id, attachments")
    .eq("user_id", userId)
    .eq("category", "LOCATION")
    .gte("received_at", since)
    .not("gmail_message_id", "is", null);

  if (!emails || emails.length === 0) {
    return NextResponse.json({ message: "Aucun email LOCATION à rescanner", updated: 0 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(userId);
  } catch {
    return NextResponse.json({ error: "TOKEN_ERROR" }, { status: 400 });
  }

  let updated = 0;
  let skipped = 0;
  const results: { id: string; gmailId: string; pj: number; action: string }[] = [];

  for (const email of emails) {
    const gmailId = email.gmail_message_id as string;
    const existingPj = (email.attachments as any[] ?? []).length;

    try {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) { skipped++; continue; }

      const detail = await res.json();
      const atts = extractAttachments(detail.payload);

      console.log(`[RESYNC-ATT] email=${email.id} gmailId=${gmailId} → ${atts.length} PJ (avant: ${existingPj})`);

      if (atts.length > 0) {
        const gmailLink = buildGmailLink(gmailId);
        const enriched = atts.map(att => ({ ...att, gmailLink, docType: classifyDocument(att.filename), status: "EN_ATTENTE" }));
        await supabaseAdmin.from("emails").update({ attachments: enriched }).eq("id", email.id);
        updated++;
        results.push({ id: email.id, gmailId, pj: atts.length, action: "updated" });
      } else {
        skipped++;
        results.push({ id: email.id, gmailId, pj: 0, action: "no_attachment" });
      }
    } catch (e: any) {
      console.warn(`[RESYNC-ATT] Error email=${email.id}:`, e?.message);
      skipped++;
    }
  }

  return NextResponse.json({ message: "Resync terminé", total: emails.length, updated, skipped, results });
}
