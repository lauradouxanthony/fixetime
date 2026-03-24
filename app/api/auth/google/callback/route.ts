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

    // 3) Récupération de l'email Google
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

    // 4) UPSERT dans gmail_tokens
    await supabaseAdmin.from("gmail_tokens").upsert(
      {
        user_id: userId,
        user_email: userInfo.email,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(
          Date.now() + tokenData.expires_in * 1000
        ).toISOString(),
        last_history_id: null,
      },
      { onConflict: "user_id" }
    );

    // 5) Déclencher gmail/sync en arrière-plan (fire & forget)
    //    → On n'attend pas la réponse pour ne pas bloquer la redirection
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "http://localhost:3001";

    fetch(`${baseUrl}/api/gmail/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, mode: "quick" }),
      cache: "no-store",
    }).catch((err) => {
      console.error("[GOOGLE CALLBACK] Sync background error:", err);
    });

    console.log(`[GOOGLE CALLBACK] ✅ Token sauvegardé pour user=${userId} — sync lancé en background`);

    // 6) Vérifier si l'onboarding est terminé → redirect intelligent
    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("email_rules")
      .eq("user_id", userId)
      .maybeSingle();

    const emailRules =
      settingsRow?.email_rules && typeof settingsRow.email_rules === "object"
        ? (settingsRow.email_rules as Record<string, unknown>)
        : {};

    const onboardingDone = emailRules.ft_onboarding_done === true;

    // Si onboarding terminé → home (reconnexion Gmail depuis les settings)
    // Si onboarding en cours → retour step 3 avec provider=gmail
    const redirectPath = onboardingDone
      ? "/home"
      : "/onboarding?step=3&provider=gmail";

    return NextResponse.redirect(
      new URL(redirectPath, process.env.NEXT_PUBLIC_SITE_URL)
    );
  } catch (error) {
    console.error("GOOGLE_CALLBACK_ERROR:", error);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
