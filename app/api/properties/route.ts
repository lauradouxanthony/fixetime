import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// Colonnes actuellement présentes en DB (avant migration complète)
// name=title, type/description/available peuvent manquer → defaults
function normalize(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: (row.title ?? row.name ?? "") as string,
    address: (row.address ?? null) as string | null,
    type: (row.type ?? null) as string | null,
    rent: (row.rent ?? 0) as number,
    description: (row.description ?? null) as string | null,
    available: row.available !== undefined ? Boolean(row.available) : true,
    required_docs: (row.required_docs ?? []) as unknown[],
    created_at: row.created_at as string,
    animaux_acceptes: row.animaux_acceptes != null ? Boolean(row.animaux_acceptes) : false,
    parking_inclus: row.parking_inclus != null ? Boolean(row.parking_inclus) : false,
    charges_mensuelles: (row.charges_mensuelles ?? null) as number | null,
    meuble: row.meuble != null ? Boolean(row.meuble) : false,
    disponible_a_partir_de: (row.disponible_a_partir_de ?? null) as string | null,
    notes_specifiques: (row.notes_specifiques ?? null) as string | null,
  };
}

// GET /api/properties — liste des biens de l'utilisateur avec nb prospects
export async function GET() {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from("properties")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[PROPERTIES_GET]", error);
      return NextResponse.json({ error: "DB_ERROR", details: error.message }, { status: 500 });
    }

    const properties = (data ?? []).map(normalize);

    // Compter les prospects par bien (colonne property_id sur emails)
    // Tenter de récupérer les counts — graceful si colonne manquante
    let prospectCounts: Record<string, number> = {};
    try {
      const ids = properties.map((p) => p.id);
      if (ids.length > 0) {
        const { data: countData } = await supabaseAdmin
          .from("emails")
          .select("property_id")
          .in("property_id", ids)
          .eq("user_id", user.id)
          .eq("is_archived", false);

        for (const row of countData ?? []) {
          if (row.property_id) {
            prospectCounts[row.property_id] = (prospectCounts[row.property_id] ?? 0) + 1;
          }
        }
      }
    } catch { /* property_id column might not exist yet */ }

    const propertiesWithCount = properties.map((p) => ({
      ...p,
      prospect_count: prospectCounts[p.id as string] ?? 0,
    }));

    return NextResponse.json({ properties: propertiesWithCount });
  } catch (err) {
    console.error("PROPERTIES_GET_ERROR", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

// POST /api/properties — créer un nouveau bien
export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const body = await req.json();
    const { title, address, type, rent, description, available,
      animaux_acceptes, parking_inclus, charges_mensuelles, meuble, disponible_a_partir_de, notes_specifiques } = body;

    if (!title || !rent) {
      return NextResponse.json({ error: "TITLE_AND_RENT_REQUIRED" }, { status: 400 });
    }

    // Construire l'objet d'insertion en ne mettant que les colonnes qui existent
    // name = colonne actuelle (sera renommée title après migration)
    const insertData: Record<string, unknown> = {
      user_id: user.id,
      address: address?.trim() ?? null,
      rent: parseInt(String(rent), 10),
    };

    // title ou name selon ce qui est disponible
    // On tente d'abord title (post-migration), puis name (pre-migration)
    insertData.title = title.trim();
    insertData.name = title.trim(); // colonne actuelle en DB

    // Colonnes optionnelles (présentes après migration)
    if (type !== undefined) insertData.type = type ?? null;
    if (description !== undefined) insertData.description = description?.trim() ?? null;
    if (available !== undefined) insertData.available = available !== false;
    if (animaux_acceptes !== undefined) insertData.animaux_acceptes = Boolean(animaux_acceptes);
    if (parking_inclus !== undefined) insertData.parking_inclus = Boolean(parking_inclus);
    if (charges_mensuelles !== undefined) insertData.charges_mensuelles = charges_mensuelles ? parseInt(String(charges_mensuelles), 10) : null;
    if (meuble !== undefined) insertData.meuble = Boolean(meuble);
    if (disponible_a_partir_de !== undefined) insertData.disponible_a_partir_de = disponible_a_partir_de ?? null;
    if (notes_specifiques !== undefined) insertData.notes_specifiques = notes_specifiques?.trim() ?? null;

    const { data, error } = await supabaseAdmin
      .from("properties")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("[PROPERTIES_POST] INSERT FAILED:", error);
      // Si erreur colonne inconnue, retry avec seulement les colonnes de base
      if (error.code === "PGRST204" || error.message?.includes("column")) {
        const baseInsert = {
          user_id: user.id,
          name: title.trim(),
          address: address?.trim() ?? null,
          rent: parseInt(String(rent), 10),
        };
        const { data: d2, error: e2 } = await supabaseAdmin
          .from("properties")
          .insert(baseInsert)
          .select()
          .single();
        if (e2) return NextResponse.json({ error: "INSERT_FAILED", details: e2.message }, { status: 500 });
        return NextResponse.json({ property: normalize(d2 as Record<string, unknown>) }, { status: 201 });
      }
      return NextResponse.json({ error: "INSERT_FAILED", details: error.message }, { status: 500 });
    }
    return NextResponse.json({ property: normalize(data as Record<string, unknown>) }, { status: 201 });
  } catch (err) {
    console.error("PROPERTIES_POST_ERROR", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
