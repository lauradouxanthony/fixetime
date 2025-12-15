// lib/googleClient.ts
import { google, gmail_v1 } from "googleapis";

/**
 * Crée un client Gmail authentifié avec un access token.
 */
export function getGmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  return google.gmail({ version: "v1", auth });
}

/**
 * Récupère la liste des derniers messages Gmail pour l'utilisateur "me".
 */
export async function listMessages(
  gmail: gmail_v1.Gmail,
  maxResults: number = 20
) {
  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults,
  });

  return res.data.messages || [];
}

/**
 * Récupère un message Gmail complet (headers + corps décodé).
 */
export async function getMessageDetails(
  gmail: gmail_v1.Gmail,
  messageId: string
) {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = res.data.payload;
  const headers = payload?.headers || [];

  function header(name: string): string {
    return (
      headers.find(
        (h: gmail_v1.Schema$MessagePartHeader) =>
          h.name?.toLowerCase() === name.toLowerCase()
      )?.value || ""
    );
  }

  // Decode body (texte brut ou HTML)
  let body = "";

  if (payload?.parts && payload.parts.length > 0) {
    // On parcourt toutes les "parts" pour trouver du texte
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        body = Buffer.from(part.body.data, "base64").toString("utf-8");
        break;
      }
      if (part.mimeType === "text/html" && part.body?.data && !body) {
        body = Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }
  } else if (payload?.body?.data) {
    body = Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  return {
    gmail_id: messageId,
    sender: header("From"),
    subject: header("Subject"),
    received_at: header("Date"),
    body,
  };
}
