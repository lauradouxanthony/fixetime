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

    // ── Récupérer les gmail_message_id déjà en DB pour éviter les appels inutiles ──
    const { data: existingRows } = await supabaseAdmin
      .from("emails")
      .select("gmail_message_id")
      .eq("user_id", userId)
      .not("gmail_message_id", "is", null);

    const knownIds = new Set((existingRows || []).map((r: any) => r.gmail_message_id));
    console.log(`[GMAIL SYNC] ${knownIds.size} emails déjà en DB`);

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

        // ✅ Skip si déjà en DB — évite l'appel metadata inutile
        if (knownIds.has(msg.id)) {
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

        // BLOC 3 : extraire les pièces jointes depuis payload.parts (récursif)
        function extractAttachments(parts: any[]): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
          const result: { filename: string; mimeType: string; attachmentId: string; size: number }[] = [];
          for (const part of parts ?? []) {
            if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
              result.push({
                filename: part.filename,
                mimeType: part.mimeType ?? "application/octet-stream",
                attachmentId: part.body.attachmentId,
                size: part.body.size ?? 0,
              });
            }
            if (part.parts) {
              result.push(...extractAttachments(part.parts));
            }
          }
          return result;
        }
        const attachments = extractAttachments(detail.payload?.parts ?? []);

        // PROBLÈME 1 : thread_id pour la détection des fils de conversation
        const threadId: string | null = detail.threadId ?? null;

        // ✅ FIX BUG 1 : is_archived:false explicite + ignoreDuplicates
        // → les nouveaux emails ont is_archived=false (visible dans fetchEmails)
        // → on n'écrase pas les emails déjà archivés manuellement
        const { error } = await supabaseAdmin.from("emails").upsert(
          {
            user_id: userId,
            gmail_message_id: msg.id,
            sender: from,
            subject,
            received_at: receivedAt,
            is_archived: false,  // ← CRITIQUE : évite is_archived=NULL
            attachments: attachments.length > 0 ? attachments : [],
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
