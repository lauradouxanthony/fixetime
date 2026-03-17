import { supabaseAdmin } from "../supabaseAdmin";

type TokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export async function getValidMicrosoftAccessToken(userId: string): Promise<string> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("microsoft_tokens")
    .select("user_id, access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !tokenRow?.access_token) {
    throw new Error("NO_MICROSOFT_TOKEN");
  }

  const row = tokenRow as TokenRow;
  const expiresAtMs = new Date(row.expires_at ?? 0).getTime();
  const isExpired = Date.now() > expiresAtMs - 60_000;

  if (!isExpired) return row.access_token;

  if (!row.refresh_token) {
    throw new Error("NO_MICROSOFT_REFRESH_TOKEN");
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_OAUTH_MISSING_CREDENTIALS");
  }

  const tokenRes = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: row.refresh_token,
        scope: [
          "offline_access",
          "User.Read",
          "Mail.Read",
          "Mail.ReadWrite",
          "Calendars.Read",
        ].join(" "),
      }),
    }
  );

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenRes.ok) {
    throw new Error("MICROSOFT_REFRESH_FAILED");
  }

  const newAccess = tokenData.access_token as string;
  const newRefresh = tokenData.refresh_token ?? row.refresh_token;
  const newExpiresAt = new Date(
    Date.now() + (tokenData.expires_in ?? 3600) * 1000
  ).toISOString();

  await supabaseAdmin
    .from("microsoft_tokens")
    .update({
      access_token: newAccess,
      refresh_token: newRefresh,
      expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return newAccess;
}
