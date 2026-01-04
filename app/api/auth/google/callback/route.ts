import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    // 1) Récupération des paramètres Google
    const code = req.nextUrl.searchParams.get("code");
    const userId = req.nextUrl.searchParams.get("state"); // user_id Supabase

    if (!code || !userId) {
      return NextResponse.json(
        { error: "NO_CODE_OR_USER_ID" },
        { status: 400 }
      );
    }

    // 2) Échange code → tokens Google
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
        code,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: "GOOGLE_TOKEN_ERROR", details: tokenData },
        { status: 400 }
      );
    }

    // 3) Récupération de l’email Google
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    const userInfo = await userInfoRes.json();

    if (!userInfo?.email) {
      return NextResponse.json(
        { error: "NO_GOOGLE_EMAIL" },
        { status: 400 }
      );
    }

    // 4) UPSERT DANS gmail_tokens (COLONNES RÉELLES)
    await supabaseAdmin.from("gmail_tokens").upsert(
      {
        user_id: userId,
        user_email: userInfo.email,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(
          Date.now() + tokenData.expires_in * 1000
        ).toISOString(),
        last_history_id: null, // 🔥 TRÈS IMPORTANT
      },
      { onConflict: "user_id" }
    );
    

    // 5) REDIRECTION FINALE
    return NextResponse.redirect(
      new URL("/home", process.env.NEXT_PUBLIC_SITE_URL)
    );
  } catch (error) {
    console.error("GOOGLE_CALLBACK_ERROR:", error);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
