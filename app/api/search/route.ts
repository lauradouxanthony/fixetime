import { NextResponse } from "next/server";
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

  const [prospectsRes, emailsRes, biensRes] = await Promise.all([
    // Prospects : chercher dans prospect_data (nom, téléphone) — via emails LOCATION
    supabase
      .from("emails")
      .select("id, sender, subject, prospect_data, received_at")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .or(`sender.ilike.${like},subject.ilike.${like}`)
      .limit(5),

    // Emails : chercher dans sujet ou expéditeur
    supabase
      .from("emails")
      .select("id, sender, subject, received_at, category")
      .eq("user_id", userId)
      .or(`subject.ilike.${like},sender.ilike.${like}`)
      .neq("category", "LOCATION")
      .limit(5),

    // Biens : chercher dans title/address
    supabase
      .from("properties")
      .select("id, title, address, rent, type, available")
      .eq("user_id", userId)
      .or(`title.ilike.${like},address.ilike.${like}`)
      .limit(5),
  ]);

  return NextResponse.json({
    prospects: prospectsRes.data ?? [],
    emails: emailsRes.data ?? [],
    biens: biensRes.data ?? [],
  });
}
