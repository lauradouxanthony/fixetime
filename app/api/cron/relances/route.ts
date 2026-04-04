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

/** Rappels visite J-2 (48h avant) et J-1 (24h avant) */
const RAPPEL_MESSAGES = {
  j2: (nom: string, date: string, heure: string, bien: string, adresse: string) =>
    `Bonjour ${nom},\n\nNous vous rappelons votre visite du ${date} à ${heure} pour le ${bien}.\nAdresse : ${adresse}\n\nÀ bientôt !\n\nCordialement,\nL'équipe de l'agence`,

  j1: (nom: string, heure: string, bien: string, adresse: string) =>
    `Bonjour ${nom},\n\nVotre visite est demain à ${heure} pour ${bien} situé au ${adresse}.\nN'hésitez pas à nous contacter si besoin.\n\nCordialement,\nL'équipe de l'agence`,

  portail: (nom: string, portalUrl: string) =>
    `Bonjour ${nom},\n\nMerci pour votre visite ! Pour finaliser votre candidature, veuillez déposer votre dossier via ce lien sécurisé :\n${portalUrl}\n\nCe lien est valable 7 jours.\n\nCordialement,\nL'équipe de l'agence`,
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
  const isDev = process.env.NODE_ENV !== "production";
  const isAuthorized =
    auth === `Bearer ${CRON_KEY}` ||
    cronHeader === CRON_KEY ||
    (isDev && CRON_KEY === ""); // dev local uniquement, jamais en production

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
        .select("email_rules")
        .eq("user_id", userId)
        .maybeSingle();

      const rules = ((settingsRow as Record<string, unknown>)?.email_rules as Record<string, unknown>) ?? {};
      // pipeline_mode n'est pas une colonne dédiée — il est stocké dans email_rules.pipeline_mode
      const pipelineMode: string = (rules.pipeline_mode as string) ?? "DRAFT";
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
          .filter("prospect_data->>etape_process", "eq", etape);

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

  // === RAPPELS VISITE J-2 / J-1 + PORTAIL APRÈS VISITE ===
  try {
    const nowTs = Date.now();
    const j1End   = new Date(nowTs + 24 * 3600 * 1000).toISOString();   // dans 24h
    const j2Start = new Date(nowTs + 24 * 3600 * 1000).toISOString();   // dans 24h
    const j2End   = new Date(nowTs + 48 * 3600 * 1000).toISOString();   // dans 48h
    const pastStart = new Date(nowTs - 48 * 3600 * 1000).toISOString(); // passé depuis max 48h

    // Récupérer les users avec Gmail connecté (même liste que le cron principal)
    const { data: usersWithGmail } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id")
      .not("refresh_token", "is", null);

    for (const { user_id: userId } of (usersWithGmail ?? [])) {
      // pipeline_mode pour cet utilisateur
      const { data: sRow } = await supabaseAdmin
        .from("settings_v1")
        .select("email_rules")
        .eq("user_id", userId)
        .maybeSingle();
      const rules = ((sRow as Record<string, unknown>)?.email_rules as Record<string, unknown>) ?? {};
      const pMode: string = (rules.pipeline_mode as string) ?? "DRAFT";
      const nomAgence = ((rules.ft_locatif as Record<string, unknown>)?.nomAgence as string) ?? "l'agence";

      // ── 1. Rappels J-1 (visite dans 0-24h) ──────────────────────────────
      const { data: evtsJ1 } = await supabaseAdmin
        .from("calendar_events")
        .select("id, title, start_time, location, prospect_email, property_name")
        .eq("user_id", userId)
        .gt("start_time", new Date(nowTs).toISOString())
        .lt("start_time", j1End);

      for (const evt of (evtsJ1 ?? [])) {
        const e = evt as Record<string, unknown>;
        if (!e.prospect_email) continue;
        // Vérifier si rappel J-1 déjà envoyé via prospect_timeline
        const { count: alreadySent } = await supabaseAdmin
          .from("prospect_timeline")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("action_type", "RAPPEL_J1")
          .filter("metadata->calendar_event_id", "eq", `"${e.id}"`);
        if ((alreadySent ?? 0) > 0) continue;

        // Trouver l'email prospect correspondant
        const { data: matchEmail } = await supabaseAdmin
          .from("emails")
          .select("id, sender, subject, prospect_data")
          .eq("user_id", userId)
          .ilike("sender", `%${e.prospect_email}%`)
          .filter("prospect_data->>etape_process", "eq", "VISITE_CONFIRMEE")
          .maybeSingle();

        const pd = ((matchEmail as Record<string, unknown>)?.prospect_data as Record<string, unknown>) ?? {};
        const nom = (pd.nom as string) ?? "Madame, Monsieur";
        const startDt = new Date(e.start_time as string);
        const heure = startDt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        const adresse = (e.location as string) ?? (e.property_name as string) ?? "notre agence";
        const bien = (e.property_name as string) ?? (e.title as string) ?? "le bien";

        const body = RAPPEL_MESSAGES.j1(nom, heure, bien, adresse)
          .replace("L'équipe de l'agence", `L'équipe ${nomAgence}`);

        if (pMode === "AUTOPILOTE" && matchEmail) {
          await sendGmailReply({ userId, to: e.prospect_email as string, subject: `Rappel visite demain — ${bien}`, body });
          sent++;
        } else if (matchEmail) {
          await supabaseAdmin.from("emails").update({ ai_reply: body }).eq("id", (matchEmail as Record<string, unknown>).id);
          drafted++;
        }

        // Marquer comme envoyé dans la timeline
        try {
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: userId,
            email_id: (matchEmail as Record<string, unknown>)?.id ?? null,
            action_type: "RAPPEL_J1",
            description: `Rappel J-1 visite — ${bien} à ${heure}`,
            metadata: { calendar_event_id: e.id, mode: pMode },
          });
          processed++;
        } catch { /* silencieux */ }
      }

      // ── 2. Rappels J-2 (visite dans 24-48h) ─────────────────────────────
      const { data: evtsJ2 } = await supabaseAdmin
        .from("calendar_events")
        .select("id, title, start_time, location, prospect_email, property_name")
        .eq("user_id", userId)
        .gt("start_time", j2Start)
        .lt("start_time", j2End);

      for (const evt of (evtsJ2 ?? [])) {
        const e = evt as Record<string, unknown>;
        if (!e.prospect_email) continue;
        const { count: alreadySent } = await supabaseAdmin
          .from("prospect_timeline")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("action_type", "RAPPEL_J2")
          .filter("metadata->calendar_event_id", "eq", `"${e.id}"`);
        if ((alreadySent ?? 0) > 0) continue;

        const { data: matchEmail } = await supabaseAdmin
          .from("emails")
          .select("id, sender, subject, prospect_data")
          .eq("user_id", userId)
          .ilike("sender", `%${e.prospect_email}%`)
          .filter("prospect_data->>etape_process", "eq", "VISITE_CONFIRMEE")
          .maybeSingle();

        const pd = ((matchEmail as Record<string, unknown>)?.prospect_data as Record<string, unknown>) ?? {};
        const nom = (pd.nom as string) ?? "Madame, Monsieur";
        const startDt = new Date(e.start_time as string);
        const dateStr = startDt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        const heure = startDt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        const adresse = (e.location as string) ?? (e.property_name as string) ?? "notre agence";
        const bien = (e.property_name as string) ?? (e.title as string) ?? "le bien";

        const body = RAPPEL_MESSAGES.j2(nom, dateStr, heure, bien, adresse)
          .replace("L'équipe de l'agence", `L'équipe ${nomAgence}`);

        if (pMode === "AUTOPILOTE" && matchEmail) {
          await sendGmailReply({ userId, to: e.prospect_email as string, subject: `Rappel visite dans 2 jours — ${bien}`, body });
          sent++;
        } else if (matchEmail) {
          await supabaseAdmin.from("emails").update({ ai_reply: body }).eq("id", (matchEmail as Record<string, unknown>).id);
          drafted++;
        }

        try {
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: userId,
            email_id: (matchEmail as Record<string, unknown>)?.id ?? null,
            action_type: "RAPPEL_J2",
            description: `Rappel J-2 visite — ${bien} le ${dateStr} à ${heure}`,
            metadata: { calendar_event_id: e.id, mode: pMode },
          });
          processed++;
        } catch { /* silencieux */ }
      }

      // ── 3. Après visite → envoi portail documents ────────────────────────
      const { data: pastEvts } = await supabaseAdmin
        .from("calendar_events")
        .select("id, title, start_time, location, prospect_email, property_name")
        .eq("user_id", userId)
        .gt("start_time", pastStart)
        .lt("start_time", new Date(nowTs).toISOString());

      for (const evt of (pastEvts ?? [])) {
        const e = evt as Record<string, unknown>;
        if (!e.prospect_email) continue;
        // Vérifier si portail déjà envoyé
        const { count: alreadySent } = await supabaseAdmin
          .from("prospect_timeline")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("action_type", "PORTAIL_APRES_VISITE")
          .filter("metadata->calendar_event_id", "eq", `"${e.id}"`);
        if ((alreadySent ?? 0) > 0) continue;

        // Trouver email VISITE_CONFIRMEE correspondant
        const { data: matchEmail } = await supabaseAdmin
          .from("emails")
          .select("id, sender, subject, prospect_data")
          .eq("user_id", userId)
          .ilike("sender", `%${e.prospect_email}%`)
          .filter("prospect_data->>etape_process", "eq", "VISITE_CONFIRMEE")
          .maybeSingle();

        if (!matchEmail) continue;
        const eId = (matchEmail as Record<string, unknown>).id as string;
        const pd = ((matchEmail as Record<string, unknown>).prospect_data as Record<string, unknown>) ?? {};
        const nom = (pd.nom as string) ?? "Madame, Monsieur";

        // Créer ou récupérer le token portail
        const { data: existingToken } = await supabaseAdmin
          .from("document_portal_tokens")
          .select("token, expires_at")
          .eq("email_id", eId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        let portalToken: string;
        if (existingToken) {
          portalToken = (existingToken as Record<string, unknown>).token as string;
        } else {
          portalToken = crypto.randomUUID();
          await supabaseAdmin.from("document_portal_tokens").insert({
            token: portalToken,
            email_id: eId,
            user_id: userId,
            prospect_email: e.prospect_email,
            prospect_name: nom,
            expires_at: new Date(nowTs + 7 * 24 * 3600 * 1000).toISOString(),
          });
        }

        const portalUrl = `${SITE_URL}/portal/${portalToken}`;
        const body = RAPPEL_MESSAGES.portail(nom, portalUrl)
          .replace("L'équipe de l'agence", `L'équipe ${nomAgence}`);

        // Mettre à jour l'étape → DOSSIER_DEMANDE
        await supabaseAdmin.from("emails").update({
          ai_reply: body,
          prospect_data: { ...pd, etape_process: "DOSSIER_DEMANDE" },
        }).eq("id", eId);

        if (pMode === "AUTOPILOTE") {
          await sendGmailReply({ userId, to: e.prospect_email as string, subject: "Dépôt de votre dossier de location", body });
          sent++;
        } else {
          drafted++;
        }

        try {
          await supabaseAdmin.from("prospect_timeline").insert({
            user_id: userId,
            email_id: eId,
            action_type: "PORTAIL_APRES_VISITE",
            description: `Lien portail envoyé après visite — étape → DOSSIER_DEMANDE`,
            metadata: { calendar_event_id: e.id, portal_url: portalUrl, mode: pMode },
          });
          processed++;
        } catch { /* silencieux */ }

        console.log(`[CRON RELANCES] PORTAIL_APRES_VISITE email=${eId} portail=${portalUrl}`);
      }
    }
  } catch (err) {
    console.error("[CRON RELANCES] Erreur rappels visite:", err);
    errors.push(`rappels_visite:${(err as Error).message?.substring(0, 50)}`);
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
