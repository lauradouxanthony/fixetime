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

  const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: [
      "offline_access",
      "Mail.ReadWrite",
      "Calendars.ReadWrite",
      "User.Read",
    ].join(" "),
    state: data.user.id,
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`
  );
}
