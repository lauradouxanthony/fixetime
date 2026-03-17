import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    // 1) Récupération des paramètres Google
    const code = req.nextUrl.searchParams.get("code");
    const userId = req.nextUrl.searchParams.get("state"); // user_id Supabase

    console.log("[GOOGLE_CALLBACK] CALLBACK_START", {
      hasCode: !!code,
      hasUserId: !!userId,
    });

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
      console.error("[GOOGLE_CALLBACK] TOKEN_EXCHANGE_ERROR", {
        status: tokenRes.status,
        body: tokenData,
      });
      return NextResponse.json(
        { error: "GOOGLE_TOKEN_ERROR", details: tokenData },
        { status: 400 }
      );
    }

    console.log("[GOOGLE_CALLBACK] TOKEN_EXCHANGE_OK", {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    });

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
      console.error("[GOOGLE_CALLBACK] NO_GOOGLE_EMAIL", {
        userInfo,
      });
      return NextResponse.json(
        { error: "NO_GOOGLE_EMAIL" },
        { status: 400 }
      );
    }

    // 4) UPSERT DANS gmail_tokens (COLONNES RÉELLES)
    //    - Ne pas écraser un refresh_token existant si Google n'en renvoie pas
    const { data: existing } = await supabaseAdmin
      .from("gmail_tokens")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();

    const effectiveRefreshToken =
      tokenData.refresh_token ?? existing?.refresh_token ?? null;

    const expiresAt =
      typeof tokenData.expires_in === "number"
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null;

    try {
      const { error: upsertError } = await supabaseAdmin
        .from("gmail_tokens")
        .upsert(
          {
            user_id: userId,
            user_email: userInfo.email,
            access_token: tokenData.access_token,
            refresh_token: effectiveRefreshToken,
            expires_at: expiresAt,
            last_history_id: null, // TRES IMPORTANT
            needs_reconnect: false,
          },
          { onConflict: "user_id" }
        );

      if (upsertError) {
        console.error("[GOOGLE_CALLBACK] DB_UPSERT_ERR", {
          userId,
          error: upsertError.message,
          code: upsertError.code,
        });
        return NextResponse.json(
          { error: "DB_UPSERT_ERR", details: upsertError.message },
          { status: 500 }
        );
      }

      console.log("[GOOGLE_CALLBACK] DB_UPSERT_OK", {
        userId,
        hasRefreshToken: !!effectiveRefreshToken,
      });
    } catch (e: any) {
      console.error("[GOOGLE_CALLBACK] DB_UPSERT_FATAL", {
        userId,
        message: e?.message,
      });
      return NextResponse.json(
        { error: "DB_UPSERT_FATAL", details: e?.message ?? String(e) },
        { status: 500 }
      );
    }

    // 5) Redirection vers onboarding : la page verra le token et redirigera vers /home
    //    (évite une race où le layout (app) ne verrait pas encore le token)
    return NextResponse.redirect(
      new URL("/onboarding", process.env.NEXT_PUBLIC_SITE_URL)
    );
  } catch (error) {
    console.error("GOOGLE_CALLBACK_ERROR:", error);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
