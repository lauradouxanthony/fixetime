/**
 * GET /api/portal/status?emailId=[id]
 * Route authentifiée — vérifie si un token de portail valide existe pour cet email.
 * Utilisée par le ProspectDrawer pour afficher "Lien envoyé le [date]".
 *
 * Output : { hasToken: true, portalUrl, lastSentAt, expiresAt }
 *        | { hasToken: false }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const emailId = req.nextUrl.searchParams.get("emailId");
    if (!emailId) return NextResponse.json({ error: "EMAIL_ID_REQUIRED" }, { status: 400 });

    const { data: tokenRow } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("token, expires_at, last_sent_at")
      .eq("email_id", emailId)
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tokenRow) return NextResponse.json({ hasToken: false });

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
    return NextResponse.json({
      hasToken: true,
      portalUrl: `${siteUrl}/portal/${tokenRow.token}`,
      lastSentAt: tokenRow.last_sent_at ?? null,
      expiresAt: tokenRow.expires_at,
    });
  } catch (err) {
    console.error("[portal/status]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
