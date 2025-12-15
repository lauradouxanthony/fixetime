// app/api/auth/google/callback/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

export async function GET(request: NextRequest) {
  const supabase = supabaseServer();

  // Récupérer l'utilisateur Supabase
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const userId = authData.user.id;

  // Récupérer le code Google OAuth
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    console.error("Google OAuth error:", errorParam);
    return NextResponse.redirect(new URL("/home?google_error=oauth", request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/home?google_error=no_code", request.url));
  }

  try {
    // 1) Échanger le code → tokens Google
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("TOKEN_ERROR:", await tokenRes.text());
      return NextResponse.redirect(new URL("/home?google_error=token", request.url));
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token ?? null;
    const expiresIn = tokenJson.expires_in;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    if (!accessToken) {
      return NextResponse.redirect(new URL("/home?google_error=bad_token", request.url));
    }

    // 2) Récupérer l'email Google
    const userinfoRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userinfoRes.ok) {
      console.error("USERINFO_ERROR:", await userinfoRes.text());
      return NextResponse.redirect(new URL("/home?google_error=userinfo", request.url));
    }

    const userinfo = await userinfoRes.json();
    const googleEmail = userinfo.email;

    if (!googleEmail) {
      return NextResponse.redirect(new URL("/home?google_error=no_email", request.url));
    }

    // 3) Enregistrer le token dans Supabase (gmail_tokens)
    const { error: upsertError } = await supabase
      .from("gmail_tokens")
      .upsert(
        {
          user_id: userId,
          user_email: googleEmail,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("DB_ERROR:", upsertError);
      return NextResponse.redirect(new URL("/home?google_error=db", request.url));
    }

    // 4) 🚀 SYNCHRONISATION AUTOMATIQUE APRÈS CONNEXION GOOGLE
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        await fetch(new URL("/api/sync/all", request.url).toString(), {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
      }
    } catch (err) {
      console.error("AUTO_SYNC_FAILED:", err);
    }

    // 5) Redirection finale → Home
    return NextResponse.redirect(new URL("/home?google_connected=1", request.url));
  } catch (err) {
    console.error("UNEXPECTED_OAUTH_ERROR:", err);
    return NextResponse.redirect(new URL("/home?google_error=unknown", request.url));
  }
}
