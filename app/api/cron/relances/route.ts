import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

export const runtime = "nodejs";
export const maxDuration = 120;

const CRON_KEY = process.env.FIXETIME_INTERNAL_CRON_KEY ?? "";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

/** Délais de relance par étape (en millisecondes) */
const RELANCE_DELAYS_MS: Record<string, number> = {
  QUALIFICATION:   48 * 3600 * 1000,  // 48h
  VISITE_PROPOSEE: 24 * 3600 * 1000,  // 24h
  DOSSIER_DEMANDE: 72 * 3600 * 1000,  // 72h
};

/** Messages de relance par étape */
const RELANCE_MESSAGES: Record<string, (nom: string) => string> = {
  QUALIFICATION: (nom) =>
    `Bonjour ${nom},\n\nAvez-vous eu le temps de rassembler vos informations ? Je reste disponible pour répondre à vos questions.\n\nCordialement,\nL'équipe de l'agence`,

  VISITE_PROPOSEE: (nom) =>
    `Bonjour ${nom},\n\nJe voulais m'assurer que vous avez bien reçu ma proposition de créneau de visite. Confirmez-vous votre disponibilité ?\n\nCordialement,\nL'équipe de l'agence`,

  DOSSIER_DEMANDE: (nom: string, portalUrl?: string) =>
    `Bonjour ${nom},\n\nVoici de nouveau votre lien sécurisé pour déposer vos documents :\n${portalUrl ?? "[lien non disponible]"}\n\nCe lien est valable 7 jours.\n\nCordialement,\nL'équipe de l'agence`,
};

/** Envoie un email via Gmail API */
async function sendGmailReply(params: {
  userId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  try {
    const accessToken = await getValidGoogleAccessToken(params.userId);
    const subjectEncoded = `=?UTF-8?B?${Buffer.from(`Re: ${params.subject}`, "utf-8").toString("base64")}?=`;
    const mime = [
      `MIME-Version: 1.0`,
      `To: ${params.to}`,
      `Subject: ${subjectEncoded}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(params.body, "utf-8").toString("base64"),
    ].join("\r\n");
    const raw = Buffer.from(mime, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Vérification clé CRON (accept Bearer token ou header dédié)
  const auth = req.headers.get("authorization");
  const cronHeader = req.headers.get("x-fixetime-cron-key");
  const isAuthorized =
    auth === `Bearer ${CRON_KEY}` ||
    cronHeader === CRON_KEY ||
    CRON_KEY === ""; // dev sans clé

  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let processed = 0;
  let sent = 0;
  let drafted = 0;
  const errors: string[] = [];

  try {
    // Récupérer tous les users avec Gmail connecté
    const { data: users } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id")
      .not("refresh_token", "is", null);

    if (!users || users.length === 0) {
      return NextResponse.json({ processed: 0, sent: 0, drafted: 0 });
    }

    const now = Date.now();

    for (const { user_id: userId } of users) {
      // Charger le pipeline_mode de l'utilisateur
      const { data: settingsRow } = await supabaseAdmin
        .from("settings_v1")
        .select("email_rules, pipeline_mode")
        .eq("user_id", userId)
        .maybeSingle();

      const pipelineMode: string = (settingsRow as Record<string, unknown>)?.pipeline_mode as string ?? "DRAFT";
      const rules = ((settingsRow as Record<string, unknown>)?.email_rules as Record<string, unknown>) ?? {};
      const nomAgence = ((rules.ft_locatif as Record<string, unknown>)?.nomAgence as string) ?? "l'agence";

      for (const [etape, delayMs] of Object.entries(RELANCE_DELAYS_MS)) {
        const cutoff = new Date(now - delayMs).toISOString();

        // Prospects dans cette étape, non archivés, reçus avant le délai, < 3 relances
        const { data: staleLeads } = await supabaseAdmin
          .from("emails")
          .select("id, user_id, sender, subject, prospect_data, relance_count, last_relance_at, property_id")
          .eq("user_id", userId)
          .eq("category", "LOCATION")
          .eq("is_archived", false)
          .lt("received_at", cutoff)
          .lt("relance_count", 3)
          .filter("prospect_data->etape_process", "eq", etape);

        if (!staleLeads || staleLeads.length === 0) continue;

        for (const lead of staleLeads) {
          const leadAny = lead as Record<string, unknown>;
          const lastRelance = leadAny.last_relance_at as string | null;

          // Vérifier que la dernière relance date de plus du délai
          if (lastRelance && Date.now() - new Date(lastRelance).getTime() < delayMs) continue;

          processed++;

          const pd = (leadAny.prospect_data as Record<string, unknown>) ?? {};
          const nom = (pd.nom as string) ?? "Madame, Monsieur";
          const relanceCount = ((leadAny.relance_count as number) ?? 0) + 1;
          const sender = (leadAny.sender as string) ?? "";
          const subject = (leadAny.subject as string) ?? "";

          // Récupérer le lien portail pour DOSSIER_DEMANDE
          let portalUrl: string | undefined;
          if (etape === "DOSSIER_DEMANDE") {
            const { data: tokenRow } = await supabaseAdmin
              .from("document_portal_tokens")
              .select("token, expires_at")
              .eq("email_id", lead.id)
              .gt("expires_at", new Date().toISOString())
              .maybeSingle();

            if (tokenRow) {
              portalUrl = `${SITE_URL}/portal/${(tokenRow as Record<string, unknown>).token}`;
            } else {
              // Créer un nouveau token portail si absent
              const newToken = crypto.randomUUID();
              const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
              await supabaseAdmin.from("document_portal_tokens").insert({
                token: newToken,
                email_id: lead.id,
                user_id: userId,
                expires_at: expiresAt,
              });
              portalUrl = `${SITE_URL}/portal/${newToken}`;
            }
          }

          // Construire le message de relance
          const msgFn = RELANCE_MESSAGES[etape];
          if (!msgFn) continue;
          const relanceBody = etape === "DOSSIER_DEMANDE"
            ? (RELANCE_MESSAGES.DOSSIER_DEMANDE as (n: string, u?: string) => string)(nom, portalUrl)
            : msgFn(nom);

          // Remplacer nom agence dans signature
          const finalBody = relanceBody.replace("L'équipe de l'agence", `L'équipe ${nomAgence}`);

          // Mise à jour DB (compteur + last_relance_at)
          const updateData: Record<string, unknown> = {
            relance_count: relanceCount,
            last_relance_at: new Date().toISOString(),
          };
          // Archiver après 3 relances
          if (relanceCount >= 3) {
            updateData.is_archived = true;
            updateData.classification_reason = "Archivé automatiquement — 3 relances sans réponse";
          }
          await supabaseAdmin.from("emails").update(updateData).eq("id", lead.id);

          if (pipelineMode === "AUTOPILOTE") {
            // Envoi direct
            const ok = await sendGmailReply({ userId, to: sender, subject, body: finalBody });
            if (ok) {
              sent++;
              // Sauvegarder le texte envoyé
              await supabaseAdmin.from("emails").update({ ai_reply: finalBody }).eq("id", lead.id);
            } else {
              errors.push(`send:${lead.id}:gmail_error`);
            }
          } else {
            // DRAFT — sauvegarder comme brouillon uniquement
            await supabaseAdmin.from("emails").update({ ai_reply: finalBody }).eq("id", lead.id);
            drafted++;
          }

          // Log timeline
          try {
            await supabaseAdmin.from("prospect_timeline").insert({
              user_id: userId,
              email_id: lead.id,
              action_type: "RELANCE",
              description: `Relance ${relanceCount}/3 — étape : ${etape} — mode : ${pipelineMode}`,
              metadata: {
                etape,
                relance_count: relanceCount,
                mode: pipelineMode,
                message_label: RELANCE_MESSAGES[etape]
                  ? `Template ${etape}`
                  : "Template inconnu",
                sent: pipelineMode === "AUTOPILOTE",
              },
            });
          } catch { /* silencieux si table absente */ }

          console.log(`[CRON RELANCES] lead=${lead.id} etape=${etape} relance=${relanceCount}/3 mode=${pipelineMode}`);
        }
      }
    }
  } catch (err) {
    console.error("[CRON RELANCES] Erreur globale:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }

  return NextResponse.json({ processed, sent, drafted, errors: errors.length > 0 ? errors : undefined });
}

/**
 * GET /api/cron/relances
 * Vercel Cron envoie des GET avec Authorization: Bearer CRON_SECRET.
 * On délègue vers le POST handler après vérification de la clé.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronHeader = req.headers.get("x-fixetime-cron-key");
  const isAuthorized =
    auth === `Bearer ${CRON_KEY}` ||
    cronHeader === CRON_KEY ||
    CRON_KEY === "";
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Crée une requête POST synthétique et délègue
  const postReq = new NextRequest(req.url, { method: "POST", headers: req.headers });
  return POST(postReq);
}
