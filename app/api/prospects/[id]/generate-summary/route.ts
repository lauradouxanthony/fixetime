/**
 * POST /api/prospects/[id]/generate-summary
 * Génère une note de synthèse IA pour un dossier de candidature locataire.
 * id = email_id du prospect
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: emailId } = await params;

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // ── 1. Email principal ─────────────────────────────────────────────────────
    const { data: emailRow, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, summary, body, received_at, prospect_data, attachments")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !emailRow) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    // ── 2. Contexte thread (tous les emails du même expéditeur) ────────────────
    const senderKey = (emailRow.sender ?? "").toLowerCase().replace(/.*<(.+)>.*/, "$1").trim();
    const { data: threadEmails } = senderKey
      ? await supabaseAdmin
          .from("emails")
          .select("subject, summary, received_at, prospect_data, attachments")
          .eq("user_id", user.id)
          .ilike("sender", `%${senderKey}%`)
          .order("received_at", { ascending: true })
          .limit(10)
      : { data: null };

    // ── 3. Construire le prompt ────────────────────────────────────────────────
    const pd = (emailRow.prospect_data ?? {}) as Record<string, unknown>;
    const attachments = (emailRow.attachments ?? []) as Record<string, unknown>[];
    const validatedAtts = attachments.filter((a) => a.validated_by_human === true);

    const nom = (pd.nom as string | null) ?? emailRow.sender ?? "Candidat";
    const situationPro = (pd.situation_pro as string | null) ?? "non renseignée";
    const revenus = pd.revenus_mensuels as number | null;
    const loyer = pd.loyer_max as number | null;
    const ratio = revenus && loyer ? (revenus / loyer).toFixed(1) : "inconnu";
    const garant = (pd.garant as string | null) ?? "non renseigné";
    const etape = (pd.etape_process as string | null) ?? "NEW";

    const docLines = validatedAtts.length > 0
      ? validatedAtts.map((a) => `- ${(a.docType as string) ?? (a.filename as string) ?? "Document"} (validé ✓)`).join("\n")
      : "Aucun document validé";

    const threadSummaries = (threadEmails ?? []).map((e: Record<string, unknown>, i: number) =>
      `Email ${i + 1} (${new Date(e.received_at as string).toLocaleDateString("fr-FR")}): ${(e.summary as string | null) ?? (e.subject as string | null) ?? "sans objet"}`
    ).join("\n");

    const prompt = `Tu es un assistant immobilier expert. Génère une note de synthèse concise pour un dossier de candidature locataire.

CANDIDAT : ${nom}
SITUATION PRO : ${situationPro}
REVENUS NETS/MOIS : ${revenus ? `${revenus.toLocaleString("fr-FR")} €` : "non renseignés"}
LOYER VISÉ : ${loyer ? `${loyer.toLocaleString("fr-FR")} €` : "non renseigné"}
RATIO REVENUS/LOYER : ${ratio}x
GARANT : ${garant}
ÉTAPE ACTUELLE : ${etape}

DOCUMENTS VALIDÉS :
${docLines}

HISTORIQUE EMAILS :
${threadSummaries || "Aucun historique disponible"}

Rédige la note de synthèse en français, structurée en 5 parties :
1. Présentation du candidat (2-3 phrases)
2. Analyse financière (solvabilité, ratio, commentaire)
3. État du dossier (documents reçus et validés)
4. Points d'attention ou risques
5. Recommandation (valider / mettre en attente / refuser + justification brève)

Sois factuel, précis et professionnel. Maximum 300 mots.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "NO_API_KEY" }, { status: 500 });

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error("[generate-summary] AI error:", err);
      return NextResponse.json({ error: "AI_ERROR" }, { status: 502 });
    }

    const aiData = await aiRes.json();
    const summary = (aiData.content?.[0]?.text as string | null) ?? "Note de synthèse non disponible.";

    return NextResponse.json({ summary });
  } catch (err) {
    console.error("[generate-summary]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
