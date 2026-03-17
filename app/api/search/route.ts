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

  // ── Recherche prospects : essayer RPC d'abord (cherche dans JSONB) ──
  let prospects: unknown[] = [];

  try {
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("search_prospects", {
      search_query: like,
      user_id_param: userId,
    });

    if (!rpcErr && rpcData && (rpcData as any[]).length > 0) {
      // RPC disponible → utiliser les résultats
      prospects = rpcData as unknown[];
    } else if (rpcErr) {
      console.log("[SEARCH] RPC non disponible, fallback requête directe:", rpcErr.message);
    }
  } catch {
    // RPC pas encore créée → fallback
  }

  // Fallback : si RPC n'a rien retourné, chercher directement (sender + subject)
  if (prospects.length === 0) {
    const { data: fallbackData } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, prospect_data, received_at, category, ai_score")
      .eq("user_id", userId)
      .eq("category", "LOCATION")
      .or(`sender.ilike.${like},subject.ilike.${like}`)
      .limit(10);

    prospects = fallbackData ?? [];
  }

  // Normaliser le nom prospect pour l'affichage (RPC retourne prospect_name, requête directe retourne prospect_data)
  const normalizedProspects = prospects.map((p: any) => ({
    ...p,
    prospect_name: p.prospect_name ?? p.prospect_data?.nom_prenom ?? p.prospect_data?.nom ?? null,
    etape: p.etape ?? p.prospect_data?.etape_process ?? null,
  }));

  // Emails non-LOCATION + Biens en parallèle
  const [emailsRes, biensRes] = await Promise.all([
    supabaseAdmin
      .from("emails")
      .select("id, sender, subject, received_at, category")
      .eq("user_id", userId)
      .or(`subject.ilike.${like},sender.ilike.${like}`)
      .neq("category", "LOCATION")
      .limit(5),

    supabaseAdmin
      .from("properties")
      .select("id, title, address, rent, type, available")
      .eq("user_id", userId)
      .or(`title.ilike.${like},address.ilike.${like}`)
      .limit(5),
  ]);

  return NextResponse.json({
    prospects: normalizedProspects.slice(0, 10),
    emails: emailsRes.data ?? [],
    biens: biensRes.data ?? [],
  });
}
