/**
 * POST /api/portal/[token]/upload
 * Route PUBLIQUE — upload d'un document par le prospect.
 *
 * Reçoit : multipart/form-data { file: File }
 * 1. Vérifie le token
 * 2. Upload dans Supabase Storage : prospect-docs/[emailId]/[ts]_[filename]
 * 3. Classifie avec Claude (vision pour images, nom seul pour PDF)
 * 4. Ajoute dans emails.attachments avec source:"portal"
 *
 * Output : { docType, confidence, label, storagePath, filename }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

async function classifyWithClaude(params: {
  filename: string;
  mimeType: string;
  fileBuffer: Buffer;
}): Promise<{ docType: string; confidence: number; label: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { docType: "autre", confidence: 0, label: "Document" };

  const isImage = params.mimeType.startsWith("image/") && !params.mimeType.includes("heic");

  const systemPrompt = `Quel type de document est-ce ? Réponds UNIQUEMENT en JSON valide (sans markdown, sans texte autour) :
{"docType":"<type>","confidence":<0.0-1.0>,"label":"<label lisible en français>"}

Types valides : fiche_paie | contrat_travail | avis_imposition | piece_identite | garant_fiche_paie | garant_contrat | rib | quittance_loyer | kbis | bilan | releve_bancaire | carte_etudiant | autre`;

  const content: unknown[] = [];

  // Vision pour images (sauf HEIC non supporté par Claude)
  if (isImage && params.fileBuffer.length < 5 * 1024 * 1024) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: params.mimeType as "image/jpeg" | "image/png" | "image/webp",
        data: params.fileBuffer.toString("base64"),
      },
    });
  }

  content.push({
    type: "text",
    text: `Nom du fichier : "${params.filename}"\nType MIME : ${params.mimeType}\n\n${systemPrompt}`,
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}`);

    const data = await res.json() as { content?: { text?: string }[] };
    const text = (data.content?.[0]?.text ?? "").trim();
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error("No JSON in response");

    const parsed = JSON.parse(match[0]) as {
      docType?: string;
      confidence?: number;
      label?: string;
    };
    return {
      docType:    parsed.docType    ?? "autre",
      confidence: typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0,
      label:      parsed.label      ?? parsed.docType ?? "Document",
    };
  } catch (err) {
    console.warn("[upload/classify] Claude error:", err);
    return { docType: "autre", confidence: 0, label: "Document" };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // ── 1. Vérifier le token ──────────────────────────────────────────────────
    const { data: tokenRow } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("id, email_id, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
    if (new Date(tokenRow.expires_at) < new Date()) {
      return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 410 });
    }

    // ── 2. Parser le fichier ──────────────────────────────────────────────────
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });

    const { name: filename, type: mimeType, size } = file;

    if (!ALLOWED_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: "INVALID_FILE_TYPE", allowed: ALLOWED_TYPES },
        { status: 400 }
      );
    }
    if (size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "FILE_TOO_LARGE", maxMB: 10 }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // ── 3. Upload Supabase Storage ────────────────────────────────────────────
    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._\-() ]/g, "_");
    const storagePath = `${tokenRow.email_id}/${timestamp}_${safeName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("prospect-docs")
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error("[upload] Storage error:", uploadError);
      return NextResponse.json(
        { error: "UPLOAD_FAILED", details: uploadError.message },
        { status: 500 }
      );
    }

    // ── 4. Classification IA ──────────────────────────────────────────────────
    const { docType, confidence, label } = await classifyWithClaude({
      filename,
      mimeType,
      fileBuffer,
    });

    // ── 5. Ajouter dans emails.attachments ────────────────────────────────────
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("attachments")
      .eq("id", tokenRow.email_id)
      .maybeSingle();

    const currentAtts = (emailRow?.attachments ?? []) as Record<string, unknown>[];
    const newAttachment = {
      filename,
      mimeType,
      size,
      storage_path:       storagePath,
      source:             "portal",          // distingue des PJ Gmail
      docType,
      ai_confidence:      confidence,
      ai_reasoning:       null,
      label,
      validated_by_human: false,
      status:             "EN_ATTENTE",
      uploaded_at:        new Date().toISOString(),
      detected_at:        new Date().toISOString(),
    };

    await supabaseAdmin
      .from("emails")
      .update({ attachments: [...currentAtts, newAttachment] })
      .eq("id", tokenRow.email_id);

    // Marquer le token comme utilisé (premier upload)
    if (!tokenRow.used_at) {
      await supabaseAdmin
        .from("document_portal_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", tokenRow.id);
    }

    return NextResponse.json({ docType, confidence, label, storagePath, filename });
  } catch (err) {
    console.error("[portal/upload]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
