import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const DOC_PROFILES: Record<string, Array<{ key: string; label: string }>> = {
  CDI: [
    { key: "fiches_paie", label: "Fiches de paie (3 mois)" },
    { key: "contrat", label: "Contrat de travail" },
    { key: "avis_imposition", label: "Avis d'imposition" },
    { key: "piece_identite", label: "Pièce d'identité" },
  ],
  CDD: [
    { key: "fiches_paie", label: "Fiches de paie (3 mois)" },
    { key: "contrat", label: "Contrat de travail (+ durée)" },
    { key: "avis_imposition", label: "Avis d'imposition" },
    { key: "piece_identite", label: "Pièce d'identité" },
  ],
  ETUDIANT: [
    { key: "carte_etudiant", label: "Carte étudiante" },
    { key: "scolarite", label: "Certificat de scolarité" },
    { key: "piece_identite", label: "Pièce d'identité" },
    { key: "garant_id", label: "Garant : pièce identité" },
    { key: "garant_paie", label: "Garant : fiches de paie" },
    { key: "garant_impos", label: "Garant : avis d'imposition" },
  ],
  AUTO_ENTREPRENEUR: [
    { key: "kbis", label: "Kbis (< 3 mois)" },
    { key: "bilan", label: "Bilans (3 dernières années)" },
    { key: "releves", label: "Relevés bancaires (3 mois)" },
    { key: "piece_identite", label: "Pièce d'identité" },
  ],
  RETRAITE: [
    { key: "pension", label: "Relevés de pension (3 mois)" },
    { key: "avis_imposition", label: "Avis d'imposition" },
    { key: "piece_identite", label: "Pièce d'identité" },
  ],
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const { data: tokenRow } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("id, email_id, prospect_name, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 410 });
    }

    const { data: email } = await supabaseAdmin
      .from("emails")
      .select("prospect_data, attachments")
      .eq("id", tokenRow.email_id)
      .single();

    const pd = email?.prospect_data as Record<string, unknown> | null;
    const situationPro = (pd?.situation_pro as string) ?? "CDI";
    const requiredDocs = DOC_PROFILES[situationPro] ?? DOC_PROFILES.CDI;

    const allAttachments: unknown[] = (email?.attachments ?? []) as unknown[];
    const uploadedDocs = (allAttachments as Record<string, unknown>[]).filter(
      (a) => a.source === "portal"
    );

    return NextResponse.json({
      prospectName: tokenRow.prospect_name ?? "",
      situationPro,
      requiredDocs,
      uploadedDocs,
      expiresAt: tokenRow.expires_at,
    });
  } catch (e) {
    console.error("[PORTAL GET]", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
