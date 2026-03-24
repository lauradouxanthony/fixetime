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

    // Append to email.attachments + fetch full email data for notifications
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("attachments, prospect_data, user_id, sender")
      .eq("id", tokenRow.email_id)
      .single();

    const currentAttachments: unknown[] = (emailRow?.attachments ?? []) as unknown[];
    const uploadedAt = new Date().toISOString();
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
      uploaded_at: uploadedAt,
    };

    // Mise à jour prospect_data avec note de réception portail
    const existingPd = (emailRow?.prospect_data ?? {}) as Record<string, unknown>;
    const portalNotes: string[] = Array.isArray(existingPd.portal_docs_received)
      ? (existingPd.portal_docs_received as string[])
      : [];
    portalNotes.push(`${classification.label} reçu via portail le ${new Date(uploadedAt).toLocaleDateString("fr-FR")}`);

    await supabaseAdmin
      .from("emails")
      .update({
        attachments: [...currentAttachments, newAttachment],
        prospect_data: {
          ...existingPd,
          portal_docs_received: portalNotes,
          etape_process: "DOSSIER_RECU",
          last_portal_upload: uploadedAt,
        },
      })
      .eq("id", tokenRow.email_id);

    // Mark token as used (first upload only)
    await supabaseAdmin
      .from("document_portal_tokens")
      .update({ used_at: uploadedAt })
      .eq("id", tokenRow.id)
      .is("used_at", null);

    // Notification à l'agent selon pipeline_mode
    const userId = emailRow?.user_id;
    if (userId) {
      try {
        const { data: settingsRow } = await supabaseAdmin
          .from("settings_v1")
          .select("email_rules")
          .eq("user_id", userId)
          .maybeSingle();

        const pipelineMode = (settingsRow?.email_rules as Record<string, unknown>)?.pipeline_mode ?? "DRAFT";
        const nomProspect = (existingPd.nom as string | null)
          ?? emailRow?.sender?.replace(/<.*>/, "").trim()
          ?? "Un prospect";

        if (pipelineMode === "AUTOPILOTE") {
          // Envoyer un email à l'agent (via son adresse auth.users)
          const { data: agentUser } = await supabaseAdmin.auth.admin.getUserById(userId);
          const agentEmail = agentUser?.user?.email;
          if (agentEmail) {
            // Utiliser l'API Gmail de l'agent pour s'envoyer une notification
            const { data: gmailToken } = await supabaseAdmin
              .from("gmail_tokens")
              .select("access_token, refresh_token, expires_at")
              .eq("user_id", userId)
              .maybeSingle();

            if (gmailToken) {
              const subject = `📎 ${nomProspect} a déposé un document sur son portail`;
              const body = `Bonjour,\n\n${nomProspect} vient de déposer le document suivant via le portail FixTime :\n\n• ${classification.label} (${file.name})\n• Déposé le : ${new Date(uploadedAt).toLocaleString("fr-FR")}\n\nConnectez-vous à FixTime pour valider le dossier.\n\nCordialement,\nFixTime`;

              const raw = Buffer.from(
                `To: ${agentEmail}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
              ).toString("base64url");

              // Vérifier validité token Gmail
              const now = Date.now();
              let accessToken = gmailToken.access_token;
              if (gmailToken.expires_at && new Date(gmailToken.expires_at).getTime() < now + 60_000) {
                // Token expiré → refresh
                const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
                    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
                    refresh_token: gmailToken.refresh_token ?? "",
                    grant_type: "refresh_token",
                  }),
                });
                if (refreshRes.ok) {
                  const refreshData = await refreshRes.json();
                  accessToken = refreshData.access_token;
                }
              }

              await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ raw }),
              }).catch((err) => console.error("[PORTAL UPLOAD] Gmail send error:", err));
            }
          }
        }
        // DRAFT mode : la note dans prospect_data.portal_docs_received suffit
        // (visible dans le dashboard via l'étape DOSSIER_RECU)
        console.log(`[PORTAL UPLOAD] Doc reçu — mode=${pipelineMode} prospect=${nomProspect} doc=${classification.label}`);
      } catch (notifErr) {
        console.error("[PORTAL UPLOAD] Notification error:", notifErr);
      }
    }

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
