export type EmailDecision = "traiter" | "planifier" | "ignorer" | null;
export type EmailAction = "reply" | "schedule" | "archive" | null;

export type LeadStatus =
  | "raw"
  | "new_lead"
  | "qualifying"
  | "slots_proposed"
  | "booked"
  | "unqualified"
  | "other"
  | null;

export type LeadProfile = {
  prospect_name?: string | null;
  phone?: string | null;
  property_address?: string | null;
  monthly_income?: number | null;
  employment_status?: string | null;
  has_guarantor?: boolean | null;
} | null;

export type Email = {
  id: string;

  // Provider
  provider?: "google" | "microsoft" | string | null;
  provider_message_id?: string | null;
  open_url?: string | null;
  gmail_message_id?: string | null;

  // Raw email
  sender: string | null;
  subject: string | null;
  body?: string | null;
  received_at: string | null;

  // Legacy analysis (on garde, mais UI pipeline n’en dépend plus)
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

  // Lead layer (pipeline immo)
  lead_status?: LeadStatus;
  lead_score?: number | null;
  lead_profile?: LeadProfile;
  lead_property_address?: string | null;
  lead_missing_fields?: string[] | null;
  lead_is_qualified?: boolean | null;
  lead_last_action?: string | null;
  lead_last_action_at?: string | null;

    // ===== IMMO PIPELINE =====

    lead_json?: {
      raw_ai_output?: any;
      analysis?: any;
      next_action_logic?: string;
    } | null;
        property_id?: string | null;
  
    candidate_name?: string | null;
    monthly_income?: number | null;
    employment_type?: string | null;
    guarantor_present?: boolean | null;
    income_ratio?: number | null;
  
  
};
