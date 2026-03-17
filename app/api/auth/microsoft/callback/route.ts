import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code");
    const userId = req.nextUrl.searchParams.get("state");

    if (!code || !userId) {
      return NextResponse.json(
        { error: "NO_CODE_OR_USER_ID" },
        { status: 400 }
      );
    }

    const redirectUri =
      process.env.MICROSOFT_REDIRECT_URI ??
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/microsoft/callback`;

    // 1) Exchange code -> tokens (Microsoft)
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
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
      return NextResponse.json(
        { error: "MICROSOFT_TOKEN_ERROR", details: tokenData },
        { status: 400 }
      );
    }

    const accessToken = tokenData.access_token as string | undefined;
    if (!accessToken) {
      return NextResponse.json(
        { error: "NO_ACCESS_TOKEN" },
        { status: 400 }
      );
    }

    // 2) Get Microsoft user email
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const me = await meRes.json();

    const email =
      me?.mail ||
      me?.userPrincipalName ||
      null;

    if (!email) {
      return NextResponse.json(
        { error: "NO_MICROSOFT_EMAIL", details: me },
        { status: 400 }
      );
    }

    // 3) Upsert microsoft_tokens
    await supabaseAdmin.from("microsoft_tokens").upsert(
      {
        user_id: userId,
        user_email: email,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      },
      { onConflict: "user_id" }
    );

    // Redirection vers onboarding : la page verra le token et redirigera vers /home
    return NextResponse.redirect(
      new URL("/onboarding", process.env.NEXT_PUBLIC_SITE_URL)
    );
  } catch (error) {
    console.error("MICROSOFT_CALLBACK_ERROR:", error);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
