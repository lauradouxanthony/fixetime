// lib/google/getValidAccessToken.ts

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getValidGoogleAccessToken(userId: string) {
  // 1️⃣ Récupérer les tokens stockés
  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!tokenRow) {
    throw new Error("NO_GOOGLE_TOKEN");
  }

  const now = Date.now();
  const expiresAt = new Date(tokenRow.expires_at).getTime();

  // 2️⃣ Si le token est encore valide → on l’utilise
  if (expiresAt > now + 60_000) {
    return tokenRow.access_token;
  }

  // 3️⃣ Sinon → refresh du token
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshRes.ok) {
    throw new Error("GOOGLE_REFRESH_FAILED");
  }

  const refreshJson = await refreshRes.json();

  const newAccessToken = refreshJson.access_token;
  const expiresIn = refreshJson.expires_in; // en secondes

  const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // 4️⃣ Mise à jour en base
  await supabaseAdmin
    .from("gmail_tokens")
    .update({
      access_token: newAccessToken,
      expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return newAccessToken;
}
