import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * GET /api/emails/get?id=...
 * Récupère un seul email par id (Supabase emails.id) pour le user connecté.
 * Utilisé par le panel pour re-fetch après generate-reply / generate-slots / send-draft.
 */
export async function GET(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "NO_USER" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id || id.trim() === "") {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select(
        "id, provider, provider_message_id, open_url, gmail_message_id, gmail_thread_id, sender, subject, body, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply, lead_score, lead_status, lead_json, property_id, candidate_name, monthly_income, employment_type, guarantor_present, income_ratio, lead_profile, lead_property_address, lead_missing_fields, lead_is_qualified, lead_last_action, lead_last_action_at"
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("EMAIL_GET_ERROR", { id, error: error.message });
      return NextResponse.json({ ok: false, error: "EMAIL_GET_FAILED" }, { status: 500 });
    }

    if (!email) {
      return NextResponse.json({ ok: false, error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, email });
  } catch (e: any) {
    console.error("EMAIL_GET_FATAL", e?.message ?? e);
    return NextResponse.json({ ok: false, error: "EMAIL_GET_FATAL" }, { status: 500 });
  }
}
