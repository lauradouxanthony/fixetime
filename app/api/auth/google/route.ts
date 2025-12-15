import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer(); // ✅ CORRECTION

  // Vérifier l'utilisateur connecté
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI!;
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!;

  const googleOAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleOAuthUrl.searchParams.set("client_id", clientId);
  googleOAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleOAuthUrl.searchParams.set("response_type", "code");
  googleOAuthUrl.searchParams.set(
    "scope",
    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly openid email"
  );
  googleOAuthUrl.searchParams.set("access_type", "offline");
  googleOAuthUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(googleOAuthUrl.toString());
}
