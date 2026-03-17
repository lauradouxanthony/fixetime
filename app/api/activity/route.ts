import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ActivityLogRow } from "@/types/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "NO_USER" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(
    Math.max(1, parseInt(limitParam ?? "20", 10) || 20),
    50
  );
  const cursor = url.searchParams.get("cursor") ?? null;

  let query = supabaseAdmin
    .from("activity_log")
    .select("id, user_id, created_at, actor, type, title, email_id, lead_id, meta")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: "FEED_FETCH_FAILED" }, { status: 500 });
  }

  const list = (rows ?? []) as ActivityLogRow[];
  const hasMore = list.length > limit;
  const items = hasMore ? list.slice(0, limit) : list;
  const nextCursor =
    hasMore && items.length > 0
      ? items[items.length - 1].created_at
      : null;

  return NextResponse.json({
    items,
    nextCursor,
  });
}
