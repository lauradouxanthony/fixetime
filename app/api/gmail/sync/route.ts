import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";

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

    // fallback body JSON (pour tests curl / cron)
    let bodyJson: any = null;
    try {
      bodyJson = await req.json();
      if (bodyJson?.user_id) userId = bodyJson.user_id;
      if (bodyJson?.mode === "quick") quickMode = true;
    } catch {}

    if (!userId) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    console.log(`[GMAIL SYNC] user=${userId} mode=${quickMode ? "quick" : "full"}`);

    // ✅ 2) Token Google valide + retry si Gmail renvoie 401
    let accessToken = await getValidGoogleAccessToken(userId);

    // ── Paramètres selon le mode ──────────────────────────────────────────
    // QUICK (manuel) : 50 messages INBOX uniquement → ~50 appels API → rapide
    // FULL  (cron)   : 200 messages INBOX 30j        → ~200 appels API → complet
    const MAX_MESSAGES = quickMode ? 50 : 200;
    const PAGE_SIZE = quickMode ? 50 : 100;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    const callList = (token: string, pageToken?: string) => {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("maxResults", String(PAGE_SIZE));
      url.searchParams.set("labelIds", "INBOX"); // ✅ INBOX seulement (pas sent/drafts/spam)
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    };

    // Approche simplifiée : stocker le lien Gmail direct (pas de Supabase Storage)
    // L'utilisateur peut ouvrir la PJ depuis Gmail en un clic
    function buildGmailLink(gmailMsgId: string): string {
      return `https://mail.google.com/mail/u/0/#inbox/${gmailMsgId}`;
    }

    // Auto-détection du type de document selon le nom du fichier
    function autoCheckDoc(filename: string): Record<string, boolean> {
      const name = filename.toLowerCase();
      const docs: Record<string, boolean> = {};
      if (name.includes("paie") || name.includes("salaire") || name.includes("bulletin"))
        docs.fiches_paie = true;
      if (name.includes("contrat") || name.includes("cdi") || name.includes("cdd") || name.includes("travail"))
        docs.contrat_travail = true;
      if (name.includes("impos") || name.includes("avis") || name.includes("impot") || name.includes("fiscal"))
        docs.avis_imposition = true;
      if (name.includes("identit") || name.includes("cni") || name.includes("passeport") || name.includes("carte"))
        docs.piece_identite = true;
      if (name.includes("etudiant") || name.includes("scolarit") || name.includes("universite") || name.includes("carte_etud"))
        docs.carte_etudiant = true;
      if (name.includes("kbis") || name.includes("siren") || name.includes("extrait"))
        docs.kbis = true;
      if (name.includes("bilan") || name.includes("comptable"))
        docs.bilan = true;
      return docs;
    }

    // ── Récupérer les gmail_message_id déjà en DB ──
    // On charge aussi le champ `attachments` pour distinguer :
    //   - emails déjà traités avec PJ → skip complet
    //   - emails en DB sans PJ → on re-traite les attachments uniquement
    const { data: existingRows } = await supabaseAdmin
      .from("emails")
      .select("id, gmail_message_id, attachments")
      .eq("user_id", userId)
      .not("gmail_message_id", "is", null);

    // Tous les IDs connus
    // Fonction helper : extraire les pièces jointes (récursif)
    // Accepte aussi les payloads sans parts (fichier direct en pièce jointe)
    function extractAttachments(payload: any): { filename: string; mimeType: string; attachmentId: string | null; size: number }[] {
      const result: { filename: string; mimeType: string; attachmentId: string | null; size: number }[] = [];
      const scan = (part: any) => {
        if (part?.filename && part.filename.length > 0) {
          result.push({
            filename: part.filename,
            mimeType: part.mimeType ?? "application/octet-stream",
            attachmentId: part.body?.attachmentId ?? null,
            size: part.body?.size ?? 0,
          });
        }
        if (part?.parts) {
          part.parts.forEach(scan);
        }
      };
      if (payload?.parts) {
        payload.parts.forEach(scan);
      } else if (payload) {
        scan(payload);
      }
      return result;
    }

    const knownIds = new Set((existingRows || []).map((r: any) => r.gmail_message_id));
    // IDs avec PJ déjà traitées (array non vide)
    const knownWithAttachments = new Set(
      (existingRows || [])
        .filter((r: any) => Array.isArray(r.attachments) && r.attachments.length > 0)
        .map((r: any) => r.gmail_message_id)
    );
    // Map gmail_message_id → DB uuid (pour UPDATE ciblé)
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

      // retry 1 fois si 401
      if (listRes.status === 401) {
        accessToken = await getValidGoogleAccessToken(userId);
        listRes = await callList(accessToken, pageToken);
      }

      if (!listRes.ok) {
        const txt = await listRes.text();
        console.error("[GMAIL SYNC] Gmail list error:", txt);
        return NextResponse.json({ error: "GMAIL_LIST_ERROR", details: txt }, { status: 400 });
      }

      const listJson = await listRes.json();
      const messages: { id: string }[] = listJson.messages ?? [];
      pageToken = listJson.nextPageToken;

      if (!messages.length) break;

      for (const msg of messages) {
        fetched++;

        // Skip si déjà en DB avec PJ traitées → évite l'appel inutile
        if (knownWithAttachments.has(msg.id)) {
          skipped++;
          if (fetched >= MAX_MESSAGES) break outer;
          continue;
        }

        // Email en DB sans PJ : re-traiter uniquement les attachments (lien Gmail direct)
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
                  const enriched = attsRaw.map(att => ({
                    ...att,
                    gmailLink,
                    docTypes: autoCheckDoc(att.filename),
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
        // + headers From/Subject/Date dans payload.headers
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!detailRes.ok) {
          if (fetched >= MAX_MESSAGES) break outer;
          continue;
        }

        const detail = await detailRes.json();
        const internalDate = Number(detail.internalDate ?? 0);

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
        const emailBody = getBody(detail.payload);

        // Extraire les pièces jointes (récursif, depuis le payload complet)
        const attachments = extractAttachments(detail.payload);
        console.log(`[GMAIL SYNC][PJ] msg=${msg.id} → ${attachments.length} PJ détectée(s)${attachments.length > 0 ? ": " + attachments.map((a: any) => a.filename).join(", ") : ""}`);

        // Approche simplifiée : lien Gmail direct + auto-détection du type de document
        const gmailLink = buildGmailLink(msg.id);
        const enrichedAttachments = attachments.map((att: any) => ({
          ...att,
          gmailLink,
          docTypes: autoCheckDoc(att.filename),
        }));

        // PROBLÈME 1 : thread_id pour la détection des fils de conversation
        const threadId: string | null = detail.threadId ?? null;

        // ✅ FIX BUG 1 : is_archived:false explicite + ignoreDuplicates
        // → les nouveaux emails ont is_archived=false (visible dans fetchEmails)
        // → on n'écrase pas les emails déjà archivés manuellement
        console.log(`[GMAIL SYNC] msg=${msg.id} body_length=${emailBody.length} body_sample=${emailBody.substring(0, 100)}`);

        const { error } = await supabaseAdmin.from("emails").upsert(
          {
            user_id: userId,
            gmail_message_id: msg.id,
            sender: from,
            subject,
            body: emailBody || null,
            received_at: receivedAt,
            is_archived: false,  // ← CRITIQUE : évite is_archived=NULL
            attachments: enrichedAttachments.length > 0 ? enrichedAttachments : [],
            thread_id: threadId,
          },
          {
            onConflict: "gmail_message_id",
            ignoreDuplicates: true, // ← Ne pas écraser les emails existants (archivage préservé)
          }
        );

        if (!error) {
          inserted++;
          knownIds.add(msg.id); // éviter doublons dans la même exécution
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
