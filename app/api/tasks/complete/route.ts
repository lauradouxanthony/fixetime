import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const taskId = body?.taskId as string | undefined;

    if (!taskId) {
      return NextResponse.json({ error: "MISSING_TASK_ID" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("tasks")
      .update({
        status: "done",
      })
      .eq("id", taskId)
      .eq("user_id", user.id);

    if (error) {
      console.error("TASK_COMPLETE_ERROR", error);
      return NextResponse.json({ error: "TASK_COMPLETE_FAILED" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("TASK_COMPLETE_FATAL", e);
    return NextResponse.json({ error: "TASK_COMPLETE_FATAL" }, { status: 500 });
  }
}
