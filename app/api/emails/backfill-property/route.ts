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

const STOP_WORDS = new Set([
  "de", "du", "le", "la", "les", "un", "une", "des", "en", "et",
  "ou", "par", "sur", "sous", "au", "aux", "est", "rue", "rues",
  "avenue", "avenues", "boulevard", "allee", "place", "impasse",
  "cite", "villa", "bis", "ter", "me", "mon", "ma", "mes", "ce",
  "se", "sa", "son", "ses", "pour", "dans", "avec", "sans", "que",
  "qui", "quoi", "il", "je", "tu", "nous", "vous", "ils", "elles",
  "this", "that", "the", "for", "and",
]);

function extractKeywords(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function matchProperty(
  subject: string | null,
  body: string | null,
  properties: PropRow[]
): string | null {
  if (properties.length === 0) return null;
  if (properties.length === 1) return properties[0].id;

  const emailText = normalize(`${subject ?? ""} ${body ?? ""}`);
  let bestMatch: { id: string; count: number } | null = null;

  for (const prop of properties) {
    const effectiveTitle = (prop.title || prop.name || "").trim();
    const parts = [effectiveTitle, prop.address, prop.type].filter(
      (s): s is string => typeof s === "string" && s.length > 0
    );
    const keywords = [...new Set(parts.flatMap(extractKeywords))];
    const matched = keywords.filter((k) => emailText.includes(k));
    const matchCount = matched.length;

    console.log(
      `[BACKFILL] "${effectiveTitle}" keywords=[${keywords.join(",")}]` +
      ` score=${matchCount} matched=[${matched.join(",")}]`
    );

    if (matchCount >= 2 && (!bestMatch || matchCount > bestMatch.count)) {
      bestMatch = { id: prop.id, count: matchCount };
    }
  }

  if (bestMatch) {
    console.log(`[BACKFILL] ✅ Best match → ${bestMatch.id} (score ${bestMatch.count})`);
    return bestMatch.id;
  }
  return null;
}

/**
 * Fonction principale — appelable directement depuis d'autres routes (sans HTTP).
 * userId est déjà vérifié par l'appelant.
 */
export async function runBackfill(
  userId: string
): Promise<{ updated: number; checked: number }> {
  console.log(`[BACKFILL] ▶ Démarré pour user=${userId}`);

  // 1. Biens actifs
  const { data: propsData, error: propsErr } = await supabaseAdmin
    .from("properties")
    .select("id, title, name, address, rent, available, type")
    .eq("user_id", userId);

  if (propsErr) {
    console.error("[BACKFILL] Erreur fetch properties:", propsErr.message);
    return { updated: 0, checked: 0 };
  }

  const allProps = (propsData ?? []) as PropRow[];
  const properties = allProps.filter((p: any) => p.available !== false);

  console.log(`[BACKFILL] Biens actifs trouvés: ${properties.length} / ${allProps.length} total`);
  properties.forEach((p) => {
    const label = p.title || p.name || "(sans titre)";
    const kw = [
      ...new Set(
        [p.title || p.name || "", p.address, p.type]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .flatMap(extractKeywords)
      ),
    ];
    console.log(`[BACKFILL] Bien "${label}" | type="${p.type}" address="${p.address}"`);
    console.log(`[BACKFILL] Keywords pour "${label}": [${kw.join(",")}]`);
  });

  if (properties.length === 0) {
    console.log("[BACKFILL] Aucun bien actif → stop");
    return { updated: 0, checked: 0 };
  }

  // 2. Emails LOCATION sans property_id (60 jours, max 200)
  const since = new Date();
  since.setDate(since.getDate() - 60);

  const { data: emails, error: emailsErr } = await supabaseAdmin
    .from("emails")
    .select("id, subject, body")
    .eq("user_id", userId)
    .eq("category", "LOCATION")
    .is("property_id", null)
    .gte("received_at", since.toISOString())
    .limit(200);

  if (emailsErr) {
    console.error("[BACKFILL] Erreur fetch emails:", emailsErr.message);
    return { updated: 0, checked: 0 };
  }

  const emailCount = emails?.length ?? 0;
  console.log(`[BACKFILL] Emails LOCATION sans property_id: ${emailCount}`);

  if (!emails || emails.length === 0) return { updated: 0, checked: 0 };

  // 3. Matcher et mettre à jour
  let updated = 0;

  for (const email of emails) {
    const subject = email.subject as string | null;
    const bodySnippet = (email.body as string | null)?.slice(0, 5000) ?? null;

    console.log(`[BACKFILL] Email "${subject ?? "(sans sujet)"}"`);

    const matched = matchProperty(subject, bodySnippet, properties);

    if (matched) {
      const { error: updateErr } = await supabaseAdmin
        .from("emails")
        .update({ property_id: matched })
        .eq("id", email.id);

      if (updateErr) {
        console.error(`[BACKFILL] Update échoué ${email.id}:`, updateErr.message);
      } else {
        console.log(`[BACKFILL] Assigné: ${email.id} → ${matched}`);
        updated++;
      }
    } else {
      console.log(`[BACKFILL] ❌ Pas de match pour "${subject ?? email.id}"`);
    }
  }

  console.log(`[BACKFILL] ✅ Terminé: ${updated}/${emailCount} emails mis à jour`);
  return { updated, checked: emailCount };
}

/**
 * POST /api/emails/backfill-property
 * Point d'entrée HTTP (test manuel / cron externe).
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

    const result = await runBackfill(user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[BACKFILL-PROPERTY] FATAL:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
