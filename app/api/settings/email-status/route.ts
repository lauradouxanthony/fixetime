import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function detectProvider(email: string): "gmail" | "outlook" {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  return "outlook";
}

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { data: tokenRow } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_email, expires_at, refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json({ connected: false });
    }

    const isExpired = new Date(tokenRow.expires_at) < new Date();
    const isRevoked = isExpired && !tokenRow.refresh_token;
    const provider = detectProvider(tokenRow.user_email ?? "");

    return NextResponse.json({
      connected: true,
      provider,
      email: tokenRow.user_email,
      revoked: isRevoked,
    });
  } catch (e) {
    console.error("[EMAIL STATUS]", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
