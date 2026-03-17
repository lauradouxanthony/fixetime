import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/**
 * POST /api/leads/[id]/visite
 * Body: { action: "effectuee" | "annulee" }
 *
 * "effectuee" → etape_process = DOSSIER_DEMANDE + envoi auto liste docs (si autopilote)
 * "annulee"   → etape_process = QUALIFICATION
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const body = await req.json();
    const action = body?.action as "effectuee" | "annulee" | undefined;
    if (!action || !["effectuee", "annulee"].includes(action)) {
      return NextResponse.json({ error: "ACTION_REQUIRED: effectuee|annulee" }, { status: 400 });
    }

    // Vérifier que l'email appartient à l'user et est bien en VISITE_CONFIRMEE
    const { data: email, error: fetchErr } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, sender, subject, body, prospect_data, gmail_message_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !email) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    const pd = ((email as any).prospect_data as Record<string, unknown> | null) ?? {};
    const newEtape = action === "effectuee" ? "DOSSIER_DEMANDE" : "QUALIFICATION";

    // Mettre à jour l'étape
    const updatedPd = { ...pd, etape_process: newEtape };
    await supabaseAdmin
      .from("emails")
      .update({ prospect_data: updatedPd })
      .eq("id", id);

    // Si visite effectuée → envoyer automatiquement la liste des documents
    if (action === "effectuee" && (email as any).gmail_message_id) {
      try {
        // Charger les settings pour la liste de docs
        const { data: settingsRow } = await supabaseAdmin
          .from("settings_v1")
          .select("email_rules")
          .eq("user_id", user.id)
          .maybeSingle();

        const rules = (settingsRow?.email_rules as Record<string, unknown>) ?? {};
        const locatif = (rules.ft_locatif as Record<string, unknown>) ?? {};
        const docsSection = (rules.ft_documents as Record<string, unknown>) ?? {};
        const nomAgence = (locatif.nomAgence as string) ?? "l'agence";
        const garantObligatoire = (locatif.garantObligatoire as Record<string, boolean>) ?? { etudiant: true };

        const docsProfiles: Record<string, string[]> = {
          cdi:     (docsSection.cdi     as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail", "Avis d'imposition", "Pièce d'identité"],
          cdd:     (docsSection.cdd     as string[]) ?? ["Fiches de paie (3 mois)", "Contrat de travail (durée + date de fin)", "Avis d'imposition", "Pièce d'identité"],
          etudiant:(docsSection.etudiant as string[]) ?? ["Carte étudiante", "Certificat de scolarité", "Justificatif de garant", "Pièce d'identité"],
          auto:    (docsSection.auto    as string[]) ?? ["Extrait Kbis", "Bilans comptables (2 dernières années)", "Avis d'imposition", "Pièce d'identité"],
          retraite:(docsSection.retraite as string[]) ?? ["Relevés de pension (3 derniers mois)", "Avis d'imposition", "Pièce d'identité"],
        };

        const situationPro = pd.situation_pro as string | null;
        const spMap: Record<string, string> = { CDI: "cdi", CDD: "cdd", AUTO_ENTREPRENEUR: "auto", ETUDIANT: "etudiant", RETRAITE: "retraite" };
        const situation = situationPro ? (spMap[situationPro] ?? "cdi") : "cdi";
        const nom = (pd.nom as string | null) ?? "Madame, Monsieur";
        const docsList = (docsProfiles[situation] ?? docsProfiles.cdi).map(d => `• ${d}`).join("\n");
        const needsGarant = garantObligatoire[situation];
        const garantLine = needsGarant ? "\n• Dossier garant (mêmes documents)" : "";

        const docsPrompt = `Tu es l'assistant de l'agence ${nomAgence}. Suite à la visite du bien, rédige un email professionnel pour demander le dossier locataire à ${nom}.

Contenu :
- Remercier pour la visite et l'intérêt pour le bien
- Demander de transmettre les documents suivants pour constituer le dossier :
${docsList}${garantLine}
- Indiquer que la candidature sera étudiée dès réception du dossier complet
- Signature : Cordialement, L'équipe ${nomAgence}

Email d'origine : Expéditeur: ${(email as any).sender}, Sujet: ${(email as any).subject}`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: docsPrompt }],
          temperature: 0.3,
        });
        const docsReply = completion.choices[0]?.message?.content ?? null;

        if (docsReply) {
          const accessToken = await getValidGoogleAccessToken(user.id);
          const subjectEncoded = `=?UTF-8?B?${Buffer.from(`Re: ${(email as any).subject ?? ""}`, "utf-8").toString("base64")}?=`;
          const mime = [
            `MIME-Version: 1.0`,
            `To: ${(email as any).sender ?? ""}`,
            `Subject: ${subjectEncoded}`,
            `Content-Type: text/plain; charset=UTF-8`,
            `Content-Transfer-Encoding: base64`,
            ``,
            Buffer.from(docsReply, "utf-8").toString("base64"),
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

          await supabaseAdmin
            .from("emails")
            .update({ ai_reply: docsReply })
            .eq("id", id);
        }
      } catch (sendErr) {
        console.error("VISITE_EFFECTUEE_SEND_ERROR", sendErr);
        // Ne pas bloquer si l'envoi échoue
      }
    }

    return NextResponse.json({ success: true, etape_process: newEtape });
  } catch (err) {
    console.error("VISITE_API_ERROR", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
