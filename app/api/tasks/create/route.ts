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

    // ⬇️ NOUVEAU (optionnel)
    const start = body?.start as string | undefined;
    const end = body?.end as string | undefined;
// ⬇️ NOUVEAU — on accepte TOUTES les variantes
const estimatedFromClient =
  typeof body?.estimated_minutes === "number"
    ? body.estimated_minutes
    : typeof body?.estimatedMinutes === "number"
    ? body.estimatedMinutes
    : undefined;

    if (!title) {
      return NextResponse.json({ error: "MISSING_TITLE" }, { status: 400 });
    }

    // 🧠 Calcul SAFE de la durée réelle
    let estimated_minutes: number | null = null;

    if (typeof estimatedFromClient === "number" && estimatedFromClient > 0) {
      estimated_minutes = Math.round(estimatedFromClient);
    } else if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        const diffMs = endDate.getTime() - startDate.getTime();
        if (diffMs > 0) {
          estimated_minutes = Math.round(diffMs / 60000);
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from("tasks")
      .insert({
        user_id: user.id,
        email_id: emailId ?? null,
        title,
        status: "open",
        due_at: body?.dueAt ?? null,
        estimated_minutes,
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
