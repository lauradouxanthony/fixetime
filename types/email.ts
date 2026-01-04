export type EmailDecision = "traiter" | "planifier" | "ignorer" | null;

export type EmailAction = "reply" | "schedule" | "archive" | null;

export type Email = {
  id: string;
  gmail_message_id?: string | null;

  sender: string | null;
  subject: string | null;
  body?: string | null;
  received_at: string | null;

  summary?: string | null;
  classification_reason?: string | null;

  decision?: EmailDecision;
  estimated_time?: number | null;
  recommended_action?: EmailAction;

  category?: string | null;
  is_archived?: boolean | null;
  is_urgent?: boolean | null;
  is_important?: boolean | null;

  ai_reply?: string | null;
};
