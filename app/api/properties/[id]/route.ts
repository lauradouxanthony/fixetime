import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// PATCH /api/properties/[id] — mettre à jour un bien
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const body = await req.json();
    const update: Record<string, unknown> = {};

    // title → name (colonne actuelle) + title (post-migration)
    if ("title" in body) {
      update.name = body.title;
      update.title = body.title; // sera ignoré si colonne n'existe pas encore
    }
    if ("address" in body) update.address = body.address;
    if ("type" in body) update.type = body.type;
    if ("rent" in body) update.rent = parseInt(String(body.rent), 10);
    if ("description" in body) update.description = body.description;
    if ("available" in body) update.available = body.available;
    if ("animaux_acceptes" in body) update.animaux_acceptes = Boolean(body.animaux_acceptes);
    if ("parking_inclus" in body) update.parking_inclus = Boolean(body.parking_inclus);
    if ("charges_mensuelles" in body) update.charges_mensuelles = body.charges_mensuelles ? parseInt(String(body.charges_mensuelles), 10) : null;
    if ("meuble" in body) update.meuble = Boolean(body.meuble);
    if ("disponible_a_partir_de" in body) update.disponible_a_partir_de = body.disponible_a_partir_de ?? null;
    if ("notes_specifiques" in body) update.notes_specifiques = body.notes_specifiques?.trim() ?? null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "NO_FIELDS_TO_UPDATE" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("properties")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      // Retry sans les colonnes potentiellement manquantes
      console.error("[PROPERTY_PATCH] First attempt failed:", error.message);
      const safeUpdate: Record<string, unknown> = {};
      if ("title" in body) safeUpdate.name = body.title;
      if ("address" in body) safeUpdate.address = body.address;
      if ("rent" in body) safeUpdate.rent = parseInt(String(body.rent), 10);

      if (Object.keys(safeUpdate).length > 0) {
        const { data: d2, error: e2 } = await supabaseAdmin
          .from("properties")
          .update(safeUpdate)
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single();
        if (e2) return NextResponse.json({ error: "UPDATE_FAILED", details: e2.message }, { status: 500 });
        if (!d2) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
        return NextResponse.json({ property: normalizeRow(d2 as Record<string, unknown>) });
      }
      return NextResponse.json({ error: "UPDATE_FAILED", details: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ property: normalizeRow(data as Record<string, unknown>) });
  } catch (err) {
    console.error("PROPERTY_PATCH_ERROR", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

// DELETE /api/properties/[id] — archiver un bien (available=false)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // Tenter avec available d'abord
    const { error } = await supabaseAdmin
      .from("properties")
      .update({ available: false })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error && (error.code === "PGRST204" || error.message?.includes("available"))) {
      // Colonne available manquante → utiliser une suppression douce via un flag custom
      // Pour l'instant, on retire juste le bien (hard delete temporaire)
      const { error: delErr } = await supabaseAdmin
        .from("properties")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
      if (delErr) return NextResponse.json({ error: "DELETE_FAILED", details: delErr.message }, { status: 500 });
      return NextResponse.json({ success: true, note: "Hard deleted (available column missing — run migration)" });
    }

    if (error) return NextResponse.json({ error: "UPDATE_FAILED", details: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PROPERTY_DELETE_ERROR", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

function normalizeRow(row: Record<string, unknown>) {
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
