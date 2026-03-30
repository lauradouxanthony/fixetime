import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type PropRow = {
  id: string;
  title: string | null;
  name: string | null;
  address: string | null;
  rent: number;
  type: string | null;
};

/** Minuscules + suppression accents + caractères non-alphanumériques → espace */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mots vides français + termes d'adresse génériques
const STOP_WORDS = new Set([
  "de", "du", "le", "la", "les", "un", "une", "des", "en", "et",
  "ou", "par", "sur", "sous", "au", "aux", "est", "rue", "rues",
  "avenue", "avenues", "boulevard", "allee", "place", "impasse",
  "cite", "villa", "bis", "ter", "me", "mon", "ma", "mes", "ce",
  "se", "sa", "son", "ses", "pour", "dans", "avec", "sans", "que",
  "qui", "quoi", "il", "je", "tu", "nous", "vous", "ils", "elles",
  "this", "that", "the", "for", "and",
]);

/** Extrait les keywords significatifs d'un texte normalisé */
function extractKeywords(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Matching keyword — supporte name + title + address + type
 * Retourne property_id si au moins 2 keywords matchent (ou 1 seul bien actif)
 */
function matchProperty(
  subject: string | null,
  body: string | null,
  properties: PropRow[]
): string | null {
  if (properties.length === 0) return null;
  // Un seul bien actif → l'assigner directement (email LOCATION = forcément ce bien)
  if (properties.length === 1) return properties[0].id;

  const emailText = normalize(`${subject ?? ""} ${body ?? ""}`);

  let bestMatch: { id: string; count: number } | null = null;

  for (const prop of properties) {
    const effectiveTitle = (prop.title || prop.name || "").trim();
    // Extraire keywords de : name/title + adresse + type de bien
    const parts = [effectiveTitle, prop.address, prop.type].filter(
      (s): s is string => typeof s === "string" && s.length > 0
    );
    const keywords = [...new Set(parts.flatMap(extractKeywords))];

    const matched = keywords.filter((k) => emailText.includes(k));
    const matchCount = matched.length;

    console.log(
      `[BACKFILL] Prop "${effectiveTitle}" | keywords=[${keywords.join(",")}]` +
      ` matchCount=${matchCount} matched=[${matched.join(",")}]`
    );

    if (matchCount >= 2) {
      if (!bestMatch || matchCount > bestMatch.count) {
        bestMatch = { id: prop.id, count: matchCount };
      }
    }
  }

  if (bestMatch) {
    console.log(`[BACKFILL] ✅ Best match → property_id=${bestMatch.id} (${bestMatch.count} keywords)`);
    return bestMatch.id;
  }
  return null;
}

/**
 * POST /api/emails/backfill-property
 * Re-assigne property_id aux emails LOCATION existants qui n'en ont pas.
 */
export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.log("[BACKFILL-PROPERTY] UNAUTHORIZED");
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    console.log(`[BACKFILL-PROPERTY] ▶ user=${user.id}`);

    // 1. Récupérer les biens (title + name + address + type pour matching complet)
    const { data: propsData, error: propsErr } = await supabaseAdmin
      .from("properties")
      .select("id, title, name, address, rent, available, type")
      .eq("user_id", user.id);

    if (propsErr) {
      console.error("[BACKFILL-PROPERTY] Erreur fetch properties:", propsErr.message);
      return NextResponse.json(
        { error: "PROPS_FETCH_FAILED", details: propsErr.message },
        { status: 500 }
      );
    }

    const allProps = (propsData ?? []) as PropRow[];
    // available !== false → biens actifs (null = actif par défaut)
    const properties = allProps.filter((p: any) => p.available !== false);

    console.log(
      `[BACKFILL-PROPERTY] ${properties.length} biens actifs / ${allProps.length} total`
    );
    properties.forEach((p) => {
      const label = p.title || p.name || "(sans titre)";
      console.log(
        `  → id=${p.id} name="${p.name}" title="${p.title}" type="${p.type}" address="${p.address}" rent=${p.rent}`
      );
      // Prévisualiser les keywords extraits
      const kw = [...new Set(
        [p.title || p.name || "", p.address, p.type]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .flatMap(extractKeywords)
      )];
      console.log(`     keywords extraits: [${kw.join(",")}]`);
    });

    if (properties.length === 0) {
      console.log("[BACKFILL-PROPERTY] Aucun bien actif → stop");
      return NextResponse.json({
        updated: 0,
        reason: "no_active_properties",
        total_props: allProps.length,
      });
    }

    // 2. Emails LOCATION sans property_id (60 jours, max 200)
    const since = new Date();
    since.setDate(since.getDate() - 60);

    const { data: emails, error: emailsErr } = await supabaseAdmin
      .from("emails")
      .select("id, subject, body")
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .is("property_id", null)
      .gte("received_at", since.toISOString())
      .limit(200);

    if (emailsErr) {
      console.error("[BACKFILL-PROPERTY] Erreur fetch emails:", emailsErr.message);
      return NextResponse.json(
        { error: "EMAILS_FETCH_FAILED", details: emailsErr.message },
        { status: 500 }
      );
    }

    const emailCount = emails?.length ?? 0;
    console.log(`[BACKFILL-PROPERTY] ${emailCount} email(s) LOCATION sans property_id`);

    if (!emails || emails.length === 0) {
      return NextResponse.json({ updated: 0, checked: 0 });
    }

    // 3. Matcher et mettre à jour
    let updated = 0;
    const results: Array<{
      emailId: string;
      subject: string;
      matched: string | null;
    }> = [];

    for (const email of emails) {
      const subject = email.subject as string | null;
      const bodySnippet = (email.body as string | null)?.slice(0, 5000) ?? null;

      console.log(`[BACKFILL-PROPERTY] ── Email ${email.id} subject="${subject}"`);

      const matched = matchProperty(subject, bodySnippet, properties);
      results.push({ emailId: email.id, subject: subject ?? "", matched });

      if (matched) {
        const { error: updateErr } = await supabaseAdmin
          .from("emails")
          .update({ property_id: matched })
          .eq("id", email.id);

        if (updateErr) {
          console.error(
            `[BACKFILL-PROPERTY] Update échoué ${email.id}:`,
            updateErr.message
          );
        } else {
          console.log(
            `[BACKFILL-PROPERTY] ✅ email ${email.id} → property_id=${matched}`
          );
          updated++;
        }
      } else {
        console.log(`[BACKFILL-PROPERTY] ❌ Pas de match pour email ${email.id}`);
      }
    }

    console.log(
      `[BACKFILL-PROPERTY] ✅ Terminé: ${updated}/${emails.length} emails mis à jour`
    );
    return NextResponse.json({ updated, checked: emails.length, results });
  } catch (err) {
    console.error("[BACKFILL-PROPERTY] FATAL:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
