import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const GOOGLE_OAUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export async function GET(request: NextRequest) {
  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  // Si l'utilisateur n'est pas connecté, on le renvoie vers le login
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: scopes.join(" "),
    include_granted_scopes: "true",
  });

  const url = `${GOOGLE_OAUTH_ENDPOINT}?${params.toString()}`;

  return NextResponse.redirect(url);
}
