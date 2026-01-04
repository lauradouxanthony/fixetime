import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type TimeEventType =
  | "email_analyzed"
  | "email_ignored"
  | "email_classified"
  | "ai_reply_generated"
  | "reply_planned";

const TIME_MAP: Record<TimeEventType, number> = {
  // lecture + tri automatique
  email_analyzed: 0.33,     // ~20s
  email_ignored: 0.5,       // ~30s
  email_classified: 0.5,    // ~30s

  // vraie valeur produit
  ai_reply_generated: 3,    // réponse prête = gros gain
  reply_planned: 2,         // planification (calendar/task)
};

export async function logTime(params: {
  userId: string;
  type: TimeEventType;
  emailId?: string | null;
}) {
  const minutes = TIME_MAP[params.type] ?? 0;
  if (minutes <= 0) return;

  await supabaseAdmin.from("time_events").insert({
    user_id: params.userId,
    email_id: params.emailId ?? null,
    event_type: params.type,
    minutes_saved: minutes,
  });
}
