import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, title, due_at")
    .eq("user_id", user.id)
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: true })
    .limit(5);

  if (error) {
    console.error("FETCH_TASKS_ERROR", error);
    return NextResponse.json({ error: "FETCH_TASKS_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ tasks: data ?? [] });
}
