import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { derivePipelineRow } from "@/lib/pipeline/derivePipelineRow";
import type { PipelineRow } from "@/lib/pipeline/derivePipelineRow";
import { ETAPE_PROCESS_META, LEGACY_STATUS_TO_ETAPE, type EtapeProcess } from "@/lib/pipeline/constants";

export const runtime = "nodejs";

const SELECT_COLS =
  "id, provider, provider_message_id, open_url, gmail_message_id, gmail_thread_id, sender, subject, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply, lead_score, lead_status, lead_json, analyzed_at, property_id, candidate_name, monthly_income, employment_type, guarantor_present, income_ratio, lead_profile, lead_property_address, lead_missing_fields, lead_is_qualified, lead_last_action, lead_last_action_at, prospect_data";

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

// ── Types ProspectRow pour vue Kanban ─────────────────────────────────────────
export type ProspectKanbanRow = {
  id: string;
  email: string;
  nom: string | null;
  prenom: string | null;
  telephone: string | null;
  situation_pro: string | null;
  revenus_mensuels: number | null;
  garant: boolean;
  etape_process: string;
  property_id: string | null;
  property_title: string | null;
  property_rent: number | null;
  lead_score: number;
  last_email_subject: string | null;
  last_email_at: string | null;
  last_email_id: string | null;
  email_count: number;
  dossier_complet: boolean;
  ratio: number | null;
  is_urgent: boolean; // sans réponse >48h
  created_at: string;
  updated_at: string;
};

async function getKanbanProspects(
  userId: string,
  opts: { search: string; status: string; propertyId: string }
): Promise<NextResponse> {
  let query = supabaseAdmin
    .from("prospects")
    .select(`
      id, email, nom, prenom, telephone, situation_pro,
      revenus_mensuels, garant, etape_process, property_id,
      lead_score, dossier_complet, created_at, updated_at,
      properties!prospects_property_id_fkey(title, name, rent)
    `)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (opts.status) {
    query = query.eq("etape_process", opts.status.toUpperCase());
  }
  if (opts.propertyId) {
    query = query.eq("property_id", opts.propertyId);
  }

  const { data: prospects, error } = await query.limit(500);

  if (error) {
    console.error("[PIPELINE_KANBAN] Prospects fetch error:", error);
    return NextResponse.json({ error: "PROSPECTS_FETCH_FAILED", details: error.message }, { status: 500 });
  }

  if (!prospects || prospects.length === 0) {
    return NextResponse.json({ ok: true, prospects: [], total: 0 });
  }

  // Récupérer les stats emails pour chaque prospect
  const prospectIds = prospects.map((p: any) => p.id);
  const { data: emailStats } = await supabaseAdmin
    .from("emails")
    .select("prospect_id, id, subject, received_at")
    .in("prospect_id", prospectIds)
    .order("received_at", { ascending: false });

  // Indexer par prospect_id
  const statsByProspect = new Map<string, { last_email_subject: string | null; last_email_at: string | null; last_email_id: string | null; email_count: number }>();
  for (const e of emailStats ?? []) {
    const pid = (e as any).prospect_id as string;
    if (!statsByProspect.has(pid)) {
      statsByProspect.set(pid, {
        last_email_subject: (e as any).subject ?? null,
        last_email_at: (e as any).received_at ?? null,
        last_email_id: (e as any).id ?? null,
        email_count: 1,
      });
    } else {
      statsByProspect.get(pid)!.email_count++;
    }
  }

  const now = Date.now();
  const URGENT_MS = 48 * 60 * 60 * 1000;

  const rows: ProspectKanbanRow[] = (prospects as any[]).map((p) => {
    const prop = Array.isArray(p.properties) ? p.properties[0] : p.properties;
    const rent = (prop?.rent as number | null) ?? null;
    const revenus = (p.revenus_mensuels as number | null) ?? null;
    const ratio = revenus && rent && rent > 0 ? Math.round((revenus / rent) * 10) / 10 : null;

    const stats = statsByProspect.get(p.id) ?? { last_email_subject: null, last_email_at: null, last_email_id: null, email_count: 0 };
    const lastAt = stats.last_email_at ? new Date(stats.last_email_at).getTime() : null;
    const is_urgent = !!lastAt && now - lastAt > URGENT_MS && !["VALIDE", "REFUSE"].includes(p.etape_process ?? "NEW");

    return {
      id: p.id,
      email: p.email,
      nom: p.nom ?? null,
      prenom: p.prenom ?? null,
      telephone: p.telephone ?? null,
      situation_pro: p.situation_pro ?? null,
      revenus_mensuels: revenus,
      garant: p.garant ?? false,
      etape_process: p.etape_process ?? "NEW",
      property_id: p.property_id ?? null,
      property_title: prop?.title ?? prop?.name ?? null,
      property_rent: rent,
      lead_score: p.lead_score ?? 0,
      last_email_subject: stats.last_email_subject,
      last_email_at: stats.last_email_at,
      last_email_id: stats.last_email_id,
      email_count: stats.email_count,
      dossier_complet: p.dossier_complet ?? false,
      ratio,
      is_urgent,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  });

  // Filtre search côté serveur (après join)
  const filtered = opts.search
    ? rows.filter((r) => {
        const q = opts.search.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
        const name = `${r.nom ?? ""} ${r.prenom ?? ""} ${r.email}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
        return name.includes(q);
      })
    : rows;

  return NextResponse.json({ ok: true, prospects: filtered, total: filtered.length });
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
    const view = searchParams.get("view");

    // ── Vue Kanban prospects ───────────────────────────────────────────────
    if (view === "kanban") {
      return getKanbanProspects(user.id, {
        search: searchParams.get("search")?.trim() || "",
        status: searchParams.get("status")?.trim() || "",
        propertyId: searchParams.get("property_id")?.trim() || "",
      });
    }

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

      // --- ui_status : EtapeProcess en priorité, fallback legacy ---
      const prospectEtape = (e.prospect_data as any)?.etape_process as string | null | undefined;
      const resolvedEtape: EtapeProcess =
        prospectEtape && prospectEtape in ETAPE_PROCESS_META
          ? (prospectEtape as EtapeProcess)
          : LEGACY_STATUS_TO_ETAPE[e.lead_status ?? "raw"] ?? "NEW";
      const ui_status: string | null =
        e.decision === "ignorer"
          ? "ignored"
          : ETAPE_PROCESS_META[resolvedEtape]?.uiStatus ?? null;

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
