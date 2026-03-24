/**
 * GET /api/prospects/[id]/export-pdf
 * Génère et retourne un PDF du dossier de candidature locataire.
 * id = email_id du prospect
 */
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DossierPDF } from "@/components/pdf/DossierPDF";
import type { DossierDoc, DossierTimelineEntry } from "@/components/pdf/DossierPDF";

export const runtime = "nodejs";

// Convertit "Jean Dupont <jean@example.com>" → "jean@example.com"
function parseSenderEmail(sender: string | null | undefined): string | null {
  if (!sender) return null;
  const m = sender.match(/<([^>]+)>/);
  return m?.[1]?.trim() ?? sender.trim();
}

// Convertit un docType interne → label lisible
function docTypeLabel(docType: string): string {
  const MAP: Record<string, string> = {
    fiche_paie: "Fiches de paie",
    fiches_paie: "Fiches de paie",
    contrat_travail: "Contrat de travail",
    contrat: "Contrat de travail",
    avis_imposition: "Avis d'imposition",
    piece_identite: "Pièce d'identité",
    releve_bancaire: "Relevé bancaire",
    carte_etudiant: "Carte étudiante",
    kbis: "K-bis",
    document_garant: "Document garant",
    bilan: "Bilan comptable",
  };
  return MAP[docType] ?? docType;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: emailId } = await params;

    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // ── 1. Email + prospect_data + attachments ────────────────────────────────
    const { data: emailRow, error: emailErr } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, received_at, prospect_data, lead_json, property_id")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (emailErr || !emailRow) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    const pd = (emailRow.prospect_data ?? {}) as Record<string, unknown>;
    const lj = (emailRow.lead_json ?? {}) as Record<string, unknown>;

    // Attachments depuis lead_json.attachments
    const rawAttachments: Array<Record<string, unknown>> = Array.isArray(lj.attachments)
      ? (lj.attachments as Array<Record<string, unknown>>)
      : [];

    // ── 2. Bien associé ───────────────────────────────────────────────────────
    const propertyId = (emailRow.property_id as string | null)
      ?? (pd.property_id as string | null)
      ?? null;

    let property: {
      title: string;
      rent: number;
      required_docs: string[];
      address?: string | null;
    } | null = null;

    if (propertyId) {
      const { data: propRow } = await supabaseAdmin
        .from("properties")
        .select("id, title, name, rent, required_docs, address")
        .eq("id", propertyId)
        .maybeSingle();
      if (propRow) {
        property = {
          title: ((propRow.title ?? propRow.name ?? "") as string),
          rent: (propRow.rent as number) ?? 0,
          required_docs: Array.isArray(propRow.required_docs)
            ? (propRow.required_docs as string[])
            : [],
          address: (propRow.address as string | null) ?? null,
        };
      }
    }

    // ── 3. Timeline (10 dernières entrées) ────────────────────────────────────
    const { data: timelineRows } = await supabaseAdmin
      .from("prospect_timeline")
      .select("id, action_type, description, created_at")
      .eq("email_id", emailId)
      .order("created_at", { ascending: false })
      .limit(10);

    const timeline: DossierTimelineEntry[] = (timelineRows ?? []).map((r: any) => ({
      id: r.id,
      action_type: r.action_type,
      description: r.description ?? null,
      created_at: r.created_at,
    })).reverse(); // ordre chronologique pour l'affichage

    // ── 4. Calculs documents ──────────────────────────────────────────────────
    // Attachments reçus (ont un attachmentId ou storage_url)
    const docsRecusRaw = rawAttachments.filter(
      (a) => a.attachmentId || a.storage_url
    );

    // IDs d'attachments validés depuis la timeline
    const validatedIds = new Set(
      (timelineRows ?? [])
        .filter((r: any) => r.action_type === "DOCUMENT_VALIDE")
        .map((r: any) => (r as any).metadata?.attachmentId as string | undefined)
        .filter(Boolean)
    );

    // Checklist : si un bien avec required_docs est défini, on utilise ses docs attendus
    // sinon, on liste les attachments reçus
    const requiredDocs: string[] = property?.required_docs ?? [];

    let docs: DossierDoc[];

    if (requiredDocs.length > 0) {
      // Associer chaque doc requis à un attachment reçu (par docType ou filename heuristique)
      docs = requiredDocs.map((reqDoc) => {
        const match = docsRecusRaw.find((a) => {
          const docType = (a.docType as string | undefined) ?? "";
          const fname = ((a.filename as string | undefined) ?? "").toLowerCase();
          const reqNorm = reqDoc.toLowerCase();
          return (
            docType === reqDoc ||
            docType.includes(reqNorm) ||
            fname.includes(reqNorm)
          );
        });

        if (!match) {
          return { label: docTypeLabel(reqDoc), status: "manquant" };
        }

        const isValidated = match.attachmentId
          ? validatedIds.has(match.attachmentId as string)
          : false;

        return {
          label: docTypeLabel(reqDoc),
          status: isValidated ? "valide" : "en_attente",
          received_at: (match.received_at as string | undefined) ?? null,
        };
      });
    } else {
      // Pas de required_docs : lister tous les attachments
      docs = docsRecusRaw.map((a) => {
        const isValidated = a.attachmentId
          ? validatedIds.has(a.attachmentId as string)
          : false;
        const label = docTypeLabel(
          (a.docType as string | undefined) ?? ((a.filename as string | undefined) ?? "Document")
        );
        return {
          label,
          status: isValidated ? "valide" : "en_attente",
          received_at: (a.received_at as string | undefined) ?? null,
        };
      });
    }

    const docsTotal = requiredDocs.length > 0 ? requiredDocs.length : docsRecusRaw.length;
    const docsRecus = docs.filter((d) => d.status !== "manquant").length;

    // ── 5. Données prospect ───────────────────────────────────────────────────
    const revenus = typeof pd.revenus_mensuels === "number"
      ? pd.revenus_mensuels
      : typeof pd.revenus_mensuels === "string"
      ? parseFloat(pd.revenus_mensuels)
      : null;

    const rent = property?.rent ?? null;

    // ratio = revenus / loyer (ex: 3x signifie revenus = 3× le loyer)
    const ratio: number | null =
      revenus && rent && rent > 0 ? Math.round((revenus / rent) * 10) / 10 : null;

    const senderEmail = parseSenderEmail(emailRow.sender as string | null);
    const candidatName =
      (pd.nom as string | null) ??
      (pd.nom_prenom as string | null) ??
      senderEmail ??
      "Candidat";

    // ── 6. Note de synthèse IA (best-effort) ─────────────────────────────────
    let syntheseIA: string | null = null;
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const attachments = (emailRow as Record<string, unknown>).attachments as Array<Record<string, unknown>> ?? [];
        const validatedAtts = attachments.filter((a) => a.validated_by_human === true);
        const nom = (pd.nom as string | null) ?? candidatName;
        const situationPro = (pd.situation_pro as string | null) ?? "non renseignée";
        const revenusPd = typeof pd.revenus_mensuels === "number" ? pd.revenus_mensuels : typeof pd.revenus_mensuels === "string" ? parseFloat(pd.revenus_mensuels) : null;
        const loyerPd = typeof pd.loyer_max === "number" ? pd.loyer_max : typeof pd.loyer_max === "string" ? parseFloat(pd.loyer_max) : null;
        const ratioPd = revenusPd && loyerPd ? (revenusPd / loyerPd).toFixed(1) : "inconnu";
        const garantPd = (pd.garant as string | null) ?? "non renseigné";
        const etape = (pd.etape_process as string | null) ?? "NEW";
        const docLines = validatedAtts.length > 0
          ? validatedAtts.map((a) => `- ${(a.docType as string) ?? (a.filename as string) ?? "Document"} (validé ✓)`).join("\n")
          : "Aucun document validé";

        const summaryPrompt = `Tu es un assistant immobilier expert. Génère une note de synthèse concise pour un dossier de candidature locataire.

CANDIDAT : ${nom}
SITUATION PRO : ${situationPro}
REVENUS NETS/MOIS : ${revenusPd ? `${revenusPd.toLocaleString("fr-FR")} €` : "non renseignés"}
LOYER VISÉ : ${loyerPd ? `${loyerPd.toLocaleString("fr-FR")} €` : "non renseigné"}
RATIO REVENUS/LOYER : ${ratioPd}x
GARANT : ${garantPd}
ÉTAPE ACTUELLE : ${etape}

DOCUMENTS VALIDÉS :
${docLines}

Rédige la note de synthèse en français, structurée en 5 parties :
1. Présentation du candidat (2-3 phrases)
2. Analyse financière (solvabilité, ratio, commentaire)
3. État du dossier (documents reçus et validés)
4. Points d'attention ou risques
5. Recommandation (valider / mettre en attente / refuser + justification brève)

Sois factuel, précis et professionnel. Maximum 300 mots.`;

        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            messages: [{ role: "user", content: summaryPrompt }],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          syntheseIA = (aiData.content?.[0]?.text as string | null) ?? null;
        }
      }
    } catch (synthErr) {
      console.warn("[EXPORT_PDF] Synthèse IA échouée (non bloquant):", synthErr);
    }

    // ── 7. Génération PDF ─────────────────────────────────────────────────────
    const element = createElement(DossierPDF, {
      candidatName,
      email: senderEmail,
      telephone: (pd.telephone as string | null) ?? null,
      situationPro: (pd.situation_pro as string | null) ?? null,
      revenus: isNaN(revenus as number) ? null : revenus,
      garant: (pd.garant as string | null) ?? null,
      ratio,
      propertyTitle: property?.title ?? null,
      propertyRent: property?.rent ?? null,
      docsTotal,
      docsRecus,
      docs,
      timeline,
      generatedAt: new Date().toISOString(),
      syntheseIA,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(element as any);

    // ── 8. Nom du fichier ─────────────────────────────────────────────────────
    const safeName = candidatName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 30);
    const today = new Date().toISOString().split("T")[0];
    const filename = `Dossier_${safeName}_${today}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[EXPORT_PDF] Fatal:", err);
    return NextResponse.json({ error: "PDF_GENERATION_FAILED" }, { status: 500 });
  }
}
