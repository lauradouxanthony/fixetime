import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NO_USER" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") as "today" | "7d" | "30d" | null;

    const now = new Date();
    let fromDate: Date | null = null;

    if (period === "today") {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
    } else if (period === "7d") {
      fromDate = new Date();
      fromDate.setDate(now.getDate() - 7);
    } else if (period === "30d") {
      fromDate = new Date();
      fromDate.setDate(now.getDate() - 30);
    }

    const LIMIT = 200;
    let query = supabaseAdmin
      .from("emails")
      .select(
        "id, provider, provider_message_id, open_url, gmail_message_id, sender, subject, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply, lead_score, lead_status, lead_json, property_id, candidate_name, monthly_income, employment_type, guarantor_present, income_ratio, lead_profile, lead_property_address, lead_missing_fields, lead_is_qualified, lead_last_action, lead_last_action_at"
      )
      .eq("user_id", user.id)
      .order("received_at", { ascending: false });

    if (fromDate) {
      query = query.gte("received_at", fromDate.toISOString());
    }
    query = query.limit(LIMIT);

    const { data, error } = await query;

    if (error) {
      console.error("EMAILS_LIST_ERROR", error);
      return NextResponse.json({ error: "EMAILS_LIST_FAILED" }, { status: 500 });
    }

    // Compter les emails non analysés
    let remainingQuery = supabaseAdmin
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .or("decision.is.null,decision.eq.,lead_json.is.null");

    if (fromDate) {
      remainingQuery = remainingQuery.gte("received_at", fromDate.toISOString());
    }

    const { count: remaining } = await remainingQuery;

    return NextResponse.json({
      emails: data ?? [],
      remaining: remaining ?? 0,
    });
  } catch (e) {
    console.error("EMAILS_LIST_FATAL", e);
    return NextResponse.json({ error: "EMAILS_LIST_FATAL" }, { status: 500 });
  }
}
