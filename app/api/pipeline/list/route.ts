import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { derivePipelineRow } from "@/lib/pipeline/derivePipelineRow";
import type { PipelineRow } from "@/lib/pipeline/derivePipelineRow";

export const runtime = "nodejs";

const SELECT_COLS =
  "id, provider, provider_message_id, open_url, gmail_message_id, gmail_thread_id, sender, subject, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply, lead_score, lead_status, lead_json, analyzed_at, property_id, candidate_name, monthly_income, employment_type, guarantor_present, income_ratio, lead_profile, lead_property_address, lead_missing_fields, lead_is_qualified, lead_last_action, lead_last_action_at";

function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function candidateNameForSearch(email: any): string {
  const name =
    email?.lead_profile?.prospect_name?.trim() || email?.candidate_name || "";
  const sender = (email?.sender || "").trim();
  const match = sender.match(/^([^<]+)</);
  const fromSender = match ? match[1].trim() : sender.split("@")[0] || "";
  return [name, fromSender, email?.subject || "", email?.sender || ""].filter(Boolean).join(" ");
}

function parseSenderName(sender: string | null | undefined): string | null {
  if (!sender) return null;
  const match = sender.match(/^([^<]+)</);
  return match ? match[1].trim() : null;
}

function parseSenderEmail(sender: string | null | undefined): string | null {
  if (!sender) return null;
  const match = sender.match(/<([^>]+)>/);
  return match?.[1] ? match[1].trim() : null;
}

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
    const period = (searchParams.get("period") as "today" | "7d" | "30d") || "7d";
    const search = searchParams.get("search")?.trim() || "";
    const intent = searchParams.get("intent") as "" | "LOCATION" | "INFORMATION" | null;
    const status = searchParams.get("status")?.trim() || "";

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
      .select(SELECT_COLS)
      .eq("user_id", user.id)
      .order("received_at", { ascending: false });

    if (fromDate) {
      query = query.gte("received_at", fromDate.toISOString());
    }
    query = query.limit(LIMIT);

    const { data: rawEmails, error } = await query;

    if (error) {
      console.error("PIPELINE_LIST_ERROR", error);
      return NextResponse.json({ error: "PIPELINE_LIST_FAILED" }, { status: 500 });
    }

    const emails = rawEmails ?? [];
    const rows: PipelineRow[] = emails.map((e: any) => derivePipelineRow(e));

    type Pair = { email: any; row: PipelineRow };
    let pairs: Pair[] = emails.map((e: any, i: number) => ({ email: e, row: rows[i] }));

    if (search) {
      const normQuery = normalizeForSearch(search);
      pairs = pairs.filter(({ email }) =>
        normalizeForSearch(candidateNameForSearch(email)).includes(normQuery)
      );
    }

    if (intent === "LOCATION" || intent === "INFORMATION") {
      pairs = pairs.filter(({ row }) => row.intent === intent);
    }

    if (status) {
      pairs = pairs.filter(({ row }) => row.lead_status === status);
    }

    pairs.sort((a, b) => {
      const ta = a.row.last_action_at ? new Date(a.row.last_action_at).getTime() : 0;
      const tb = b.row.last_action_at ? new Date(b.row.last_action_at).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return 0;
    });

    const PIPELINE_PAGE_SIZE = 100;
    const total = pairs.length;
    const sliced = pairs.slice(0, PIPELINE_PAGE_SIZE);
    const slicedRows = sliced.map((p) => p.row);
    const slicedEmailHeaders = sliced.map((p) => {
      const e = p.email;

      // --- Sender parsing ---
      const from_name = parseSenderName(e.sender);
      const from_email = parseSenderEmail(e.sender);
      const snippet: string | null = e.summary ?? null;

      // --- Safe lead_json access ---
      const lj =
        e.lead_json && typeof e.lead_json === "object"
          ? (e.lead_json as Record<string, unknown>)
          : null;
      const ljIntentRaw = lj?.intent as string | undefined;

      // --- Existing intent field (backward compat) ---
      const intent: string | null =
        e.decision === "ignorer"
          ? "IGNORED"
          : ljIntentRaw === "LOCATION_REQUEST"
          ? "LOCATION_REQUEST"
          : ljIntentRaw === "FAQ_QUESTION"
          ? "FAQ_QUESTION"
          : ljIntentRaw === "INFORMATION"
          ? "FAQ_QUESTION"
          : null;

      // --- ui_intent (canonical, handles all backend variants) ---
      const ui_intent: string | null =
        e.decision === "ignorer"
          ? "IGNORED"
          : ljIntentRaw === "LOCATION" || ljIntentRaw === "LOCATION_REQUEST"
          ? "LOCATION_REQUEST"
          : ljIntentRaw === "INFORMATION" || ljIntentRaw === "FAQ_QUESTION"
          ? "FAQ_QUESTION"
          : ljIntentRaw === "ADMIN"
          ? "ADMIN"
          : null;

      // --- ui_bucket ---
      const ui_bucket: "principal" | "ignored" =
        e.decision === "ignorer" ||
        ljIntentRaw === "ADMIN" ||
        ljIntentRaw === "IGNORED"
          ? "ignored"
          : "principal";

      // --- ui_status ---
      const ui_status: string | null =
        e.lead_status === "new_lead" || e.lead_status === "raw"
          ? "new"
          : e.lead_status === "qualifying"
          ? "qualifying"
          : e.lead_status === "slots_proposed"
          ? "slots_proposed"
          : e.lead_status === "booked"
          ? "confirmed"
          : e.lead_status === "unqualified"
          ? "rejected"
          : e.decision === "ignorer"
          ? "ignored"
          : null;

      // --- ui_panel ---
      const ui_panel: string =
        e.analyzed_at == null
          ? "unanalyzed"
          : ui_intent === "ADMIN" || ui_intent === "IGNORED"
          ? "out_of_scope"
          : ui_intent === "FAQ_QUESTION"
          ? "faq"
          : ui_intent === "LOCATION_REQUEST"
          ? "location"
          : "none";

      // --- ui_next_action ---
      let ui_next_action: string | null = null;
      if (ui_panel === "location") {
        const ljAnalysis =
          lj?.analysis && typeof lj.analysis === "object"
            ? (lj.analysis as Record<string, unknown>)
            : null;
        const detectedIncome = ljAnalysis?.detected_income ?? null;
        const monthlyIncome = lj?.monthly_income ?? null;
        const leadMissingFields = Array.isArray(e.lead_missing_fields)
          ? e.lead_missing_fields
          : [];
        if (detectedIncome == null && monthlyIncome == null) {
          ui_next_action = "ask_income";
        } else if (leadMissingFields.length > 0) {
          ui_next_action = "ask_documents";
        } else if (e.ai_reply == null) {
          ui_next_action = "generate_draft";
        } else if (
          e.lead_status === "slots_proposed" ||
          e.lead_status === "booked"
        ) {
          ui_next_action = "propose_slots";
        } else {
          ui_next_action = "generate_draft";
        }
      }

      return {
        id: e.id,
        provider: e.provider,
        provider_message_id: e.provider_message_id,
        open_url: e.open_url,
        gmail_message_id: e.gmail_message_id,
        gmail_thread_id: e.gmail_thread_id,
        sender: e.sender,
        from_name,
        from_email,
        subject: e.subject,
        summary: e.summary,
        snippet,
        received_at: e.received_at,
        lead_score: e.lead_score,
        lead_status: e.lead_status,
        lead_json: e.lead_json,
        analyzed_at: e.analyzed_at,
        recommended_action: e.recommended_action,
        decision: e.decision,
        intent,
        is_urgent: e.is_urgent,
        is_important: e.is_important,
        lead_last_action: e.lead_last_action,
        lead_last_action_at: e.lead_last_action_at,
        property_id: e.property_id,
        candidate_name: e.candidate_name,
        // Canonical UI contract
        ui_bucket,
        ui_intent,
        ui_status,
        ui_panel,
        ui_next_action,
      };
    });

    if (process.env.NODE_ENV === "development") {
      console.log("PIPELINE_LIST_PAYLOAD", { count: slicedEmailHeaders.length });
    }

    return NextResponse.json({
      ok: true,
      emails: slicedEmailHeaders,
      pipelineRows: slicedRows,
      total,
    });
  } catch (e) {
    console.error("PIPELINE_LIST_FATAL", e);
    return NextResponse.json({ error: "PIPELINE_LIST_FATAL" }, { status: 500 });
  }
}
