import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

  const { data: rows, error } = await supabaseAdmin
    .from("activity_log")
    .select("id, created_at, actor, type, title, email_id, meta")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: "FEED_FETCH_FAILED" }, { status: 500 });

  return NextResponse.json({ items: rows ?? [] });
}
