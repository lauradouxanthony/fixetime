import { graphFetch } from "@/lib/microsoft/graph";

type SendEmailArgs = {
  to: string;
  subject: string;
  text: string;
  replyToMessageId?: string | null; // ✅ IMPORTANT
};


export async function sendOutlookEmail(userId: string, args: SendEmailArgs) {
  // ✅ Si replyToMessageId est fourni : on répond dans le thread Outlook
  if (args.replyToMessageId) {
    const res = await graphFetch(
      userId,
      `https://graph.microsoft.com/v1.0/me/messages/${args.replyToMessageId}/reply`,
      {
        method: "POST",
        body: JSON.stringify({
          comment: args.text,
        }),
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("OUTLOOK_REPLY_ERROR", res.status, txt);
      throw new Error("OUTLOOK_REPLY_FAILED");
    }
    const data = await res.json().catch(() => null);
    const messageId = data?.id ?? null;
    if (messageId) console.log("OUTLOOK_REPLY_OK", { id: messageId });
    return { ok: true, status: res.status, mode: "reply", id: messageId, messageId };
  }

  // ✅ fallback : envoi classique
  const res = await graphFetch(userId, "https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: args.subject,
        body: { contentType: "Text", content: args.text },
        toRecipients: [{ emailAddress: { address: args.to } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("OUTLOOK_SEND_ERROR", res.status, txt);
    throw new Error("OUTLOOK_SEND_FAILED");
  }
  const data = await res.json().catch(() => null);
  const messageId = data?.id ?? null;
  if (messageId) console.log("OUTLOOK_SEND_OK", { id: messageId });
  return { ok: true, status: res.status, mode: "sendMail", id: messageId, messageId };
}
