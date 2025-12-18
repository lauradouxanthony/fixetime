import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.json(null, { status: 401 });
  }

  return NextResponse.json({
    id: data.user.id,
    email: data.user.email,
  });
}
