import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";

type SendEmailArgs = {
  to: string;
  subject: string;
  text: string;
  threadId?: string | null; // ✅ IMPORTANT
};


function base64UrlEncode(str: string) {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sendGmailEmail(userId: string, args: SendEmailArgs) {
  const accessToken = await getValidGoogleAccessToken(userId);

  // RFC822 raw
  const rawMessage = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    args.text,
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw: base64UrlEncode(rawMessage),
      ...(args.threadId ? { threadId: args.threadId } : {}),
    }),
        cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    console.error("GMAIL_SEND_ERROR", res.status, json);
    throw new Error("GMAIL_SEND_FAILED");
  }

  const messageId = json?.id ?? null;
  if (messageId) console.log("GMAIL_SEND_OK", { id: messageId });
  return { id: messageId, messageId, ...json };
}
