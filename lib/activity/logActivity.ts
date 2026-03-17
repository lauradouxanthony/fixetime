import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ActivityActor = "ai" | "human" | "system";

export type ActivityType =
  | "email_analyzed"
  | "lead_analyzed"
  | "lead_qualified"
  | "lead_unqualified"
  | "slots_generated"
  | "draft_created"
  | "email_sent"
  | "proposal_sent"
  | "booking_confirmed"
  | "visit_booked"
  | "email_archived"
  | "email_synced"
  | "sync_done"
  | "error";

export type LogActivityInput = {
  userId: string;
  actor?: ActivityActor;
  type: ActivityType | string;
  title: string;
  emailId?: string | null;
  leadId?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Insert dans activity_log via supabaseAdmin.
 * Ne jamais throw en prod pour ne pas casser analyze-inbox ni les routes appelantes.
 */
export async function logActivity(input: LogActivityInput): Promise<null> {
  try {
    if (!input.userId || typeof input.userId !== "string") {
      console.error("ACTIVITY_LOG_INVALID", "userId required");
      return null;
    }

    const actor: ActivityActor = input.actor ?? "system";

    const { error } = await supabaseAdmin.from("activity_log").insert({
      user_id: input.userId,
      actor,
      type: input.type,
      title: input.title,
      email_id: input.emailId ?? null,
      lead_id: input.leadId ?? null,
      meta: input.meta ?? {},
    });

    if (error) {
      console.error("ACTIVITY_LOG_FAILED", error);
      return null;
    }
    return null;
  } catch (e) {
    console.error("ACTIVITY_LOG_FATAL", e);
    return null;
  }
}
