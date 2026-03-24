import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Body = {
  window_days?: 7 | 30;
  limit?: number;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    let body: Body = {};
    try {
      const raw = await req.json();
      if (raw && typeof raw === "object") {
        body = raw as Body;
      }
    } catch {
      body = {};
    }

    const windowDays = body.window_days === 30 ? 30 : 7;
    const fromIso = isoDaysAgo(windowDays);

    const rawLimit = typeof body.limit === "number" ? body.limit : 500;
    const limit = Math.max(1, Math.min(rawLimit, 1000));

    const { data: rows, error: listErr } = await supabaseAdmin
      .from("emails_cache")
      .select(
        "gmail_message_id, outlook_message_id, lead_status, lead_score, lead_json, analyzed_at, received_at",
      )
      .eq("user_id", user.id)
      .not("analyzed_at", "is", null)
      .gte("received_at", fromIso)
      .order("received_at", { ascending: false })
      .limit(limit);

    if (listErr) {
      return NextResponse.json(
        { ok: false, error: "LIST_FAILED", detail: listErr.message },
        { status: 500 },
      );
    }

    const emailRows =
      (rows as {
        gmail_message_id: string | null;
        outlook_message_id: string | null;
        lead_status: string | null;
        lead_score: number | null;
        lead_json: any;
        analyzed_at: string | null;
        received_at: string | null;
      }[]) ?? [];

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let not_found = 0;

    for (const row of emailRows) {
      scanned += 1;

      const gmailId = row.gmail_message_id;
      const outlookId = row.outlook_message_id;

      if (!gmailId && !outlookId) {
        skipped += 1;
        continue;
      }

      const updatePayload: any = {};
      if (row.lead_status != null) updatePayload.lead_status = row.lead_status;
      if (row.lead_score != null) updatePayload.lead_score = row.lead_score;
      if (row.lead_json != null) {
        updatePayload.lead_json =
          typeof row.lead_json === "string"
            ? JSON.parse(row.lead_json)
            : row.lead_json;
      }      if (row.analyzed_at != null) updatePayload.analyzed_at = row.analyzed_at;

      if (Object.keys(updatePayload).length === 0) {
        skipped += 1;
        continue;
      }

      try {
        let res:
          | {
              data: { id: string }[] | null;
              error: { message: string } | null;
            }
          | undefined;
        if (gmailId) {
          res = await supabaseAdmin
            .from("emails")
            .update(updatePayload)
            .eq("user_id", user.id)
            .eq("gmail_message_id", gmailId)
            .select("id");
        } else if (outlookId) {
          res = await supabaseAdmin
            .from("emails")
            .update(updatePayload)
            .eq("user_id", user.id)
            .eq("provider", "microsoft")
            .eq("provider_message_id", outlookId)
            .select("id");
        } else {
          skipped += 1;
          continue;
        }

        if (res && res.error) {
          console.warn("[PROPAGATE_FROM_CACHE] UPDATE_EMAILS_ERROR", {
            user_id: user.id,
            gmail_message_id: gmailId,
            error: res.error.message,
          });
        } else if (res && (res.data?.length ?? 0) > 0) {
          updated += 1;
        } else {
          not_found += 1;
        }
      } catch (e: any) {
        console.warn("[PROPAGATE_FROM_CACHE] UPDATE_EMAILS_THROW", {
          user_id: user.id,
          gmail_message_id: gmailId,
          error: e?.message ?? String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      updated,
      skipped,
      not_found,
      window_days: windowDays,
      limit,
    });
  } catch (e: any) {
    console.error("[PROPAGATE_FROM_CACHE] FATAL", {
      error: e?.message ?? String(e),
      stack: e?.stack,
    });
    return NextResponse.json(
      { ok: false, error: "PROPAGATE_FROM_CACHE_FATAL", detail: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}

