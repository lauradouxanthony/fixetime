import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/** Minimal keyword matching — identique à matchPropertyFromEmail dans analyze-inbox */
function matchProperty(
  subject: string | null,
  body: string | null,
  properties: Array<{ id: string; title: string; address: string | null; rent: number }>
): string | null {
  if (properties.length === 0) return null;
  if (properties.length === 1) return properties[0].id;

  const text = `${subject ?? ""} ${body ?? ""}`.toLowerCase();

  for (const prop of properties) {
    const keywords = [prop.title, prop.address]
      .filter(Boolean)
      .flatMap((s) => (s as string).toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3));

    const matchCount = keywords.filter((k) => text.includes(k)).length;
    if (matchCount >= 2) return prop.id;
  }
  return null;
}

/**
 * POST /api/emails/backfill-property
 * Re-assigne property_id aux emails LOCATION existants qui n'en ont pas.
 * Appelé en background après chaque sync depuis analyze-now.
 */
export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // 1. Récupérer les biens actifs de l'agent
    const { data: propsData } = await supabaseAdmin
      .from("properties")
      .select("id, title, address, rent")
      .eq("user_id", user.id)
      .neq("available", false);

    const properties = (propsData ?? []) as Array<{ id: string; title: string; address: string | null; rent: number }>;
    if (properties.length === 0) return NextResponse.json({ updated: 0, reason: "no_properties" });

    // 2. Emails LOCATION sans property_id (50 max, 60 jours)
    const since = new Date();
    since.setDate(since.getDate() - 60);

    const { data: emails } = await supabaseAdmin
      .from("emails")
      .select("id, subject, body")
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .is("property_id", null)
      .gte("received_at", since.toISOString())
      .limit(50);

    if (!emails || emails.length === 0) return NextResponse.json({ updated: 0 });

    // 3. Matcher chaque email et mettre à jour
    let updated = 0;
    for (const email of emails) {
      const matched = matchProperty(
        email.subject as string | null,
        (email.body as string | null)?.slice(0, 3000) ?? null,
        properties
      );
      if (matched) {
        await supabaseAdmin
          .from("emails")
          .update({ property_id: matched })
          .eq("id", email.id);
        updated++;
      }
    }

    console.log(`[BACKFILL-PROPERTY] ${updated}/${emails.length} emails mis à jour`);
    return NextResponse.json({ updated, checked: emails.length });
  } catch (err) {
    console.error("[BACKFILL-PROPERTY]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
