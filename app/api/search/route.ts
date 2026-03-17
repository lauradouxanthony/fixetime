import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) return NextResponse.json({ prospects: [], emails: [], biens: [] });

  const userId = authData.user.id;
  const like = `%${q}%`;

  // Run all queries in parallel: 2 prospect queries (sender/subject + JSONB nom), emails, biens
  const [prospectsQ1, prospectsQ2, emailsRes, biensRes] = await Promise.all([
    // Prospects query 1: sender/subject text search
    supabaseAdmin
      .from("emails")
      .select("id, sender, subject, prospect_data, received_at")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .or(`sender.ilike.${like},subject.ilike.${like}`)
      .limit(8),

    // Prospects query 2: JSONB prospect_data->>'nom' and 'telephone' search
    supabaseAdmin
      .from("emails")
      .select("id, sender, subject, prospect_data, received_at")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .or(`prospect_data->>nom.ilike.${like},prospect_data->>telephone.ilike.${like}`)
      .limit(8),

    // Non-LOCATION emails: subject/sender
    supabaseAdmin
      .from("emails")
      .select("id, sender, subject, received_at, category")
      .eq("user_id", userId)
      .or(`subject.ilike.${like},sender.ilike.${like}`)
      .neq("category", "LOCATION")
      .limit(5),

    // Biens: title/address
    supabaseAdmin
      .from("properties")
      .select("id, title, address, rent, type, available")
      .eq("user_id", userId)
      .or(`title.ilike.${like},address.ilike.${like}`)
      .limit(5),
  ]);

  // Merge and deduplicate prospects by id
  const prospectMap = new Map<string, unknown>();
  for (const p of [...(prospectsQ1.data ?? []), ...(prospectsQ2.data ?? [])]) {
    const item = p as { id: string };
    if (!prospectMap.has(item.id)) prospectMap.set(item.id, p);
  }
  const prospects = Array.from(prospectMap.values()).slice(0, 10);

  return NextResponse.json({
    prospects,
    emails: emailsRes.data ?? [],
    biens: biensRes.data ?? [],
  });
}
