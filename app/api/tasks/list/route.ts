import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, user_id, title, priority, due_at, estimated_minutes, status, created_at, email_id, related_email_id, related_event_id, source"
      )
      .eq("user_id", user.id)
      .in("status", ["open"]) // widget = tâches actives
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("TASKS_LIST_ERROR", error);
      return NextResponse.json({ error: "TASKS_LIST_FAILED" }, { status: 500 });
    }

    return NextResponse.json({ tasks: data ?? [] });
  } catch (e) {
    console.error("TASKS_LIST_FATAL", e);
    return NextResponse.json({ error: "TASKS_LIST_FATAL" }, { status: 500 });
  }
}
