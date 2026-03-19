import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/* ── Ordre des étapes (pour avancement uniquement) ── */
const ETAPE_ORDER = [
  "NEW", "QUALIFICATION", "VISITE_PROPOSEE", "VISITE_CONFIRMEE",
  "DOSSIER_DEMANDE", "DOSSIER_RECU", "VALIDE", "REFUSE",
];
function etapeRank(e: string) {
  return ETAPE_ORDER.indexOf(e);
}

/* ─────────────────────────────────────────────────────── */
/*  GET /api/prospects/[id]                                */
/*  → { prospect, property, emails, documents, timeline }  */
/* ─────────────────────────────────────────────────────── */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { id } = await params;

    /* 1. Prospect */
    const { data: prospect, error: pErr } = await supabaseAdmin
      .from("prospects")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (pErr || !prospect) {
      return NextResponse.json({ error: "PROSPECT_NOT_FOUND" }, { status: 404 });
    }

    /* 2. Property */
    let property: Record<string, unknown> | null = null;
    if (prospect.property_id) {
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select("id, title, address, rent, required_docs, description")
        .eq("id", prospect.property_id)
        .maybeSingle();
      property = prop ?? null;
    }

    /* 3. Emails liés (ordre chrono ASC) */
    const { data: emails } = await supabaseAdmin
      .from("emails")
      .select("id, subject, sender, body, ai_reply, received_at, category, attachments, thread_id")
      .eq("prospect_id", id)
      .eq("user_id", user.id)
      .order("received_at", { ascending: true });

    /* 4. Documents = tous les attachments de tous les emails */
    const allAttachments: { emailId: string; subject: string; receivedAt: string | null; filename: string; docType?: string; status?: string; url?: string }[] = [];
    for (const em of (emails ?? [])) {
      const atts = Array.isArray((em as any).attachments) ? (em as any).attachments : [];
      for (const att of atts) {
        if (att?.filename) {
          allAttachments.push({
            emailId: em.id,
            subject: em.subject ?? "",
            receivedAt: em.received_at ?? null,
            filename: att.filename,
            docType: att.docType ?? undefined,
            status: att.status ?? undefined,
            url: att.url ?? undefined,
          });
        }
      }
    }

    /* 5. Timeline (DESC) */
    const { data: timeline } = await supabaseAdmin
      .from("prospect_timeline")
      .select("id, action_type, description, metadata, created_at, email_id")
      .eq("user_id", user.id)
      .filter("metadata->>prospect_id", "eq", id)
      .order("created_at", { ascending: false })
      .limit(50);

    // Fallback : chercher aussi via email_id si prospect_id n'est pas dans metadata
    let timelineRows = timeline ?? [];
    if (timelineRows.length === 0 && (emails ?? []).length > 0) {
      const emailIds = (emails ?? []).map((e) => e.id);
      const { data: tlByEmail } = await supabaseAdmin
        .from("prospect_timeline")
        .select("id, action_type, description, metadata, created_at, email_id")
        .eq("user_id", user.id)
        .in("email_id", emailIds)
        .order("created_at", { ascending: false })
        .limit(50);
      timelineRows = tlByEmail ?? [];
    }

    return NextResponse.json({
      prospect,
      property,
      emails: emails ?? [],
      documents: allAttachments,
      timeline: timelineRows,
    });
  } catch (err) {
    console.error("[GET /api/prospects/[id]]", err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

/* ─────────────────────────────────────────────────────── */
/*  PATCH /api/prospects/[id]                              */
/*  Body : { field: value, ... }                           */
/*  → met à jour la table prospects + insère timeline      */
/* ─────────────────────────────────────────────────────── */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();

    // Vérifier que le prospect appartient à l'user
    const { data: existing } = await supabaseAdmin
      .from("prospects")
      .select("id, etape_process")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!existing) return NextResponse.json({ error: "PROSPECT_NOT_FOUND" }, { status: 404 });

    // Si étape_process incluse : on n'autorise l'avancement que vers une étape valide
    if (body.etape_process) {
      const currentRank = etapeRank(existing.etape_process ?? "NEW");
      const newRank = etapeRank(body.etape_process);
      // Autoriser le retour en arrière sauf VALIDE/REFUSE → NEW
      if (newRank < 0) {
        return NextResponse.json({ error: "INVALID_ETAPE" }, { status: 400 });
      }
      // Bloquer régression depuis VALIDE/REFUSE sauf si on force (pas de restriction ici : l'UI décide)
      console.log(`[PATCH /prospects/${id}] etape_process: ${existing.etape_process} → ${body.etape_process} (rank ${currentRank} → ${newRank})`);
    }

    const updatePayload = { ...body, updated_at: new Date().toISOString() };
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("prospects")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateErr) {
      console.error("[PATCH /prospects/[id]] update error", updateErr);
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 });
    }

    // Timeline : lister les champs modifiés
    const changedFields = Object.keys(body).filter((k) => k !== "updated_at");
    const fieldLabels: Record<string, string> = {
      nom: "Nom", prenom: "Prénom", telephone: "Téléphone",
      situation_pro: "Situation professionnelle", revenus_mensuels: "Revenus mensuels",
      garant: "Garant", garant_revenus: "Revenus du garant",
      nb_personnes: "Nombre de personnes", animaux: "Animaux",
      etape_process: "Étape du process", property_id: "Bien associé",
      visite_date: "Date de visite", visite_status: "Statut visite",
      dossier_complet: "Dossier complet", lead_score: "Score lead",
    };
    const desc = changedFields
      .map((f) => fieldLabels[f] ?? f)
      .join(", ");

    await supabaseAdmin.from("prospect_timeline").insert({
      user_id: user.id,
      action_type: "info_mise_a_jour",
      description: `Champ(s) modifié(s) : ${desc}`,
      metadata: { prospect_id: id, champs: changedFields, valeurs: body },
    });

    return NextResponse.json({ prospect: updated });
  } catch (err) {
    console.error("[PATCH /api/prospects/[id]]", err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

/* ─────────────────────────────────────────────────────── */
/*  POST /api/prospects/[id]                               */
/*  Body : { action: "visite_effectuee" | "visite_annulee" */
/*           | "demander_dossier" | "valider" | "refuser"  */
/*           , message?: string }                          */
/* ─────────────────────────────────────────────────────── */

type ProspectAction =
  | "visite_effectuee"
  | "visite_annulee"
  | "demander_dossier"
  | "valider"
  | "refuser";

const ACTION_CONFIG: Record<ProspectAction, {
  nextEtape: string;
  timelineLabel: string;
  emailSubject: (nom: string) => string;
  emailBody: (nom: string, agence: string, bien: string | null) => string;
}> = {
  visite_effectuee: {
    nextEtape: "DOSSIER_DEMANDE",
    timelineLabel: "Visite effectuée — dossier demandé",
    emailSubject: (nom) => `Suite à notre visite — Dossier locataire pour ${nom}`,
    emailBody: (nom, agence, bien) => `Bonjour ${nom},

Merci d'avoir pris le temps de visiter${bien ? ` le bien "${bien}"` : " notre bien"} aujourd'hui. Nous espérons que la visite vous a plu.

Afin de traiter votre candidature, nous vous remercions de bien vouloir nous transmettre votre dossier locataire complet (pièces d'identité, justificatifs de revenus, avis d'imposition, etc.).

N'hésitez pas à répondre directement à cet email avec vos documents.

Cordialement,
L'équipe ${agence}`,
  },
  visite_annulee: {
    nextEtape: "VISITE_PROPOSEE",
    timelineLabel: "Visite annulée — replanification en cours",
    emailSubject: (nom) => `Visite annulée — Replanification pour ${nom}`,
    emailBody: (nom, agence, _bien) => `Bonjour ${nom},

Nous avons bien pris note de l'annulation de votre visite. Nous comprenons tout à fait que des imprévus peuvent survenir.

Pourriez-vous nous indiquer vos disponibilités pour replanifier une visite à votre convenance ?

Nous restons à votre disposition.

Cordialement,
L'équipe ${agence}`,
  },
  demander_dossier: {
    nextEtape: "DOSSIER_DEMANDE",
    timelineLabel: "Dossier locataire demandé",
    emailSubject: (nom) => `Dossier locataire — ${nom}`,
    emailBody: (nom, agence, bien) => `Bonjour ${nom},

Suite à nos échanges concernant${bien ? ` le bien "${bien}"` : " notre bien"}, nous vous remercions de l'intérêt que vous lui portez.

Afin de traiter votre candidature, nous vous invitons à nous faire parvenir votre dossier locataire complet :
• Pièce d'identité
• Justificatifs de revenus (3 derniers bulletins de salaire)
• Dernier avis d'imposition
• Contrat de travail ou justificatif de situation professionnelle

Merci de répondre directement à cet email avec vos documents.

Cordialement,
L'équipe ${agence}`,
  },
  valider: {
    nextEtape: "VALIDE",
    timelineLabel: "Dossier validé",
    emailSubject: (nom) => `Votre candidature a été retenue — ${nom}`,
    emailBody: (nom, agence, bien) => `Bonjour ${nom},

Nous avons le plaisir de vous informer que votre candidature pour${bien ? ` le bien "${bien}"` : " notre bien"} a été retenue !

Nous allons vous recontacter très prochainement pour vous communiquer les prochaines étapes (signature du bail, état des lieux, remise des clés).

Merci pour votre confiance et bienvenue !

Cordialement,
L'équipe ${agence}`,
  },
  refuser: {
    nextEtape: "REFUSE",
    timelineLabel: "Candidature refusée",
    emailSubject: (nom) => `Votre candidature — ${nom}`,
    emailBody: (nom, agence, bien) => `Bonjour ${nom},

Nous vous remercions pour l'intérêt que vous portez à${bien ? ` notre bien "${bien}"` : " notre bien"} ainsi que pour les documents que vous nous avez transmis.

Après examen de votre dossier, nous avons le regret de vous informer que votre candidature n'a pas pu être retenue pour ce logement.

Nous vous souhaitons bonne chance dans vos recherches et restons disponibles si d'autres biens correspondant à vos critères se présentent à l'avenir.

Cordialement,
L'équipe ${agence}`,
  },
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const action = body.action as ProspectAction;
    const customMessage = body.message as string | undefined;

    if (!ACTION_CONFIG[action]) {
      return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
    }

    /* 1. Charger le prospect */
    const { data: prospect } = await supabaseAdmin
      .from("prospects")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!prospect) return NextResponse.json({ error: "PROSPECT_NOT_FOUND" }, { status: 404 });

    const config = ACTION_CONFIG[action];

    /* 2. Charger property et settings pour l'email */
    let propertyTitle: string | null = null;
    if (prospect.property_id) {
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select("title")
        .eq("id", prospect.property_id)
        .maybeSingle();
      propertyTitle = prop?.title ?? null;
    }

    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("email_rules")
      .eq("user_id", user.id)
      .maybeSingle();

    const rules = (settingsRow?.email_rules && typeof settingsRow.email_rules === "object")
      ? (settingsRow.email_rules as Record<string, unknown>) : {};
    const locatif = (rules.ft_locatif as Record<string, unknown>) ?? {};
    const nomAgence = (locatif.nomAgence as string) ?? "l'agence";

    const nom = [prospect.prenom, prospect.nom].filter(Boolean).join(" ") || prospect.email || "Madame, Monsieur";

    /* 3. Envoyer email via Gmail API */
    let emailSent = false;
    const { data: tokenRow } = await supabaseAdmin
      .from("google_tokens")
      .select("access_token")
      .eq("user_id", user.id)
      .maybeSingle();

    if (tokenRow?.access_token && prospect.email) {
      const subject = config.emailSubject(nom);
      const emailBody = customMessage ?? config.emailBody(nom, nomAgence, propertyTitle);

      const rawEmail = [
        `To: ${prospect.email}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        `Content-Type: text/plain; charset="UTF-8"`,
        ``,
        emailBody,
      ].join("\r\n");

      const encoded = Buffer.from(rawEmail)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      try {
        const gmailRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenRow.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ raw: encoded }),
          }
        );
        emailSent = gmailRes.ok;
        if (!gmailRes.ok) {
          const errBody = await gmailRes.text();
          console.error(`[POST /prospects/${id}/action] Gmail send error`, errBody);
        }
      } catch (gmailErr) {
        console.error(`[POST /prospects/${id}/action] Gmail fetch error`, gmailErr);
      }
    }

    /* 4. Mettre à jour l'étape du prospect */
    await supabaseAdmin
      .from("prospects")
      .update({
        etape_process: config.nextEtape,
        updated_at: new Date().toISOString(),
        ...(action === "visite_effectuee" ? { visite_status: "effectuee" } : {}),
        ...(action === "visite_annulee" ? { visite_status: "annulee" } : {}),
        ...(action === "valider" ? { dossier_validated_at: new Date().toISOString() } : {}),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    /* 5. Insérer dans prospect_timeline */
    await supabaseAdmin.from("prospect_timeline").insert({
      user_id: user.id,
      action_type: action,
      description: config.timelineLabel + (emailSent ? " — email envoyé" : " — email non envoyé"),
      metadata: {
        prospect_id: id,
        etape_avant: prospect.etape_process,
        etape_apres: config.nextEtape,
        email_sent: emailSent,
        prospect_email: prospect.email,
      },
    });

    return NextResponse.json({
      success: true,
      action,
      nextEtape: config.nextEtape,
      emailSent,
    });
  } catch (err) {
    console.error("[POST /api/prospects/[id]]", err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
