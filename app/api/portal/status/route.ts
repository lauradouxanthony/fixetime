import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const emailId = req.nextUrl.searchParams.get("emailId");
    if (!emailId)
      return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });

    const { data } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("token, expires_at, last_sent_at")
      .eq("email_id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!data) {
      return NextResponse.json({ hasToken: false });
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

    return NextResponse.json({
      hasToken: true,
      token: data.token,
      portalUrl: `${baseUrl}/portal/${data.token}`,
      lastSentAt: data.last_sent_at,
      expiresAt: data.expires_at,
    });
  } catch (e) {
    console.error("[PORTAL STATUS]", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
