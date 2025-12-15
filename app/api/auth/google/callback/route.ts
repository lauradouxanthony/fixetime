import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer(); // ✅ CORRECTION

  // Récupérer l'utilisateur Supabase
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const user = authData.user;

  // Récupérer le code de Google dans l'URL
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // Échanger le code contre les tokens Google
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });

  const tokenJson = await tokenRes.json();

  if (!tokenJson.access_token) {
    console.error("Google token exchange failed:", tokenJson);
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // Enregistrer dans Supabase
  await supabase.from("gmail_tokens").upsert({
    user_id: user.id,
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    user_email: user.email,
    expires_at: Math.floor(Date.now() / 1000) + tokenJson.expires_in,
  });

  // Redirection vers le dashboard
  return NextResponse.redirect(new URL("/home", request.url));
}
