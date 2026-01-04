import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

async function refreshGoogleAccessToken(userId: string) {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("user_id, refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!tokenRow?.refresh_token) {
    throw new Error("NO_REFRESH_TOKEN");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(`GOOGLE_REFRESH_ERROR: ${JSON.stringify(json)}`);
  }

  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();

  await supabaseAdmin
    .from("gmail_tokens")
    .update({
      access_token: json.access_token,
      expires_at: expiresAt,
    })
    .eq("user_id", userId);

  return json.access_token as string;
}

export async function getValidGoogleAccessToken(userId: string) {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("user_id, access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle<TokenRow>();

  if (error) throw error;
  if (!tokenRow?.access_token) throw new Error("NO_GOOGLE_TOKEN");

  // marge de 60s
  const expiresAtMs = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  const stillValid = expiresAtMs && expiresAtMs > Date.now() + 60_000;

  if (stillValid) return tokenRow.access_token;

  // expiré -> refresh + save
  return refreshGoogleAccessToken(userId);
}
