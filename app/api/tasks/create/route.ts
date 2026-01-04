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

    const title = (body?.title as string | undefined)?.trim();
    const emailId = body?.emailId as string | undefined;
    const dueAt = body?.dueAt as string | undefined;

    if (!title) {
      return NextResponse.json({ error: "MISSING_TITLE" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
    .from("tasks")
    .insert({
      user_id: user.id,
      email_id: emailId ?? null,
      title,
      due_at: dueAt ?? null,
      status: "open",
    })
    .select("id")
    .single();

    if (error) {
      console.error("TASK_CREATE_ERROR", error);
      return NextResponse.json({ error: "TASK_CREATE_ERROR" }, { status: 500 });
    }

    return NextResponse.json({ success: true, taskId: data.id });
  } catch (e) {
    console.error("TASK_CREATE_FATAL", e);
    return NextResponse.json({ error: "TASK_CREATE_FAILED" }, { status: 500 });
  }
}
