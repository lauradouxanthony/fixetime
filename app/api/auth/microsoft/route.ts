import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/auth/login`
    );
  }

  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/microsoft/callback`;

  if (!redirectUri) {
    return new NextResponse("Missing MICROSOFT_REDIRECT_URI", { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    // scopes: mail + calendar + offline_access (refresh token)
    scope: [
      "offline_access",
      "User.Read",
      "Mail.Read",
      "Mail.ReadWrite",
      "Calendars.Read",
    ].join(" "),    
        prompt: "consent",
    state: data.user.id,
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  );
}
