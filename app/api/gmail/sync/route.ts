import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

// Approche simplifiée : stocker le lien Gmail direct (pas de Supabase Storage)
// L'utilisateur peut ouvrir la PJ depuis Gmail en un clic
function buildGmailLink(gmailMsgId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${gmailMsgId}`;
}

// ── Classifier par nom de fichier (synchrone, heuristique) ──────────────────
function classifyByFilename(filename: string): string {
  const f = filename.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (f.includes("paie") || f.includes("salaire") || f.includes("bulletin") || f.includes("fiche"))
    return "fiche_paie";
  if (f.includes("contrat") || f.includes("cdi") || f.includes("cdd") || f.includes("emploi"))
    return "contrat_travail";
  if (f.includes("impos") || f.includes("avis") || f.includes("impot") || f.includes("fiscal"))
    return "avis_imposition";
  if (f.includes("identit") || f.includes("cni") || f.includes("passeport") || f.includes("carte") || f.includes(" id"))
    return "piece_identite";
  if (f.includes("rib") || f.includes("bancaire") || f.includes("releve") || f.includes("compte"))
    return "rib";
  if (f.includes("etudiant") || f.includes("scolari") || f.includes("universite") || f.includes("ecole"))
    return "carte_etudiant";
  if (f.includes("kbis") || f.includes("siret") || f.includes("entreprise"))
    return "kbis";
  if (f.includes("garant") || f.includes("caution"))
    return "document_garant";
  if (f.includes("quittance") || f.includes("quitt"))
    return "quittance_loyer";
  return "autre";
}

// ── Vérifier si le nom de fichier est "générique" (pas de mots-clés clairs) ─
function isGenericFilename(filename: string): boolean {
  const f = filename.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Patterns génériques : img_001, scan001, document, fichier, photo, dsc_, dsc0, p1, p2…
  const genericPatterns = [
    /^img[_\-\s]?\d/,
    /^scan\d/,
    /^document\./,
    /^fichier\d/,
    /^photo[_\-\s]?\d/,
    /^dsc[_\-\s0-9]/,
    /^p\d+\./,
    /^\d{4,}/,        // commence par 4+ chiffres (ex: 20240315_...)
    /^capture/,
    /^image\d/,
    /^screenshot/,
    /^file\d/,
    /^attachment/,
    /^untitled/,
    /^new\s*doc/,
    /^doc\d/,
  ];
  const base = f.replace(/\.[^.]+$/, ""); // nom sans extension
  return genericPatterns.some(p => p.test(base)) || base.length <= 5;
}

// ── Classifier via Claude (async, pour noms de fichiers génériques) ──────────
async function classifyWithAI(params: {
  filename: string;
  size: number;
  subject: string;
  body: string;
}): Promise<{ type: string; confidence: number; reasoning: string }> {
  const { filename, size, subject, body } = params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[CLASSIFY-AI] ANTHROPIC_API_KEY manquant — fallback 'autre'");
    return { type: "autre", confidence: 0, reasoning: "API key absent" };
  }

  const prompt = `Tu es un assistant immobilier français.
Ce fichier s'appelle '${filename}' (${size} octets).
Il a été envoyé par un candidat à la location.
Objet de l'email : ${subject}
Corps de l'email : ${body.substring(0, 500)}

Déduis le type de document parmi :
fiche_paie | contrat_travail | avis_imposition | piece_identite | garant_fiche_paie | garant_contrat | rib | quittance_loyer | autre

Réponds UNIQUEMENT en JSON :
{"type": "...", "confidence": 0.0, "reasoning": "..."}`;

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
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.warn("[CLASSIFY-AI] Anthropic error:", errTxt.substring(0, 200));
      return { type: "autre", confidence: 0, reasoning: "API error" };
    }

    const json = await res.json();
    const content: string = json.content?.[0]?.text ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { type: "autre", confidence: 0, reasoning: "No JSON in response" };

    const parsed = JSON.parse(match[0]);
    const type = String(parsed.type ?? "autre");
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    const reasoning = String(parsed.reasoning ?? "");

    console.log(`[CLASSIFY-AI] '${filename}' → type=${type} confidence=${confidence.toFixed(2)}`);
    return { type, confidence, reasoning };
  } catch (e: any) {
    console.warn("[CLASSIFY-AI] Exception:", e?.message);
    return { type: "autre", confidence: 0, reasoning: "Classification failed" };
  }
}

// ── Orchestrateur : heuristique d'abord, IA si nom générique ────────────────
async function classifyDocument(params: {
  filename: string;
  size: number;
  subject: string;
  body: string;
}): Promise<{ docType: string; ai_confidence: number | null; ai_reasoning: string | null }> {
  const { filename } = params;
  const byFilename = classifyByFilename(filename);

  // Si le nom de fichier est clair → pas besoin d'IA
  if (byFilename !== "autre" || !isGenericFilename(filename)) {
    return {
      docType: byFilename,
      ai_confidence: byFilename !== "autre" ? 1.0 : null,
      ai_reasoning: byFilename !== "autre" ? "Détecté par nom de fichier" : null,
    };
  }

  // Nom générique → appeler Claude
  const aiResult = await classifyWithAI(params);
  const docType = aiResult.confidence >= 0.7 ? aiResult.type : "autre";

  return {
    docType,
    ai_confidence: aiResult.confidence,
    ai_reasoning: aiResult.reasoning,
  };
}

// Fonction helper : extraire les pièces jointes (récursif, version robuste)
// RÈGLE : on ne garde que les parts avec attachmentId (vraies PJ, pas les images inline)
function extractAttachments(payload: any): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
  const result: { filename: string; mimeType: string; attachmentId: string; size: number }[] = [];
  const seen = new Set<string>();

  const scan = (part: any) => {
    if (!part) return;
    // PJ réelle : doit avoir un attachmentId ET un nom de fichier non-vide
    if (part.body?.attachmentId && part.filename && part.filename.trim().length > 0) {
      const key = `${part.body.attachmentId}:${part.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          filename: part.filename.trim(),
          mimeType: part.mimeType ?? "application/octet-stream",
          attachmentId: part.body.attachmentId,
          size: part.body.size ?? 0,
        });
      }
    }
    // Scanner récursivement les sous-parties
    if (Array.isArray(part.parts)) {
      part.parts.forEach(scan);
    }
  };

  // Scanner le payload lui-même (cas extrême : payload = PJ directe)
  if (payload) {
    scan(payload);
    // Scanner aussi payload.parts directement (cas standard multipart)
    if (Array.isArray(payload.parts)) {
      payload.parts.forEach(scan);
    }
  }

  return result;
}

// BLOC 1 FIX : extraire le corps de l'email (base64url → utf-8)
// Priorité : text/plain > html (cherche récursivement dans payload.parts)
function getBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = getBody(part);
        if (nested) return nested;
      }
    }
    // fallback html si pas de text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
        return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
  }
  return "";
}

export async function POST(req: NextRequest) {
  const syncStart = Date.now();
  console.log("[GMAIL SYNC] ▶ Démarrée", new Date().toISOString());

  try {
    // ✅ 1) Récupérer user_id: soit cookie session, soit body JSON
    let userId: string | null = null;
    let quickMode = false; // mode rapide pour refresh manuel (INBOX 7j, 50 messages)

    // session cookie (stable pour le bouton dans l'app)
    try {
      const supabase = await supabaseServer();
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
    } catch {}

    // fallback body JSON (pour cron interne uniquement — nécessite FIXETIME_INTERNAL_CRON_KEY)
    let bodyJson: any = null;
    try {
      bodyJson = await req.json();
      if (bodyJson?.mode === "quick") quickMode = true;
      // Autoriser user_id depuis le body uniquement si la cron key est présente et valide
      if (bodyJson?.user_id && !userId) {
        const cronKey = process.env.FIXETIME_INTERNAL_CRON_KEY ?? "";
        const reqCronKey = req.headers.get("x-fixetime-cron-key") ?? "";
        if (cronKey && cronKey === reqCronKey) {
          userId = bodyJson.user_id;
        }
      }
    } catch {}

    if (!userId) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    console.log(`[GMAIL SYNC] user=${userId} mode=${quickMode ? "quick" : "full"}`);

    // ✅ 2) Token Google valide + retry si Gmail renvoie 401
    let accessToken = await getValidGoogleAccessToken(userId);

    // ── Paramètres selon le mode ──────────────────────────────────────────
    const MAX_MESSAGES = quickMode ? 200 : 500;
    const PAGE_SIZE = quickMode ? 100 : 100;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    const callList = (token: string, pageToken?: string) => {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("maxResults", String(PAGE_SIZE));
      url.searchParams.set("labelIds", "INBOX");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    };

    // ── Récupérer les gmail_message_id déjà en DB ──
    const { data: existingRows } = await supabaseAdmin
      .from("emails")
      .select("id, gmail_message_id, attachments")
      .eq("user_id", userId)
      .not("gmail_message_id", "is", null);

    const knownIds = new Set((existingRows || []).map((r: any) => r.gmail_message_id));
    const knownWithAttachments = new Set(
      (existingRows || [])
        .filter((r: any) => Array.isArray(r.attachments) && r.attachments.length > 0)
        .map((r: any) => r.gmail_message_id)
    );
    const gmailIdToDbId = new Map<string, string>(
      (existingRows || []).map((r: any) => [r.gmail_message_id, r.id])
    );
    console.log(`[GMAIL SYNC] ${knownIds.size} emails en DB, ${knownWithAttachments.size} avec PJ déjà traitées`);

    let pageToken: string | undefined = undefined;
    let fetched = 0;
    let inserted = 0;
    let skipped = 0;

    outer: while (true) {
      let listRes = await callList(accessToken, pageToken);

      if (!listRes.ok) {
        const txt = await listRes.text();
        console.error("[GMAIL SYNC] Gmail list error:", txt);
        return NextResponse.json({ error: "GMAIL_LIST_ERROR", details: txt }, { status: 400 });
      }

      const listJson = await listRes.json();
      const messages: { id: string }[] = listJson.messages ?? [];
      pageToken = listJson.nextPageToken;

      for (const msg of messages) {
        fetched++;

        // Skip si déjà en DB avec PJ traitées → évite l'appel inutile
        if (knownWithAttachments.has(msg.id)) {
          skipped++;
          if (fetched >= MAX_MESSAGES) break outer;
          continue;
        }

        // Email en DB sans PJ : re-traiter uniquement les attachments
        if (knownIds.has(msg.id)) {
          const dbId = gmailIdToDbId.get(msg.id);
          if (dbId) {
            try {
              const detailResAtt = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (detailResAtt.ok) {
                const detailAtt = await detailResAtt.json();
                const attsRaw = extractAttachments(detailAtt.payload);
                console.log(`[GMAIL SYNC][PJ] Re-scan msg=${msg.id} → ${attsRaw.length} PJ détectée(s)`);
                if (attsRaw.length > 0) {
                  const gmailLink = buildGmailLink(msg.id);
                  // Récupérer subject/body pour la classification IA
                  const reHeaders: { name: string; value: string }[] = detailAtt.payload?.headers || [];
                  const reSubject = reHeaders.find((h: any) => h.name === "Subject")?.value ?? "";
                  const reBody = getBody(detailAtt.payload);

                  const enriched = await Promise.all(attsRaw.map(async att => {
                    const classified = await classifyDocument({
                      filename: att.filename,
                      size: att.size,
                      subject: reSubject,
                      body: reBody,
                    });
                    return {
                      ...att,
                      gmailLink,
                      docType: classified.docType,
                      ai_confidence: classified.ai_confidence,
                      ai_reasoning: classified.ai_reasoning,
                      detected_at: new Date().toISOString(),
                      validated_by_human: false,
                      status: "EN_ATTENTE",
                    };
                  }));

                  await supabaseAdmin
                    .from("emails")
                    .update({ attachments: enriched })
                    .eq("id", dbId);
                  console.log(`[GMAIL SYNC][PJ] ✅ Re-scan mis à jour: ${enriched.length} PJ sur email ${dbId}`);
                }
              }
            } catch (e: any) {
              console.warn(`[GMAIL SYNC][PJ] Re-scan failed msg=${msg.id}:`, e?.message);
            }
          }
          skipped++;
          if (fetched >= MAX_MESSAGES) break outer;
          continue;
        }

        // BLOC 3 : format=full pour obtenir payload.parts (pièces jointes)
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!detailRes.ok) {
          if (fetched >= MAX_MESSAGES) break outer;
          continue;
        }

        const detail = await detailRes.json();
        const internalDate = detail.internalDate ? Number(detail.internalDate) : null;

        // Filtre 30j côté serveur
        if (internalDate && Date.now() - internalDate > THIRTY_DAYS) {
          if (fetched >= MAX_MESSAGES) break outer;
          continue;
        }

        const headers: { name: string; value: string }[] = detail.payload?.headers || [];
        const from = headers.find((h) => h.name === "From")?.value ?? "Inconnu";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(Sans objet)";
        const date = headers.find((h) => h.name === "Date")?.value;
        const receivedAt = date ? new Date(date).toISOString() : new Date().toISOString();

        const emailBody = getBody(detail.payload);

        // ── DIAGNOSTIC PJ ──────────────────────────────────────────────────
        const payloadMimeType = detail.payload?.mimeType ?? "unknown";
        const partsCount = (detail.payload?.parts ?? []).length;
        console.log(`[GMAIL SYNC][PJ] msg=${msg.id} mimeType=${payloadMimeType} parts=${partsCount}`);
        if (partsCount > 0) {
          const partsLog = (detail.payload.parts as any[]).map((p: any) => ({
            mime: p.mimeType, filename: p.filename || "", hasData: !!p.body?.data, hasAttId: !!p.body?.attachmentId,
          }));
          console.log(`[GMAIL SYNC][PJ] parts=`, JSON.stringify(partsLog));
        }

        // Extraire les pièces jointes (récursif, version robuste avec attachmentId requis)
        const attachments = extractAttachments(detail.payload);
        console.log(`[GMAIL SYNC][PJ] msg=${msg.id} → ${attachments.length} PJ réelle(s)${attachments.length > 0 ? ": " + attachments.map((a: any) => a.filename).join(", ") : " (aucune PJ avec attachmentId)"}`);

        // Enrichir avec classification IA pour noms génériques
        const gmailLink = buildGmailLink(msg.id);
        const enrichedAttachments = await Promise.all(attachments.map(async (att: any) => {
          const classified = await classifyDocument({
            filename: att.filename,
            size: att.size,
            subject,
            body: emailBody,
          });
          return {
            ...att,
            gmailLink,
            docType: classified.docType,
            ai_confidence: classified.ai_confidence,
            ai_reasoning: classified.ai_reasoning,
            detected_at: new Date().toISOString(),
            validated_by_human: false,
            status: "EN_ATTENTE",
          };
        }));

        const threadId: string | null = detail.threadId ?? null;

        console.log(`[GMAIL SYNC] msg=${msg.id} body_length=${emailBody.length} body_sample=${emailBody.substring(0, 100)}`);

        const { error } = await supabaseAdmin.from("emails").upsert(
          {
            user_id: userId,
            provider: "google",
            gmail_message_id: msg.id,
            gmail_thread_id: threadId,
            received_at: receivedAt,
            sender: from,
            subject,
            body: emailBody || null,
            is_archived: false,
            attachments: enrichedAttachments.length > 0 ? enrichedAttachments : [],
            thread_id: threadId,
          },
          {
            onConflict: "gmail_message_id",
            ignoreDuplicates: true,
          }
        );

        if (!error) {
          inserted++;
          knownIds.add(msg.id);
        }

        if (fetched >= MAX_MESSAGES) break outer;
      }

      if (!pageToken) break;
    }

    const durationMs = Date.now() - syncStart;
    console.log(
      `[GMAIL SYNC] ✅ Terminée en ${durationMs}ms — parcourus=${fetched} nouveaux=${inserted} déjà_connus=${skipped}`
    );

    return NextResponse.json({
      success: true,
      fetched,
      inserted,
      skipped,
      durationMs,
    });
  } catch (error: any) {
    console.error("[GMAIL SYNC] FULL ERROR:", error);
    return NextResponse.json(
      {
        error: "GMAIL_SYNC_FAILED",
        message: error?.message ?? null,
      },
      { status: 500 }
    );
  }
}
