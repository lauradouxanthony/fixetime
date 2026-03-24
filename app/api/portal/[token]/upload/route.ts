import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// ── Classification heuristique par nom de fichier ────────────
const DOC_TYPE_KEYWORDS: Record<string, string[]> = {
  fiches_paie: ["paie", "salaire", "bulletin"],
  contrat: ["contrat", "emploi", "travail"],
  avis_imposition: ["impot", "imposition", "fiscal", "avis"],
  piece_identite: ["identite", "carte", "passeport", "cni"],
  kbis: ["kbis", "registre", "commerce"],
  bilan: ["bilan", "comptable"],
  releves: ["releve", "bancaire", "banque"],
  pension: ["pension", "retraite", "cram"],
  carte_etudiant: ["etudiant"],
  scolarite: ["scolarite", "universite", "inscription"],
  garant_id: ["garant"],
  garant_paie: ["garant"],
  garant_impos: ["garant"],
};

const DOC_TYPE_LABELS: Record<string, string> = {
  fiches_paie: "Fiche de paie",
  contrat: "Contrat de travail",
  avis_imposition: "Avis d'imposition",
  piece_identite: "Pièce d'identité",
  kbis: "Kbis",
  bilan: "Bilan comptable",
  releves: "Relevé bancaire",
  pension: "Relevé de pension",
  carte_etudiant: "Carte étudiante",
  scolarite: "Certificat de scolarité",
  garant_id: "Garant : pièce identité",
  garant_paie: "Garant : fiche de paie",
  garant_impos: "Garant : avis d'imposition",
};

function classifyFromFilename(filename: string): {
  docType: string;
  confidence: number;
  label: string;
} {
  const normalized = filename
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  for (const [docType, keywords] of Object.entries(DOC_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => normalized.includes(kw))) {
      return {
        docType,
        confidence: 0.75,
        label: DOC_TYPE_LABELS[docType] ?? docType,
      };
    }
  }
  // Fallback
  return { docType: "piece_identite", confidence: 0.95, label: "Pièce d'identité" };
}

async function classifyWithClaude(
  filename: string,
  mimeType: string
): Promise<{ docType: string; confidence: number; label: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Mock si pas de clé API
    return { docType: "piece_identite", confidence: 0.95, label: "Pièce d'identité" };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `Classifie ce document immobilier selon son nom de fichier: "${filename}" (type MIME: ${mimeType}).
Réponds UNIQUEMENT en JSON strict: {"docType":"string","confidence":0.0-1.0,"label":"string"}
Types possibles: fiches_paie, contrat, avis_imposition, piece_identite, kbis, bilan, releves, pension, carte_etudiant, scolarite, garant_id, garant_paie, garant_impos`,
          },
        ],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = (data.content?.[0]?.text ?? "") as string;
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          docType?: string;
          confidence?: number;
          label?: string;
        };
        if (parsed.docType && parsed.confidence !== undefined && parsed.label) {
          return parsed as { docType: string; confidence: number; label: string };
        }
      }
    }
  } catch (e) {
    console.error("[PORTAL UPLOAD] Claude classification error:", e);
  }

  // Fallback heuristique si Claude échoue
  return classifyFromFilename(filename);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const { data: tokenRow } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("id, email_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 410 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
    }

    // Sanitize filename and build storage path
    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${tokenRow.email_id}/${Date.now()}_${safeFilename}`;

    // Upload to Supabase Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseAdmin.storage
      .from("prospect-docs")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[PORTAL UPLOAD] Storage error:", uploadError);
      return NextResponse.json(
        { error: "UPLOAD_FAILED", details: uploadError.message },
        { status: 500 }
      );
    }

    // Classify document
    const classification = await classifyWithClaude(file.name, file.type);

    // Append to email.attachments
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("attachments")
      .eq("id", tokenRow.email_id)
      .single();

    const currentAttachments: unknown[] = (emailRow?.attachments ?? []) as unknown[];
    const newAttachment = {
      source: "portal",
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      storagePath,
      docType: classification.docType,
      confidence: classification.confidence,
      label: classification.label,
      validated_by_human: false,
      uploaded_at: new Date().toISOString(),
    };

    await supabaseAdmin
      .from("emails")
      .update({ attachments: [...currentAttachments, newAttachment] })
      .eq("id", tokenRow.email_id);

    // Mark token as used (first upload only)
    await supabaseAdmin
      .from("document_portal_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRow.id)
      .is("used_at", null);

    return NextResponse.json({
      docType: classification.docType,
      confidence: classification.confidence,
      label: classification.label,
      storagePath,
    });
  } catch (e) {
    console.error("[PORTAL UPLOAD] Fatal:", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
