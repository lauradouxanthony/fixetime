import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type PropRow = { id: string; title: string | null; name: string | null; address: string | null; rent: number };

/** Keyword matching — supporte name ET title (compatibilité pré/post migration) */
function matchProperty(
  subject: string | null,
  body: string | null,
  properties: PropRow[]
): string | null {
  if (properties.length === 0) return null;
  // Un seul bien actif → toujours l'assigner (email LOCATION = forcément ce bien)
  if (properties.length === 1) return properties[0].id;

  const text = `${subject ?? ""} ${body ?? ""}`.toLowerCase();

  for (const prop of properties) {
    // Utiliser title OU name (selon la colonne présente en DB)
    const effectiveTitle = (prop.title || prop.name || "").trim();
    const keywords = [effectiveTitle, prop.address]
      .filter((s) => s && s.length > 0)
      .flatMap((s) => (s as string).toLowerCase().split(/[\s,.\-\/]+/).filter((w) => w.length > 3));

    const matched = keywords.filter((k) => text.includes(k));
    const matchCount = matched.length;

    console.log(`[BACKFILL] Prop "${effectiveTitle}" → keywords=[${keywords.join(",")}] matchCount=${matchCount} matched=[${matched.join(",")}]`);

    if (matchCount >= 1 && keywords.length >= 1) return prop.id; // >= 1 keyword si un seul bien candidat possible
    if (matchCount >= 2) return prop.id;
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log("[BACKFILL-PROPERTY] UNAUTHORIZED");
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    console.log(`[BACKFILL-PROPERTY] ▶ user=${user.id}`);

    // 1. Récupérer les biens de l'agent (title ET name pour compatibilité DB)
    const { data: propsData, error: propsErr } = await supabaseAdmin
      .from("properties")
      .select("id, title, name, address, rent, available")
      .eq("user_id", user.id);

    if (propsErr) {
      console.error("[BACKFILL-PROPERTY] Erreur fetch properties:", propsErr.message);
      return NextResponse.json({ error: "PROPS_FETCH_FAILED", details: propsErr.message }, { status: 500 });
    }

    // Filtrer les biens actifs (available !== false, compatible avec available=null)
    const allProps = (propsData ?? []) as PropRow[];
    const properties = allProps.filter((p: any) => p.available !== false);

    console.log(`[BACKFILL-PROPERTY] ${properties.length} biens actifs sur ${allProps.length} total:`);
    properties.forEach((p) => {
      const displayTitle = (p.title || p.name || "(sans titre)");
      console.log(`  → id=${p.id} title="${p.title}" name="${p.name}" address="${p.address}" rent=${p.rent} effectiveTitle="${displayTitle}"`);
    });

    if (properties.length === 0) {
      console.log("[BACKFILL-PROPERTY] Aucun bien actif → stop");
      return NextResponse.json({ updated: 0, reason: "no_active_properties", total_props: allProps.length });
    }

    // 2. Emails LOCATION sans property_id (60 jours, max 100)
    const since = new Date();
    since.setDate(since.getDate() - 60);

    const { data: emails, error: emailsErr } = await supabaseAdmin
      .from("emails")
      .select("id, subject, body")
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .is("property_id", null)
      .gte("received_at", since.toISOString())
      .limit(100);

    if (emailsErr) {
      console.error("[BACKFILL-PROPERTY] Erreur fetch emails:", emailsErr.message);
      return NextResponse.json({ error: "EMAILS_FETCH_FAILED", details: emailsErr.message }, { status: 500 });
    }

    console.log(`[BACKFILL-PROPERTY] ${emails?.length ?? 0} email(s) LOCATION sans property_id trouvé(s)`);

    if (!emails || emails.length === 0) {
      return NextResponse.json({ updated: 0, checked: 0 });
    }

    // 3. Matcher chaque email
    let updated = 0;
    const results: Array<{ emailId: string; subject: string; matched: string | null }> = [];

    for (const email of emails) {
      const subject = email.subject as string | null;
      const bodySnippet = (email.body as string | null)?.slice(0, 3000) ?? null;

      console.log(`[BACKFILL-PROPERTY] Email id=${email.id} subject="${subject}"`);

      const matched = matchProperty(subject, bodySnippet, properties);
      results.push({ emailId: email.id, subject: subject ?? "", matched });

      if (matched) {
        const { error: updateErr } = await supabaseAdmin
          .from("emails")
          .update({ property_id: matched })
          .eq("id", email.id);

        if (updateErr) {
          console.error(`[BACKFILL-PROPERTY] Update échoué pour ${email.id}:`, updateErr.message);
        } else {
          console.log(`[BACKFILL-PROPERTY] ✅ email ${email.id} → property_id=${matched}`);
          updated++;
        }
      } else {
        console.log(`[BACKFILL-PROPERTY] ❌ Pas de match pour email ${email.id}`);
      }
    }

    console.log(`[BACKFILL-PROPERTY] ✅ Terminé: ${updated}/${emails.length} emails mis à jour`);
    return NextResponse.json({ updated, checked: emails.length, results });

  } catch (err) {
    console.error("[BACKFILL-PROPERTY] FATAL:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
