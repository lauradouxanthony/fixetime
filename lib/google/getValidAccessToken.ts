import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";

const TOKEN_REFRESH_TIMEOUT_MS = 12000;

// Ces variables doivent être définies côté serveur (non NEXT_PUBLIC)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

type TokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};
function isGoogleRevokedToken(json: any) {
  const err = json?.error;
  const desc = String(json?.error_description || "").toLowerCase();

  // Google renvoie souvent invalid_grant quand le refresh token est révoqué/expiré
  return err === "invalid_grant" || desc.includes("revoked") || desc.includes("expired");
}

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

  // Vérification stricte des credentials OAuth avant d'appeler Google
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error("[GOOGLE OAUTH] Missing client credentials", {
      hasClientId: !!GOOGLE_CLIENT_ID,
      hasClientSecret: !!GOOGLE_CLIENT_SECRET,
      envKeysHint: Object.keys(process.env)
        .filter((k) => k.includes("GOOGLE"))
        .slice(0, 30),
    });
    throw new Error("GOOGLE_OAUTH_MISSING_CLIENT_CREDENTIALS");
  }

  // Log non-sensible sur l'état du refresh token
  console.log("GOOGLE_REFRESH_TOKEN_STATE", {
    user_id: userId,
    has_refresh_token: !!tokenRow.refresh_token,
    refresh_token_length:
      typeof tokenRow.refresh_token === "string" ? tokenRow.refresh_token.length : 0,
  });

  const res = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
      }),
    },
    TOKEN_REFRESH_TIMEOUT_MS
  );

  const json = await res.json();

  if (!res.ok) {
    // Instrumentation OAuth: log le corps complet et le status
    console.error("GOOGLE_OAUTH_REFRESH_ERROR", {
      user_id: userId,
      oauth_status: res.status,
      oauth_error: json,
      oauth_url: "https://oauth2.googleapis.com/token",
    });

    if (isGoogleRevokedToken(json)) {
      // Token révoqué/expiré : marquer le compte comme nécessitant une reconnexion
      await supabaseAdmin
        .from("gmail_tokens")
        .update({ needs_reconnect: true })
        .eq("user_id", userId);
      // Erreur stable qu'on gérera proprement dans les routes appelantes
      throw new Error("GOOGLE_TOKEN_REVOKED");
    }
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

  // Instrumentation non-sensible de l'état du token
  const hasRefreshToken = !!tokenRow.refresh_token;
  const refreshTokenLength =
    typeof tokenRow.refresh_token === "string" ? tokenRow.refresh_token.length : 0;
  const hasAccessToken = !!tokenRow.access_token;
  console.log("GOOGLE_TOKEN_STATE", {
    user_id: userId,
    has_refresh_token: hasRefreshToken,
    refresh_token_length: refreshTokenLength,
    has_access_token: hasAccessToken,
    token_expires_at: tokenRow.expires_at,
  });

  // marge de 60s
  const expiresAtMs = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  const stillValid = expiresAtMs && expiresAtMs > Date.now() + 60_000;

  if (stillValid) return tokenRow.access_token;

  // expiré -> refresh + save
  return refreshGoogleAccessToken(userId);
}
