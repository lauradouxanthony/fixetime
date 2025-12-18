import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json(
      { error: "NO_USER_ID" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    user_id: data.user.id,
    email: data.user.email,
  });
}
