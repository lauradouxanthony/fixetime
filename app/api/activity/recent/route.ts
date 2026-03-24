import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/activity/recent?limit=20 — 20 derniers événements pour le Live Feed. */
export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(5, parseInt(url.searchParams.get("limit") || "20", 10) || 20));

  const { data: rows, error } = await supabaseAdmin
    .from("activity_log")
    .select("id, created_at, actor, type, title, email_id, meta")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: "ACTIVITY_FETCH_FAILED" }, { status: 500 });

  return NextResponse.json({ items: rows ?? [] });
}
