/**
 * POST /api/emails/validate-doc
 * Valider ou rejeter un document reçu dans un email.
 * - action: "validate" → DOCUMENT_VALIDE + email prospect si dossier complet
 * - action: "reject"   → DOCUMENT_REJETE + email de rejet au prospect
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

// Map nom de fichier / docType → label lisible (supporte nouveau format fiche_paie et ancien fiches_paie)
function docTypeLabel(docType: string | null, filename: string): string {
  if (docType === "fiche_paie" || docType === "fiches_paie") return "fiches de paie";
  if (docType === "contrat_travail" || docType === "contrat") return "contrat de travail";
  if (docType === "avis_imposition") return "avis d'imposition";
  if (docType === "piece_identite") return "pièce d'identité";
  if (docType === "releve_bancaire") return "relevé bancaire";
  if (docType === "carte_etudiant") return "carte étudiante";
  if (docType === "kbis") return "K-bis";
  if (docType === "document_garant") return "document garant";
  if (docType === "bilan") return "bilan comptable";
  return filename;
}

async function sendGmailMessage(params: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
}) {
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
  const rawMsg = Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const payload: Record<string, unknown> = { raw: rawMsg };
  if (params.threadId) payload.threadId = params.threadId;

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
  return res.json();
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = authData.user.id;

  let body: {
    emailId: string;
    attachmentId: string;
    filename: string;
    docType?: string | null;
    action: "validate" | "reject";
    rejectionReason?: string;
    dossierComplet?: boolean; // client indique si tous les docs sont maintenant validés
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { emailId, attachmentId, filename, docType = null, action, rejectionReason, dossierComplet } = body;
  if (!emailId || !attachmentId || !filename || !action) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Récupérer l'email (pour sender, subject, gmail_message_id, prospect_data)
  const { data: emailRow } = await supabaseAdmin
    .from("emails")
    .select("id, sender, subject, gmail_message_id, prospect_data, user_id")
    .eq("id", emailId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!emailRow) return NextResponse.json({ error: "Email not found" }, { status: 404 });

  const senderEmail = (emailRow.sender ?? "").replace(/.*<(.+)>/, "$1").trim() || (emailRow.sender ?? "");
  const prospectNom = (emailRow.prospect_data as any)?.nom_prenom
    ?? (emailRow.prospect_data as any)?.nom
    ?? "le candidat";
  const docLabel = docTypeLabel(docType, filename);

  // ── Si dossier complet → etape_process = DOSSIER_COMPLET ─────────────────
  if (action === "validate" && dossierComplet) {
    try {
      await supabaseAdmin
        .from("emails")
        .update({ etape_process: "DOSSIER_COMPLET" })
        .eq("id", emailId);
      console.log(`[VALIDATE-DOC] ✅ etape_process → DOSSIER_COMPLET pour email ${emailId}`);
    } catch (e) {
      console.warn("[VALIDATE-DOC] etape_process update échoué:", e);
    }
  }

  // ── Insérer dans prospect_timeline ────────────────────────────────────────
  const timelineEntry = {
    user_id: userId,
    email_id: emailId,
    action_type: action === "validate" ? "DOCUMENT_VALIDE" : "DOCUMENT_REJETE",
    description: action === "validate"
      ? `${docLabel} validé manuellement`
      : `${docLabel} rejeté — ${rejectionReason ?? "aucune raison"}`,
    metadata: { attachmentId, filename, docType, rejectionReason: rejectionReason ?? null },
  };

  try {
    await supabaseAdmin.from("prospect_timeline").insert(timelineEntry);
  } catch (e) {
    console.warn("[VALIDATE-DOC] prospect_timeline insert échoué:", e);
  }

  // ── Envoyer email si Gmail token disponible ───────────────────────────────
  let emailSent = false;
  try {
    const accessToken = await getValidGoogleAccessToken(userId);

    // Récupérer threadId pour répondre dans le même fil
    let threadId: string | undefined;
    if (emailRow.gmail_message_id) {
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailRow.gmail_message_id}?format=minimal`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (msgRes.ok) threadId = (await msgRes.json()).threadId;
      } catch { /* optional */ }
    }

    if (action === "validate" && dossierComplet) {
      // Dossier complet → email de confirmation
      const completionBody = `Bonjour ${prospectNom},\n\nVotre dossier est complet. Nous avons bien reçu et validé l'ensemble de vos documents.\n\nNous revenons vers vous très prochainement avec notre décision.\n\nCordialement,\nL'équipe de l'agence`;
      await sendGmailMessage({
        accessToken,
        to: senderEmail,
        subject: `Re: ${emailRow.subject ?? "Votre dossier de location"}`,
        body: completionBody,
        threadId,
      });
      emailSent = true;
      console.log(`[VALIDATE-DOC] ✅ Email dossier complet envoyé à ${senderEmail}`);
    } else if (action === "reject") {
      // Rejet → email de rejet
      const rejectionBody = `Bonjour ${prospectNom},\n\nNous avons examiné votre document "${docLabel}" que vous avez envoyé.\n\nMalheureusement : ${rejectionReason ?? "ce document ne correspond pas à nos critères"}.\n\nMerci de nous en renvoyer un nouveau dans les meilleurs délais.\n\nCordialement,\nL'équipe de l'agence`;
      await sendGmailMessage({
        accessToken,
        to: senderEmail,
        subject: `Re: ${emailRow.subject ?? "Votre dossier de location"}`,
        body: rejectionBody,
        threadId,
      });
      emailSent = true;
      console.log(`[VALIDATE-DOC] 📧 Email rejet envoyé à ${senderEmail}`);
    }
  } catch (e: any) {
    console.warn("[VALIDATE-DOC] Envoi email échoué:", e?.message);
  }

  return NextResponse.json({
    success: true,
    action,
    docLabel,
    emailSent,
    dossierComplet: action === "validate" && dossierComplet,
  });
}
