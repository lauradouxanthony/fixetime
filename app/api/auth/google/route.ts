import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  // user pas connecté => retour login
  if (!data.user) {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    return NextResponse.redirect(`${site}/auth/login`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!siteUrl) {
    return NextResponse.json(
      { error: "MISSING_NEXT_PUBLIC_SITE_URL" },
      { status: 500 }
    );
  }
  if (!clientId) {
    return NextResponse.json(
      { error: "MISSING_GOOGLE_CLIENT_ID" },
      { status: 500 }
    );
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? `${siteUrl}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    state: data.user.id,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
