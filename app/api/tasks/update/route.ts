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
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);

    const taskId = body?.taskId as string | undefined;
    if (!taskId) {
      return NextResponse.json({ error: "MISSING_TASK_ID" }, { status: 400 });
    }

    const updates: any = {};

    // champs autorisés
    if (body.status !== undefined) updates.status = body.status;
    if (body.due_at !== undefined) updates.due_at = body.due_at;
    if (body.estimated_minutes !== undefined) updates.estimated_minutes = body.estimated_minutes;
    if (body.related_event_id !== undefined) updates.related_event_id = body.related_event_id;
    if (body.related_email_id !== undefined) updates.related_email_id = body.related_email_id;

    // sécurité : on force le user_id en WHERE
    const { error } = await supabaseAdmin
      .from("tasks")
      .update(updates)
      .eq("id", taskId)
      .eq("user_id", user.id);

    if (error) {
      console.error("TASK_UPDATE_ERROR", error);
      return NextResponse.json({ error: "TASK_UPDATE_FAILED" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("TASK_UPDATE_FATAL", e);
    return NextResponse.json({ error: "TASK_UPDATE_FATAL" }, { status: 500 });
  }
}
