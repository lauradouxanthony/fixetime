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
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/google/callback`;

  if (!redirectUri) {
    return new NextResponse("Missing GOOGLE_REDIRECT_URI", { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
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

