export type ActivityLogRow = {
  id: string;
  user_id: string;
  created_at: string;
  actor: "ai" | "human" | "system";
  type: string;
  title: string;
  email_id: string | null;
  lead_id: string | null;
  meta: Record<string, unknown>;
};
