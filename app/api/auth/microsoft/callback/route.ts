import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code");
    const userId = req.nextUrl.searchParams.get("state"); // user_id Supabase

    if (!code || !userId) {
      return NextResponse.json(
        { error: "NO_CODE_OR_USER_ID" },
        { status: 400 }
      );
    }

    const redirectUri =
      process.env.MICROSOFT_REDIRECT_URI ??
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/microsoft/callback`;

    const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";

    // Échange code → tokens Microsoft
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code,
        }),
      }
    );

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("[MICROSOFT CALLBACK] Token error:", tokenData);
      return NextResponse.json(
        { error: "MICROSOFT_TOKEN_ERROR", details: tokenData },
        { status: 400 }
      );
    }

    // Récupération de l'email Microsoft
    const userInfoRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userInfo = await userInfoRes.json();

    if (!userInfo?.mail && !userInfo?.userPrincipalName) {
      return NextResponse.json({ error: "NO_MICROSOFT_EMAIL" }, { status: 400 });
    }

    const userEmail = userInfo.mail ?? userInfo.userPrincipalName;

    // Upsert dans gmail_tokens avec provider=microsoft
    // (réutilise la même table pour la compatibilité avec le reste de l'app)
    await supabaseAdmin.from("gmail_tokens").upsert(
      {
        user_id: userId,
        user_email: userEmail,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(
          Date.now() + (tokenData.expires_in ?? 3600) * 1000
        ).toISOString(),
        last_history_id: null,
      },
      { onConflict: "user_id" }
    );

    // Vérifier si l'onboarding est terminé → redirect intelligent
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

    const redirectPath = onboardingDone
      ? "/home"
      : "/onboarding?step=3&provider=outlook";

    return NextResponse.redirect(
      new URL(redirectPath, process.env.NEXT_PUBLIC_SITE_URL)
    );
  } catch (error) {
    console.error("[MICROSOFT CALLBACK] Error:", error);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
