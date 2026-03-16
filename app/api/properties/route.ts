import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// GET /api/properties — liste des biens de l'utilisateur
export async function GET() {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from("properties")
      .select("id, title, address, type, rent, description, available, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
    return NextResponse.json({ properties: data ?? [] });
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
    const { title, address, type, rent, description, available } = body;

    if (!title || !rent) {
      return NextResponse.json({ error: "TITLE_AND_RENT_REQUIRED" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("properties")
      .insert({
        user_id: user.id,
        title: title.trim(),
        address: address?.trim() ?? null,
        type: type ?? null,
        rent: parseInt(String(rent), 10),
        description: description?.trim() ?? null,
        available: available !== false,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: "INSERT_FAILED" }, { status: 500 });
    return NextResponse.json({ property: data }, { status: 201 });
  } catch (err) {
    console.error("PROPERTIES_POST_ERROR", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
