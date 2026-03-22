/**
 * GET /api/portal/[token]
 * Route PUBLIQUE — le token fait office d'authentification.
 * Retourne les infos du prospect et les documents requis + déjà uploadés.
 *
 * Output : {
 *   prospectName, prospectEmail, situationPro,
 *   requiredDocs: { key, label }[],
 *   uploadedDocs: { filename, docType, ai_confidence, label, validated_by_human, uploaded_at }[],
 *   expiresAt
 * }
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const DOC_PROFILES: Record<string, { key: string; label: string }[]> = {
  CDI: [
    { key: "fiches_paie",     label: "Fiches de paie (3 mois)" },
    { key: "contrat",         label: "Contrat de travail" },
    { key: "avis_imposition", label: "Avis d'imposition" },
    { key: "piece_identite",  label: "Pièce d'identité" },
  ],
  CDD: [
    { key: "fiches_paie",     label: "Fiches de paie (3 mois)" },
    { key: "contrat",         label: "Contrat de travail (+ durée restante)" },
    { key: "avis_imposition", label: "Avis d'imposition" },
    { key: "piece_identite",  label: "Pièce d'identité" },
  ],
  ETUDIANT: [
    { key: "carte_etudiant",  label: "Carte étudiante" },
    { key: "scolarite",       label: "Certificat de scolarité" },
    { key: "piece_identite",  label: "Pièce d'identité" },
    { key: "garant_id",       label: "Garant : pièce d'identité" },
    { key: "garant_paie",     label: "Garant : fiches de paie" },
  ],
  AUTO_ENTREPRENEUR: [
    { key: "kbis",            label: "Kbis (moins de 3 mois)" },
    { key: "bilan",           label: "Bilans des 3 dernières années" },
    { key: "releves",         label: "Relevés bancaires (3 mois)" },
    { key: "piece_identite",  label: "Pièce d'identité" },
  ],
  RETRAITE: [
    { key: "pension",         label: "Relevés de pension (3 mois)" },
    { key: "avis_imposition", label: "Avis d'imposition" },
    { key: "piece_identite",  label: "Pièce d'identité" },
  ],
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // ── 1. Vérifier le token ──────────────────────────────────────────────────
    const { data: tokenRow } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("id, email_id, prospect_email, prospect_name, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
    if (new Date(tokenRow.expires_at) < new Date()) {
      return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 410 });
    }

    // ── 2. Email + prospect_data + attachments ────────────────────────────────
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("id, prospect_data, attachments, subject")
      .eq("id", tokenRow.email_id)
      .maybeSingle();

    if (!emailRow) return NextResponse.json({ error: "PROSPECT_NOT_FOUND" }, { status: 404 });

    const pd = (emailRow.prospect_data ?? {}) as Record<string, unknown>;
    const situationPro = (pd.situation_pro as string | null) ?? null;
    const requiredDocs = situationPro
      ? (DOC_PROFILES[situationPro] ?? DOC_PROFILES.CDI)
      : DOC_PROFILES.CDI;

    // ── 3. Docs déjà déposés via le portail ──────────────────────────────────
    const attachments = (emailRow.attachments ?? []) as Record<string, unknown>[];
    const uploadedDocs = attachments
      .filter((a) => a.source === "portal")
      .map((a) => ({
        filename:           a.filename,
        docType:            a.docType,
        ai_confidence:      a.ai_confidence,
        label:              a.label,
        validated_by_human: a.validated_by_human,
        uploaded_at:        a.uploaded_at,
        storage_path:       a.storage_path,
      }));

    return NextResponse.json({
      prospectName:  tokenRow.prospect_name,
      prospectEmail: tokenRow.prospect_email,
      situationPro,
      requiredDocs,
      uploadedDocs,
      expiresAt:     tokenRow.expires_at,
    });
  } catch (err) {
    console.error("[portal/token GET]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
