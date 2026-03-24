import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "NOT_AUTH" }, { status: 401 });
  }

  // crée ou relance le job
  await supabaseAdmin
    .from("analyze_jobs")
    .upsert({
      user_id: user.id,
      status: "running",
      started_at: new Date().toISOString(),
    });

  return NextResponse.json({ success: true });
}
