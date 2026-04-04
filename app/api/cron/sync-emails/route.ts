import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { graphFetch } from "@/lib/microsoft/graph";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL!;
const CRON_KEY = process.env.FIXETIME_INTERNAL_CRON_KEY ?? "";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** Délais de relance par étape (en heures) */
const RELANCE_DELAYS: Record<string, number> = {
  QUALIFICATION:  3 * 24,  // 3 jours sans réponse
  VISITE_PROPOSEE: 2 * 24, // 2 jours sans réponse
  DOSSIER_DEMANDE: 5 * 24, // 5 jours sans réponse
};

/** Messages de relance par étape */
const RELANCE_MESSAGES: Record<string, string> = {
  QUALIFICATION:   "Avez-vous pu rassembler les informations demandées ? Nous sommes disponibles pour répondre à vos questions.",
  VISITE_PROPOSEE: "Avez-vous pu consulter nos créneaux de visite ? N'hésitez pas à nous faire part de vos disponibilités.",
  DOSSIER_DEMANDE: "Avez-vous pu préparer votre dossier ? Nous restons disponibles pour toute question.",
};

/**
 * GET /api/cron/sync-emails
 * Appelé par Vercel Cron toutes les 5 minutes.
 */
export async function GET(req: Request) {
  const cronStart = Date.now();

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn("[CRON SYNC] Unauthorized request");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: users, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("user_id")
    .not("refresh_token", "is", null);

  if (error) {
    console.error("[CRON SYNC] Erreur lecture gmail_tokens:", error);
    return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ success: true, synced: 0, analyzed: 0 });
  }

  console.log(`[CRON SYNC] ${users.length} users à synchroniser`);

  let synced = 0;
  let analyzed = 0;
  let relances = 0;
  const errors: string[] = [];

  for (const row of users) {
    const userId = row.user_id;

    // ── 1) Gmail sync ─────────────────────────────────────────────────────
    try {
      const syncRes = await fetch(`${BASE_URL}/api/gmail/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fixetime-cron-key": CRON_KEY,
        },
        body: JSON.stringify({ user_id: userId, mode: "quick" }),
      });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        synced++;
        console.log(`[CRON SYNC] user=${userId} sync OK — nouveaux=${syncData.inserted ?? 0}`);
      } else {
        errors.push(`sync:${userId}:${syncRes.status}`);
      }
    } catch (e: any) {
      errors.push(`sync:${userId}:exception`);
    }

    // ── 2) Analyse IA ─────────────────────────────────────────────────────
    try {
      const analyzeRes = await fetch(`${BASE_URL}/api/ai/analyze-inbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fixetime-cron-key": CRON_KEY,
        },
        body: JSON.stringify({ user_id: userId, period: "7d" }),
      });
      if (analyzeRes.ok) {
        const analyzeData = await analyzeRes.json();
        analyzed++;
        console.log(`[CRON SYNC] user=${userId} analyze OK — analysés=${analyzeData.analyzed ?? 0}`);
      } else {
        errors.push(`analyze:${userId}:${analyzeRes.status}`);
      }
    } catch (e: any) {
      errors.push(`analyze:${userId}:exception`);
    }

    // ── 3) Relances automatiques ─────────────────────────────────────────
    try {
      const userRelances = await processRelances(userId);
      relances += userRelances;
    } catch (e: any) {
      console.warn(`[CRON RELANCES] user=${userId} erreur:`, e?.message);
      errors.push(`relance:${userId}:exception`);
    }
  }

  // ── Microsoft / Outlook sync ────────────────────────────────────────────
  const { data: msUsers } = await supabaseAdmin
    .from("microsoft_tokens")
    .select("user_id")
    .not("refresh_token", "is", null);

  let msSynced = 0;
  for (const msRow of msUsers ?? []) {
    try {
      const inserted = await syncMicrosoftInbox(msRow.user_id);
      msSynced++;
      console.log(`[CRON SYNC][MS] user=${msRow.user_id} OK — nouveaux=${inserted}`);

      // Analyse IA pour les emails Microsoft nouvellement insérés
      try {
        const analyzeRes = await fetch(`${BASE_URL}/api/ai/analyze-inbox`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-fixetime-cron-key": CRON_KEY,
          },
          body: JSON.stringify({ user_id: msRow.user_id, period: "7d" }),
        });
        if (!analyzeRes.ok) {
          errors.push(`analyze-ms:${msRow.user_id}:${analyzeRes.status}`);
        }
      } catch {
        errors.push(`analyze-ms:${msRow.user_id}:exception`);
      }
    } catch (e: any) {
      console.warn(`[CRON SYNC][MS] user=${msRow.user_id} erreur:`, e?.message);
      errors.push(`ms-sync:${msRow.user_id}:${e?.message ?? "exception"}`);
    }
  }

  const durationMs = Date.now() - cronStart;
  console.log(`[CRON SYNC] ✅ Terminé en ${durationMs}ms — gmail=${synced} ms=${msSynced} analyzed=${analyzed} relances=${relances} errors=${errors.length}`);

  return NextResponse.json({
    success: true,
    gmail_users: users.length,
    ms_users: (msUsers ?? []).length,
    synced,
    ms_synced: msSynced,
    analyzed,
    relances,
    errors: errors.length > 0 ? errors : undefined,
    durationMs,
  });
}

/**
 * Sync Microsoft/Outlook INBOX via Graph API — même logique que Gmail sync.
 * Fetche les 200 derniers messages de l'INBOX des 30 derniers jours,
 * insère les nouveaux dans la table `emails`.
 */
async function syncMicrosoftInbox(userId: string): Promise<number> {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  // Récupérer les message IDs déjà connus pour cet user (provider=microsoft)
  const { data: existingRows } = await supabaseAdmin
    .from("emails")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .not("gmail_message_id", "is", null);
  const knownIds = new Set((existingRows ?? []).map((r: any) => r.gmail_message_id));

  // Appel Microsoft Graph — INBOX, 30 derniers jours, triés par date desc, max 200
  const url =
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
    `?$top=200` +
    `&$orderby=receivedDateTime desc` +
    `&$filter=receivedDateTime ge ${since}` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview,body,isRead`;

  const res = await graphFetch(userId, url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GRAPH_LIST_ERROR ${res.status}: ${txt.slice(0, 200)}`);
  }

  const json = await res.json();
  const messages: any[] = json.value ?? [];

  let inserted = 0;
  for (const msg of messages) {
    const msgId: string = msg.id;
    if (knownIds.has(msgId)) continue;

    const sender = msg.from?.emailAddress
      ? `${msg.from.emailAddress.name ?? ""} <${msg.from.emailAddress.address}>`.trim()
      : "Inconnu";
    const subject = msg.subject ?? "(Sans objet)";
    const receivedAt = msg.receivedDateTime ?? new Date().toISOString();
    // Préférer le corps HTML → text/plain (bodyPreview en fallback)
    const body: string =
      msg.body?.contentType === "text"
        ? (msg.body.content ?? msg.bodyPreview ?? "")
        : (msg.bodyPreview ?? "");

    const { error } = await supabaseAdmin.from("emails").upsert(
      {
        user_id: userId,
        provider: "microsoft",
        gmail_message_id: msgId, // réutilise la colonne pour stocker l'ID Graph
        received_at: receivedAt,
        sender,
        subject,
        body: body || null,
        is_archived: false,
        attachments: [],
      },
      { onConflict: "gmail_message_id", ignoreDuplicates: true }
    );

    if (!error) {
      inserted++;
      knownIds.add(msgId);
    }
  }

  return inserted;
}

/** Envoie les relances automatiques pour un user */
async function processRelances(userId: string): Promise<number> {
  const { data: settings } = await supabaseAdmin
    .from("settings_v1")
    .select("email_rules")
    .eq("user_id", userId)
    .maybeSingle();

  const rules = (settings?.email_rules as Record<string, unknown>) ?? {};
  const pipelineMode = (rules.pipeline_mode as string) ?? "DRAFT";
  const nomAgence = ((rules.ft_locatif as Record<string, unknown>)?.nomAgence as string) ?? "l'agence";

  // Relances auto uniquement en AUTOPILOTE — en DRAFT, on log seulement
  if (pipelineMode !== "AUTOPILOTE") {
    console.log(`[CRON RELANCES] user=${userId} mode=DRAFT — relances non envoyées`);
    return 0;
  }

  const now = new Date();
  let count = 0;

  for (const [etape, delaiH] of Object.entries(RELANCE_DELAYS)) {
    const cutoff = new Date(now.getTime() - delaiH * 3600 * 1000);

    // Prospects dans cette étape, non archivés, sans réponse récente, max 2 relances
    const { data: staleLeads } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, prospect_data, gmail_message_id, relance_count, last_relance_at")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .eq("is_archived", false)
      .lt("received_at", cutoff.toISOString())
      .lt("relance_count", 2) // max 2 relances
      .filter("prospect_data->etape_process", "eq", etape);

    if (!staleLeads || staleLeads.length === 0) continue;

    for (const lead of staleLeads) {
      // Vérifier que la dernière relance date de plus du délai
      const lastRelance = (lead as any).last_relance_at;
      if (lastRelance && new Date(lastRelance).getTime() > cutoff.getTime()) continue;

      const nom = ((lead as any).prospect_data as any)?.nom ?? "Madame, Monsieur";
      const message = RELANCE_MESSAGES[etape];
      const relanceCount = ((lead as any).relance_count ?? 0) + 1;

      const prompt = `Tu es l'assistant de l'agence ${nomAgence}. Rédige une relance courte et professionnelle pour ${nom}.
- Message principal : ${message}
- Restez cordial et non pressant
- Si pas de réponse après cette relance → indiquer qu'on classe le dossier
- Signature : Cordialement, L'équipe ${nomAgence}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });
      const relanceText = completion.choices[0]?.message?.content ?? null;
      if (!relanceText) continue;

      // Envoyer la relance
      try {
        const accessToken = await getValidGoogleAccessToken(userId);
        const subjectEncoded = `=?UTF-8?B?${Buffer.from(`Re: ${(lead as any).subject ?? ""}`, "utf-8").toString("base64")}?=`;
        const mime = [
          `MIME-Version: 1.0`,
          `To: ${(lead as any).sender ?? ""}`,
          `Subject: ${subjectEncoded}`,
          `Content-Type: text/plain; charset=UTF-8`,
          `Content-Transfer-Encoding: base64`,
          ``,
          Buffer.from(relanceText, "utf-8").toString("base64"),
        ].join("\r\n");
        const raw = Buffer.from(mime, "utf-8")
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });

        // Mettre à jour le compteur et archiver si 2e relance sans réponse
        const updateData: Record<string, unknown> = {
          relance_count: relanceCount,
          last_relance_at: now.toISOString(),
          ai_reply: relanceText,
        };

        if (relanceCount >= 2) {
          updateData.is_archived = true;
          updateData.classification_reason = "Archivé automatiquement — 2 relances sans réponse";
        }

        await supabaseAdmin.from("emails").update(updateData).eq("id", lead.id);

        // Log in prospect_timeline (BLOC 3)
        try {
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: userId,
            email_id: lead.id,
            action_type: "RELANCE",
            description: `Relance ${relanceCount}/2 envoyée — étape : ${etape}`,
            metadata: { etape, relance_count: relanceCount, message: relanceText?.substring(0, 200) },
          });
        } catch {} // silently ignore if table doesn't exist yet

        count++;
        console.log(`[CRON RELANCES] Relance ${relanceCount}/2 envoyée — lead=${lead.id} etape=${etape}`);
      } catch (sendErr) {
        console.error(`[CRON RELANCES] Envoi échoué lead=${lead.id}:`, sendErr);
      }
    }
  }

  return count;
}
