import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const supabase = await supabaseServer(); // ✅ IMPORTANT

    // 1) Vérifier user connecté
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      console.error("AUTH ERROR:", authError);
      return NextResponse.json(
        { error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const userId = authData.user.id;

    // 2) Vérifier token Google
    const { data: tokenRow, error: tokenError } = await supabase
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokenError || !tokenRow) {
      return NextResponse.json(
        { error: "NO_GOOGLE_TOKEN" },
        { status: 400 }
      );
    }

    // 3) Appels des anciennes routes
    const baseUrl = request.nextUrl.origin;

    const gmailSync = await fetch(`${baseUrl}/api/gmail/sync`);
    const calendarSync = await fetch(`${baseUrl}/api/calendar/sync`);

    const gmailJson = await gmailSync.json();
    const calendarJson = await calendarSync.json();

    return NextResponse.json({
      success: true,
      gmail: gmailJson,
      calendar: calendarJson,
    });
  } catch (err) {
    console.error("SYNC_ALL_ERROR:", err);
    return NextResponse.json(
      { error: "SYNC_ALL_FAILED" },
      { status: 500 }
    );
  }
}
